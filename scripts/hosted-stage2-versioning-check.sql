-- Bounded SQL-role rollback audit of the installed v1/v2 queue. No Auth user,
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
 intake uuid; later_intake uuid; j1 public.extraction_jobs; j2 public.extraction_jobs; again public.extraction_jobs; later public.extraction_jobs; leased public.extraction_jobs;
 fixture_jobs uuid[]; fixture_intakes uuid[]; claimed uuid[]:='{}'; checks jsonb:='[]';
 note text:='SYNTHETIC v2 rollback audit 🎻'; output jsonb; bad jsonb;
 passed boolean; denied boolean; unsupported_denied boolean; null_denied boolean;
 jobs_before text; attempts_before text; intakes_before text; facts_before text; decisions_before text; commands_before text; sources_before text;
 existing_jobs bigint;
begin
 if (select count(*) from public.tracker_members)<>1 then raise exception 'Audit requires exactly one existing registered owner';end if;
 select user_id into owner from public.tracker_members;
 if owner=other then other:=gen_random_uuid();end if;
 if exists(select 1 from public.extraction_jobs where state in('queued','processing')) then raise exception 'Audit stopped: real queued/processing jobs exist; no queue, quota or lease will be reset';end if;
 if exists(select 1 from public.extraction_jobs where first_started_at>=day_start) or exists(select 1 from public.extraction_attempts where started_at>=day_start)
 then raise exception 'Audit stopped: the current UTC extraction budget has already been used; no counters will be reset';end if;
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
 select * into j1 from public.extraction_enqueue('manual',intake,'stage2-rules-v1');
 select * into j2 from public.extraction_enqueue('manual',intake);
 select * into again from public.extraction_enqueue('manual',intake,'stage2-rules-v2');
 select count(*)=2 into passed from public.extraction_jobs where id in(j1.id,j2.id);
 execute 'reset role';
 fixture_jobs:=array[j1.id,j2.id];fixture_intakes:=array[intake];
 checks:=checks||jsonb_build_array(jsonb_build_object('test','v2_default_and_v1_explicit_requests_have_immutable_idempotent_identities','passed',passed and j1.extractor_version='stage2-rules-v1' and j2.extractor_version='stage2-rules-v2' and j2.id=again.id and j1.id<>j2.id and j1.input_hash<>j2.input_hash and j1.input_snapshot=j2.input_snapshot and j2.input_snapshot->'publishedAt'='null'::jsonb));
 execute 'set local role authenticated';
 unsupported_denied:=false;begin perform public.extraction_enqueue('manual',intake,'unsupported-v99');exception when raise_exception then unsupported_denied:=position('unsupported extractor version' in sqlerrm)>0;end;
 null_denied:=false;begin perform public.extraction_enqueue('manual',intake,null);exception when raise_exception then null_denied:=position('unsupported extractor version' in sqlerrm)>0;end;
 execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','unsupported_and_null_versions_never_enter_the_queue','passed',unsupported_denied and null_denied and (select count(*)=2 from public.extraction_jobs where manual_intake_id=intake)));
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
 for leased in select * from public.extraction_claim(2,180) loop
  if not(leased.id=any(fixture_jobs)) then raise exception 'Audit stopped: lease selected non-fixture work';end if;
  claimed:=array_append(claimed,leased.id);
  if leased.id=j1.id then j1:=leased;else j2:=leased;end if;
 end loop;
 select count(*)=0 into passed from public.extraction_claim(1,180);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','worker_leases_only_the_two_fixture_versions_and_excludes_active_leases','passed',passed and cardinality(claimed)=2 and j1.id=any(claimed) and j2.id=any(claimed) and j1.attempts=1 and j2.attempts=1 and j1.visual_page_budget=0 and j2.visual_page_budget=0));
 output:=jsonb_build_object('version','stage2-result-v1','complete',true,'issues','[]'::jsonb,
  'units',jsonb_build_array(jsonb_build_object('assetId','text','page',null,'status','processed','text',note,'method','provided-text','sha256',encode(sha256(convert_to(note,'UTF8')),'hex'),'issues','[]'::jsonb)),
  'candidates',jsonb_build_array(jsonb_build_object('key','synthetic','kind','event','fields',jsonb_build_object('title',note),'claims',jsonb_build_array(jsonb_build_object('field','title','value',note,'evidence',jsonb_build_array(jsonb_build_object('unitId','text:0','start',0,'end',length(note)+1,'quote',note)))),'issues','[]'::jsonb)),
  'stats',jsonb_build_object('processedAssets',0,'expectedAssets',0,'processedPages',0,'engine','synthetic-sql-role-audit/stage2-rules-v2','elapsedMs',1));
 execute 'set local role service_role';
 denied:=false;begin perform public.extraction_finish(j2.id,gen_random_uuid(),'succeeded',output);exception when serialization_failure then denied:=true;end;
 bad:=jsonb_set(output,'{candidates,0,claims,0,evidence,0,quote}','"fabricated"');
 unsupported_denied:=false;begin perform public.extraction_finish(j2.id,j2.lease_token,'succeeded',bad);exception when raise_exception then unsupported_denied:=position('Evidence span' in sqlerrm)>0;end;
 perform public.extraction_finish(j2.id,j2.lease_token,'succeeded',output);execute 'reset role';
 passed:=(select state='succeeded' and result=output from public.extraction_jobs where id=j2.id);
 output:=jsonb_set(output,'{stats,engine}','"synthetic-sql-role-audit/stage2-rules-v1"');
 execute 'set local role service_role';perform public.extraction_finish(j1.id,j1.lease_token,'succeeded',output);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','v2_finish_fences_lease_validates_exact_utf16_spans_and_retains_result','passed',denied and unsupported_denied and passed and (select count(*)=2 from public.extraction_attempts where job_id=any(fixture_jobs) and state='succeeded' and visual_pages=0)));
 insert into public.manual_intakes(owner_id,note,media,submission_key) values(owner,'SYNTHETIC third job checks shared budget','[]'::jsonb,gen_random_uuid()) returning id into later_intake;
 execute 'set local role authenticated';select * into later from public.extraction_enqueue('manual',later_intake);execute 'reset role';
 fixture_jobs:=array_append(fixture_jobs,later.id);fixture_intakes:=array_append(fixture_intakes,later_intake);
 execute 'set local role service_role';select count(*)=0 into passed from public.extraction_claim(1,180);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','v1_and_v2_share_the_two_new_jobs_utc_budget_without_resetting_it','passed',passed and later.extractor_version='stage2-rules-v2' and (select attempts=0 and state='queued' from public.extraction_jobs where id=later.id) and (select count(*)=2 from public.extraction_attempts where job_id=any(fixture_jobs))));
 passed:=jobs_before=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.extraction_jobs t where not(id=any(fixture_jobs)))
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
 perform set_config('tracker.stage2_versioning_audit',jsonb_build_object('checkedAt',clock_timestamp(),'passed',jsonb_array_length(checks),'checks',checks,
  'existingJobCount',existing_jobs,'existingRealRowsFullHashesPreserved',true,'persistentRowsChanged',0,
  'fixtureClass','Temporary synthetic notes through installed owner/worker RPCs and transaction-local SQL role claims; not native processing, signed-JWT, Storage HTTP or independent-session contention',
  'authUsersCreated',0,'sourcesCreated',0,'googleCalls',0,'storageHttpCalls',0,'modelCalls',0,'independentConnectionsTested',false,
  'safePreconditions','Exactly one owner; no real queued/processing work; no current-UTC-day budget used; short table locks; repeatable read; 2s lock and 20s statement limits; no resets/deletes')::text,true);
end $$;
select current_setting('tracker.stage2_versioning_audit')::jsonb as stage2_versioning_audit;
rollback;
