-- Execute only after owner registration and real worker ingestion are ready.
-- Read-only, consistent snapshot; no test users, rows, objects, procedures or schema changes.
-- Role/claim simulation validates PostgreSQL RLS, not a signed JWT or browser login.
begin isolation level repeatable read read only;
do $$
declare
  v_owner uuid; v_other uuid; v_baseline jsonb; v_owner_counts jsonb;
  v_checks jsonb:='[]'; v_test record; v_count bigint; v_expected bigint;
  v_pass boolean; v_result text; v_owner_count bigint;
begin
  select count(*) into v_owner_count from public.tracker_members;
  if v_owner_count<>1 then raise exception 'Readiness required: exactly one confirmed owner'; end if;
  select user_id into v_owner from public.tracker_members;
  v_other:=case when v_owner<>uuid '22222222-2222-4222-8222-222222222222' then uuid '22222222-2222-4222-8222-222222222222' else uuid '33333333-3333-4333-8333-333333333333' end;
  select jsonb_build_object(
    'checked_at',clock_timestamp(),'auth_user_count',(select count(*) from auth.users),'owner_count',v_owner_count,
    'sources',(select count(*) from public.sources),'source_runs',(select count(*) from public.source_runs),
    'captures',(select count(*) from public.captures),'opportunities',(select count(*) from public.opportunities),
    'occurrences',(select count(*) from public.occurrences),'entity_versions',(select count(*) from public.entity_versions),
    'field_claims',(select count(*) from public.field_claims),'review_inbox',(select count(*) from public.review_inbox),
    'user_decisions',(select count(*) from public.user_decisions),'manual_intakes',(select count(*) from public.manual_intakes),
    'private_objects',(select count(*) from storage.objects where bucket_id='captures'),
    'bucket_private',(select not public from storage.buckets where id='captures')
  ) into v_baseline;
  if (v_baseline->>'opportunities')::bigint=0 or (v_baseline->>'captures')::bigint=0 or (v_baseline->>'private_objects')::bigint=0 then raise exception 'Readiness required: real populated opportunities, captures and private objects'; end if;

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_owner)::text,true);
  execute 'set local role authenticated';
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_role_and_membership','passed',current_user='authenticated' and public.is_tracker_member() and auth.uid()=v_owner,'sql_role',current_user));
  for v_test in select * from (values
    ('sources','select count(*) from public.sources'),('source_runs','select count(*) from public.source_runs'),
    ('captures','select count(*) from public.captures'),('opportunities','select count(*) from public.opportunities'),
    ('occurrences','select count(*) from public.occurrences'),('entity_versions','select count(*) from public.entity_versions'),
    ('field_claims','select count(*) from public.field_claims'),('review_inbox','select count(*) from public.review_inbox'),
    ('user_decisions','select count(*) from public.user_decisions'),('manual_intakes','select count(*) from public.manual_intakes'),
    ('private_objects','select count(*) from storage.objects where bucket_id=''captures''')
  ) as queries(name,statement) loop
    execute v_test.statement into v_count;
    v_expected:=(v_baseline->>v_test.name)::bigint;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_read_'||v_test.name,'passed',v_count=v_expected,'sql_role',current_user,'visible_rows',v_count,'baseline_rows',v_expected));
  end loop;
  v_checks:=v_checks||jsonb_build_array(
    jsonb_build_object('test','owner_cannot_directly_forge_facts','passed',not has_table_privilege(current_user,'public.opportunities','INSERT,UPDATE,DELETE') and not has_table_privilege(current_user,'public.sources','UPDATE'),'sql_role',current_user),
    jsonb_build_object('test','owner_cannot_bootstrap_membership_or_lease_sources','passed',not has_function_privilege(current_user,'public.configure_tracker_owner(uuid)','EXECUTE') and not has_function_privilege(current_user,'public.lease_due_sources(integer,integer)','EXECUTE'),'sql_role',current_user)
  );
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',v_other::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_other)::text,true);
  execute 'set local role authenticated';
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','nonowner_role_and_membership','passed',current_user='authenticated' and not public.is_tracker_member() and auth.uid()=v_other,'sql_role',current_user));
  for v_test in select * from (values
    ('sources','select count(*) from public.sources'),('source_runs','select count(*) from public.source_runs'),
    ('captures','select count(*) from public.captures'),('opportunities','select count(*) from public.opportunities'),
    ('occurrences','select count(*) from public.occurrences'),('entity_versions','select count(*) from public.entity_versions'),
    ('field_claims','select count(*) from public.field_claims'),('review_inbox','select count(*) from public.review_inbox'),
    ('user_decisions','select count(*) from public.user_decisions'),('manual_intakes','select count(*) from public.manual_intakes'),
    ('private_objects','select count(*) from storage.objects where bucket_id=''captures''')
  ) as queries(name,statement) loop
    v_pass:=false;v_result:='';
    begin
      execute v_test.statement into v_count;
      v_pass:=v_count=0;v_result:='visible_rows='||v_count::text;
    exception when insufficient_privilege then v_pass:=true;v_result:='SQLSTATE 42501 denied';
    end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','nonowner_read_'||v_test.name,'passed',v_pass,'sql_role',current_user,'result',v_result,'populated_baseline_rows',(v_baseline->>v_test.name)::bigint));
  end loop;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role anon';
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','anonymous_role_and_membership','passed',current_user='anon' and not public.is_tracker_member() and auth.uid() is null,'sql_role',current_user));
  for v_test in select * from (values
    ('sources','select count(*) from public.sources'),('captures','select count(*) from public.captures'),
    ('opportunities','select count(*) from public.opportunities'),('review_inbox','select count(*) from public.review_inbox'),
    ('private_objects','select count(*) from storage.objects where bucket_id=''captures''')
  ) as queries(name,statement) loop
    v_pass:=false;v_result:='';
    begin
      execute v_test.statement into v_count;
      v_pass:=v_count=0;v_result:='visible_rows='||v_count::text;
    exception when insufficient_privilege then v_pass:=true;v_result:='SQLSTATE 42501 denied';
    end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','anonymous_read_'||v_test.name,'passed',v_pass,'sql_role',current_user,'result',v_result,'populated_baseline_rows',(v_baseline->>v_test.name)::bigint));
  end loop;
  execute 'reset role';
  perform set_config('opportunity_tracker.populated_rls_result',jsonb_build_object('baseline',v_baseline,'checks',v_checks,'test_count',jsonb_array_length(v_checks),'failed',(select count(*) from jsonb_array_elements(v_checks) as check_item(value) where not (check_item.value->>'passed')::boolean),'database_changes',0,'scope','Actual PostgreSQL SQL roles with transaction-local claims; not JWT/HTTP/browser proof')::text,true);
end $$;
select current_setting('opportunity_tracker.populated_rls_result')::jsonb as populated_rls_checks;
rollback;
