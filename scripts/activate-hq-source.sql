-- Operator step: apply only after the hq-ics-v1 worker release is verified deployed.
-- This script targets one existing source; it never resets or reseeds other routes.
-- Re-running it after activation leaves existing due/lease/cursor/health state intact.
begin;
do $$
declare s public.sources; owner uuid;
begin
  if (select count(*) from public.tracker_members) <> 1 then
    raise exception 'Exactly one tracker owner is required for HQ activation';
  end if;
  select user_id into owner from public.tracker_members;
  select * into s from public.sources where id='fsu-hq-public-export' for update;
  if not found or s.owner_id <> owner then raise exception 'Existing HQ source with the tracker owner is required'; end if;
  if s.enabled and s.adapter='hq-ics-v1' and s.cadence_seconds=21600 then
    raise notice 'HQ already enabled; existing collection state preserved';
    return;
  end if;
  if s.enabled or s.adapter not in ('unconfigured','hq-ics-v1') or s.lease_token is not null then
    raise exception 'HQ has unexpected active state; review it before activation';
  end if;
  update public.sources set adapter='hq-ics-v1',enabled=true,cadence_seconds=21600,
    next_poll_at=tracker_private.poll_slot_at(21600,clock_timestamp()),
    next_due_at=greatest(tracker_private.poll_slot_at(21600,clock_timestamp()),retry_not_before),
    health_status='setup_needed',health_message='HQ public export enabled; awaiting first real collection.',
    coverage_note='Public institutional HQ ICS export only, rolling 90-day normalization window plus ongoing events. No private/member completeness, feed freshness or ticket availability guarantee. Missing/uncertain facts stay visible; cross-source duplicates remain possible.',
    updated_at=clock_timestamp()
    where id='fsu-hq-public-export' and owner_id=owner;
end $$;
commit;
