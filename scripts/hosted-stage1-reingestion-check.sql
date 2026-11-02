-- Bounded rollback audit of the installed production RPCs. Synthetic sources/facts
-- only; no existing source, user decision, Storage object or Google API is changed.
-- The decision identity sequence may advance (normal PostgreSQL rollback gaps).
-- This is sequential lease exclusion/recovery, NOT independent-session contention.
begin isolation level repeatable read;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $$
declare
 owner uuid; source_a text:='audit-stage1-a-'||gen_random_uuid(); source_b text:='audit-stage1-b-'||gen_random_uuid();
 lease_a public.sources; lease_b public.sources; recovered public.sources;
 payload jsonb; changed jsonb; result jsonb; checks jsonb:='[]';
 one uuid; two uuid; three uuid; decision_one jsonb; decision_two jsonb;
 source_before text; decisions_before text; commands_before bigint;
 baseline jsonb; after_replay jsonb; ids_before jsonb; last_success timestamptz; cursor_before jsonb;
 denied boolean; i integer; actual jsonb; other uuid:='22222222-2222-4222-8222-222222222222';
begin
 select user_id into strict owner from public.tracker_members;
 if owner=other then other:='33333333-3333-4333-8333-333333333333';end if;
 -- Prevent the test lease RPC from selecting an existing old-due source.
 if exists(select 1 from public.sources where enabled and adapter in ('localist-v1','music-v1','hq-ics-v1')
   and greatest(coalesce(next_poll_at,next_due_at),retry_not_before)<=timestamptz '2002-01-01Z')
 then raise exception 'Audit precondition: an existing core source is due before 2002; no test performed';end if;
 select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by id),'')) into source_before from public.sources s;
 select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),'')) into decisions_before from public.user_decisions d;
 select count(*) into commands_before from tracker_private.calendar_write_commands;
 insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,coverage_note)
 values(source_a,owner,'Synthetic rollback-only audit A','localist-v1','https://calendar.fsu.edu/',true,3600,'2000-01-01Z','2000-01-01Z','Synthetic audit; never live source evidence'),
       (source_b,owner,'Synthetic rollback-only audit B','localist-v1','https://calendar.fsu.edu/',true,3600,'2001-01-01Z','2001-01-01Z','Synthetic audit; never live source evidence');
 execute 'set local role service_role';
 select * into strict lease_a from public.lease_due_sources(1,600);
 select * into strict lease_b from public.lease_due_sources(1,600);
 execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','sequential lease calls exclude the active source and lease the other synthetic source','passed',lease_a.id=source_a and lease_b.id=source_b and lease_a.lease_token<>lease_b.lease_token));
 payload:=jsonb_build_object('outcome','success','pagination_complete',true,'started_at',clock_timestamp(),'finished_at',clock_timestamp(),
   'http_status',200,'request_count',0,'byte_count',2,'parser_version','synthetic-stage1-audit-v1','invocation_kind','replay',
   'cursor_after',jsonb_build_object('audit','baseline'),'window',jsonb_build_object('synthetic',true),
   'captures',jsonb_build_array(jsonb_build_object('native_id','audit-page','source_url','https://calendar.fsu.edu/',
      'content_sha256',repeat('a',64),'content_type','application/json','byte_count',2,'fetched_at',clock_timestamp())),
   'opportunities',jsonb_build_array(jsonb_build_object('native_id','event','title','Synthetic rollback-only recurring event',
      'source_url','https://calendar.fsu.edu/','capture_native_id','audit-page','content_sha256',repeat('b',64))),
   'occurrences',jsonb_build_array(
      jsonb_build_object('native_id','one','opportunity_native_id','event','date_precision','unknown','status','scheduled','capture_native_id','audit-page','content_sha256',repeat('c',64)),
      jsonb_build_object('native_id','two','opportunity_native_id','event','date_precision','unknown','status','scheduled','capture_native_id','audit-page','content_sha256',repeat('d',64)),
      jsonb_build_object('native_id','three','opportunity_native_id','event','date_precision','unknown','status','scheduled','capture_native_id','audit-page','content_sha256',repeat('e',64))),
   'milestones','[]'::jsonb);
 update public.sources set lease_until=now()-interval '1 second' where id=source_a;
 denied:=false;
 begin perform public.complete_source_run(source_a,lease_a.lease_token,payload);exception when serialization_failure then denied:=true;end;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','expired lease cannot commit a run','passed',denied and not exists(select 1 from public.source_runs where source_id=source_a)));
 execute 'set local role service_role';select * into strict recovered from public.lease_due_sources(1,600);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','expired source reacquires a different token and records the abandoned attempt','passed',recovered.id=source_a and recovered.lease_token<>lease_a.lease_token and (select count(*)=1 from public.source_runs where source_id=source_a and parser_version='lease-recovery-v3' and outcome='failed' and request_count=0)));
 denied:=false;
 begin perform public.complete_source_run(source_a,lease_a.lease_token,payload);exception when serialization_failure then denied:=true;end;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','old token is fenced after recovery','passed',denied));
 execute 'set local role service_role';perform public.complete_source_run(source_a,recovered.lease_token,payload);execute 'reset role';
 select id into strict one from public.occurrences where source_id=source_a and native_id='one';
 select id into strict two from public.occurrences where source_id=source_a and native_id='two';
 select id into strict three from public.occurrences where source_id=source_a and native_id='three';
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select public.record_review_decision(one,'save',1) into decision_one;
 select public.record_review_decision(two,'reject',1) into decision_two;
 execute 'reset role';
 select jsonb_build_object('captures',(select count(*) from public.captures where source_id=source_a),
   'opportunities',(select count(*) from public.opportunities where source_id=source_a),
   'occurrences',(select count(*) from public.occurrences where source_id=source_a),
   'versions',(select count(*) from public.entity_versions v join public.captures c on c.id=v.capture_id where c.source_id=source_a),
   'decisions',(select count(*) from public.user_decisions where occurrence_id in(one,two,three))) into baseline;
 select jsonb_object_agg(native_id,id) into ids_before from public.occurrences where source_id=source_a;
 for i in 1..3 loop
   update public.sources set next_due_at='2000-01-01Z',next_poll_at='2000-01-01Z',retry_not_before=null where id=source_a;
   execute 'set local role service_role';select * into strict recovered from public.lease_due_sources(1,600);
   if recovered.id<>source_a then raise exception 'Synthetic source lost due ordering';end if;
   perform public.complete_source_run(source_a,recovered.lease_token,payload);execute 'reset role';
 end loop;
 select jsonb_build_object('captures',(select count(*) from public.captures where source_id=source_a),
   'opportunities',(select count(*) from public.opportunities where source_id=source_a),
   'occurrences',(select count(*) from public.occurrences where source_id=source_a),
   'versions',(select count(*) from public.entity_versions v join public.captures c on c.id=v.capture_id where c.source_id=source_a),
   'decisions',(select count(*) from public.user_decisions where occurrence_id in(one,two,three))) into after_replay;
 checks:=checks||jsonb_build_array(jsonb_build_object('test','three unchanged collections add observations without duplicate entities versions or decisions','passed',after_replay=baseline and (select count(*)=5 from public.source_runs where source_id=source_a)));
 changed:=jsonb_set(jsonb_set(jsonb_set(payload,'{opportunities,0,title}','"Synthetic source title changed"'),'{opportunities,0,content_sha256}',to_jsonb(repeat('f',64))),'{occurrences,0,content_sha256}',to_jsonb(repeat('1',64)));
 changed:=jsonb_set(changed,'{occurrences,0,location}','"Synthetic changed venue"');
 update public.sources set next_due_at='2000-01-01Z',next_poll_at='2000-01-01Z',retry_not_before=null where id=source_a;
 execute 'set local role service_role';select * into strict recovered from public.lease_due_sources(1,600);perform public.complete_source_run(source_a,recovered.lease_token,changed);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','changed source facts retain native occurrence UUIDs and add exactly two content versions','passed',(select jsonb_object_agg(native_id,id)=ids_before from public.occurrences where source_id=source_a) and (select count(*)=6 from public.entity_versions v join public.captures c on c.id=v.capture_id where c.source_id=source_a) and (select revision=2 from public.occurrences where id=one)));
 execute 'set local role authenticated';
 select jsonb_object_agg(id,decision) into actual from public.review_inbox where id in(one,two,three);
 execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','saved passed and undecided sibling occurrences remain independent after changed collection','passed',actual->>one::text='save' and actual->>two::text='reject' and actual->three::text='null'::jsonb));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','saved decision retains its original target revision for honest review history','passed',(select target_revision=1 from public.user_decisions where id=(decision_one->>'decision_id')::uuid)));
 denied:=false;
 execute 'set local role authenticated';
 begin perform public.record_review_decision(one,'reject',1);exception when serialization_failure then denied:=true;end;
 execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','stale occurrence review is rejected after changed source facts','passed',denied));
 select last_success_at,cursor into last_success,cursor_before from public.sources where id=source_a;
 update public.sources set next_due_at='2000-01-01Z',next_poll_at='2000-01-01Z',retry_not_before=null where id=source_a;
 execute 'set local role service_role';select * into strict recovered from public.lease_due_sources(1,600);
 changed:=payload||jsonb_build_object('outcome','rate_limited','pagination_complete',false,'error','Synthetic HTTP 429',
   'retry_after_seconds',7200,'cursor_after',jsonb_build_object('must','not advance'),'captures','[]'::jsonb,'opportunities','[]'::jsonb,'occurrences','[]'::jsonb);
 perform public.complete_source_run(source_a,recovered.lease_token,changed);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','failure preserves successful cursor last success and decisions and respects Retry-After','passed',(select cursor=cursor_before and last_success_at=last_success and health_status='rate_limited' and retry_not_before>=clock_timestamp()+interval '7190 seconds' from public.sources where id=source_a) and (select count(*)=2 from public.user_decisions where occurrence_id in(one,two,three))));
 perform set_config('request.jwt.claim.sub',other::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select count(*)=0 into denied from public.review_inbox where id in(one,two,three);execute 'reset role';
 checks:=checks||jsonb_build_array(jsonb_build_object('test','other authenticated user cannot read the audited inbox decisions','passed',denied));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','existing source state remains byte-for-byte unchanged','passed',(select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by id),''))=source_before from public.sources s where id not in(source_a,source_b))));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','existing real user decision rows remain unchanged','passed',(select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),''))=decisions_before from public.user_decisions d where occurrence_id not in(one,two,three))));
 checks:=checks||jsonb_build_array(jsonb_build_object('test','no calendar command or approval was created','passed',(select count(*)=commands_before from tracker_private.calendar_write_commands)));
 if exists(select 1 from jsonb_array_elements(checks) c where (c->>'passed')::boolean is distinct from true) then raise exception 'Stage 1 replay audit failed: %',checks;end if;
 perform set_config('tracker.stage1_reingestion_audit',jsonb_build_object('checked_at',clock_timestamp(),'passed',jsonb_array_length(checks),'checks',checks,
   'fixture_class','Synthetic SQL fixtures through installed production RPCs and actual SQL roles; not live HTTP or user browser evidence',
   'persistent_rows_changed',0,'decision_sequence_note','Identity sequence may advance despite rollback; existing decision rows are untouched',
   'google_calls',0,'storage_http_calls',0,'independent_connections_tested',false)::text,true);
end $$;
select current_setting('tracker.stage1_reingestion_audit')::jsonb as stage1_reingestion_audit;
rollback;
