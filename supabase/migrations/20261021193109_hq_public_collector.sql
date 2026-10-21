-- Generated with pinned Supabase CLI 2.121.0 migration new hq_public_collector.
-- This adds only HQ to the core lease allowlist and bounds core work to three sources.
-- It enables no source and changes no existing cursor, due slot, retry, decision or social budget.
create or replace function tracker_private.lease_due_source_group(p_group text,p_limit integer,p_lease_seconds integer)
returns setof public.sources language plpgsql security definer set search_path='' as $$
declare v_source public.sources; v_now timestamptz:=clock_timestamp(); v_slot timestamptz;
begin
  if p_group is null or p_group not in ('core','instagram') or p_limit is null
    or p_limit not between 1 and (case when p_group='instagram' then 27 else 3 end)
    or p_lease_seconds is null or p_lease_seconds not between 30 and 1800 then raise exception 'Invalid lease limits'; end if;
  for v_source in
    select * from public.sources
    where enabled and ((p_group='core' and adapter in ('localist-v1','music-v1','hq-ics-v1'))
      or (p_group='instagram' and adapter='instagram-business-discovery-v1'))
      and greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,v_now))),retry_not_before)<=v_now
      and (lease_until is null or lease_until<=v_now)
    order by greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,v_now))),retry_not_before),id
    for update skip locked limit p_limit
  loop
    if v_source.lease_token is not null then
      insert into public.source_runs(owner_id,source_id,started_at,finished_at,outcome,pagination_complete,parser_version,request_count,byte_count,opportunity_count,occurrence_count,cursor_before,error,scheduled_poll_at)
        values(v_source.owner_id,v_source.id,coalesce(v_source.last_attempt_at,v_now),v_now,'failed',false,'lease-recovery-v3',0,0,0,0,v_source.cursor,'Previous collector lease expired before completion; request/byte costs unknown.',v_source.leased_poll_at);
    end if;
    v_slot:=greatest(tracker_private.poll_slot_at(v_source.cadence_seconds,coalesce(v_source.next_poll_at,v_source.next_due_at,v_now)),tracker_private.poll_slot_at(v_source.cadence_seconds,v_now));
    update public.sources set next_poll_at=tracker_private.poll_slot_at(cadence_seconds,coalesce(next_poll_at,next_due_at,v_now)),
      leased_poll_at=v_slot,lease_token=gen_random_uuid(),lease_until=v_now+make_interval(secs=>p_lease_seconds),last_attempt_at=v_now,updated_at=v_now,
      consecutive_failures=case when v_source.lease_token is not null then consecutive_failures+1 else consecutive_failures end,
      health_status=case when v_source.lease_token is not null then 'failed' else health_status end,
      health_message=case when v_source.lease_token is not null then 'Retrying expired collector lease; previous attempt did not complete' else health_message end
    where id=v_source.id returning * into v_source;
    return next v_source;
  end loop;
end $$;
revoke all on function tracker_private.lease_due_source_group(text,integer,integer) from public,anon,authenticated,service_role;

-- The public core endpoint defaults to the three exact implemented producers.
create or replace function public.lease_due_sources(p_limit integer default 3,p_lease_seconds integer default 300)
returns setof public.sources language sql security definer set search_path='' as $$
  select * from tracker_private.lease_due_source_group('core',p_limit,p_lease_seconds);
$$;
revoke all on function public.lease_due_sources(integer,integer) from public,anon,authenticated;
grant execute on function public.lease_due_sources(integer,integer) to service_role;
