-- Stage 2: private, quarantined extraction and reversible reconciliation.
-- No collector activation, normalized fact promotion, calendar or delivery calls.
create table public.extraction_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.tracker_members(user_id),
 manual_intake_id uuid,
 instagram_update_id uuid,
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 extractor_version text not null check(extractor_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
 input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object' and octet_length(input_snapshot::text)<=65536),
 state text not null default 'queued' check(state in ('queued','processing','succeeded','partial','failed','blocked')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_until timestamptz,
 retry_not_before timestamptz,
 visual_page_budget integer not null default 0 check(visual_page_budget between 0 and 12),
 result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=524288)),
 error_code text check(error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
 created_at timestamptz not null default clock_timestamp(),
 first_started_at timestamptz, last_attempt_at timestamptz, finished_at timestamptz,
 unique(id,owner_id), unique(owner_id,input_hash,extractor_version),
 foreign key(manual_intake_id,owner_id) references public.manual_intakes(id,owner_id),
 foreign key(instagram_update_id,owner_id) references public.instagram_updates(id,owner_id),
 check(num_nonnulls(manual_intake_id,instagram_update_id)=1),
 check((lease_token is null)=(lease_until is null)),
 check((state='processing')=(lease_token is not null))
);
create index extraction_jobs_owner_created on public.extraction_jobs(owner_id,created_at desc,id);
create index extraction_jobs_due on public.extraction_jobs(retry_not_before,created_at) where state in ('queued','processing');

create table public.extraction_attempts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 job_id uuid not null, attempt_number integer not null check(attempt_number between 1 and 3),
 lease_token uuid not null unique,
 state text not null check(state in ('processing','succeeded','partial','failed','blocked','expired')),
 reserved_visual_pages integer not null check(reserved_visual_pages between 0 and 12),
 visual_pages integer check(visual_pages between 0 and 12),
 started_at timestamptz not null, finished_at timestamptz,
 error_code text,
 unique(job_id,attempt_number),
 foreign key(job_id,owner_id) references public.extraction_jobs(id,owner_id)
);
create index extraction_attempts_owner_day on public.extraction_attempts(owner_id,started_at);

alter table public.extraction_jobs enable row level security;
alter table public.extraction_attempts enable row level security;
create policy owner_extraction_jobs on public.extraction_jobs for select to authenticated using(owner_id=(select auth.uid()) and public.is_tracker_member());
create policy owner_extraction_attempts on public.extraction_attempts for select to authenticated using(owner_id=(select auth.uid()) and public.is_tracker_member());
revoke all on public.extraction_jobs,public.extraction_attempts from public,anon,authenticated,service_role;
grant select on public.extraction_jobs,public.extraction_attempts to authenticated;

create function tracker_private.keep_extraction_input_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.owner_id<>old.owner_id or new.manual_intake_id is distinct from old.manual_intake_id
  or new.instagram_update_id is distinct from old.instagram_update_id or new.input_hash<>old.input_hash
  or new.extractor_version<>old.extractor_version or new.input_snapshot<>old.input_snapshot or new.created_at<>old.created_at
 then raise exception 'Extraction input is immutable';end if;
 return new;
end $$;
revoke all on function tracker_private.keep_extraction_input_immutable() from public,anon,authenticated,service_role;
create trigger immutable_extraction_input before update on public.extraction_jobs for each row execute function tracker_private.keep_extraction_input_immutable();

create function tracker_private.extraction_enqueue(p_kind text,p_target_id uuid,p_extractor_version text) returns public.extraction_jobs
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_owner uuid:=auth.uid(); v_input jsonb; v_media jsonb; v_hash text; v_job public.extraction_jobs; m public.manual_intakes; u public.instagram_updates;
begin
 if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('manual','instagram') or p_target_id is null or p_extractor_version is distinct from 'stage2-rules-v1' then raise exception 'Invalid extraction target or unsupported extractor version';end if;
 if p_kind='manual' then
  select * into m from public.manual_intakes where id=p_target_id and owner_id=v_owner;
  if not found or m.purged_at is not null or m.media_purged_at is not null then raise exception 'Private input unavailable';end if;
  select coalesce(jsonb_agg(jsonb_build_object('assetId',i::text,'storagePath',value->>'storage_path','mimeType',value->>'mime_type','byteCount',(value->>'byte_count')::bigint,
    'sha256',substring(value->>'storage_path' from '([a-f0-9]{64})[.][a-z]+$')) order by i),'[]'::jsonb) into v_media from jsonb_array_elements(m.media) with ordinality as asset(value,i);
  v_input:=jsonb_build_object('kind','manual','targetId',m.id,'note',m.note,'sourceUrl',m.source_url,'publishedAt',null,'media',v_media);
 else
  select * into u from public.instagram_updates where id=p_target_id and owner_id=v_owner;
  if not found then raise exception 'Private input unavailable';end if;
  if u.media_type='CAROUSEL_ALBUM' then
   select coalesce(jsonb_agg(jsonb_build_object('assetId',(i)::text,'nativeId',value->>'native_id','mediaType',value->>'media_type','available',false) order by i),'[]'::jsonb)
     into v_media from jsonb_array_elements(u.children) with ordinality as asset(value,i);
  else v_media:=jsonb_build_array(jsonb_build_object('assetId','1','nativeId',u.native_id,'mediaType',u.media_type,'available',false));end if;
  v_input:=jsonb_build_object('kind','instagram','targetId',u.id,'sourceId',u.source_id,'captureId',u.capture_id,'contentHash',u.content_hash,
    'caption',u.caption,'sourceUrl',u.permalink,'publishedAt',u.published_at,'childrenComplete',u.children_complete,'media',v_media);
 end if;
 v_hash:=encode(sha256(convert_to(v_input::text||'|'||p_extractor_version,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':extraction-enqueue',0));
 select * into v_job from public.extraction_jobs where owner_id=v_owner and input_hash=v_hash and extractor_version=p_extractor_version;
 if found then return v_job;end if;
 if (select count(*) from public.extraction_jobs where owner_id=v_owner and state in ('queued','processing'))>=50 then raise exception 'Extraction queue is full';end if;
 insert into public.extraction_jobs(owner_id,manual_intake_id,instagram_update_id,input_hash,extractor_version,input_snapshot)
 values(v_owner,case when p_kind='manual' then p_target_id end,case when p_kind='instagram' then p_target_id end,v_hash,p_extractor_version,v_input) returning * into v_job;
 return v_job;
end $$;

create function tracker_private.extraction_retry(p_job_id uuid) returns public.extraction_jobs language plpgsql security definer set search_path='' as $$
declare j public.extraction_jobs;
begin
 if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501';end if;
 select * into j from public.extraction_jobs where id=p_job_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Extraction unavailable';end if;
 if j.state not in ('partial','failed','blocked') or j.attempts>=3 or coalesce(j.retry_not_before,'-infinity')>clock_timestamp() then raise exception 'Extraction retry unavailable';end if;
 update public.extraction_jobs set state='queued',error_code=null,finished_at=null where id=j.id returning * into j;
 return j;
end $$;

create function tracker_private.extraction_claim(p_limit integer,p_lease_seconds integer) returns setof public.extraction_jobs
language plpgsql security definer set search_path='' as $$
declare j public.extraction_jobs; v_now timestamptz:=clock_timestamp(); v_day timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 v_used integer; v_reserved integer; v_budget integer; v_started integer; v_claimed integer:=0; v_visual boolean;
begin
 if p_limit is null or p_limit not between 1 and 2 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'Invalid extraction lease';end if;
 for j in select * from public.extraction_jobs where (state='processing' or state='queued' and attempts<3)
   and coalesce(retry_not_before,'-infinity')<=v_now and (lease_until is null or lease_until<=v_now)
   order by created_at,id for update skip locked
 loop
  perform pg_advisory_xact_lock(hashtextextended(j.owner_id::text||':extraction-budget:'||v_day::text,0));
  if j.state='processing' then
   update public.extraction_attempts set state='expired',finished_at=v_now,visual_pages=reserved_visual_pages,error_code='lease_expired'
    where job_id=j.id and lease_token=j.lease_token and state='processing';
   update public.extraction_jobs set state='failed',lease_token=null,lease_until=null,error_code='lease_expired',retry_not_before=v_now+interval '60 seconds',finished_at=v_now where id=j.id;
   continue;
  end if;
  select count(*) into v_started from public.extraction_jobs where owner_id=j.owner_id and first_started_at>=v_day;
  if j.first_started_at is null and v_started>=2 then continue;end if;
  select coalesce(sum(visual_pages),0),coalesce(sum(reserved_visual_pages) filter(where state='processing'),0) into v_used,v_reserved
   from public.extraction_attempts where owner_id=j.owner_id and started_at>=v_day;
  v_visual:=jsonb_array_length(j.input_snapshot->'media')>0;
  v_budget:=case when v_visual then greatest(0,12-v_used-v_reserved) else 0 end;
  if v_visual and v_budget=0 then continue;end if;
  update public.extraction_jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=v_now+make_interval(secs=>p_lease_seconds),
    visual_page_budget=v_budget,last_attempt_at=v_now,first_started_at=coalesce(first_started_at,v_now),finished_at=null,error_code=null
    where id=j.id returning * into j;
  insert into public.extraction_attempts(owner_id,job_id,attempt_number,lease_token,state,reserved_visual_pages,started_at)
    values(j.owner_id,j.id,j.attempts,j.lease_token,'processing',v_budget,v_now);
  return next j;v_claimed:=v_claimed+1;if v_claimed>=p_limit then return;end if;
 end loop;
end $$;

-- Text offsets use JavaScript/UTF-16 code units. PostgreSQL substring uses
-- Unicode characters, so supplementary characters must retain their two units.
create function tracker_private.extraction_evidence_slice(p_text text,p_start integer,p_end integer) returns text
language sql immutable strict set search_path='' as $$
 with chars as (select ch,i,case when ascii(ch)>65535 then 2 else 1 end as width from regexp_split_to_table(p_text,'') with ordinality as t(ch,i)),
 positions as (select ch,i,width,coalesce(sum(width) over(order by i rows between unbounded preceding and 1 preceding),0) as pos from chars)
 select case when p_start>=0 and p_end>p_start and min(pos)=p_start and max(pos+width)=p_end then string_agg(ch,'' order by i) end
 from positions where pos>=p_start and pos+width<=p_end;
$$;
revoke all on function tracker_private.extraction_evidence_slice(text,integer,integer) from public,anon,authenticated,service_role;

create function tracker_private.extraction_finish(p_job_id uuid,p_lease_token uuid,p_state text,p_result jsonb,p_error_code text,p_retry_after_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
declare j public.extraction_jobs; v_units jsonb; v_unit jsonb; v_asset jsonb; v_candidate jsonb; v_claim jsonb; v_span jsonb; v_source jsonb; v_field record;
 v_visual integer; v_attempted integer; v_expected integer; v_processed integer; v_asset_processed integer; v_expected_pages integer; v_now timestamptz:=clock_timestamp();
begin
 select * into j from public.extraction_jobs where id=p_job_id for update;
 if not found or j.state<>'processing' or j.lease_token is distinct from p_lease_token or j.lease_until<=v_now then raise exception 'Stale extraction lease' using errcode='40001';end if;
 if p_state is null or p_state not in ('succeeded','partial','failed','blocked') or p_retry_after_seconds is null or p_retry_after_seconds not between 0 and 86400
  or p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,80}$' then raise exception 'Invalid extraction completion';end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>524288 or p_result->>'version' is distinct from 'stage2-result-v1'
  or jsonb_typeof(p_result->'units') is distinct from 'array' or jsonb_array_length(p_result->'units')>1025
  or jsonb_typeof(p_result->'candidates') is distinct from 'array' or jsonb_array_length(p_result->'candidates')>30
  or jsonb_typeof(p_result->'issues') is distinct from 'array' or jsonb_typeof(p_result->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_result->'stats') is distinct from 'object'
  or (p_result->'stats' ? 'visualWorkUncertain' and jsonb_typeof(p_result->'stats'->'visualWorkUncertain') is distinct from 'boolean') then raise exception 'Invalid extraction result';end if;
 v_units:=p_result->'units';v_expected:=jsonb_array_length(j.input_snapshot->'media');
 if coalesce(j.input_snapshot->>'note',j.input_snapshot->>'caption','')<>'' and not exists(select 1 from jsonb_array_elements(v_units) u where u->>'assetId'='text') then raise exception 'Retained text must be accounted for';end if;
 for v_asset in select value from jsonb_array_elements(j.input_snapshot->'media') loop
  if not exists(select 1 from jsonb_array_elements(v_units) u where u->>'assetId'=v_asset->>'assetId') then raise exception 'Every supplied asset must be accounted for';end if;
 end loop;
 if (select count(*)<>count(distinct (value->>'assetId')||':'||coalesce(value->>'page','0')) from jsonb_array_elements(v_units)) then raise exception 'Duplicate extraction unit';end if;
 for v_unit in select value from jsonb_array_elements(v_units) loop
  if jsonb_typeof(v_unit)<>'object' or coalesce(v_unit->>'status','') not in ('processed','empty','missing','failed','unsupported','blocked')
   or (v_unit->>'page' is not null and (v_unit->>'page' !~ '^[0-9]{1,3}$' or (v_unit->>'page')::integer not between 1 and 128))
   or jsonb_typeof(v_unit->'text') is distinct from 'string' or length(v_unit->>'text')>100000
   or length(coalesce(v_unit->>'method','')) not between 1 and 80
   or (v_unit->>'status' in ('processed','empty') and coalesce(v_unit->>'sha256','') !~ '^[a-f0-9]{64}$')
   or (v_unit->>'sha256' is not null and v_unit->>'sha256' !~ '^[a-f0-9]{64}$')
   or jsonb_typeof(v_unit->'issues') is distinct from 'array'
   or (v_unit ? 'attempted' and jsonb_typeof(v_unit->'attempted') is distinct from 'boolean') then raise exception 'Invalid extraction unit';end if;
  if v_unit->>'assetId'='text' then
   if v_unit->>'page' is not null then raise exception 'Invalid text unit';end if;
   if v_unit->>'text' is distinct from coalesce(j.input_snapshot->>'note',j.input_snapshot->>'caption','') or v_unit->>'method'<>'provided-text'
    or v_unit->>'sha256' is distinct from encode(sha256(convert_to(v_unit->>'text','UTF8')),'hex') then raise exception 'Provided text differs from retained input';end if;
  else
   select value into v_asset from jsonb_array_elements(j.input_snapshot->'media') a where a->>'assetId'=v_unit->>'assetId';
   if not found then raise exception 'Unknown extraction asset';end if;
   if v_asset->>'mimeType'='application/pdf' and v_unit->>'page' is null and v_unit->>'status' in ('processed','empty') then raise exception 'PDF pages must be identified';end if;
   if v_asset->>'mimeType'='application/pdf' and v_unit->>'status' in ('processed','empty') and (coalesce(v_unit->>'expectedPages','') !~ '^[0-9]{1,3}$' or (v_unit->>'expectedPages')::integer not between 1 and 128) then raise exception 'PDF processed pages require a verified page count';end if;
   if v_asset->>'mimeType' is distinct from 'application/pdf' and v_unit->>'page' is not null then raise exception 'Only PDFs have page numbers';end if;
   if j.input_snapshot->>'kind'='instagram' and v_unit->>'status' in ('processed','empty') then raise exception 'Instagram media bytes are unavailable';end if;
   if v_asset->>'sha256' is not null and v_unit->>'sha256' is not null and v_asset->>'sha256'<>v_unit->>'sha256' then raise exception 'Asset evidence hash differs';end if;
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_result->'candidates') c where jsonb_typeof(c)<>'object' or coalesce(c->>'key','') !~ '^[a-zA-Z0-9._:-]{1,120}$'
   or coalesce(c->>'kind','') not in ('event','action','resource') or jsonb_typeof(c->'fields') is distinct from 'object'
   or jsonb_typeof(c->'claims') is distinct from 'array' or jsonb_array_length(c->'claims')>100 or jsonb_typeof(c->'issues') is distinct from 'array') then raise exception 'Invalid extraction candidate';end if;
 for v_candidate in select value from jsonb_array_elements(p_result->'candidates') loop
  for v_field in select key,value from jsonb_each(v_candidate->'fields') loop
   if jsonb_typeof(v_field.value) not in ('string','number','boolean','null') then raise exception 'Candidate fields must be scalar';end if;
   if v_field.value<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(v_candidate->'claims') c where c->>'field'=v_field.key and c->'value'=v_field.value) then raise exception 'Non-null candidate field lacks evidence';end if;
  end loop;
  for v_claim in select value from jsonb_array_elements(v_candidate->'claims') loop
   if not (v_candidate->'fields' ? (v_claim->>'field')) or v_claim->'value' is distinct from v_candidate->'fields'->(v_claim->>'field')
    or jsonb_typeof(v_claim->'evidence') is distinct from 'array' or jsonb_array_length(v_claim->'evidence') not between 1 and 8 then raise exception 'Invalid field claim';end if;
   for v_span in select value from jsonb_array_elements(v_claim->'evidence') loop
    if coalesce(v_span->>'start','') !~ '^[0-9]{1,7}$' or coalesce(v_span->>'end','') !~ '^[0-9]{1,7}$' or length(coalesce(v_span->>'quote','')) not between 1 and 3000 then raise exception 'Invalid evidence span';end if;
    select value into v_source from jsonb_array_elements(v_units) u where (u->>'assetId')||':'||coalesce(u->>'page','0')=v_span->>'unitId';
    if not found or v_source->>'status' not in ('processed','empty') or tracker_private.extraction_evidence_slice(v_source->>'text',(v_span->>'start')::integer,(v_span->>'end')::integer) is distinct from v_span->>'quote' then raise exception 'Evidence span is not exact retained text';end if;
   end loop;
  end loop;
 end loop;
 select count(*) filter(where u->>'status' in ('processed','empty')),count(*) filter(where u->>'status'<>'blocked' or u->'attempted'='true'::jsonb) into v_visual,v_attempted
  from jsonb_array_elements(v_units) u where u->>'assetId'<>'text';
 if p_result->'stats'->'visualWorkUncertain'='true'::jsonb then
  if p_state='succeeded' or p_result->'complete'='true'::jsonb or v_expected=0 then raise exception 'Unconfirmed visual work cannot claim success';end if;
  v_attempted:=j.visual_page_budget;
 end if;
 if v_attempted>j.visual_page_budget then raise exception 'Visual extraction budget exceeded';end if;
 select count(distinct u->>'assetId') into v_processed from jsonb_array_elements(v_units) u where u->>'assetId'<>'text' and u->>'status' in ('processed','empty');
 if coalesce(p_result->'stats'->>'expectedAssets','')<>v_expected::text or coalesce(p_result->'stats'->>'processedAssets','')<>v_processed::text
  or coalesce(p_result->'stats'->>'processedPages','')<>v_visual::text then raise exception 'Extraction counters disagree';end if;
 if p_state='succeeded' then
  if p_result->'complete'<>'true'::jsonb or exists(select 1 from jsonb_array_elements(v_units) u where u->>'status' not in ('processed','empty'))
    or j.input_snapshot->>'kind'='instagram' then raise exception 'Incomplete media cannot succeed';end if;
  if v_expected=0 and trim(coalesce(j.input_snapshot->>'note',j.input_snapshot->>'caption',''))='' then raise exception 'No extraction evidence was processed';end if;
  for v_asset in select value from jsonb_array_elements(j.input_snapshot->'media') loop
   select count(*) into v_asset_processed from jsonb_array_elements(v_units) u where u->>'assetId'=v_asset->>'assetId' and u->>'status' in ('processed','empty');
   if v_asset_processed=0 then raise exception 'Every supplied asset must be processed';end if;
   if v_asset->>'mimeType'='application/pdf' then
    select min((u->>'expectedPages')::integer) into v_expected_pages from jsonb_array_elements(v_units) u where u->>'assetId'=v_asset->>'assetId';
    if (select count(distinct u->>'expectedPages')<>1 or count(*)<>v_expected_pages or max((u->>'page')::integer)<>v_expected_pages from jsonb_array_elements(v_units) u where u->>'assetId'=v_asset->>'assetId') then raise exception 'PDF page sequence is incomplete';end if;
   end if;
  end loop;
 elsif p_result->'complete'='true'::jsonb then raise exception 'Non-success result cannot claim complete';end if;
 update public.extraction_attempts set state=p_state,finished_at=v_now,visual_pages=v_attempted,error_code=p_error_code where job_id=j.id and lease_token=p_lease_token and state='processing';
 update public.extraction_jobs set state=p_state,result=p_result,error_code=p_error_code,finished_at=v_now,lease_token=null,lease_until=null,
   retry_not_before=case when p_state in ('partial','failed','blocked') then v_now+make_interval(secs=>greatest(60,p_retry_after_seconds)) end where id=j.id;
end $$;

create function public.extraction_enqueue(p_kind text,p_target_id uuid,p_extractor_version text default 'stage2-rules-v1') returns public.extraction_jobs language sql security invoker set search_path='' as $$ select tracker_private.extraction_enqueue(p_kind,p_target_id,p_extractor_version); $$;
create function public.extraction_retry(p_job_id uuid) returns public.extraction_jobs language sql security invoker set search_path='' as $$ select tracker_private.extraction_retry(p_job_id); $$;
create function public.extraction_claim(p_limit integer default 1,p_lease_seconds integer default 180) returns setof public.extraction_jobs language sql security invoker set search_path='' as $$ select * from tracker_private.extraction_claim(p_limit,p_lease_seconds); $$;
create function public.extraction_finish(p_job_id uuid,p_lease_token uuid,p_state text,p_result jsonb,p_error_code text default null,p_retry_after_seconds integer default 0) returns void language sql security invoker set search_path='' as $$ select tracker_private.extraction_finish(p_job_id,p_lease_token,p_state,p_result,p_error_code,p_retry_after_seconds); $$;
revoke all on function tracker_private.extraction_enqueue(text,uuid,text),tracker_private.extraction_retry(uuid),tracker_private.extraction_claim(integer,integer),tracker_private.extraction_finish(uuid,uuid,text,jsonb,text,integer),public.extraction_enqueue(text,uuid,text),public.extraction_retry(uuid),public.extraction_claim(integer,integer),public.extraction_finish(uuid,uuid,text,jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function tracker_private.extraction_enqueue(text,uuid,text),tracker_private.extraction_retry(uuid),public.extraction_enqueue(text,uuid,text),public.extraction_retry(uuid) to authenticated;
grant execute on function tracker_private.extraction_claim(integer,integer),tracker_private.extraction_finish(uuid,uuid,text,jsonb,text,integer),public.extraction_claim(integer,integer),public.extraction_finish(uuid,uuid,text,jsonb,text,integer) to service_role;
grant usage on schema tracker_private to service_role;

-- A confirmed relation is a reversible assertion; native entities and all their
-- source-claim, decision and Calendar identities remain intact.
create table public.reconciliation_links (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.tracker_members(user_id),
 kind text not null check(kind in ('opportunity','occurrence','milestone')),left_id uuid not null,right_id uuid not null,
 reason text not null check(length(reason) between 1 and 2000),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 state text not null default 'proposed' check(state in ('proposed','confirmed','rejected','revoked')),
 created_at timestamptz not null default clock_timestamp(),reviewed_at timestamptz,
 unique(id,owner_id),unique(owner_id,kind,left_id,right_id),check(left_id<right_id)
);
create table public.reconciliation_history (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,link_id uuid not null,
 action text not null check(action in ('propose','confirm','reject','revoke')),snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp(),foreign key(link_id,owner_id) references public.reconciliation_links(id,owner_id)
);
alter table public.reconciliation_links enable row level security;
alter table public.reconciliation_history enable row level security;
create policy owner_reconciliation_links on public.reconciliation_links for select to authenticated using(owner_id=(select auth.uid()) and public.is_tracker_member());
create policy owner_reconciliation_history on public.reconciliation_history for select to authenticated using(owner_id=(select auth.uid()) and public.is_tracker_member());
revoke all on public.reconciliation_links,public.reconciliation_history from public,anon,authenticated,service_role;
grant select on public.reconciliation_links,public.reconciliation_history to authenticated;
create index reconciliation_links_owner_state on public.reconciliation_links(owner_id,state,created_at desc);

create function tracker_private.reconciliation_facts(p_kind text,p_id uuid,p_owner uuid) returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare v jsonb;
begin
 if p_kind='opportunity' then select to_jsonb(o) into v from public.opportunities o where id=p_id and owner_id=p_owner;
 elsif p_kind='occurrence' then select to_jsonb(o)||jsonb_build_object('opportunity',jsonb_build_object('id',p.id,'title',p.title,'revision',p.revision,'source_url',p.source_url,'content_sha256',p.content_sha256))
  into v from public.occurrences o join public.opportunities p on p.id=o.opportunity_id and p.owner_id=o.owner_id where o.id=p_id and o.owner_id=p_owner;
 elsif p_kind='milestone' then select to_jsonb(o)||jsonb_build_object('opportunity',jsonb_build_object('id',p.id,'title',p.title,'revision',p.revision,'source_url',p.source_url,'content_sha256',p.content_sha256))
  into v from public.milestones o join public.opportunities p on p.id=o.opportunity_id and p.owner_id=o.owner_id where o.id=p_id and o.owner_id=p_owner;
 else raise exception 'Invalid reconciliation kind';end if;
 if v is null then raise exception 'Reconciliation entity unavailable';end if;
 return v;
end $$;
revoke all on function tracker_private.reconciliation_facts(text,uuid,uuid) from public,anon,authenticated,service_role;

create function tracker_private.reconciliation_propose(p_kind text,p_left_id uuid,p_right_id uuid,p_reason text) returns public.reconciliation_links language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_owner uuid:=auth.uid(); a uuid:=least(p_left_id,p_right_id);b uuid:=greatest(p_left_id,p_right_id);l jsonb;r jsonb;s jsonb;f text;j public.reconciliation_links;
begin
 if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('opportunity','occurrence','milestone') or p_left_id is null or p_right_id is null or a=b or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Invalid reconciliation proposal';end if;
 l:=tracker_private.reconciliation_facts(p_kind,a,v_owner);r:=tracker_private.reconciliation_facts(p_kind,b,v_owner);
 if l->>'source_id'=r->>'source_id' then raise exception 'Same-source identities remain separate';end if;
 s:=jsonb_build_object('left',l,'right',r);f:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
 insert into public.reconciliation_links(owner_id,kind,left_id,right_id,reason,fingerprint,snapshot) values(v_owner,p_kind,a,b,trim(p_reason),f,s)
 on conflict(owner_id,kind,left_id,right_id) do nothing returning * into j;
 if not found then select * into j from public.reconciliation_links where owner_id=v_owner and kind=p_kind and left_id=a and right_id=b;return j;end if;
 insert into public.reconciliation_history(owner_id,link_id,action,snapshot) values(v_owner,j.id,'propose',s);
 return j;
end $$;

create function tracker_private.reconciliation_preview(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare j public.reconciliation_links;l jsonb;r jsonb;s jsonb;d jsonb;v_commands integer;v_conflict boolean;w jsonb:='[]';
begin
 if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501';end if;
 select * into j from public.reconciliation_links where id=p_id and owner_id=auth.uid();if not found then raise exception 'Reconciliation unavailable';end if;
 l:=tracker_private.reconciliation_facts(j.kind,j.left_id,j.owner_id);r:=tracker_private.reconciliation_facts(j.kind,j.right_id,j.owner_id);s:=jsonb_build_object('left',l,'right',r);
 select coalesce(jsonb_agg(x),'[]') into d from (select distinct on(occurrence_id) occurrence_id,action,target_revision,created_at from public.user_decisions where owner_id=j.owner_id
   and (j.kind='occurrence' and occurrence_id in(j.left_id,j.right_id) or j.kind='opportunity' and occurrence_id in(select id from public.occurrences where owner_id=j.owner_id and opportunity_id in(j.left_id,j.right_id))) order by occurrence_id,decision_index desc) x;
 select count(distinct value->>'action')>1 into v_conflict from jsonb_array_elements(d) where value->>'action' in ('save','reject');
 select count(*) into v_commands from tracker_private.calendar_write_commands c where c.owner_id=j.owner_id and (
  j.kind='occurrence' and c.target_kind='occurrence' and c.target_id in(j.left_id,j.right_id)
  or j.kind='milestone' and c.target_kind='milestone' and c.target_id in(j.left_id,j.right_id)
  or j.kind='opportunity' and (c.target_kind='occurrence' and c.target_id in(select id from public.occurrences where owner_id=j.owner_id and opportunity_id in(j.left_id,j.right_id))
    or c.target_kind='milestone' and c.target_id in(select id from public.milestones where owner_id=j.owner_id and opportunity_id in(j.left_id,j.right_id))));
 if v_conflict then w:=w||jsonb_build_array('Conflicting saved/passed decisions remain separate and need review.');end if;
 if v_commands>0 then w:=w||jsonb_build_array('Related calendar approvals exist. Their immutable identities and payloads are unchanged; check for an existing Google event before approving another source alias.');end if;
 if s<>j.snapshot then w:=w||jsonb_build_array('Source facts changed after this proposal. It cannot be confirmed from its old snapshot.');end if;
 return jsonb_build_object('id',j.id,'kind',j.kind,'state',j.state,'reason',j.reason,'fingerprint',j.fingerprint,'currentFingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'),
   'snapshot',j.snapshot,'currentFacts',s,'relatedDecisions',d,'relatedCalendarApprovals',v_commands,'warnings',w);
end $$;

create function tracker_private.reconciliation_review(p_id uuid,p_action text,p_expected_fingerprint text) returns public.reconciliation_links language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare j public.reconciliation_links;l jsonb;r jsonb;s jsonb;f text;v_existing integer;
begin
 if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501';end if;
 select * into j from public.reconciliation_links where id=p_id and owner_id=auth.uid() for update;if not found then raise exception 'Reconciliation unavailable';end if;
 if p_action is null or p_action not in ('confirm','reject','revoke') or p_expected_fingerprint is null or p_expected_fingerprint<>j.fingerprint then raise exception 'Invalid reconciliation review';end if;
 if p_action='revoke' then if j.state<>'confirmed' then raise exception 'Only confirmed relations can be revoked';end if;
 elsif j.state<>'proposed' then raise exception 'Relation already reviewed';end if;
 l:=tracker_private.reconciliation_facts(j.kind,j.left_id,j.owner_id);r:=tracker_private.reconciliation_facts(j.kind,j.right_id,j.owner_id);s:=jsonb_build_object('left',l,'right',r);f:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
 if p_action='confirm' then
  -- The same owner/kind lock is held by the Calendar insertion guard below.
  perform pg_advisory_xact_lock(hashtextextended(j.owner_id::text||':calendar-alias:'||j.kind,0));
  if f<>j.fingerprint then raise exception 'Reconciliation facts changed' using errcode='40001';end if;
  if j.kind='occurrence' and (l->>'date_precision'<>r->>'date_precision' or l->>'date_precision'='unknown'
   or l->>'date_precision'='instant' and (l->>'starts_at' is distinct from r->>'starts_at' or l->>'ends_at' is distinct from r->>'ends_at')
   or l->>'date_precision'='date' and l->>'start_date' is distinct from r->>'start_date') then raise exception 'Different or unknown occurrences stay separate';end if;
  if j.kind='milestone' and (l->>'kind'<>r->>'kind' or l->>'occurs_at' is distinct from r->>'occurs_at' or l->>'occurs_on' is distinct from r->>'occurs_on'
    or coalesce(l->>'occurs_at',l->>'occurs_on') is null) then raise exception 'Different or unknown milestones stay separate';end if;
  if j.kind in ('occurrence','milestone') then
   with recursive related(id) as (
    select j.left_id union select j.right_id
    union select case when e.left_id=r.id then e.right_id else e.left_id end
     from public.reconciliation_links e join related r on r.id in(e.left_id,e.right_id)
     where e.owner_id=j.owner_id and e.kind=j.kind and e.state='confirmed'
   ) select count(*) into v_existing from tracker_private.calendar_write_commands c
     where c.owner_id=j.owner_id and c.target_kind=j.kind and c.target_id in(select id from related);
   if v_existing>1 then raise exception 'Related calendar approvals require manual review before confirming this relation';end if;
  end if;
 end if;
 update public.reconciliation_links set state=case p_action when 'confirm' then 'confirmed' when 'reject' then 'rejected' else 'revoked' end,reviewed_at=clock_timestamp() where id=j.id returning * into j;
 insert into public.reconciliation_history(owner_id,link_id,action,snapshot) values(j.owner_id,j.id,p_action,s);
 return j;
end $$;

create function public.reconciliation_propose(p_kind text,p_left_id uuid,p_right_id uuid,p_reason text) returns public.reconciliation_links language sql security invoker set search_path='' as $$ select tracker_private.reconciliation_propose(p_kind,p_left_id,p_right_id,p_reason); $$;
create function public.reconciliation_preview(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select tracker_private.reconciliation_preview(p_id); $$;
create function public.reconciliation_review(p_id uuid,p_action text,p_expected_fingerprint text) returns public.reconciliation_links language sql security invoker set search_path='' as $$ select tracker_private.reconciliation_review(p_id,p_action,p_expected_fingerprint); $$;
revoke all on function tracker_private.reconciliation_propose(text,uuid,uuid,text),tracker_private.reconciliation_preview(uuid),tracker_private.reconciliation_review(uuid,text,text),public.reconciliation_propose(text,uuid,uuid,text),public.reconciliation_preview(uuid),public.reconciliation_review(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function tracker_private.reconciliation_propose(text,uuid,uuid,text),tracker_private.reconciliation_preview(uuid),tracker_private.reconciliation_review(uuid,text,text),public.reconciliation_propose(text,uuid,uuid,text),public.reconciliation_preview(uuid),public.reconciliation_review(uuid,text,text) to authenticated;

create function tracker_private.prevent_calendar_alias_duplicate() returns trigger language plpgsql security definer set search_path='' as $$
declare v_exists boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text||':calendar-alias:'||new.target_kind,0));
 with recursive related(id) as (
  select new.target_id
  union select case when e.left_id=r.id then e.right_id else e.left_id end
   from public.reconciliation_links e join related r on r.id in(e.left_id,e.right_id)
   where e.owner_id=new.owner_id and e.kind=new.target_kind and e.state='confirmed'
 ) select exists(select 1 from tracker_private.calendar_write_commands c where c.owner_id=new.owner_id and c.target_kind=new.target_kind and c.target_id in(select id from related)) into v_exists;
 if v_exists then raise exception 'An approval already exists for this occurrence or a confirmed source alias. Review that recorded approval instead.' using errcode='23505';end if;
 return new;
end $$;
revoke all on function tracker_private.prevent_calendar_alias_duplicate() from public,anon,authenticated,service_role;
create trigger calendar_alias_duplicate_guard before insert on tracker_private.calendar_write_commands for each row execute function tracker_private.prevent_calendar_alias_duplicate();

-- Make the duplicate boundary visible before the owner submits an approval.
-- The insertion trigger remains authoritative for concurrent requests.
alter function tracker_private.calendar_write_preview(text,uuid) rename to calendar_write_preview_before_stage2;
revoke all on function tracker_private.calendar_write_preview_before_stage2(text,uuid) from public,anon,authenticated,service_role;
create function tracker_private.calendar_write_preview(p_kind text,p_target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_preview jsonb;c tracker_private.calendar_write_commands;
begin
 v_preview:=tracker_private.calendar_write_preview_before_stage2(p_kind,p_target_id);
 if v_preview->'existingCommand'<>'null'::jsonb then return v_preview;end if;
 with recursive related(id) as (
  select p_target_id
  union select case when e.left_id=r.id then e.right_id else e.left_id end
   from public.reconciliation_links e join related r on r.id in(e.left_id,e.right_id)
   where e.owner_id=auth.uid() and e.kind=p_kind and e.state='confirmed'
 ) select * into c from tracker_private.calendar_write_commands a
   where a.owner_id=auth.uid() and a.target_kind=p_kind and a.target_id in(select id from related)
   order by a.approved_at,a.id limit 1;
 if found then return v_preview||jsonb_build_object('canApprove',false,'blockedReason','confirmed_alias_approved','relatedCalendarApprovalId',c.id);end if;
 return v_preview;
end $$;
revoke all on function tracker_private.calendar_write_preview(text,uuid) from public,anon,authenticated,service_role;
grant execute on function tracker_private.calendar_write_preview(text,uuid) to authenticated;
