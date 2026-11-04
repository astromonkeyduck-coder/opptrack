-- Read-only independent full-row/function fingerprints before and after the
-- v4 rollback audit. No rows, source leases, quotas or Auth identities change.
begin isolation level repeatable read read only;
set local lock_timeout='2s';
set local statement_timeout='20s';
select jsonb_build_object(
 'observedAt',clock_timestamp(),
 'ownerCount',(select count(*) from public.tracker_members),
 'authUserCount',(select count(*) from auth.users),
 'realQueuedJobs',(select count(*) from public.extraction_jobs where state='queued'),
 'realProcessingJobs',(select count(*) from public.extraction_jobs where state='processing'),
 'usedUtcJobSlots',(select count(*) from public.extraction_jobs where first_started_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'),
 'usedUtcAttempts',(select count(*) from public.extraction_attempts where started_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'),
 'usedUtcVisualPages',(select coalesce(sum(visual_pages),0) from public.extraction_attempts where started_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'),
 'activeSourceLeases',(select count(*) from public.sources where lease_until>clock_timestamp()),
 'enqueueDefault',(select pg_get_expr(proargdefaults,0) from pg_proc where oid='public.extraction_enqueue(text,uuid,text)'::regprocedure),
 'protectedRows',jsonb_build_object(
  'jobs',jsonb_build_object('rows',(select count(*) from public.extraction_jobs),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.extraction_jobs t)),
  'attempts',jsonb_build_object('rows',(select count(*) from public.extraction_attempts),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.extraction_attempts t)),
  'intakes',jsonb_build_object('rows',(select count(*) from public.manual_intakes),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.manual_intakes t)),
  'sources',jsonb_build_object('rows',(select count(*) from public.sources),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.sources t)),
  'opportunities',jsonb_build_object('rows',(select count(*) from public.opportunities),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.opportunities t)),
  'occurrences',jsonb_build_object('rows',(select count(*) from public.occurrences),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.occurrences t)),
  'milestones',jsonb_build_object('rows',(select count(*) from public.milestones),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.milestones t)),
  'decisions',jsonb_build_object('rows',(select count(*) from public.user_decisions),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.user_decisions t)),
  'calendarCommands',jsonb_build_object('rows',(select count(*) from tracker_private.calendar_write_commands),'sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from tracker_private.calendar_write_commands t))
 ),
 'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid::text,'name',p.oid::regprocedure::text,'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig,'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by p.oid) from pg_proc p where p.oid in('public.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_enqueue(text,uuid,text)'::regprocedure,'public.extraction_claim(integer,integer)'::regprocedure,'tracker_private.extraction_claim(integer,integer)'::regprocedure,'public.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'tracker_private.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'public.extraction_retry(uuid)'::regprocedure,'tracker_private.extraction_retry(uuid)'::regprocedure))
) as stage2_v4_audit_fingerprint;
rollback;
