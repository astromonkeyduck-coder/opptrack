-- First-release audit: after migration, before real extraction jobs are queued.
-- Synthetic SQL metadata only; no Storage, Google, model or network calls.
-- Rollback preserves real rows. Review identity sequences can retain normal gaps.
begin isolation level repeatable read;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$
declare
 owner uuid; other uuid:=gen_random_uuid(); nonce text:=gen_random_uuid()::text;
 intake uuid; ig uuid; capture_a uuid; capture_b uuid; program_a uuid; program_b uuid; occurrence_a uuid; occurrence_b uuid;
 source_a text;source_b text; j public.extraction_jobs; j2 public.extraction_jobs; again public.extraction_jobs;
 link public.reconciliation_links; cmd jsonb; cp jsonb; rp jsonb;
 note text:='Synthetic 🎻 event tomorrow'; output jsonb; bad jsonb; media jsonb; blocked_pages jsonb;
 denied boolean; passed boolean; checks jsonb:='[]'; r record;
 source_before text; decision_before text; commands_before text; normalized_before text; connection_before text;
begin
 if (select count(*) from public.tracker_members)<>1 then raise exception 'Audit requires exactly one registered owner';end if;
 if exists(select 1 from public.extraction_jobs) then raise exception 'First-release audit requires no extraction jobs; it will not alter a real queue or reset its budget';end if;
 select user_id into owner from public.tracker_members;
 if not exists(select 1 from tracker_private.google_calendar_connections where owner_id=owner and scope='https://www.googleapis.com/auth/calendar.events.owned') then raise exception 'Alias audit requires an existing owned-event grant; no credential or scope is changed';end if;
 source_a:='audit-stage2-a-'||nonce;source_b:='audit-stage2-b-'||nonce;
 select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by id),'')) into source_before from public.sources s;
 select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),'')) into decision_before from public.user_decisions d;
 select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),'')) into commands_before from tracker_private.calendar_write_commands c;
 select md5(coalesce(string_agg(x::text,'' order by x::text),'')) into normalized_before from (
  select to_jsonb(o) x from public.opportunities o union all select to_jsonb(o) from public.occurrences o union all select to_jsonb(o) from public.milestones o) t;
 select md5(concat_ws('|',scope,revision,authorization_generation,updated_at)) into connection_before from tracker_private.google_calendar_connections where owner_id=owner;
 for r in select * from (values('extraction_jobs'),('extraction_attempts'),('reconciliation_links'),('reconciliation_history')) t(name) loop
  select relrowsecurity and not has_table_privilege('anon','public.'||r.name,'SELECT,INSERT,UPDATE,DELETE')
   and not has_table_privilege('authenticated','public.'||r.name,'INSERT,UPDATE,DELETE') and not has_table_privilege('service_role','public.'||r.name,'INSERT,UPDATE,DELETE')
   into passed from pg_class where oid=('public.'||r.name)::regclass;
  checks:=checks||jsonb_build_array(jsonb_build_object('test',r.name||'_owner_rls_no_direct_mutations','passed',passed));
 end loop;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','owner_worker_rpc_boundaries','passed',
  has_function_privilege('authenticated','public.extraction_enqueue(text,uuid,text)','EXECUTE') and not has_function_privilege('service_role','public.extraction_enqueue(text,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.extraction_claim(integer,integer)','EXECUTE') and not has_function_privilege('authenticated','public.extraction_claim(integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.extraction_enqueue(text,uuid,text)','EXECUTE') and not has_function_privilege('service_role','public.calendar_write_approve(text,uuid,text,timestamptz,timestamptz)','EXECUTE')));
 media:=jsonb_build_array(jsonb_build_object('storage_path',owner::text||'/manual/synthetic-audit/01-'||repeat('a',64)||'.png','mime_type','image/png','byte_count',24),
  jsonb_build_object('storage_path',owner::text||'/manual/synthetic-audit/02-'||repeat('a',64)||'.png','mime_type','image/png','byte_count',24));
 insert into public.manual_intakes(owner_id,note,media,submission_key) values(owner,note,media,gen_random_uuid()) returning id into intake;
 perform set_config('request.jwt.claim.sub',owner::text,true);execute 'set local role authenticated';
 select * into j from public.extraction_enqueue('manual',intake);select * into again from public.extraction_enqueue('manual',intake);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','enqueue_idempotent_manual_publication_unknown','passed',j.id=again.id and j.input_snapshot->'publishedAt'='null'::jsonb and j.input_snapshot->'media'->0->>'assetId'='1' and j.input_snapshot->'media'->1->>'assetId'='2'));
 execute 'set local role service_role';select * into strict j from public.extraction_claim(1,180);select count(*)=0 into passed from public.extraction_claim(1,180);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','active_lease_excludes_duplicate_claim','passed',passed and j.attempts=1 and j.visual_page_budget=12));
 output:=jsonb_build_object('version','stage2-result-v1','complete',true,'issues','[]'::jsonb,
  'units',jsonb_build_array(jsonb_build_object('assetId','text','page',null,'status','processed','text',note,'method','provided-text','sha256',encode(sha256(convert_to(note,'UTF8')),'hex'),'issues','[]'::jsonb),
   jsonb_build_object('assetId','1','page',null,'status','processed','text','Synthetic slide one','method','ocr','sha256',repeat('a',64),'issues','[]'::jsonb),
   jsonb_build_object('assetId','2','page',null,'status','processed','text','Synthetic slide two','method','ocr','sha256',repeat('a',64),'issues','[]'::jsonb)),
  'candidates',jsonb_build_array(jsonb_build_object('key','synthetic','kind','event','fields',jsonb_build_object('title',note),
   'claims',jsonb_build_array(jsonb_build_object('field','title','value',note,'evidence',jsonb_build_array(jsonb_build_object('unitId','text:0','start',0,'end',length(note)+1,'quote',note)))),'issues','[]'::jsonb)),
  'stats',jsonb_build_object('processedAssets',2,'expectedAssets',2,'processedPages',2,'engine','synthetic-sql-audit','elapsedMs',1));
 execute 'set local role service_role';
 denied:=false;begin perform public.extraction_finish(j.id,gen_random_uuid(),'succeeded',output);exception when serialization_failure then denied:=true;end;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','wrong_lease_cannot_finish','passed',denied));
 bad:=jsonb_set(output,'{candidates,0,claims,0,evidence,0,quote}','"fabricated"');
 denied:=false;begin perform public.extraction_finish(j.id,j.lease_token,'succeeded',bad);exception when others then denied:=true;end;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','unsupported_span_rejected','passed',denied));
 bad:=jsonb_set(output,'{units}',(output->'units')-2);
 denied:=false;begin perform public.extraction_finish(j.id,j.lease_token,'succeeded',bad);exception when others then denied:=true;end;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','missing_slide_cannot_succeed','passed',denied));
 perform public.extraction_finish(j.id,j.lease_token,'succeeded',output);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','exact_utf16_evidence_and_two_slides_retained','passed',
  (select state='succeeded' and result=output from public.extraction_jobs where id=j.id) and (select visual_pages=2 from public.extraction_attempts where job_id=j.id)));
 -- Isolated subtransactions test the remaining reservation without resetting a
 -- quota or leaving an extra started job in the following audit scenarios.
 begin
  insert into public.manual_intakes(owner_id,note,media,submission_key) values(owner,note,jsonb_build_array(media->0),gen_random_uuid()) returning id into intake;
  execute 'set local role authenticated';perform public.extraction_enqueue('manual',intake);execute 'reset role';
  execute 'set local role service_role';select * into strict j2 from public.extraction_claim(1,180);execute 'reset role';
  bad:=jsonb_set(output,'{units}',jsonb_build_array(output->'units'->0,jsonb_build_object('assetId','1','page',null,'status','blocked','text','','method','ocr','sha256',null,'issues',jsonb_build_array('Native work unconfirmed'))));
  bad:=jsonb_set(jsonb_set(bad,'{complete}','false'),'{stats}',jsonb_build_object('processedAssets',0,'expectedAssets',1,'processedPages',0,'engine','synthetic-sql-audit','elapsedMs',1,'visualWorkUncertain',true));
  execute 'set local role service_role';perform public.extraction_finish(j2.id,j2.lease_token,'failed',bad,'native_work_unconfirmed');execute 'reset role';
  checks:=checks||jsonb_build_array(jsonb_build_object('test','unknown_native_work_charges_full_remaining_reservation','passed',
   (select visual_pages=j2.visual_page_budget and visual_pages=10 from public.extraction_attempts where job_id=j2.id) and (select sum(visual_pages)=12 from public.extraction_attempts)));
  raise exception using errcode='P7001',message='Expected rollback of synthetic native-uncertainty subcase';
 exception when sqlstate 'P7001' then null;end;
 begin
  insert into public.manual_intakes(owner_id,note,media,submission_key) values(owner,note,jsonb_build_array(jsonb_set(media->0,'{mime_type}','"application/pdf"')),gen_random_uuid()) returning id into intake;
  execute 'set local role authenticated';perform public.extraction_enqueue('manual',intake);execute 'reset role';
  execute 'set local role service_role';select * into strict j2 from public.extraction_claim(1,180);execute 'reset role';
  select jsonb_agg(jsonb_build_object('assetId','1','page',i,'expectedPages',j2.visual_page_budget,'status','blocked','attempted',true,'text','','method','pdf-text-and-ocr','sha256',null,'issues',jsonb_build_array('Native deadline after attempt')) order by i) into blocked_pages from generate_series(1,j2.visual_page_budget) i;
  bad:=jsonb_set(output,'{units}',jsonb_build_array(output->'units'->0)||blocked_pages);
  bad:=jsonb_set(jsonb_set(bad,'{complete}','false'),'{stats}',jsonb_build_object('processedAssets',0,'expectedAssets',1,'processedPages',0,'engine','synthetic-sql-audit','elapsedMs',1));
  execute 'set local role service_role';perform public.extraction_finish(j2.id,j2.lease_token,'partial',bad,'native_deadline');execute 'reset role';
  checks:=checks||jsonb_build_array(jsonb_build_object('test','blocked_but_attempted_pages_consume_remaining_visual_budget','passed',
   (select visual_pages=j2.visual_page_budget and visual_pages=10 from public.extraction_attempts where job_id=j2.id) and (select sum(visual_pages)=12 from public.extraction_attempts)));
  raise exception using errcode='P7002',message='Expected rollback of synthetic attempted-page subcase';
 exception when sqlstate 'P7002' then null;end;
 insert into public.sources(id,owner_id,name,adapter,url,enabled,coverage_note)
 values(source_a,owner,'Synthetic audit A','synthetic-stage2','https://calendar.fsu.edu/',false,'Synthetic rollback only'),(source_b,owner,'Synthetic audit B','synthetic-stage2','https://calendar.fsu.edu/',false,'Synthetic rollback only');
 insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until)
 values(owner,source_a,'audit','https://calendar.fsu.edu/',repeat('a',64),'text/plain',2,'synthetic-stage2',now(),now(),now()+interval '1 day') returning id into capture_a;
 insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until)
 values(owner,source_b,'audit','https://calendar.fsu.edu/',repeat('a',64),'text/plain',2,'synthetic-stage2',now(),now(),now()+interval '1 day') returning id into capture_b;
 insert into public.instagram_updates(owner_id,source_id,native_id,content_hash,capture_id,caption,published_at,permalink,media_type,children,children_complete,evidence_pointer,first_seen_at,last_seen_at)
 values(owner,source_a,'18000000000000001',repeat('b',64),capture_a,note,'2026-10-20T18:00Z','https://www.instagram.com/p/Synthetic123/','CAROUSEL_ALBUM','[{"native_id":"18000000000000002","media_type":"IMAGE","position":0}]',true,'/posts/0',now(),now()) returning id into ig;
 execute 'set local role authenticated';select * into j2 from public.extraction_enqueue('instagram',ig);execute 'reset role';
 execute 'set local role service_role';select * into strict j2 from public.extraction_claim(1,180);execute 'reset role';
 bad:=jsonb_set(output,'{units}',jsonb_build_array(output->'units'->0,jsonb_build_object('assetId','1','page',null,'status','blocked','text','','method','ocr','sha256',null,'issues',jsonb_build_array('Media unavailable'))));
 bad:=jsonb_set(jsonb_set(bad,'{complete}','false'),'{stats}',jsonb_build_object('processedAssets',0,'expectedAssets',1,'processedPages',0,'engine','synthetic-sql-audit','elapsedMs',1));
 execute 'set local role service_role';perform public.extraction_finish(j2.id,j2.lease_token,'partial',bad,'media_unavailable',120);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','instagram_publication_preserved_missing_media_explicit','passed',(j2.input_snapshot->>'publishedAt')::timestamptz=timestamptz '2026-10-20T18:00Z' and (select state='partial' and not(result->>'complete')::boolean from public.extraction_jobs where id=j2.id)));
 execute 'set local role authenticated';denied:=false;begin perform public.extraction_retry(j2.id);exception when others then denied:=true;end;execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','retry_floor_enforced','passed',denied));
 insert into public.manual_intakes(owner_id,note,submission_key) values(owner,'Synthetic third job quota check',gen_random_uuid()) returning id into intake;
 execute 'set local role authenticated';perform public.extraction_enqueue('manual',intake);execute 'reset role';
 execute 'set local role service_role';select count(*)=0 into passed from public.extraction_claim(1,180);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','two_new_jobs_per_utc_day_enforced','passed',passed));
 perform set_config('request.jwt.claim.sub',other::text,true);execute 'set local role authenticated';select count(*)=0 into passed from public.extraction_jobs;denied:=false;begin perform public.extraction_enqueue('manual',intake);exception when insufficient_privilege then denied:=true;end;execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','other_user_cannot_see_or_enqueue_owner_jobs','passed',passed and denied));
 execute 'set local role anon';denied:=false;begin perform count(*) from public.extraction_jobs;exception when insufficient_privilege then denied:=true;end;execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','anonymous_job_read_is_denied','passed',denied));
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.opportunities(owner_id,source_id,native_id,title,source_url,capture_id,content_sha256) values(owner,source_a,'audit','SYNTHETIC relation','https://calendar.fsu.edu/',capture_a,repeat('c',64)) returning id into program_a;
 insert into public.opportunities(owner_id,source_id,native_id,title,source_url,capture_id,content_sha256) values(owner,source_b,'audit','SYNTHETIC relation','https://calendar.fsu.edu/',capture_b,repeat('c',64)) returning id into program_b;
 insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,starts_at,ends_at,date_precision,timezone,status,capture_id,content_sha256)
 values(owner,source_a,program_a,'audit','2099-11-05T15:00Z','2099-11-05T16:00Z','instant','America/New_York','scheduled',capture_a,repeat('d',64)) returning id into occurrence_a;
 insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,starts_at,ends_at,date_precision,timezone,status,capture_id,content_sha256)
 values(owner,source_b,program_b,'audit','2099-11-05T15:00Z','2099-11-05T16:00Z','instant','America/New_York','scheduled',capture_b,repeat('d',64)) returning id into occurrence_b;
 execute 'set local role authenticated';perform public.record_review_decision(occurrence_a,'save',1);perform public.record_review_decision(occurrence_b,'reject',1);
 select * into link from public.reconciliation_propose('occurrence',occurrence_a,occurrence_b,'Synthetic cross-link; no physical merge');
 rp:=public.reconciliation_preview(link.id);select * into link from public.reconciliation_review(link.id,'confirm',link.fingerprint);
 cp:=public.calendar_write_preview('occurrence',occurrence_a);cmd:=public.calendar_write_approve('occurrence',occurrence_a,cp->>'fingerprint');
 cp:=public.calendar_write_preview('occurrence',occurrence_b);denied:=false;begin perform public.calendar_write_approve('occurrence',occurrence_b,cp->>'fingerprint');exception when others then denied:=true;end;
 execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','reconciliation_keeps_conflicting_decisions_and_native_ids','passed',jsonb_array_length(rp->'relatedDecisions')=2 and jsonb_array_length(rp->'warnings')>0 and (select count(*)=2 from public.occurrences where id in(occurrence_a,occurrence_b))));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','confirmed_alias_blocks_second_approval_without_provider_execution','passed',denied and cp->>'blockedReason'='confirmed_alias_approved' and (select count(*)=1 from tracker_private.calendar_write_commands where target_id in(occurrence_a,occurrence_b))));
 execute 'set local role authenticated';select * into link from public.reconciliation_review(link.id,'revoke',link.fingerprint);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','revocation_recorded_and_existing_approval_payload_preserved','passed',link.state='revoked' and (select count(*)=3 from public.reconciliation_history where link_id=link.id) and (select payload=cmd->'payload' from tracker_private.calendar_write_commands where id=(cmd->>'id')::uuid)));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','existing_sources_unchanged','passed',source_before=(select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by id),'')) from public.sources s where id not in(source_a,source_b))));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','existing_decisions_unchanged','passed',decision_before=(select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),'')) from public.user_decisions d where occurrence_id not in(occurrence_a,occurrence_b))));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','existing_calendar_commands_unchanged','passed',commands_before=(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),'')) from tracker_private.calendar_write_commands c where target_id not in(occurrence_a,occurrence_b))));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','existing_normalized_facts_unchanged','passed',normalized_before=(select md5(coalesce(string_agg(x::text,'' order by x::text),'')) from (
  select to_jsonb(o) x from public.opportunities o where id not in(program_a,program_b) union all select to_jsonb(o) from public.occurrences o where id not in(occurrence_a,occurrence_b) union all select to_jsonb(o) from public.milestones o) t)));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','connection_metadata_generation_unchanged','passed',connection_before=(select md5(concat_ws('|',scope,revision,authorization_generation,updated_at)) from tracker_private.google_calendar_connections where owner_id=owner)));
 if exists(select 1 from jsonb_array_elements(checks) x where (x->>'passed')::boolean is distinct from true) then raise exception 'Stage 2 audit failed: %',checks;end if;
 perform set_config('tracker.stage2_audit',jsonb_build_object('checkedAt',clock_timestamp(),'passed',jsonb_array_length(checks),'checks',checks,
  'fixtureClass','Synthetic text/media/source metadata through actual RPCs and SQL roles; not OCR, signed-JWT, Storage HTTP or Google insertion proof',
  'persistentRowsChanged',0,'googleCalls',0,'storageHttpCalls',0,'modelCalls',0,'independentConnectionsTested',false,
  'sequenceNote','Review identity sequence can advance on rollback; real rows unchanged','firstReleasePrecondition','No extraction jobs; existing owned grant; credential values never selected into output')::text,true);
end $$;
select current_setting('tracker.stage2_audit')::jsonb as stage2_audit;
rollback;
