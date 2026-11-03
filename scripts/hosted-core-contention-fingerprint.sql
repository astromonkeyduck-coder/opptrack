-- Execute once immediately BEFORE A/B and once immediately AFTER both have
-- returned/rolled back. All four complete-row SHA256 values must be identical.
-- Do not run if the scheduled worker is currently collecting. Active leases,
-- no due core source, A/B failure, different hashes or absent overlap => no pass.
begin read only;
set local lock_timeout='2s';
set local statement_timeout='12s';
select jsonb_build_object(
 'observedAt',clock_timestamp(),'backendPid',pg_backend_pid(),
 'sources',jsonb_build_object('rows',(select count(*) from public.sources),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.sources t)),
 'sourceRuns',jsonb_build_object('rows',(select count(*) from public.source_runs),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.source_runs t)),
 'decisions',jsonb_build_object('rows',(select count(*) from public.user_decisions),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.user_decisions t)),
 'calendarCommands',jsonb_build_object('rows',(select count(*) from tracker_private.calendar_write_commands),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from tracker_private.calendar_write_commands t)),
 'committedLeases',(select count(*) from public.sources where lease_token is not null or lease_until is not null),
 'dueCoreSources',(select coalesce(jsonb_agg(jsonb_build_object('sourceId',id,'nextDueAt',greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,clock_timestamp()))),retry_not_before)) order by id),'[]'::jsonb) from public.sources where enabled and adapter in('localist-v1','music-v1','hq-ics-v1') and greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,clock_timestamp()))),retry_not_before)<=clock_timestamp()),
 'scope','Read-only full-row fingerprints. Separate A/B observations prove only concurrent installed core source leasing; not extraction contention, HTTP, backup restore or laptop-off execution.'
) as core_contention_fingerprint;
rollback;
