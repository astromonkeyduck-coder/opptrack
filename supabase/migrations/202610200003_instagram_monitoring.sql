-- Narrow, authorized Instagram monitoring extension. Publication is not an event.
-- Supabase CLI is unavailable locally; filename follows the existing migration sequence.
alter table public.captures add column evidence_kind text not null default 'source_response'
  check (evidence_kind in ('source_response','sanitized_api_projection'));
alter table public.source_runs add column instagram_update_count integer not null default 0
  check (instagram_update_count between 0 and 25);

create function tracker_private.valid_instagram_children(p_children jsonb) returns boolean
language sql immutable strict set search_path='' as $$
  select jsonb_typeof(p_children)='array' and jsonb_array_length(p_children)<=20
    and not exists (
      select 1 from jsonb_array_elements(p_children) with ordinality as child(value,ordinality)
      where jsonb_typeof(value)<>'object'
        or not (value ?& array['native_id','media_type','position'])
        or (value-array['native_id','media_type','position'])<>'{}'::jsonb
        or coalesce(value->>'native_id','') !~ '^[0-9]{1,40}$'
        or coalesce(value->>'media_type','') not in ('IMAGE','VIDEO')
        or jsonb_typeof(value->'position')<>'number'
        or coalesce(value->>'position','')<>((ordinality-1)::text)
    ) and (select count(*)=count(distinct value->>'native_id') from jsonb_array_elements(p_children));
$$;
revoke all on function tracker_private.valid_instagram_children(jsonb) from public,anon,authenticated,service_role;

create table public.instagram_updates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.tracker_members(user_id),
  source_id text not null,
  native_id text not null check(native_id ~ '^[0-9]{1,40}$'),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  capture_id uuid not null,
  caption text check(caption is null or length(caption)<=22000),
  published_at timestamptz not null,
  permalink text not null check(permalink ~ '^https://www[.]instagram[.]com/(p|reel|tv)/[A-Za-z0-9_-]+/$'),
  media_type text not null check(media_type in ('IMAGE','VIDEO','CAROUSEL_ALBUM')),
  media_product_type text check(media_product_type in ('FEED','REELS','AD')),
  children jsonb not null default '[]' check(tracker_private.valid_instagram_children(children)),
  children_complete boolean not null,
  evidence_pointer text not null check(length(evidence_pointer) between 1 and 512),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  search_document tsvector generated always as (to_tsvector('english',coalesce(caption,''))) stored,
  unique(id,owner_id),
  unique(owner_id,source_id,native_id),
  foreign key(source_id,owner_id) references public.sources(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id),
  check(last_seen_at>=first_seen_at),
  check(media_type='CAROUSEL_ALBUM' or (children='[]'::jsonb and children_complete))
);
create index instagram_updates_search on public.instagram_updates using gin(search_document);
create index instagram_updates_published on public.instagram_updates(owner_id,published_at desc,id);
create index instagram_updates_capture on public.instagram_updates(capture_id,owner_id);
create table public.instagram_update_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.tracker_members(user_id),
  update_id uuid not null,
  capture_id uuid not null,
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  facts jsonb not null check(jsonb_typeof(facts)='object'),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  unique(update_id,content_hash),
  foreign key(update_id,owner_id) references public.instagram_updates(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id),
  check(last_seen_at>=first_seen_at)
);
create index instagram_update_versions_owner on public.instagram_update_versions(owner_id,update_id);
create index instagram_update_versions_capture on public.instagram_update_versions(capture_id,owner_id);
do $$ declare t text; begin
  foreach t in array array['instagram_updates','instagram_update_versions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()) and public.is_tracker_member())',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create view public.instagram_updates_current with (security_invoker=true) as
select u.*,s.name as source_name,s.health_status as source_health,
  s.last_attempt_at as source_last_attempt_at,s.last_success_at as source_last_success_at,s.coverage_note
from public.instagram_updates u join public.sources s on s.id=u.source_id and s.owner_id=u.owner_id;
revoke all on public.instagram_updates_current from public,anon,authenticated;
grant select on public.instagram_updates_current to authenticated,service_role;

-- Independent lease budgets keep enabled social sources from consuming Central/Music slots.
-- Both groups use the same hourly dispatcher and preserve nominal UTC slots and retry floors.
create function tracker_private.lease_due_source_group(p_group text,p_limit integer,p_lease_seconds integer)
returns setof public.sources language plpgsql security definer set search_path='' as $$
declare v_source public.sources; v_now timestamptz:=clock_timestamp(); v_slot timestamptz;
begin
  if p_group is null or p_group not in ('core','instagram') or p_limit is null
    or p_limit not between 1 and (case when p_group='instagram' then 16 else 10 end)
    or p_lease_seconds is null or p_lease_seconds not between 30 and 1800 then raise exception 'Invalid lease limits'; end if;
  for v_source in
    select * from public.sources
    where enabled and ((p_group='core' and adapter in ('localist-v1','music-v1'))
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
create or replace function public.lease_due_sources(p_limit integer default 2,p_lease_seconds integer default 300)
returns setof public.sources language sql security definer set search_path='' as $$
  select * from tracker_private.lease_due_source_group('core',p_limit,p_lease_seconds);
$$;
revoke all on function public.lease_due_sources(integer,integer) from public,anon,authenticated;
grant execute on function public.lease_due_sources(integer,integer) to service_role;
create function public.lease_due_instagram_sources(p_limit integer default 16,p_lease_seconds integer default 600)
returns setof public.sources language sql security definer set search_path='' as $$
  select * from tracker_private.lease_due_source_group('instagram',p_limit,p_lease_seconds);
$$;
revoke all on function public.lease_due_instagram_sources(integer,integer) from public,anon,authenticated;
grant execute on function public.lease_due_instagram_sources(integer,integer) to service_role;

create function public.complete_instagram_run(p_source_id text,p_lease_token uuid,p_batch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sources; u jsonb; v_result jsonb; v_run uuid; v_capture uuid; v_update uuid;
  v_observed timestamptz; v_added integer:=0; v_rows integer; v_facts jsonb;
begin
  select * into s from public.sources where id=p_source_id for update;
  if not found or s.adapter<>'instagram-business-discovery-v1' then raise exception 'Instagram source required'; end if;
  if p_batch is null or jsonb_typeof(p_batch)<>'object' or jsonb_typeof(coalesce(p_batch->'updates','[]'))<>'array'
    or jsonb_array_length(coalesce(p_batch->'updates','[]'))>25 then raise exception 'Invalid Instagram updates'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_batch->'opportunities','[]')))
    or exists(select 1 from jsonb_array_elements(coalesce(p_batch->'occurrences','[]')))
    or exists(select 1 from jsonb_array_elements(coalesce(p_batch->'milestones','[]'))) then raise exception 'Instagram publication is not an event'; end if;
  if p_batch->>'outcome'='success' and (jsonb_array_length(coalesce(p_batch->'updates','[]'))=0
    or coalesce(p_batch->'window'->>'scope','')<>'latest25_parent_metadata_only'
    or p_batch->'window'->'history_complete' is distinct from 'false'::jsonb) then raise exception 'Instagram success requires nonempty bounded-window evidence'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_batch->'captures','[]')) c
    where c->>'evidence_kind' is distinct from 'sanitized_api_projection') then raise exception 'Instagram captures must be sanitized API projections'; end if;
  if (select count(*)<>count(distinct value->>'native_id') from jsonb_array_elements(coalesce(p_batch->'updates','[]'))) then raise exception 'Duplicate Instagram identity in batch'; end if;
  v_observed:=coalesce((p_batch->>'finished_at')::timestamptz,clock_timestamp());
  -- This call validates the lease and provenance and writes runs/captures/cursor/health.
  -- Every following check/write belongs to this same transaction, so errors roll it all back.
  v_result:=public.complete_source_run(p_source_id,p_lease_token,p_batch);
  v_run:=(v_result->>'run_id')::uuid;
  update public.captures cap set evidence_kind='sanitized_api_projection'
    from public.run_captures rc where rc.run_id=v_run and rc.capture_id=cap.id and rc.owner_id=s.owner_id;
  for u in select value from jsonb_array_elements(coalesce(p_batch->'updates','[]')) loop
    select cap.id into v_capture from public.captures cap join public.run_captures rc on rc.capture_id=cap.id and rc.run_id=v_run
      where cap.owner_id=s.owner_id and cap.source_id=s.id and cap.native_id=u->>'capture_native_id' order by cap.fetched_at desc,cap.id limit 1;
    if v_capture is null then raise exception 'Instagram capture evidence missing'; end if;
    insert into public.instagram_updates(owner_id,source_id,native_id,content_hash,capture_id,caption,published_at,permalink,media_type,media_product_type,children,children_complete,evidence_pointer,first_seen_at,last_seen_at)
      values(s.owner_id,s.id,u->>'native_id',u->>'content_hash',v_capture,u->>'caption',(u->>'published_at')::timestamptz,u->>'permalink',u->>'media_type',u->>'media_product_type',coalesce(u->'children','[]'),(u->>'children_complete')::boolean,u->>'evidence_pointer',v_observed,v_observed)
      on conflict(owner_id,source_id,native_id) do update set
        content_hash=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.content_hash else instagram_updates.content_hash end,
        capture_id=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.capture_id else instagram_updates.capture_id end,
        caption=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.caption else instagram_updates.caption end,
        published_at=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.published_at else instagram_updates.published_at end,
        permalink=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.permalink else instagram_updates.permalink end,
        media_type=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.media_type else instagram_updates.media_type end,
        media_product_type=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.media_product_type else instagram_updates.media_product_type end,
        children=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.children else instagram_updates.children end,
        children_complete=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.children_complete else instagram_updates.children_complete end,
        evidence_pointer=case when excluded.last_seen_at>=instagram_updates.last_seen_at then excluded.evidence_pointer else instagram_updates.evidence_pointer end,
        last_seen_at=greatest(instagram_updates.last_seen_at,excluded.last_seen_at)
      returning id into v_update;
    -- Store only allowlisted facts: arbitrary API properties, signed URLs and secrets are excluded.
    v_facts:=jsonb_build_object('native_id',u->>'native_id','caption',u->>'caption','published_at',u->>'published_at',
      'permalink',u->>'permalink','media_type',u->>'media_type','media_product_type',u->>'media_product_type',
      'children',coalesce(u->'children','[]'),'children_complete',(u->>'children_complete')::boolean,'evidence_pointer',u->>'evidence_pointer');
    insert into public.instagram_update_versions(owner_id,update_id,capture_id,content_hash,facts,first_seen_at,last_seen_at)
      values(s.owner_id,v_update,v_capture,u->>'content_hash',v_facts,v_observed,v_observed)
      on conflict(update_id,content_hash) do nothing;
    get diagnostics v_rows=row_count; v_added:=v_added+v_rows;
    update public.instagram_update_versions set last_seen_at=greatest(last_seen_at,v_observed) where update_id=v_update and content_hash=u->>'content_hash';
  end loop;
  update public.source_runs set instagram_update_count=jsonb_array_length(coalesce(p_batch->'updates','[]')) where id=v_run;
  if p_batch->>'outcome'='success' then
    update public.sources set health_message='Latest 25 parent posts requested; older history, Stories and media contents remain unmonitored.'
      ||case when coalesce((p_batch->'window'->>'token_expiry_known')::boolean,false) then '' else ' Token expiry/renewal unverified.' end
      where id=p_source_id;
  end if;
  return v_result||jsonb_build_object('updates',jsonb_array_length(coalesce(p_batch->'updates','[]')),'versions_added',v_added);
end $$;
revoke all on function public.complete_instagram_run(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_instagram_run(text,uuid,jsonb) to service_role;
