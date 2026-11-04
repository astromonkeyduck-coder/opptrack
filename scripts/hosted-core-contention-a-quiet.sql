-- SESSION A. Start asynchronously, then launch B within the eight-second sleep.
-- Require pg_stat_activity visibility; expected independent B call is another
-- database connection, not a second statement in this same transaction.
-- Execute only in the agreed quiet due window, before the scheduled worker.
-- Existing rows only. No HTTP collection, fixture inserts, source completion,
-- calendar action, quota reset or commit. Any error requires ROLLBACK.
-- Source recovery is excluded: any committed lease token/expiry aborts.
begin isolation level read committed;
set local lock_timeout='2s';
set local statement_timeout='12s';
do $quiet$ begin if extract(minute from clock_timestamp() at time zone 'UTC') not between 0 and 6 then raise exception 'Outside quiet window; no lease audit';end if;end $quiet$;
-- These SHARE locks freeze run/decision/calendar writes for at most eight seconds.
-- They permit the independent A/B source-row lease statements.
lock table public.source_runs,public.user_decisions,tracker_private.calendar_write_commands in share mode;
set local application_name='opptrack-core-a:preparing';
do $$
declare
 v_now timestamptz:=clock_timestamp(); v_pid integer:=pg_backend_pid();
 sources_before jsonb; protected_before text; functions_before text;
 leased public.sources; leased_ids text[]:='{}'; due_ids text[];
 sources_preserved boolean; protected_preserved boolean; functions_preserved boolean;
 held_id text; after_sleep timestamptz;
begin
 if exists(select 1 from public.sources where lease_token is not null or lease_until is not null)
 then raise exception 'Contention audit stopped: committed lease exists; no lease will be reset';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) into sources_before from public.sources s;
 select encode(sha256(convert_to(jsonb_build_object(
  'runs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.source_runs t),
  'decisions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.user_decisions t),
  'calendar',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from tracker_private.calendar_write_commands t))::text,'UTF8')),'hex') into protected_before;
 select encode(sha256(convert_to(jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'definition',pg_get_functiondef(p.oid)) order by p.oid)::text,'UTF8')),'hex') into functions_before
 from pg_proc p where p.oid in('public.lease_due_sources(integer,integer)'::regprocedure,'tracker_private.lease_due_source_group(text,integer,integer)'::regprocedure);
 select coalesce(array_agg(id order by id),'{}') into due_ids from public.sources
 where enabled and adapter in('localist-v1','music-v1','hq-ics-v1')
  and greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,v_now))),retry_not_before)<=v_now;
 if cardinality(due_ids)<1 or cardinality(due_ids)>3 then raise exception 'Contention audit stopped: requires one to three currently due real core sources';end if;
 execute 'set local role service_role';
 for leased in select * from public.lease_due_sources(1,30) loop
  leased_ids:=array_append(leased_ids,leased.id);
  if leased.lease_token is null or leased.lease_until<=clock_timestamp() or not(leased.id=any(due_ids)) then raise exception 'Unexpected source lease';end if;
 end loop;
 execute 'reset role';
 if cardinality(leased_ids)<>1 then raise exception 'Contention A stopped: no single real due source was claimed';end if;
 held_id:=leased_ids[1];
 if length('opptrack-core-a:'||held_id)>63 then raise exception 'Source ID exceeds activity marker limit';end if;
 perform set_config('application_name','opptrack-core-a:'||held_id,true);
 perform pg_sleep(8);
 after_sleep:=clock_timestamp();
 -- Replace only this transaction's own lease rows with their original values;
 -- every other complete source row must still match the committed baseline.
 select sources_before=coalesce(jsonb_agg(case when s.id=any(leased_ids)
  then (select original from jsonb_array_elements(sources_before) original where original->>'id'=s.id)
  else to_jsonb(s) end order by s.id),'[]'::jsonb) into sources_preserved from public.sources s;
 select protected_before=encode(sha256(convert_to(jsonb_build_object(
  'runs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.source_runs t),
  'decisions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.user_decisions t),
  'calendar',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from tracker_private.calendar_write_commands t))::text,'UTF8')),'hex') into protected_preserved;
 select functions_before=encode(sha256(convert_to(jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'definition',pg_get_functiondef(p.oid)) order by p.oid)::text,'UTF8')),'hex') into functions_preserved
 from pg_proc p where p.oid in('public.lease_due_sources(integer,integer)'::regprocedure,'tracker_private.lease_due_source_group(text,integer,integer)'::regprocedure);
 if sources_preserved is distinct from true or protected_preserved is distinct from true or functions_preserved is distinct from true
 then raise exception 'Contention audit stopped: source writer race or protected rows/function definitions changed';end if;
 perform set_config('tracker.core_contention_a',jsonb_build_object(
  'session','A','backendPid',v_pid,'startedAt',v_now,'afterSleepAt',after_sleep,'finishedAt',clock_timestamp(),
  'heldSourceIds',leased_ids,'dueSourceIdsAtStart',due_ids,'sleepSeconds',8,
  'sourcesBeforeSha256',encode(sha256(convert_to(sources_before::text,'UTF8')),'hex'),
  'protectedBeforeSha256',protected_before,'otherSourceRowsPreserved',sources_preserved,
  'runsDecisionsCalendarPreserved',protected_preserved,'leaseFunctionOidsAclsDefinitionsPreserved',functions_preserved,
  'persistentWrites',0,'collectionHttpCalls',0,'calendarCalls',0,'requiresIndependentBObservation',true)::text,true);
end $$;
select current_setting('tracker.core_contention_a')::jsonb as core_contention_a;
rollback;
