-- Run after real Instagram worker rows/private objects exist.
-- READ ONLY repeatable snapshot; no users, posts, objects or schema changes.
-- The simulated non-owner UUID never becomes an Auth user. No owner identifiers,
-- captions, post IDs, object paths or secrets appear in this result.
-- PostgreSQL roles/transaction-local claims are not signed-JWT/Storage HTTP proof.
begin isolation level repeatable read read only;
do $$
declare
  v_owner uuid; v_other uuid; v_owner_count bigint; v_baseline jsonb; v_checks jsonb:='[]';
  v_test record; v_count bigint; v_expected bigint; v_pass boolean; v_result text;
  v_source text; v_search text; v_search_count bigint; v_source_count bigint;
begin
  select count(*) into v_owner_count from public.tracker_members;
  if v_owner_count<>1 then raise exception 'Readiness required: exactly one confirmed owner'; end if;
  select user_id into v_owner from public.tracker_members;
  v_other:=case when v_owner<>uuid '22222222-2222-4222-8222-222222222222' then uuid '22222222-2222-4222-8222-222222222222' else uuid '33333333-3333-4333-8333-333333333333' end;
  select source_id into v_source from public.instagram_updates order by published_at desc,id limit 1;
  select '%'||replace(replace(replace(left(caption,48),'\','\\'),'%','\%'),'_','\_')||'%'
    into v_search from public.instagram_updates where nullif(trim(caption),'') is not null order by published_at desc,id limit 1;
  select count(*) into v_search_count from public.instagram_updates_current where caption ilike v_search;
  select count(*) into v_source_count from public.instagram_updates_current where source_id=v_source;
  select jsonb_build_object(
    'checked_at',clock_timestamp(),'owner_count',v_owner_count,'auth_user_count',(select count(*) from auth.users),
    'instagram_updates',(select count(*) from public.instagram_updates),
    'instagram_update_versions',(select count(*) from public.instagram_update_versions),
    'instagram_updates_current',(select count(*) from public.instagram_updates_current),
    'instagram_captures',(select count(*) from public.captures where evidence_kind='sanitized_api_projection'),
    'instagram_private_objects',(select count(distinct obj.id) from storage.objects obj join public.captures cap on cap.storage_path=obj.name where obj.bucket_id='captures' and cap.evidence_kind='sanitized_api_projection' and cap.purged_at is null),
    'instagram_source_runs',(select count(*) from public.source_runs run join public.sources s on s.id=run.source_id where s.adapter='instagram-business-discovery-v1'),
    'enabled_instagram_sources',(select count(*) from public.sources where enabled and adapter='instagram-business-discovery-v1'),
    'opportunities',(select count(*) from public.opportunities),'occurrences',(select count(*) from public.occurrences),
    'searchable_rows',v_search_count,'one_source_rows',v_source_count,
    'bucket_private',(select not public from storage.buckets where id='captures')
  ) into v_baseline;
  if (v_baseline->>'instagram_updates')::bigint=0 or (v_baseline->>'instagram_captures')::bigint=0
    or (v_baseline->>'instagram_private_objects')::bigint=0 then raise exception 'Readiness required: actual populated Instagram posts, private captures and objects'; end if;

  v_checks:=v_checks||jsonb_build_array(
    jsonb_build_object('test','private_capture_bucket','passed',(v_baseline->>'bucket_private')::boolean),
    jsonb_build_object('test','all_current_posts_have_private_sanitized_capture_evidence','passed',not exists(select 1 from public.instagram_updates u left join public.captures c on c.id=u.capture_id and c.owner_id=u.owner_id left join storage.objects obj on obj.bucket_id='captures' and obj.name=c.storage_path where c.id is null or c.evidence_kind<>'sanitized_api_projection' or c.storage_path is null or (c.purged_at is null and obj.id is null))),
    jsonb_build_object('test','no_duplicate_social_identity_or_version','passed',not exists(select 1 from public.instagram_updates group by owner_id,source_id,native_id having count(*)>1) and not exists(select 1 from public.instagram_update_versions group by update_id,content_hash having count(*)>1)),
    jsonb_build_object('test','post_publications_do_not_create_event_records','passed',not exists(select 1 from public.opportunities op join public.sources s on s.id=op.source_id where s.adapter='instagram-business-discovery-v1') and not exists(select 1 from public.occurrences oc join public.sources s on s.id=oc.source_id where s.adapter='instagram-business-discovery-v1')),
    jsonb_build_object('test','new_tables_have_rls','passed',(select bool_and(relrowsecurity) and count(*)=2 from pg_class where oid in ('public.instagram_updates'::regclass,'public.instagram_update_versions'::regclass))),
    jsonb_build_object('test','feed_view_is_security_invoker','passed',(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.instagram_updates_current'::regclass))
  );
  for v_test in select * from (values
    ('complete_instagram_run','public.complete_instagram_run(text,uuid,jsonb)'),
    ('lease_due_instagram_sources','public.lease_due_instagram_sources(integer,integer)'),
    ('lease_due_sources','public.lease_due_sources(integer,integer)')
  ) as funcs(name,signature) loop
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','service_only_'||v_test.name,'passed',
      has_function_privilege('service_role',v_test.signature,'EXECUTE')
      and not has_function_privilege('authenticated',v_test.signature,'EXECUTE')
      and not has_function_privilege('anon',v_test.signature,'EXECUTE')));
  end loop;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','private_ingestion_helpers_are_not_callable_by_api_roles','passed',
    not has_function_privilege('service_role','tracker_private.lease_due_source_group(text,integer,integer)','EXECUTE')
    and not has_function_privilege('authenticated','tracker_private.lease_due_source_group(text,integer,integer)','EXECUTE')
    and not has_function_privilege('anon','tracker_private.lease_due_source_group(text,integer,integer)','EXECUTE')
    and not has_schema_privilege('authenticated','tracker_private','USAGE') and not has_schema_privilege('anon','tracker_private','USAGE')));

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_owner)::text,true);
  execute 'set local role authenticated';
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','actual_owner_membership','passed',current_user='authenticated' and public.is_tracker_member() and auth.uid()=v_owner));
  for v_test in select * from (values
    ('instagram_updates','select count(*) from public.instagram_updates'),
    ('instagram_update_versions','select count(*) from public.instagram_update_versions'),
    ('instagram_updates_current','select count(*) from public.instagram_updates_current'),
    ('instagram_captures','select count(*) from public.captures where evidence_kind=''sanitized_api_projection'''),
    ('instagram_private_objects','select count(distinct obj.id) from storage.objects obj join public.captures cap on cap.storage_path=obj.name where obj.bucket_id=''captures'' and cap.evidence_kind=''sanitized_api_projection'' and cap.purged_at is null')
  ) as queries(name,statement) loop
    execute v_test.statement into v_count;v_expected:=(v_baseline->>v_test.name)::bigint;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_read_'||v_test.name,'passed',v_count=v_expected,'visible_rows',v_count,'baseline_rows',v_expected));
  end loop;
  select count(*) into v_count from public.instagram_updates_current where caption ilike v_search;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_caption_search','passed',v_search is not null and v_search_count>0 and v_count=v_search_count,'visible_rows',v_count));
  select count(*) into v_count from public.instagram_updates_current where source_id=v_source;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_source_filter','passed',v_source_count>0 and v_count=v_source_count,'visible_rows',v_count));
  select count(*) into v_count from (select id from public.instagram_updates_current order by published_at desc,id limit 20 offset 0) page;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_feed_first_page','passed',v_count=least(20,(v_baseline->>'instagram_updates_current')::bigint),'visible_rows',v_count));
  select count(*) into v_count from (select id from public.instagram_updates_current order by published_at desc,id limit 20 offset 20) page;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_feed_second_page','passed',v_count=least(20,greatest(0,(v_baseline->>'instagram_updates_current')::bigint-20)),'visible_rows',v_count));
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_has_no_direct_social_mutation_privileges','passed',
    not has_table_privilege(current_user,'public.instagram_updates','INSERT,UPDATE,DELETE') and not has_table_privilege(current_user,'public.instagram_update_versions','INSERT,UPDATE,DELETE')));
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',v_other::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_other)::text,true);
  execute 'set local role authenticated';
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','synthetic_nonowner_is_not_member','passed',not public.is_tracker_member() and auth.uid()=v_other));
  for v_test in select * from (values
    ('instagram_updates','select count(*) from public.instagram_updates'),
    ('instagram_update_versions','select count(*) from public.instagram_update_versions'),
    ('instagram_updates_current','select count(*) from public.instagram_updates_current'),
    ('instagram_captures','select count(*) from public.captures where evidence_kind=''sanitized_api_projection'''),
    ('private_objects','select count(*) from storage.objects where bucket_id=''captures''')
  ) as queries(name,statement) loop
    v_pass:=false;v_result:='';
    begin execute v_test.statement into v_count;v_pass:=v_count=0;v_result:='visible_rows='||v_count::text;
    exception when insufficient_privilege then v_pass:=true;v_result:='SQLSTATE 42501 denied';end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','nonowner_read_'||v_test.name,'passed',v_pass,'result',v_result));
  end loop;
  select count(*) into v_count from public.instagram_updates_current where caption ilike v_search and source_id=v_source;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','nonowner_search_filter_denied','passed',v_count=0,'visible_rows',v_count));
  execute 'reset role';

  perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','anon',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);execute 'set local role anon';
  for v_test in select * from (values
    ('instagram_updates','select count(*) from public.instagram_updates'),
    ('instagram_update_versions','select count(*) from public.instagram_update_versions'),
    ('instagram_updates_current','select count(*) from public.instagram_updates_current'),
    ('instagram_captures','select count(*) from public.captures where evidence_kind=''sanitized_api_projection'''),
    ('private_objects','select count(*) from storage.objects where bucket_id=''captures''')
  ) as queries(name,statement) loop
    v_pass:=false;v_result:='';
    begin execute v_test.statement into v_count;v_pass:=v_count=0;v_result:='visible_rows='||v_count::text;
    exception when insufficient_privilege then v_pass:=true;v_result:='SQLSTATE 42501 denied';end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','anonymous_read_'||v_test.name,'passed',v_pass,'result',v_result));
  end loop;
  execute 'reset role';
  perform set_config('opportunity_tracker.instagram_rls_result',jsonb_build_object('baseline',v_baseline,'checks',v_checks,
    'test_count',jsonb_array_length(v_checks),'failed',(select count(*) from jsonb_array_elements(v_checks) as item(value) where not (item.value->>'passed')::boolean),
    'database_changes',0,'scope','Actual PostgreSQL roles with transaction-local claims; not signed-JWT/HTTP/browser proof')::text,true);
end $$;
select current_setting('opportunity_tracker.instagram_rls_result')::jsonb as instagram_rls_checks;
rollback;
