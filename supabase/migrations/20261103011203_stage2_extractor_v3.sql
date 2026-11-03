-- Stage 2 parser-v3 guard rollout. Versions 1 and 2 remain supported with
-- their exact archived implementations; only new default requests select v3.
-- No prior input, result, decision, source, calendar command or budget is changed.

create or replace function tracker_private.extraction_enqueue(p_kind text,p_target_id uuid,p_extractor_version text) returns public.extraction_jobs
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_owner uuid:=auth.uid(); v_input jsonb; v_media jsonb; v_hash text; v_job public.extraction_jobs; m public.manual_intakes; u public.instagram_updates;
begin
 if not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('manual','instagram') or p_target_id is null or (p_extractor_version is null or p_extractor_version not in ('stage2-rules-v1','stage2-rules-v2','stage2-rules-v3')) then raise exception 'Invalid extraction target or unsupported extractor version';end if;
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

create or replace function tracker_private.extraction_claim(p_limit integer,p_lease_seconds integer) returns setof public.extraction_jobs
language plpgsql security definer set search_path='' as $$
declare j public.extraction_jobs; v_now timestamptz:=clock_timestamp(); v_day timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 v_used integer; v_reserved integer; v_budget integer; v_started integer; v_claimed integer:=0; v_visual boolean;
begin
 if p_limit is null or p_limit not between 1 and 2 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'Invalid extraction lease';end if;
 for j in select * from public.extraction_jobs where (state='processing' or state='queued' and attempts<3 and extractor_version in ('stage2-rules-v1','stage2-rules-v2','stage2-rules-v3'))
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

create or replace function public.extraction_enqueue(p_kind text,p_target_id uuid,p_extractor_version text default 'stage2-rules-v3') returns public.extraction_jobs
language sql security invoker set search_path='' as $$ select tracker_private.extraction_enqueue(p_kind,p_target_id,p_extractor_version); $$;

-- CREATE OR REPLACE preserves identities/ACLs; repeat the existing narrow grants explicitly.
revoke all on function tracker_private.extraction_enqueue(text,uuid,text),public.extraction_enqueue(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function tracker_private.extraction_enqueue(text,uuid,text),public.extraction_enqueue(text,uuid,text) to authenticated;
revoke all on function tracker_private.extraction_claim(integer,integer) from public,anon,authenticated,service_role;
grant execute on function tracker_private.extraction_claim(integer,integer) to service_role;
