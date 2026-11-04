-- Revision 2: lease v4 before enqueueing legacy fixtures; no timestamp or quota edits.
-- Bounded SQL-role rollback audit of the installed v1/v2/v3/v4 queue, respecting already-used UTC slots. No Auth user,
-- source, Storage object, model or Calendar operation is created or changed.
-- Local claims test SQL policies; this is NOT signed-JWT or contention proof.
begin isolation level repeatable read;
set local lock_timeout='2s';
set local statement_timeout='20s';
-- Freeze the queue/preconditions and protected row sets for this short audit.
-- A concurrent real writer makes lock acquisition fail safely rather than race.
lock table public.tracker_members,public.sources,public.opportunities,public.occurrences,public.milestones,public.user_decisions,tracker_private.calendar_write_commands in share mode;
lock table public.extraction_jobs,public.extraction_attempts,public.manual_intakes in share row exclusive mode;
do $$
declare
 owner uuid; other uuid:=gen_random_uuid(); day_start timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 intake uuid; later_intake uuid; j1 public.extraction_jobs; j2 public.extraction_jobs; legacy2 public.extraction_jobs; legacy3 public.extraction_jobs; again public.extraction_jobs; later public.extraction_jobs; leased public.extraction_jobs;
 fixture_jobs uuid[]; fixture_intakes uuid[]; claimed uuid[]:='{}'; checks jsonb:='[]';
 note text:='SYNTHETIC v4 rollback audit 🎻'; output jsonb; bad jsonb;
 passed boolean; denied boolean; unsupported_denied boolean; null_denied boolean;
 jobs_before text; attempts_before text; intakes_before text; facts_before text; decisions_before text; commands_before text; sources_before text;
 existing_jobs bigint; baseline_used integer; remaining_slots integer; baseline_attempts integer; baseline_visual_pages integer; functions_before text; retry_floor_denied boolean:=false; finish_tested boolean:=false;
begin
 if (select count(*) from public.tracker_members)<>1 then raise exception 'Audit requires exactly one existing registered owner';end if;
 select user_id into owner from public.tracker_members;
 if owner=other then other:=gen_random_uuid();end if;
 if exists(select 1 from public.extraction_jobs where state in('queued','processing')) then raise exception 'Audit stopped: real queued/processing jobs exist; no queue, quota or lease will be reset';end if;
 select count(*) into baseline_used from public.extraction_jobs where owner_id=owner and first_started_at>=day_start;
 if baseline_used>2 then raise exception 'Audit stopped: current UTC job budget exceeds installed limit; no counters will be reset';end if;
 remaining_slots:=2-baseline_used;
 select count(*),coalesce(sum(visual_pages),0) into baseline_attempts,baseline_visual_pages from public.extraction_attempts where owner_id=owner and started_at>=day_start;
 select encode(sha256(convert_to(jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'definition',pg_get_functiondef(p.oid)) order by p.oid)::text,'UTF8')),'hex') into functions_before from pg_proc p
 where p.oid in('public.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_enqueue(text,uuid,text)'::regprocedure,'public.extraction_claim(integer,integer)'::regprocedure,'tracker_private.extraction_claim(integer,integer)'::regprocedure,'public.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'tracker_private.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'public.extraction_retry(uuid)'::regprocedure,'tracker_private.extraction_retry(uuid)'::regprocedure);
 select count(*) into existing_jobs from public.extraction_jobs;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') into jobs_before from public.extraction_jobs t;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') into attempts_before from public.extraction_attempts t;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') into intakes_before from public.manual_intakes t;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') into sources_before from public.sources t;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') into decisions_before from public.user_decisions t;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') into commands_before from tracker_private.calendar_write_commands t;
 select encode(sha256(convert_to(jsonb_build_object(
  'opportunities',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.opportunities t),
  'occurrences',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.occurrences t),
  'milestones',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.milestones t))::text,'UTF8')),'hex') into facts_before;
 passed:=has_function_privilege('authenticated','public.extraction_enqueue(text,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.extraction_enqueue(text,uuid,text)','EXECUTE')
  and not has_function_privilege('service_role','public.extraction_enqueue(text,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.extraction_claim(integer,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.extraction_claim(integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.extraction_claim(integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.extraction_finish(uuid,uuid,text,jsonb,text,integer)','EXECUTE')
  and not has_function_privilege('service_role','public.calendar_write_approve(text,uuid,text,timestamptz,timestamptz)','EXECUTE')
  and not has_table_privilege('authenticated','public.extraction_jobs','INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role','public.extraction_jobs','INSERT,UPDATE,DELETE')
  and (select not prosecdef from pg_proc where oid='public.extraction_enqueue(text,uuid,text)'::regprocedure)
  and (select relrowsecurity from pg_class where oid='public.extraction_jobs'::regclass);
 checks:=checks||jsonb_build_array(jsonb_build_object('test','owner_worker_rpc_and_rls_boundaries','passed',passed));
 insert into public.manual_intakes(owner_id,note,media,submission_key) values(owner,note,'[]'::jsonb,gen_random_uuid()) returning id into intake;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 -- Claim v4 while it is the ONLY queued fixture. created_at defaults to
 -- transaction time, so enqueue order alone cannot break UUID ordering ties.
 select * into j2 from public.extraction_enqueue('manual',intake);
 execute 'reset role';
 if remaining_slots>0 then
  execute 'set local role service_role';
  select * into strict leased from public.extraction_claim(1,180);
  if leased.id<>j2.id or leased.extractor_version<>'stage2-rules-v4' then raise exception 'Audit stopped: initial lease did not select the sole v4 fixture';end if;
  j2:=leased;claimed:=array_append(claimed,j2.id);
  execute 'reset role';
 end if;
 execute 'set local role authenticated';
 select * into j1 from public.extraction_enqueue('manual',intake,'stage2-rules-v1');
 select * into legacy2 from public.extraction_enqueue('manual',intake,'stage2-rules-v2');
 select * into legacy3 from public.extraction_enqueue('manual',intake,'stage2-rules-v3');
 select * into again from public.extraction_enqueue('manual',intake,'stage2-rules-v4');
 select count(*)=4 into passed from public.extraction_jobs where id in(j1.id,j2.id,legacy2.id,legacy3.id);
 execute 'reset role';
 fixture_jobs:=array[j1.id,j2.id,legacy2.id,legacy3.id];fixture_intakes:=array[intake];
 checks:=checks||jsonb_build_array(jsonb_build_object('test','v4_default_and_v1_v2_v3_explicit_requests_have_immutable_idempotent_identities','passed',passed and j1.extractor_version='stage2-rules-v1' and legacy2.extractor_version='stage2-rules-v2' and legacy3.extractor_version='stage2-rules-v3' and j2.extractor_version='stage2-rules-v4' and j2.id=again.id and j1.id<>j2.id and j1.input_hash<>j2.input_hash and legacy2.input_hash<>j2.input_hash and legacy3.input_hash<>j2.input_hash and j1.input_snapshot=j2.input_snapshot and legacy2.input_snapshot=j2.input_snapshot and legacy3.input_snapshot=j2.input_snapshot and j2.input_snapshot->'publishedAt'='null'::jsonb));
 execute 'set local role authenticated';
 unsupported_denied:=false;begin perform public.extraction_enqueue('manual',intake,'unsupported-v99');exception when raise_exception then unsupported_denied:=position('unsupported extractor version' in sqlerrm)>0;end;
 null_denied:=false;begin perform public.extraction_enqueue('manual',intake,null);exception when raise_exception then null_denied:=position('unsupported extractor version' in sqlerrm)>0;end;
 execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','unsupported_and_null_versions_never_enter_the_queue','passed',unsupported_denied and null_denied and (select count(*)=4 from public.extraction_jobs where manual_intake_id=intake)));
 perform set_config('request.jwt.claim.sub',other::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
 execute 'set local role authenticated';select count(*)=0 into passed from public.extraction_jobs;
 denied:=false;begin perform public.extraction_enqueue('manual',intake);exception when insufficient_privilege then denied:=true;end;
 execute 'reset role';passed:=passed and denied;
 execute 'set local role anon';denied:=false;begin perform count(*) from public.extraction_jobs;exception when insufficient_privilege then denied:=true;end;execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','nonmember_local_claims_and_anonymous_cannot_read_or_enqueue_owner_work','passed',passed and denied));
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 execute 'set local role service_role';
 if remaining_slots>1 then
  for leased in select * from public.extraction_claim(remaining_slots-1,180) loop
   if not(leased.id=any(fixture_jobs)) or leased.id=any(claimed) then raise exception 'Audit stopped: lease selected non-fixture or duplicate work';end if;
   claimed:=array_append(claimed,leased.id);
   if leased.id=j1.id then j1:=leased;elsif leased.id=legacy2.id then legacy2:=leased;elsif leased.id=legacy3.id then legacy3:=leased;else raise exception 'Audit stopped: second claim unexpectedly selected current v4';end if;
  end loop;
 end if;
 select count(*)=0 into passed from public.extraction_claim(1,180);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','worker_leases_exact_remaining_fixture_slots_without_touching_existing_used_budget','passed',passed and cardinality(claimed)=remaining_slots and (remaining_slots=0 or j2.id=any(claimed)),'baselineUsedJobSlots',baseline_used,'fixtureClaims',cardinality(claimed)));
 output:=jsonb_build_object('version','stage2-result-v1','complete',true,'issues','[]'::jsonb,
  'units',jsonb_build_array(jsonb_build_object('assetId','text','page',null,'status','processed','text',note,'method','provided-text','sha256',encode(sha256(convert_to(note,'UTF8')),'hex'),'issues','[]'::jsonb)),
  'candidates',jsonb_build_array(jsonb_build_object('key','synthetic','kind','event','fields',jsonb_build_object('title',note),'claims',jsonb_build_array(jsonb_build_object('field','title','value',note,'evidence',jsonb_build_array(jsonb_build_object('unitId','text:0','start',0,'end',length(note)+1,'quote',note)))),'issues','[]'::jsonb)),
  'stats',jsonb_build_object('processedAssets',0,'expectedAssets',0,'processedPages',0,'engine','synthetic-sql-role-audit/stage2-rules-v4','elapsedMs',1));
 if remaining_slots>0 then
  finish_tested:=true;
  execute 'set local role service_role';
  denied:=false;begin perform public.extraction_finish(j2.id,gen_random_uuid(),'succeeded',output);exception when serialization_failure then denied:=true;end;
  bad:=jsonb_set(output,'{candidates,0,claims,0,evidence,0,quote}','"fabricated"');
  unsupported_denied:=false;begin perform public.extraction_finish(j2.id,j2.lease_token,'succeeded',bad);exception when raise_exception then unsupported_denied:=position('Evidence span' in sqlerrm)>0;end;
  execute 'reset role';
  -- A nested rollback branch tests the real owner retry floor without waiting,
  -- editing timestamps, resetting quotas or retaining a failed fixture result.
  begin
   execute 'set local role service_role';
   perform public.extraction_finish(j2.id,j2.lease_token,'failed',jsonb_set(output,'{complete}','false'),'synthetic_audit_retry',0);
   execute 'reset role';
   execute 'set local role authenticated';
   begin perform public.extraction_retry(j2.id);exception when raise_exception then retry_floor_denied:=position('Extraction retry unavailable' in sqlerrm)>0;end;
   execute 'reset role';
   raise exception using errcode='Z0001',message='Rollback only synthetic retry-floor branch';
  exception when sqlstate 'Z0001' then null;
  end;
  execute 'set local role service_role';
  perform public.extraction_finish(j2.id,j2.lease_token,'succeeded',output);
  execute 'reset role';
  passed:=(select state='succeeded' and result=output from public.extraction_jobs where id=j2.id);
  -- The remaining legacy lease may be v1, v2 OR v3 when their transaction
  -- timestamps tie. Finish the actual returned job/version, never a guess.
  for leased in select * from public.extraction_jobs where id=any(claimed) and id<>j2.id loop
   output:=jsonb_set(output,'{stats,engine}',to_jsonb('synthetic-sql-role-audit/'||leased.extractor_version));
   execute 'set local role service_role';perform public.extraction_finish(leased.id,leased.lease_token,'succeeded',output);execute 'reset role';
  end loop;
 else denied:=true;unsupported_denied:=true;passed:=true;retry_floor_denied:=true;
 end if;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','available_v4_fixture_finish_fences_lease_and_utf16_and_denies_early_owner_retry','passed',denied and unsupported_denied and passed and retry_floor_denied and (select count(*)=remaining_slots from public.extraction_attempts where job_id=any(fixture_jobs) and state='succeeded' and visual_pages=0),'finishActuallyTested',finish_tested,'skipReason',case when finish_tested then null else 'Both real UTC slots already used; enqueue/denial tested, no fixture lease or finish claimed' end));
 insert into public.manual_intakes(owner_id,note,media,submission_key) values(owner,'SYNTHETIC overflow checks all-version shared budget','[]'::jsonb,gen_random_uuid()) returning id into later_intake;
 execute 'set local role authenticated';select * into later from public.extraction_enqueue('manual',later_intake);execute 'reset role';
 fixture_jobs:=array_append(fixture_jobs,later.id);fixture_intakes:=array_append(fixture_intakes,later_intake);
 execute 'set local role service_role';select count(*)=0 into passed from public.extraction_claim(1,180);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','v1_v2_v3_v4_share_remaining_utc_budget_without_resetting_existing_work','passed',passed and later.extractor_version='stage2-rules-v4' and (select attempts=0 and state='queued' from public.extraction_jobs where id=later.id) and (select count(*)=remaining_slots from public.extraction_attempts where job_id=any(fixture_jobs))));
 passed:=functions_before=(select encode(sha256(convert_to(jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'definition',pg_get_functiondef(p.oid)) order by p.oid)::text,'UTF8')),'hex') from pg_proc p where p.oid in('public.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_enqueue(text,uuid,text)'::regprocedure,'public.extraction_claim(integer,integer)'::regprocedure,'tracker_private.extraction_claim(integer,integer)'::regprocedure,'public.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'tracker_private.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'public.extraction_retry(uuid)'::regprocedure,'tracker_private.extraction_retry(uuid)'::regprocedure))
  and jobs_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.extraction_jobs t where not(id=any(fixture_jobs)))
  and attempts_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.extraction_attempts t where not(job_id=any(fixture_jobs)))
  and intakes_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.manual_intakes t where not(id=any(fixture_intakes)))
  and sources_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.sources t)
  and decisions_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.user_decisions t)
  and commands_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from tracker_private.calendar_write_commands t);
 select passed and facts_before=encode(sha256(convert_to(jsonb_build_object(
  'opportunities',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.opportunities t),
  'occurrences',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.occurrences t),
  'milestones',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.milestones t))::text,'UTF8')),'hex') into passed;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','all_existing_jobs_attempts_intakes_sources_facts_decisions_and_calendar_commands_keep_full_sha256','passed',passed));
 if (date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')<>day_start then raise exception 'Audit crossed UTC midnight; rollback without claiming a result';end if;
 if jsonb_array_length(checks)<>8 or exists(select 1 from jsonb_array_elements(checks) c where (c->>'passed')::boolean is distinct from true) then raise exception 'Version audit failed: %',checks;end if;
 perform set_config('tracker.stage2_v4_audit',jsonb_build_object('checkedAt',clock_timestamp(),'passed',jsonb_array_length(checks),'checks',checks,'checksActuallyExercised',case when finish_tested then 8 else 7 end,'skippedChecks',case when finish_tested then '[]'::jsonb else '["v4_lease_finish_utf16_retry_guards_budget_exhausted"]'::jsonb end,
  'existingJobCount',existing_jobs,'baselineUsedUtcJobs',baseline_used,'baselineUtcAttempts',baseline_attempts,'baselineUtcVisualPages',baseline_visual_pages,'remainingUtcJobSlots',remaining_slots,'fixtureClaims',cardinality(claimed),'v4ClaimedBeforeLegacyEnqueue',remaining_slots>0,'firstClaimedVersion',case when remaining_slots>0 then 'stage2-rules-v4' else null end,'claimedVersions',(select coalesce(jsonb_agg(extractor_version order by array_position(claimed,id)),'[]'::jsonb) from public.extraction_jobs where id=any(claimed)),'v4FinishActuallyTested',finish_tested,'functionDefinitionsOidsAclsAndConfigurationPreserved',true,'existingRealRowsFullHashesPreserved',true,'persistentRowsChanged',0,
  'fixtureClass','Temporary synthetic notes through installed owner/worker RPCs and transaction-local SQL role claims; not native processing, signed-JWT, Storage HTTP or independent-session contention',
  'authUsersCreated',0,'sourcesCreated',0,'googleCalls',0,'storageHttpCalls',0,'modelCalls',0,'independentConnectionsTested',false,
  'safePreconditions','Exactly one owner; no real queued/processing work; respects 2 minus existing current-UTC-day jobs; no real queued work; short table locks; repeatable read; 2s lock and 20s statement limits; no resets/deletes')::text,true);
end $$;
select current_setting('tracker.stage2_v4_audit')::jsonb as stage2_v4_audit;
rollback;
