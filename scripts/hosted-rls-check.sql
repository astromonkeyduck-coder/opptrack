-- Non-destructive hosted policy checks: no Auth users, ownership or events created.
-- Arbitrary test claims are injected only in this transaction, not signed/JWT verified.
-- Storage INSERT is a rejected/rolled-back metadata probe, never a file upload.
begin;
create temporary table stage1_hosted_policy_results(test text primary key,passed boolean not null,sql_role text not null,result text not null) on commit drop;
grant select,insert on pg_temp.stage1_hosted_policy_results to anon,authenticated,service_role;

set local role anon;
set local request.jwt.claim.sub='';
set local request.jwt.claim.role='anon';
set local request.jwt.claims='{"role":"anon"}';
do $$ declare t record; n bigint; begin
  for t in select * from (values
    ('anon_opportunity_read','select count(*) from public.opportunities','denied'),
    ('anon_capture_read','select count(*) from public.captures','denied'),
    ('anon_inbox_read','select count(*) from public.review_inbox','denied'),
    ('anon_owner_table_read','select count(*) from public.tracker_members','denied'),
    ('anon_source_fact_write','with changed as (update public.sources set health_status=health_status where false returning 1) select count(*) from changed','denied'),
    ('anon_storage_read','select count(*) from storage.objects where bucket_id=''captures''','hidden'),
    ('anon_membership_helper','select public.is_tracker_member()::integer','zero'),
    ('anon_worker_lease','select count(*) from public.lease_due_sources(1,600)','denied'),
    ('anon_decision_rpc','select public.record_decision(''33333333-3333-4333-8333-333333333333'',''save'',1)::text::bigint','denied')
  ) as checks(name,statement,expected) loop
    begin
      execute t.statement into n;
      insert into pg_temp.stage1_hosted_policy_results values(t.name,t.expected in ('zero','hidden') and n=0,current_user,'row_or_boolean_count='||coalesce(n::text,'null'));
    exception when insufficient_privilege then
      insert into pg_temp.stage1_hosted_policy_results values(t.name,t.expected in ('denied','hidden'),current_user,'SQLSTATE 42501 denied');
    end;
  end loop;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}';
do $$ declare t record; n bigint; begin
  for t in select * from (values
    ('nonowner_opportunity_read','select count(*) from public.opportunities','zero'),
    ('nonowner_occurrence_read','select count(*) from public.occurrences','zero'),
    ('nonowner_capture_read','select count(*) from public.captures','zero'),
    ('nonowner_source_run_read','select count(*) from public.source_runs','zero'),
    ('nonowner_claim_read','select count(*) from public.field_claims','zero'),
    ('nonowner_inbox_read','select count(*) from public.review_inbox','zero'),
    ('nonowner_manual_read','select count(*) from public.manual_intakes','zero'),
    ('nonowner_owner_table_read','select count(*) from public.tracker_members','denied'),
    ('nonowner_membership_helper','select public.is_tracker_member()::integer','zero'),
    ('nonowner_source_fact_write','with changed as (update public.sources set health_status=health_status where false returning 1) select count(*) from changed','denied'),
    ('nonowner_storage_read','select count(*) from storage.objects where bucket_id=''captures''','hidden'),
    ('nonowner_storage_insert','with changed as (insert into storage.objects(bucket_id,name) values(''captures'',''22222222-2222-4222-8222-222222222222/__rolled_back_policy_probe__'') returning 1) select count(*) from changed','denied'),
    ('nonowner_decision_rpc','select public.record_decision(''33333333-3333-4333-8333-333333333333'',''save'',1)::text::bigint','denied'),
    ('nonowner_manual_rpc','select public.submit_manual_intake(null,''Rollback-only policy probe'',''[]'')::text::bigint','denied'),
    ('nonowner_worker_lease','select count(*) from public.lease_due_sources(1,600)','denied'),
    ('nonowner_private_base','select count(*) from tracker_private.complete_source_run(''fsu-calendar-api'',null,''{}'')','denied')
  ) as checks(name,statement,expected) loop
    begin
      execute t.statement into n;
      insert into pg_temp.stage1_hosted_policy_results values(t.name,t.expected in ('zero','hidden') and n=0,current_user,'row_or_boolean_count='||coalesce(n::text,'null'));
    exception when insufficient_privilege then
      insert into pg_temp.stage1_hosted_policy_results values(t.name,t.expected in ('denied','hidden'),current_user,'SQLSTATE 42501 denied');
    end;
  end loop;
end $$;
reset role;

set local role service_role;
set local request.jwt.claim.sub='';
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$ declare n bigint; begin
  select count(*) into n from public.lease_due_sources(2,600);
  insert into pg_temp.stage1_hosted_policy_results values('worker_lease_empty_unconfigured_project',n=0,current_user,'lease_count='||n::text);
  begin
    perform public.complete_source_run('fsu-calendar-api','33333333-3333-4333-8333-333333333333','{}');
    insert into pg_temp.stage1_hosted_policy_results values('worker_invalid_lease_rejected',false,current_user,'unexpected acceptance');
  exception when serialization_failure then
    insert into pg_temp.stage1_hosted_policy_results values('worker_invalid_lease_rejected',true,current_user,'SQLSTATE 40001 invalid/expired lease rejected');
  end;
  begin
    perform tracker_private.complete_source_run('fsu-calendar-api',null,'{}');
    insert into pg_temp.stage1_hosted_policy_results values('worker_private_base_unavailable',false,current_user,'unexpected acceptance');
  exception when insufficient_privilege then
    insert into pg_temp.stage1_hosted_policy_results values('worker_private_base_unavailable',true,current_user,'SQLSTATE 42501 denied');
  end;
end $$;
reset role;
select jsonb_build_object('check_count',count(*),'passed',count(*) filter(where passed),'failed',count(*) filter(where not passed),'checks',jsonb_agg(to_jsonb(r) order by test)) as checks from pg_temp.stage1_hosted_policy_results r;
rollback;
