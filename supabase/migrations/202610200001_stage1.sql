-- Stage 1 only: no calendar connection, approval, outbox or provider write path.
create table public.tracker_members (
  user_id uuid primary key references auth.users(id),
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);
create function public.is_tracker_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tracker_members where user_id = auth.uid());
$$;
revoke all on function public.is_tracker_member() from public;
grant execute on function public.is_tracker_member() to anon, authenticated, service_role;

create table public.sources (
  id text primary key,
  owner_id uuid not null references public.tracker_members(user_id),
  name text not null,
  adapter text not null,
  url text not null check (url ~ '^https://'),
  enabled boolean not null default false,
  cadence_seconds integer check (cadence_seconds >= 300),
  cursor jsonb,
  next_due_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  health_status text not null default 'setup_needed',
  health_message text,
  coverage_note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check ((lease_token is null) = (lease_until is null)),
  check (not enabled or cadence_seconds is not null)
);
create index sources_due on public.sources(next_due_at) where enabled;
create table public.source_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.tracker_members(user_id),
  source_id text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null check (outcome in ('success','partial','failed','blocked','rate_limited')),
  pagination_complete boolean not null,
  parser_version text not null,
  http_status integer,
  request_count integer not null check (request_count >= 0),
  byte_count bigint not null check (byte_count >= 0),
  opportunity_count integer not null,
  occurrence_count integer not null,
  cursor_before jsonb,
  cursor_after jsonb,
  collection_window jsonb not null default '{}',
  error text,
  cost_usd numeric(12,6),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (source_id,owner_id) references public.sources(id,owner_id),
  check (finished_at >= started_at),
  check (outcome <> 'success' or pagination_complete),
  check (outcome = 'success' or error is not null)
);
create table public.captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.tracker_members(user_id),
  source_id text not null,
  native_id text not null,
  source_url text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text,
  content_type text not null,
  byte_count bigint not null check (byte_count >= 0),
  excerpt text,
  parser_version text not null,
  first_seen_at timestamptz not null,
  fetched_at timestamptz not null,
  retention_until timestamptz not null,
  purged_at timestamptz,
  unique (id,owner_id),
  unique (owner_id,source_id,native_id,content_sha256),
  foreign key(source_id,owner_id) references public.sources(id,owner_id),
  check (storage_path is null or storage_path like owner_id::text || '/%'),
  check (excerpt is null or length(excerpt) <= 4096)
);
create table public.run_captures (
  owner_id uuid not null,
  run_id uuid not null,
  capture_id uuid not null,
  primary key(run_id,capture_id),
  foreign key(run_id,owner_id) references public.source_runs(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id)
);
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.tracker_members(user_id),
  source_id text not null,
  native_id text not null,
  title text not null check (length(title) between 1 and 1000),
  description text not null default '',
  source_url text not null,
  categories jsonb not null default '[]' check(jsonb_typeof(categories)='array'),
  campus_relation text not null default 'campus',
  uncertainties jsonb not null default '[]' check(jsonb_typeof(uncertainties)='array'),
  source_published_at timestamptz,
  source_updated_at timestamptz,
  capture_id uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1 check(revision > 0),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (to_tsvector('english', title || ' ' || description)) stored,
  unique(id,owner_id),
  unique(owner_id,source_id,native_id),
  foreign key(source_id,owner_id) references public.sources(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id)
);
create index opportunities_search on public.opportunities using gin(search_document);
create table public.occurrences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source_id text not null,
  opportunity_id uuid not null,
  native_id text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  all_day boolean not null default false,
  local_start_text text,
  timezone text,
  date_precision text not null check(date_precision in ('instant','date','unknown')),
  location text,
  status text not null default 'scheduled' check(status in ('scheduled','cancelled','postponed','unknown')),
  capture_id uuid not null,
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1 check(revision > 0),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_id),
  unique(owner_id,source_id,native_id),
  foreign key(source_id,owner_id) references public.sources(id,owner_id),
  foreign key(opportunity_id,owner_id) references public.opportunities(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id),
  check(ends_at is null or (starts_at is not null and ends_at >= starts_at)),
  check((date_precision='instant' and starts_at is not null) or (date_precision='date' and start_date is not null and starts_at is null) or (date_precision='unknown' and starts_at is null and start_date is null))
);
create index occurrences_date on public.occurrences(owner_id,starts_at,start_date);
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source_id text not null,
  opportunity_id uuid not null,
  occurrence_id uuid,
  native_id text not null,
  kind text not null,
  occurs_at timestamptz,
  occurs_on date,
  availability text,
  action_url text,
  uncertainty text,
  capture_id uuid not null,
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1,
  unique(id,owner_id),
  unique(owner_id,source_id,native_id),
  foreign key(source_id,owner_id) references public.sources(id,owner_id),
  foreign key(opportunity_id,owner_id) references public.opportunities(id,owner_id),
  foreign key(occurrence_id,owner_id) references public.occurrences(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id)
);
create table public.entity_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  opportunity_id uuid,
  occurrence_id uuid,
  milestone_id uuid,
  capture_id uuid not null,
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  facts jsonb not null,
  observed_at timestamptz not null default now(),
  foreign key(opportunity_id,owner_id) references public.opportunities(id,owner_id),
  foreign key(occurrence_id,owner_id) references public.occurrences(id,owner_id),
  foreign key(milestone_id,owner_id) references public.milestones(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id),
  check(num_nonnulls(opportunity_id,occurrence_id,milestone_id)=1)
);
create unique index opportunity_versions_unique on public.entity_versions(opportunity_id,content_sha256) where opportunity_id is not null;
create unique index occurrence_versions_unique on public.entity_versions(occurrence_id,content_sha256) where occurrence_id is not null;
create unique index milestone_versions_unique on public.entity_versions(milestone_id,content_sha256) where milestone_id is not null;
create table public.field_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  opportunity_id uuid,
  occurrence_id uuid,
  milestone_id uuid,
  capture_id uuid not null,
  field text not null,
  value jsonb not null,
  evidence_pointer text not null,
  parser_version text not null,
  observed_at timestamptz not null default now(),
  foreign key(opportunity_id,owner_id) references public.opportunities(id,owner_id),
  foreign key(occurrence_id,owner_id) references public.occurrences(id,owner_id),
  foreign key(milestone_id,owner_id) references public.milestones(id,owner_id),
  foreign key(capture_id,owner_id) references public.captures(id,owner_id),
  check(num_nonnulls(opportunity_id,occurrence_id,milestone_id)=1)
);
create unique index claims_unique on public.field_claims(coalesce(opportunity_id,occurrence_id,milestone_id),capture_id,field,evidence_pointer);
create table public.user_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  occurrence_id uuid not null,
  action text not null check(action in ('save','reject')),
  target_revision integer not null,
  decision_index bigint generated always as identity unique,
  created_at timestamptz not null default now(),
  foreign key(occurrence_id,owner_id) references public.occurrences(id,owner_id)
);
create index decisions_latest on public.user_decisions(owner_id,occurrence_id,decision_index desc);
create table public.manual_intakes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.tracker_members(user_id),
  source_url text,
  submission_key uuid,
  note text not null,
  retention_until timestamptz not null default (now()+interval '7 days'),
  purged_at timestamptz,
  media_purged_at timestamptz,
  media jsonb not null default '[]',
  status text not null default 'pending_verification' check(status in ('pending_verification','verified','rejected')),
  created_at timestamptz not null default now(),
  unique(id,owner_id),
  unique(owner_id,submission_key),
  check(source_url is null or (source_url ~ '^https://[^/?#[:space:]]+' and source_url !~ '^https://[^/]*@' and source_url !~ '[[:space:]]' and length(source_url)<=2048)),
  check(length(note)<=5000),
  check(jsonb_typeof(media)='array' and jsonb_array_length(media)<=8),
  check(source_url is not null or length(trim(note))>0 or jsonb_array_length(media)>0)
);

-- Every exposed relation denies anonymous access, including accidentally granted reads.
alter table public.tracker_members enable row level security;
revoke all on public.tracker_members from anon, authenticated;
grant all on public.tracker_members to service_role;
do $$ declare t text; begin
  foreach t in array array['sources','source_runs','captures','run_captures','opportunities','occurrences','milestones','entity_versions','field_claims','user_decisions','manual_intakes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = auth.uid() and public.is_tracker_member())',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create view public.review_inbox with (security_invoker=true) as
select oc.id,oc.owner_id,oc.opportunity_id,op.title,op.description,op.source_url,op.categories,op.uncertainties,
  oc.starts_at,oc.ends_at,oc.start_date,oc.all_day,oc.local_start_text,oc.timezone,oc.date_precision,oc.location,oc.status,oc.revision,oc.source_id,
  s.name as source_name,s.cadence_seconds as source_cadence_seconds,s.health_status as source_health,s.last_success_at as source_last_success_at,s.last_attempt_at as source_last_attempt_at,s.coverage_note,
  d.action as decision,d.created_at as decision_at
from public.occurrences oc
join public.opportunities op on op.id=oc.opportunity_id and op.owner_id=oc.owner_id
join public.sources s on s.id=oc.source_id and s.owner_id=oc.owner_id
left join lateral (select action,created_at from public.user_decisions where occurrence_id=oc.id and owner_id=oc.owner_id order by decision_index desc limit 1) d on true;
revoke all on public.review_inbox from anon;
grant select on public.review_inbox to authenticated,service_role;

create function public.configure_tracker_owner(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.tracker_members where user_id<>p_user_id) then raise exception 'Owner already configured'; end if;
  insert into public.tracker_members(user_id) values(p_user_id) on conflict do nothing;
  insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,health_status,coverage_note) values
    ('fsu-calendar-api',p_user_id,'FSU central calendar','localist-v1','https://calendar.fsu.edu/api/2/events?days=7',true,3600,now(),'never_run','Public central calendar only; event omissions and ticket timing remain unknown.'),
    ('fsu-music-events',p_user_id,'FSU College of Music','music-v1','https://music.fsu.edu/events/',true,21600,now(),'never_run','Independent producer dated cards; missing times and end times remain unknown.'),
    ('fsu-hq-events',p_user_id,'HQ member events','unconfigured','https://hq.fsu.edu/events',false,null,null,'blocked','Dynamic/member HQ route unconfigured. Public exports do not prove full HQ coverage.'),
    ('fsu-hq-public-export',p_user_id,'HQ public export','unconfigured','https://hq.fsu.edu/ical/floridastate/ical_floridastate.ics',false,null,null,'documented_but_untested','Stage 0 public subset verified; Stage 1 ingestion disabled. Member/private coverage unknown.'),
    ('fsu-hello-weekly',p_user_id,'Hello FSU newsletter archive','unconfigured','https://hello.fsu.edu/weekly-top-5',false,null,null,'stale','Latest Stage 0 sampled RSS item was April 30, 2023; archive is not a current alert feed.'),
    ('instagram-official',p_user_id,'Instagram and Stories','unconfigured','https://www.instagram.com/',false,null,null,'setup_needed','No social credentials/paid connectors enabled. Stories, private channels and all-slide coverage unverified.')
  on conflict(id) do nothing;
end $$;
revoke all on function public.configure_tracker_owner(uuid) from public,anon,authenticated;
grant execute on function public.configure_tracker_owner(uuid) to service_role;

create function public.record_decision(p_occurrence_id uuid,p_action text,p_expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare v_row public.occurrences; v_id uuid;
begin
  if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_action not in ('save','reject') or p_action is null then raise exception 'Only save/reject are enabled'; end if;
  select * into v_row from public.occurrences where id=p_occurrence_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_row.revision<>p_expected_revision then raise exception 'Occurrence changed; review current facts' using errcode='40001'; end if;
  insert into public.user_decisions(owner_id,occurrence_id,action,target_revision) values(auth.uid(),p_occurrence_id,p_action,p_expected_revision) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_decision(uuid,text,integer) from public,anon;
grant execute on function public.record_decision(uuid,text,integer) to authenticated;

create function public.submit_manual_intake(p_source_url text,p_note text,p_media jsonb default '[]',p_submission_key uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; m jsonb; v_path text; v_type text; v_bytes bigint:=0;
begin
  if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_submission_key is not null then
    select id into v_id from public.manual_intakes where owner_id=auth.uid() and submission_key=p_submission_key;
    if v_id is not null then return v_id; end if;
  end if;
  if p_media is null or jsonb_typeof(p_media)<>'array' or jsonb_array_length(p_media)>8 then raise exception 'Invalid media list'; end if;
  for m in select value from jsonb_array_elements(p_media) loop
    v_path:=m->>'storage_path'; v_type:=m->>'mime_type';
    v_bytes:=v_bytes+coalesce((m->>'byte_count')::bigint,0);
    if v_bytes>20971520 then raise exception 'Manual media total exceeds 20 MiB'; end if;
    if v_path is null or v_path not like auth.uid()::text || '/%' or v_path like '%..%' or v_type is null or v_type not in ('image/jpeg','image/png','image/webp','application/pdf') or coalesce((m->>'byte_count')::bigint,0) not between 1 and 5242880 then raise exception 'Invalid private media'; end if;
    if not exists(select 1 from storage.objects where bucket_id='captures' and name=v_path) then raise exception 'Private media object missing'; end if;
  end loop;
  insert into public.manual_intakes(owner_id,source_url,note,media,submission_key) values(auth.uid(),nullif(trim(p_source_url),''),coalesce(p_note,''),p_media,p_submission_key) on conflict(owner_id,submission_key) do update set submission_key=excluded.submission_key returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_manual_intake(text,text,jsonb,uuid) from public,anon;
grant execute on function public.submit_manual_intake(text,text,jsonb,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('captures','captures',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf','application/json','text/html','text/calendar','application/rss+xml','application/xml','text/plain']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy tracker_private_read on storage.objects for select to authenticated using(bucket_id='captures' and (storage.foldername(name))[1]=auth.uid()::text and public.is_tracker_member());
create policy tracker_private_upload on storage.objects for insert to authenticated with check(bucket_id='captures' and (storage.foldername(name))[1]=auth.uid()::text and public.is_tracker_member() and name not like '%..%');
create policy tracker_private_delete on storage.objects for delete to authenticated using(bucket_id='captures' and (storage.foldername(name))[1]=auth.uid()::text and public.is_tracker_member());

create function public.lease_due_sources(p_limit integer default 2,p_lease_seconds integer default 300) returns setof public.sources language plpgsql security definer set search_path='' as $$
declare v_source public.sources;
begin
  if p_limit not between 1 and 10 or p_lease_seconds not between 30 and 1800 then raise exception 'Invalid lease limits'; end if;
  for v_source in select * from public.sources where enabled and next_due_at<=now() and (lease_until is null or lease_until<=now()) order by next_due_at,id for update skip locked limit p_limit loop
    if v_source.lease_token is not null then
      insert into public.source_runs(owner_id,source_id,started_at,finished_at,outcome,pagination_complete,parser_version,request_count,byte_count,opportunity_count,occurrence_count,cursor_before,error)
        values(v_source.owner_id,v_source.id,coalesce(v_source.last_attempt_at,now()),now(),'failed',false,'lease-recovery-v1',0,0,0,0,v_source.cursor,'Previous collector lease expired before completion; request/byte costs unknown.');
    end if;
    update public.sources set lease_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>p_lease_seconds),last_attempt_at=now(),updated_at=now(),consecutive_failures=case when v_source.lease_token is not null then consecutive_failures+1 else consecutive_failures end,health_status=case when v_source.lease_token is not null then 'failed' else health_status end,health_message=case when v_source.lease_token is not null then 'Retrying expired collector lease; previous attempt did not complete' else health_message end where id=v_source.id returning * into v_source;
    return next v_source;
  end loop;
end $$;
revoke all on function public.lease_due_sources(integer,integer) from public,anon,authenticated;
grant execute on function public.lease_due_sources(integer,integer) to service_role;

create function public.complete_source_run(p_source_id text,p_lease_token uuid,p_batch jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sources; v_run uuid; c jsonb; o jsonb; claim jsonb; v_capture uuid; v_entity uuid; v_parent uuid; v_occurrence uuid; v_outcome text; v_complete boolean; v_retry integer; v_count integer; v_version text; v_finished timestamptz;
begin
  select * into s from public.sources where id=p_source_id for update;
  if not found or s.lease_token is distinct from p_lease_token or s.lease_until<=now() or p_lease_token is null then raise exception 'Invalid or expired source lease' using errcode='40001'; end if;
  v_outcome:=p_batch->>'outcome'; v_complete:=coalesce((p_batch->>'pagination_complete')::boolean,false); v_version:=p_batch->>'parser_version';
  if v_outcome not in ('success','partial','failed','blocked','rate_limited') or v_outcome is null or nullif(v_version,'') is null then raise exception 'Invalid collection result'; end if;
  if v_outcome='success' and (not v_complete or jsonb_array_length(coalesce(p_batch->'captures','[]'))=0) then raise exception 'Successful collection requires complete pagination and capture evidence'; end if;
  if v_outcome<>'success' and nullif(p_batch->>'error','') is null then raise exception 'Unsuccessful collection requires an error'; end if;
  v_finished:=coalesce((p_batch->>'finished_at')::timestamptz,now());
  insert into public.source_runs(owner_id,source_id,started_at,finished_at,outcome,pagination_complete,parser_version,http_status,request_count,byte_count,opportunity_count,occurrence_count,cursor_before,cursor_after,collection_window,error,cost_usd)
    values(s.owner_id,s.id,(p_batch->>'started_at')::timestamptz,v_finished,v_outcome,v_complete,v_version,(p_batch->>'http_status')::integer,coalesce((p_batch->>'request_count')::integer,0),coalesce((p_batch->>'byte_count')::bigint,0),jsonb_array_length(coalesce(p_batch->'opportunities','[]')),jsonb_array_length(coalesce(p_batch->'occurrences','[]')),s.cursor,case when v_outcome='success' then p_batch->'cursor_after' else null end,coalesce(p_batch->'window','{}'),p_batch->>'error',(p_batch->>'cost_usd')::numeric) returning id into v_run;
  for c in select value from jsonb_array_elements(coalesce(p_batch->'captures','[]')) loop
    insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,storage_path,content_type,byte_count,excerpt,parser_version,first_seen_at,fetched_at,retention_until)
      values(s.owner_id,s.id,c->>'native_id',c->>'source_url',c->>'content_sha256',c->>'storage_path',c->>'content_type',(c->>'byte_count')::bigint,c->>'excerpt',v_version,(c->>'fetched_at')::timestamptz,(c->>'fetched_at')::timestamptz,(c->>'fetched_at')::timestamptz+interval '30 days')
      on conflict(owner_id,source_id,native_id,content_sha256) do update set fetched_at=greatest(captures.fetched_at,excluded.fetched_at),storage_path=coalesce(excluded.storage_path,captures.storage_path),content_type=excluded.content_type,byte_count=excluded.byte_count,purged_at=case when excluded.storage_path is not null then null else captures.purged_at end,retention_until=case when excluded.storage_path is not null then greatest(captures.retention_until,excluded.retention_until) else captures.retention_until end returning id into v_capture;
    insert into public.run_captures(owner_id,run_id,capture_id) values(s.owner_id,v_run,v_capture) on conflict do nothing;
  end loop;
  for o in select value from jsonb_array_elements(coalesce(p_batch->'opportunities','[]')) loop
    select c.id into v_capture from public.captures c join public.run_captures rc on rc.capture_id=c.id and rc.run_id=v_run where c.owner_id=s.owner_id and c.source_id=s.id and c.native_id=o->>'capture_native_id' order by c.fetched_at desc,c.id limit 1;
    if v_capture is null then raise exception 'Opportunity capture evidence missing'; end if;
    insert into public.opportunities(owner_id,source_id,native_id,title,description,source_url,categories,campus_relation,uncertainties,source_published_at,source_updated_at,capture_id,content_sha256)
      values(s.owner_id,s.id,o->>'native_id',o->>'title',coalesce(o->>'description',''),o->>'source_url',coalesce(o->'categories','[]'),coalesce(o->>'campus_relation','campus'),coalesce(o->'uncertainties','[]'),(o->>'source_published_at')::timestamptz,(o->>'source_updated_at')::timestamptz,v_capture,o->>'content_sha256')
      on conflict(owner_id,source_id,native_id) do update set title=excluded.title,description=excluded.description,source_url=excluded.source_url,categories=excluded.categories,campus_relation=excluded.campus_relation,uncertainties=excluded.uncertainties,source_published_at=excluded.source_published_at,source_updated_at=excluded.source_updated_at,capture_id=excluded.capture_id,content_sha256=excluded.content_sha256,revision=case when opportunities.content_sha256<>excluded.content_sha256 then opportunities.revision+1 else opportunities.revision end,updated_at=case when opportunities.content_sha256<>excluded.content_sha256 then now() else opportunities.updated_at end returning id into v_entity;
    insert into public.entity_versions(owner_id,opportunity_id,capture_id,content_sha256,facts) values(s.owner_id,v_entity,v_capture,o->>'content_sha256',o) on conflict do nothing;
    for claim in select value from jsonb_array_elements(coalesce(o->'claims','[]')) loop
      insert into public.field_claims(owner_id,opportunity_id,capture_id,field,value,evidence_pointer,parser_version) values(s.owner_id,v_entity,v_capture,claim->>'field',claim->'value',claim->>'evidence_pointer',v_version) on conflict do nothing;
    end loop;
  end loop;
  for o in select value from jsonb_array_elements(coalesce(p_batch->'occurrences','[]')) loop
    select id into v_parent from public.opportunities where owner_id=s.owner_id and source_id=s.id and native_id=o->>'opportunity_native_id';
    select c.id into v_capture from public.captures c join public.run_captures rc on rc.capture_id=c.id and rc.run_id=v_run where c.owner_id=s.owner_id and c.source_id=s.id and c.native_id=o->>'capture_native_id' order by c.fetched_at desc,c.id limit 1;
    if v_parent is null or v_capture is null then raise exception 'Occurrence parent/capture evidence missing'; end if;
    insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,starts_at,ends_at,start_date,all_day,local_start_text,timezone,date_precision,location,status,capture_id,content_sha256)
      values(s.owner_id,s.id,v_parent,o->>'native_id',(o->>'starts_at')::timestamptz,(o->>'ends_at')::timestamptz,(o->>'start_date')::date,coalesce((o->>'all_day')::boolean,false),o->>'local_start_text',o->>'timezone',o->>'date_precision',o->>'location',coalesce(o->>'status','scheduled'),v_capture,o->>'content_sha256')
      on conflict(owner_id,source_id,native_id) do update set opportunity_id=excluded.opportunity_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=excluded.start_date,all_day=excluded.all_day,local_start_text=excluded.local_start_text,timezone=excluded.timezone,date_precision=excluded.date_precision,location=excluded.location,status=excluded.status,capture_id=excluded.capture_id,content_sha256=excluded.content_sha256,revision=case when occurrences.content_sha256<>excluded.content_sha256 then occurrences.revision+1 else occurrences.revision end,updated_at=case when occurrences.content_sha256<>excluded.content_sha256 then now() else occurrences.updated_at end returning id into v_entity;
    insert into public.entity_versions(owner_id,occurrence_id,capture_id,content_sha256,facts) values(s.owner_id,v_entity,v_capture,o->>'content_sha256',o) on conflict do nothing;
    for claim in select value from jsonb_array_elements(coalesce(o->'claims','[]')) loop
      insert into public.field_claims(owner_id,occurrence_id,capture_id,field,value,evidence_pointer,parser_version) values(s.owner_id,v_entity,v_capture,claim->>'field',claim->'value',claim->>'evidence_pointer',v_version) on conflict do nothing;
    end loop;
  end loop;
  for o in select value from jsonb_array_elements(coalesce(p_batch->'milestones','[]')) loop
    select id into v_parent from public.opportunities where owner_id=s.owner_id and source_id=s.id and native_id=o->>'opportunity_native_id';
    v_occurrence:=null;
    if o->>'occurrence_native_id' is not null then select id into v_occurrence from public.occurrences where owner_id=s.owner_id and source_id=s.id and native_id=o->>'occurrence_native_id'; if v_occurrence is null then raise exception 'Milestone occurrence missing'; end if; end if;
    select c.id into v_capture from public.captures c join public.run_captures rc on rc.capture_id=c.id and rc.run_id=v_run where c.owner_id=s.owner_id and c.source_id=s.id and c.native_id=o->>'capture_native_id' order by c.fetched_at desc,c.id limit 1;
    if v_parent is null or v_capture is null then raise exception 'Milestone evidence missing'; end if;
    insert into public.milestones(owner_id,source_id,opportunity_id,occurrence_id,native_id,kind,occurs_at,occurs_on,availability,action_url,uncertainty,capture_id,content_sha256)
      values(s.owner_id,s.id,v_parent,v_occurrence,o->>'native_id',o->>'kind',(o->>'occurs_at')::timestamptz,(o->>'occurs_on')::date,o->>'availability',o->>'action_url',o->>'uncertainty',v_capture,o->>'content_sha256')
      on conflict(owner_id,source_id,native_id) do update set kind=excluded.kind,occurs_at=excluded.occurs_at,occurs_on=excluded.occurs_on,availability=excluded.availability,action_url=excluded.action_url,uncertainty=excluded.uncertainty,capture_id=excluded.capture_id,content_sha256=excluded.content_sha256,revision=case when milestones.content_sha256<>excluded.content_sha256 then milestones.revision+1 else milestones.revision end returning id into v_entity;
    insert into public.entity_versions(owner_id,milestone_id,capture_id,content_sha256,facts) values(s.owner_id,v_entity,v_capture,o->>'content_sha256',o) on conflict do nothing;
    for claim in select value from jsonb_array_elements(coalesce(o->'claims','[]')) loop
      insert into public.field_claims(owner_id,milestone_id,capture_id,field,value,evidence_pointer,parser_version) values(s.owner_id,v_entity,v_capture,claim->>'field',claim->'value',claim->>'evidence_pointer',v_version) on conflict do nothing;
    end loop;
  end loop;
  v_retry:=greatest(coalesce((p_batch->>'retry_after_seconds')::integer,0),least(86400,(60*power(2,least(s.consecutive_failures,10)))::integer)+floor(random()*30)::integer);
  update public.sources set cursor=case when v_outcome='success' then p_batch->'cursor_after' else cursor end,last_success_at=case when v_outcome='success' then v_finished else last_success_at end,consecutive_failures=case when v_outcome='success' then 0 else consecutive_failures+1 end,health_status=v_outcome,health_message=case when v_outcome='success' then null else p_batch->>'error' end,next_due_at=v_finished+make_interval(secs=>case when v_outcome='success' then cadence_seconds else v_retry end),lease_token=null,lease_until=null,updated_at=now() where id=s.id;
  return jsonb_build_object('run_id',v_run,'outcome',v_outcome,'opportunities',jsonb_array_length(coalesce(p_batch->'opportunities','[]')),'occurrences',jsonb_array_length(coalesce(p_batch->'occurrences','[]')));
end $$;
revoke all on function public.complete_source_run(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_source_run(text,uuid,jsonb) to service_role;

-- PLAN ONLY: external Storage deletion cannot share this database transaction.
-- The production retention script must not delete candidates without a later verified race guard.
create function public.purge_candidates(p_limit integer default 100) returns table(owner_id uuid,storage_path text,candidate_reason text,object_created_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid purge plan limit'; end if;
  return query
  select member.user_id,obj.name,
    case
      when exists(select 1 from public.captures c where c.owner_id=member.user_id and c.storage_path=obj.name and c.retention_until<=now()) then 'expired_capture'
      when exists(select 1 from public.manual_intakes mi cross join lateral jsonb_array_elements(mi.media) as media_item(value) where mi.owner_id=member.user_id and media_item.value->>'storage_path'=obj.name and mi.retention_until<=now()) then 'expired_manual_media'
      else 'aged_orphan_review'
    end,
    obj.created_at
  from storage.objects obj cross join public.tracker_members member
  where obj.bucket_id='captures' and obj.name like member.user_id::text || '/%'
    and not exists(select 1 from public.captures c where c.owner_id=member.user_id and c.storage_path=obj.name and c.purged_at is null and c.retention_until>now())
    and not exists(select 1 from public.manual_intakes mi cross join lateral jsonb_array_elements(mi.media) as media_item(value) where mi.owner_id=member.user_id and media_item.value->>'storage_path'=obj.name and mi.media_purged_at is null and mi.retention_until>now())
    and (
      exists(select 1 from public.captures c where c.owner_id=member.user_id and c.storage_path=obj.name and c.retention_until<=now())
      or exists(select 1 from public.manual_intakes mi cross join lateral jsonb_array_elements(mi.media) as media_item(value) where mi.owner_id=member.user_id and media_item.value->>'storage_path'=obj.name and mi.retention_until<=now())
      or (obj.name like member.user_id::text || '/sources/%' and obj.created_at<=now()-interval '30 days')
      or (obj.name not like member.user_id::text || '/sources/%' and obj.created_at<=now()-interval '7 days')
    )
  order by obj.created_at,obj.name limit p_limit;
end $$;
revoke all on function public.purge_candidates(integer) from public,anon,authenticated;
grant execute on function public.purge_candidates(integer) to service_role;
