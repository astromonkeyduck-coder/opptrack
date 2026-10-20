-- Keep 0001 immutable. UTC polling slots are independent of processing duration
-- and Retry-After. Trigger Free may spread an hourly invocation within its hour.
create schema if not exists tracker_private;
revoke all on schema tracker_private from public,anon,authenticated,service_role;

alter table public.sources add column next_poll_at timestamptz;
alter table public.sources add column retry_not_before timestamptz;
alter table public.sources add column leased_poll_at timestamptz;
alter table public.source_runs add column trigger_run_id text;
alter table public.source_runs add column dispatcher_scheduled_at timestamptz;
alter table public.source_runs add column trigger_schedule_id text;
alter table public.source_runs add column scheduled_poll_at timestamptz;
alter table public.source_runs add column invocation_kind text not null default 'local' check(invocation_kind in ('local','scheduled','manual','replay'));

create function tracker_private.poll_slot_at(p_cadence_seconds integer,p_at timestamptz) returns timestamptz language sql immutable strict set search_path='' as $$
  select date_bin(make_interval(secs=>p_cadence_seconds),p_at,timestamptz '2000-01-01 00:00:00+00');
$$;
revoke all on function tracker_private.poll_slot_at(integer,timestamptz) from public,anon,authenticated,service_role;

-- Preserve the effective Retry-After/backoff floor of an existing failed run.
-- Active leases retain their token, expiry and effective due time. Their nominal
-- acquired slot is recovered from the existing actual last-attempt timestamp.
update public.sources set
  next_poll_at=case
    when lease_token is not null then tracker_private.poll_slot_at(cadence_seconds,coalesce(last_attempt_at,now()))
    when consecutive_failures>0 then tracker_private.poll_slot_at(cadence_seconds,now())
    when health_status='success' and last_attempt_at is not null then tracker_private.poll_slot_at(cadence_seconds,last_attempt_at)+make_interval(secs=>cadence_seconds)
    else tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,now()))
  end,
  retry_not_before=case when consecutive_failures>0 then next_due_at else null end,
  leased_poll_at=case when lease_token is not null then tracker_private.poll_slot_at(cadence_seconds,coalesce(last_attempt_at,now())) else null end
where enabled and cadence_seconds is not null;
update public.sources set next_due_at=greatest(next_poll_at,retry_not_before)
where enabled and lease_token is null and next_poll_at is not null;

create or replace function public.lease_due_sources(p_limit integer default 2,p_lease_seconds integer default 300) returns setof public.sources language plpgsql security definer set search_path='' as $$
declare v_source public.sources; v_now timestamptz:=clock_timestamp(); v_slot timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 10 or p_lease_seconds is null or p_lease_seconds not between 30 and 1800 then raise exception 'Invalid lease limits'; end if;
  for v_source in
    select * from public.sources
    where enabled
      and greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,v_now))),retry_not_before)<=v_now
      and (lease_until is null or lease_until<=v_now)
    order by greatest(coalesce(next_poll_at,tracker_private.poll_slot_at(cadence_seconds,coalesce(next_due_at,v_now))),retry_not_before),id
    for update skip locked limit p_limit
  loop
    if v_source.lease_token is not null then
      insert into public.source_runs(owner_id,source_id,started_at,finished_at,outcome,pagination_complete,parser_version,request_count,byte_count,opportunity_count,occurrence_count,cursor_before,error,scheduled_poll_at)
        values(v_source.owner_id,v_source.id,coalesce(v_source.last_attempt_at,v_now),v_now,'failed',false,'lease-recovery-v2',0,0,0,0,v_source.cursor,'Previous collector lease expired before completion; request/byte costs unknown.',v_source.leased_poll_at);
    end if;
    -- Coalesce missed source slots once: never burst through every missed hour.
    v_slot:=greatest(tracker_private.poll_slot_at(v_source.cadence_seconds,coalesce(v_source.next_poll_at,v_source.next_due_at,v_now)),tracker_private.poll_slot_at(v_source.cadence_seconds,v_now));
    update public.sources set
      next_poll_at=tracker_private.poll_slot_at(cadence_seconds,coalesce(next_poll_at,next_due_at,v_now)),
      leased_poll_at=v_slot,
      lease_token=gen_random_uuid(),lease_until=v_now+make_interval(secs=>p_lease_seconds),last_attempt_at=v_now,updated_at=v_now,
      consecutive_failures=case when v_source.lease_token is not null then consecutive_failures+1 else consecutive_failures end,
      health_status=case when v_source.lease_token is not null then 'failed' else health_status end,
      health_message=case when v_source.lease_token is not null then 'Retrying expired collector lease; previous attempt did not complete' else health_message end
    where id=v_source.id returning * into v_source;
    return next v_source;
  end loop;
end $$;
revoke all on function public.lease_due_sources(integer,integer) from public,anon,authenticated;
grant execute on function public.lease_due_sources(integer,integer) to service_role;

-- Reuse the validated ingestion transaction from 0001, inaccessible through REST.
alter function public.complete_source_run(text,uuid,jsonb) set schema tracker_private;
revoke all on function tracker_private.complete_source_run(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.complete_source_run(p_source_id text,p_lease_token uuid,p_batch jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.sources; v_after public.sources; v_result jsonb; v_next_poll timestamptz; v_retry_floor timestamptz; v_finished timestamptz; v_slot timestamptz;
begin
  select * into v_before from public.sources where id=p_source_id for update;
  -- The original function validates lease, payload, pagination, evidence and all
  -- relationships. Any failure rolls back this wrapper and the original body.
  v_result:=tracker_private.complete_source_run(p_source_id,p_lease_token,p_batch);
  select * into v_after from public.sources where id=p_source_id;
  v_slot:=coalesce(v_before.leased_poll_at,tracker_private.poll_slot_at(v_before.cadence_seconds,coalesce(v_before.last_attempt_at,clock_timestamp())));
  v_finished:=coalesce((p_batch->>'finished_at')::timestamptz,clock_timestamp());
  if p_batch->>'outcome'='success' then
    -- A collection beginning at 12:58 and finishing at 13:01 still leaves 13:00
    -- due. Completion time and dispatch jitter do not move the grid to 14:01.
    v_next_poll:=v_slot+make_interval(secs=>v_before.cadence_seconds);
    v_retry_floor:=null;
  else
    v_next_poll:=coalesce(v_before.next_poll_at,v_slot);
    -- Historical replay timestamps must not accidentally erase a real retry wait.
    v_retry_floor:=greatest(clock_timestamp(),v_finished)+(v_after.next_due_at-v_finished);
  end if;
  update public.sources set next_poll_at=v_next_poll,retry_not_before=v_retry_floor,next_due_at=greatest(v_next_poll,v_retry_floor),leased_poll_at=null where id=p_source_id;
  update public.source_runs set
    trigger_run_id=nullif(p_batch->>'trigger_run_id',''),
    dispatcher_scheduled_at=(p_batch->>'dispatcher_scheduled_at')::timestamptz,
    trigger_schedule_id=nullif(p_batch->>'trigger_schedule_id',''),
    invocation_kind=coalesce(p_batch->>'invocation_kind','local'),
    scheduled_poll_at=v_slot
  where id=(v_result->>'run_id')::uuid and owner_id=v_before.owner_id;
  return v_result||jsonb_build_object('scheduled_poll_at',v_slot,'next_poll_at',v_next_poll,'retry_not_before',v_retry_floor);
end $$;
revoke all on function public.complete_source_run(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_source_run(text,uuid,jsonb) to service_role;
