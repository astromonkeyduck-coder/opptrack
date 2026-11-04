-- SESSION B. Run as a second independent MCP execute_sql call while A sleeps.
-- B accepts zero leases when A holds the sole due source: the visible due row
-- plus independently observed live PgSleep backend proves exclusion, not idleness.
-- Execute only in the agreed quiet due window, before the scheduled worker.
-- Existing rows only. No HTTP collection, fixture inserts, source completion,
-- calendar action, quota reset or commit. Any error requires ROLLBACK.
-- Source recovery is excluded: any committed lease token/expiry aborts.
begin isolation level read committed;
set local lock_timeout='2s';
set local statement_timeout='12s';
do $quiet$ begin if extract(minute from clock_timestamp() at time zone 'UTC') not between 0 and 6 then raise exception 'Outside quiet window; no lease audit';end if;end $quiet$;
-- Wait only on read-only activity, BEFORE taking any table locks.
set local statement_timeout='25s';
do $observe$ declare i integer; seen boolean:=false; begin
 for i in 1..100 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name like 'opptrack-core-a:%' and application_name<>'opptrack-core-a:preparing' and state='active' and wait_event_type='Timeout' and wait_event='PgSleep') into seen;
  exit when seen;
  perform pg_sleep(0.2);
 end loop;
 if not seen then raise exception 'No independent A observed before table locks';end if;
end $observe$;
set local statement_timeout='12s';

-- These SHARE locks freeze run/decision/calendar writes for at most eight seconds.
-- They permit the independent A/B source-row lease statements.
lock table public.source_runs,public.user_decisions,tracker_private.calendar_write_commands in share mode;
set local application_name='opptrack-core-b';
do $$
declare
 v_now timestamptz:=clock_timestamp(); v_pid integer:=pg_backend_pid();
 sources_before jsonb; protected_before text; functions_before text;
 leased public.sources; leased_ids text[]:='{}'; due_ids text[];
 sources_preserved boolean; protected_preserved boolean; functions_preserved boolean;
 a_pid integer; a_name text; a_query_start timestamptz; a_observed_at timestamptz;
 a_source text; expected_ids text[]; elapsed_ms numeric; claim_started timestamptz; a_still_sleeping boolean;
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
 -- PostgreSQL caches activity within a transaction; force fresh observations.
 -- https://www.postgresql.org/docs/16/monitoring-stats.html
 perform pg_stat_clear_snapshot();
 select pid,application_name,query_start into a_pid,a_name,a_query_start from pg_stat_activity
 where pid<>v_pid and application_name like 'opptrack-core-a:%' and application_name<>'opptrack-core-a:preparing'
  and state='active' and wait_event_type='Timeout' and wait_event='PgSleep';
 if not found then raise exception 'Contention B stopped: independent A backend is not actively sleeping';end if;
 if (select count(*) from pg_stat_activity where pid<>v_pid and application_name like 'opptrack-core-a:%')<>1
 then raise exception 'Contention B stopped: ambiguous A session';end if;
 a_source:=substring(a_name from length('opptrack-core-a:')+1);
 if not(a_source=any(due_ids)) then raise exception 'Contention B stopped: A-held source is not visible as due in committed snapshot';end if;
 a_observed_at:=clock_timestamp();
 select coalesce(array_agg(id order by id),'{}') into expected_ids from unnest(due_ids) id where id<>a_source;
 claim_started:=clock_timestamp();
 execute 'set local role service_role';
 for leased in select * from public.lease_due_sources(3,30) loop
  if leased.id=a_source or not(leased.id=any(expected_ids)) or leased.lease_token is null or leased.lease_until<=clock_timestamp()
  then raise exception 'Contention B stopped: duplicate or unexpected lease selected';end if;
  leased_ids:=array_append(leased_ids,leased.id);
 end loop;
 execute 'reset role';
 elapsed_ms:=extract(epoch from clock_timestamp()-claim_started)*1000;
 if (select coalesce(array_agg(id order by id),'{}') from unnest(leased_ids) id) is distinct from expected_ids
 then raise exception 'Contention B stopped: competing writer or missing expected nonlocked source';end if;
 perform pg_stat_clear_snapshot();
 select exists(select 1 from pg_stat_activity where pid=a_pid and pid<>v_pid and application_name=a_name
  and state='active' and wait_event_type='Timeout' and wait_event='PgSleep') into a_still_sleeping;
 if not a_still_sleeping then raise exception 'Contention B stopped: A ended before independent overlap was confirmed';end if;
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
 perform set_config('tracker.core_contention_b',jsonb_build_object(
  'session','B','backendPid',v_pid,'startedAt',v_now,'finishedAt',clock_timestamp(),
  'observedABackendPid',a_pid,'observedAQueryStart',a_query_start,'observedAAt',a_observed_at,
  'observedAHeldSourceId',a_source,'aActivePgSleepBeforeAndAfterClaim',a_still_sleeping,
  'leasedSourceIds',leased_ids,'expectedOtherDueSourceIds',expected_ids,'dueSourceIdsAtStart',due_ids,
  'claimElapsedMs',elapsed_ms,'differentBackend',a_pid<>v_pid,'disjointClaims',not(a_source=any(leased_ids)),
  'sourcesBeforeSha256',encode(sha256(convert_to(sources_before::text,'UTF8')),'hex'),
  'protectedBeforeSha256',protected_before,'otherSourceRowsPreserved',sources_preserved,
  'runsDecisionsCalendarPreserved',protected_preserved,'leaseFunctionOidsAclsDefinitionsPreserved',functions_preserved,
  'persistentWrites',0,'collectionHttpCalls',0,'calendarCalls',0)::text,true);
end $$;
select current_setting('tracker.core_contention_b')::jsonb as core_contention_b;
rollback;
