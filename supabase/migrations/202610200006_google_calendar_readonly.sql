-- Optional owner-authorized Google Calendar reads. No calendar write/outbox path.
create table tracker_private.google_calendar_connections (
  owner_id uuid primary key references public.tracker_members(user_id) on delete cascade,
  encrypted_credentials text not null check (
    length(encrypted_credentials) between 48 and 30000
    and encrypted_credentials ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  ),
  scope text not null default 'https://www.googleapis.com/auth/calendar.events.readonly'
    check (scope = 'https://www.googleapis.com/auth/calendar.events.readonly'),
  revision uuid not null default gen_random_uuid(),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tracker_private.google_calendar_connections enable row level security;
create policy owner_private_calendar on tracker_private.google_calendar_connections
  for all to authenticated
  using (owner_id = (select auth.uid()) and public.is_tracker_member())
  with check (owner_id = (select auth.uid()) and public.is_tracker_member());
revoke all on tracker_private.google_calendar_connections from public,anon,authenticated,service_role;

-- Only encrypted bytes cross the RPC boundary. The AES key stays in Netlify Functions.
create function public.calendar_connection_get() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_tracker_member() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return (
    select jsonb_build_object('encrypted_credentials',c.encrypted_credentials,'revision',c.revision,'connected_at',c.connected_at,'updated_at',c.updated_at)
    from tracker_private.google_calendar_connections c where c.owner_id=auth.uid()
  );
end $$;
revoke all on function public.calendar_connection_get() from public,anon,authenticated,service_role;
grant execute on function public.calendar_connection_get() to authenticated;

create function public.calendar_connection_put(p_encrypted_credentials text,p_expected_revision uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_revision uuid;
begin
  if auth.uid() is null or not public.is_tracker_member() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_expected_revision is null then
    insert into tracker_private.google_calendar_connections(owner_id,encrypted_credentials)
      values(auth.uid(),p_encrypted_credentials)
      on conflict(owner_id) do nothing returning revision into v_revision;
  else
    update tracker_private.google_calendar_connections set encrypted_credentials=p_encrypted_credentials,revision=gen_random_uuid(),updated_at=now()
      where owner_id=auth.uid() and revision=p_expected_revision returning revision into v_revision;
  end if;
  if v_revision is null then raise exception 'Calendar connection changed' using errcode='40001'; end if;
  return v_revision;
end $$;
revoke all on function public.calendar_connection_put(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.calendar_connection_put(text,uuid) to authenticated;

create function public.calendar_connection_delete(p_expected_revision uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_deleted uuid;
begin
  if auth.uid() is null or not public.is_tracker_member() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  delete from tracker_private.google_calendar_connections where owner_id=auth.uid() and revision=p_expected_revision returning owner_id into v_deleted;
  if v_deleted is null and exists(select 1 from tracker_private.google_calendar_connections where owner_id=auth.uid()) then
    raise exception 'Calendar connection changed' using errcode='40001';
  end if;
  return v_deleted is not null;
end $$;
revoke all on function public.calendar_connection_delete(uuid) from public,anon,authenticated,service_role;
grant execute on function public.calendar_connection_delete(uuid) to authenticated;
