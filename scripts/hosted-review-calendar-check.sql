-- Transactional hosted audit: RPC writes are exercised, then unconditionally
-- rolled back. No Google calls, users, calendar events or persistent review rows.
-- PostgreSQL identity sequences can advance despite rollback. SQL roles/local
-- claims do not prove signed-JWT HTTP/browser authorization or real encryption.
begin isolation level repeatable read;
do $$
declare
  v_owner uuid; v_other uuid; v_occurrence uuid; v_revision integer;
  v_result jsonb; v_saved jsonb; v_newer jsonb; v_current jsonb;
  v_checks jsonb:='[]'; v_id uuid; v_calendar_revision uuid; v_next_revision uuid;
  v_prior text; v_count bigint; v_before bigint; v_pass boolean; v_test record;
  v_cipher text:='v1.'||repeat('A',16)||'.'||repeat('B',22)||'.SYNTHETIC_NOT_ENCRYPTED';
begin
  if (select count(*) from public.tracker_members)<>1 then raise exception 'Readiness required: exactly one tracker owner'; end if;
  select user_id into v_owner from public.tracker_members;
  v_other:=case when v_owner<>uuid '22222222-2222-4222-8222-222222222222' then uuid '22222222-2222-4222-8222-222222222222' else uuid '33333333-3333-4333-8333-333333333333' end;
  select id,revision into v_occurrence,v_revision from public.review_inbox where owner_id=v_owner and decision is null order by id limit 1;
  if not found then raise exception 'Readiness required: actual undecided occurrence for rollback-only review test'; end if;
  select count(*) into v_before from public.user_decisions where occurrence_id=v_occurrence;
  v_checks:=v_checks||jsonb_build_array(
    jsonb_build_object('test','review_view_security_invoker','passed',(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.review_inbox'::regclass)),
    jsonb_build_object('test','calendar_private_rls','passed',(select relrowsecurity from pg_class where oid='tracker_private.google_calendar_connections'::regclass)),
    jsonb_build_object('test','calendar_table_not_directly_accessible','passed',not has_table_privilege('anon','tracker_private.google_calendar_connections','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','tracker_private.google_calendar_connections','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role','tracker_private.google_calendar_connections','SELECT,INSERT,UPDATE,DELETE'))
  );
  for v_test in select * from (values
    ('review_record','public.record_review_decision(uuid,text,integer)'),
    ('review_restore','public.restore_review_decision(uuid,integer,text,text,uuid)'),
    ('calendar_get','public.calendar_connection_get()'),
    ('calendar_put','public.calendar_connection_put(text,uuid)'),
    ('calendar_delete','public.calendar_connection_delete(uuid)')
  ) funcs(name,signature) loop
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_authenticated_only_grant','passed',has_function_privilege('authenticated',v_test.signature,'EXECUTE') and not has_function_privilege('anon',v_test.signature,'EXECUTE')));
  end loop;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_membership','passed',public.is_tracker_member() and auth.uid()=v_owner));
  v_saved:=public.record_review_decision(v_occurrence,'save',v_revision);
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_save_returns_actual_prior','passed',v_saved->>'decision_id' is not null and v_saved->>'previous_decision' is null and (select decision='save' from public.review_inbox where id=v_occurrence)));
  v_id:=public.restore_review_decision(v_occurrence,v_revision,'save',null,(v_saved->>'decision_id')::uuid);
  select count(*) into v_count from public.user_decisions where occurrence_id=v_occurrence;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','undo_clear_preserves_audit_history','passed',v_count=v_before+2 and (select decision is null from public.review_inbox where id=v_occurrence) and (select action='clear' from public.user_decisions where id=v_id)));
  v_pass:=false;begin perform public.restore_review_decision(v_occurrence,v_revision,'save',null,(v_saved->>'decision_id')::uuid);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','repeated_undo_denied','passed',v_pass));
  v_saved:=public.record_review_decision(v_occurrence,'save',v_revision);
  v_pass:=false;begin perform public.restore_review_decision(v_occurrence,v_revision,'save','reject',(v_saved->>'decision_id')::uuid);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','forged_previous_decision_denied','passed',v_pass));
  v_newer:=public.record_review_decision(v_occurrence,'save',v_revision);
  v_pass:=false;begin perform public.restore_review_decision(v_occurrence,v_revision,'save',null,(v_saved->>'decision_id')::uuid);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','stale_same_action_decision_id_denied','passed',v_pass));
  v_pass:=false;begin perform public.record_review_decision(v_occurrence,'reject',v_revision+1);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','stale_review_revision_denied','passed',v_pass));
  v_pass:=false;begin perform public.restore_review_decision(v_occurrence,v_revision+1,'save','save',(v_newer->>'decision_id')::uuid);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','stale_undo_revision_denied','passed',v_pass));

  v_current:=public.calendar_connection_get();
  v_calendar_revision:=public.calendar_connection_put(v_cipher,(v_current->>'revision')::uuid);
  v_current:=public.calendar_connection_get();
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_calendar_synthetic_ciphertext_roundtrip','passed',v_current->>'encrypted_credentials'=v_cipher and (v_current->>'revision')::uuid=v_calendar_revision));
  v_next_revision:=public.calendar_connection_put(v_cipher||'2',v_calendar_revision);
  v_pass:=false;begin perform public.calendar_connection_put(v_cipher,v_calendar_revision);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','calendar_stale_update_cas_denied','passed',v_pass and v_next_revision<>v_calendar_revision));
  v_pass:=false;begin perform public.calendar_connection_delete(v_calendar_revision);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','calendar_stale_delete_cas_denied','passed',v_pass));
  v_pass:=public.calendar_connection_delete(v_next_revision);
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_calendar_current_revision_delete','passed',v_pass and public.calendar_connection_get() is null));
  execute 'reset role';

  for v_test in select * from (values ('nonowner','authenticated',v_other::text),('anonymous','anon','')) roles(name,db_role,subject) loop
    perform set_config('request.jwt.claim.sub',v_test.subject,true);
    perform set_config('request.jwt.claims',jsonb_build_object('role',v_test.db_role,'sub',v_test.subject)::text,true);
    execute format('set local role %I',v_test.db_role);
    v_pass:=false;begin perform public.record_review_decision(v_occurrence,'save',v_revision);exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_review_denied','passed',v_pass));
    v_pass:=false;begin perform public.restore_review_decision(v_occurrence,v_revision,'save','save',(v_newer->>'decision_id')::uuid);exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_undo_denied','passed',v_pass));
    v_pass:=false;begin perform public.calendar_connection_get();exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_calendar_read_denied','passed',v_pass));
    v_pass:=false;begin perform public.calendar_connection_put(v_cipher);exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_calendar_put_denied','passed',v_pass));
    v_pass:=false;begin perform public.calendar_connection_delete(v_next_revision);exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_calendar_delete_denied','passed',v_pass));
    v_pass:=false;begin execute 'select count(*) from tracker_private.google_calendar_connections' into v_count;v_pass:=v_count=0;exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_direct_private_table_denied','passed',v_pass));
    execute 'reset role';
  end loop;
  v_result:=jsonb_build_object('checked_at',clock_timestamp(),'test_count',jsonb_array_length(v_checks),'failed',(select count(*) from jsonb_array_elements(v_checks) c where not (c->>'passed')::boolean),'checks',v_checks,'persistent_row_changes',0,'rollback_required',true,'identity_sequence_may_advance',true,'google_calls',0,'credential_fixture','Synthetic format-only bytes; not real encryption or Google credentials','scope','Actual SQL roles and transaction-local claims; not signed-JWT HTTP, crypto or browser proof');
  perform set_config('opportunity_tracker.review_calendar_checks',v_result::text,true);
end $$;
select current_setting('opportunity_tracker.review_calendar_checks')::jsonb as review_calendar_checks;
rollback;
