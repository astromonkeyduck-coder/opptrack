-- Real hosted SQL roles and RPCs, synthetic facts only, unconditional rollback.
-- No Google/HTTP calls, credentials, OAuth scopes or persistent calendar approvals.
-- This does not prove signed-JWT authorization or independent connection races.
begin;
do $$
declare
  v_owner uuid; v_other uuid:=gen_random_uuid(); v_capture uuid; v_opportunity uuid; v_occurrence uuid; v_unknown uuid; v_milestone uuid;
  v_command jsonb; v_preview jsonb; v_again jsonb; v_lease uuid; v_old_lease uuid; v_pass boolean; v_result jsonb; v_test record;
  v_checks jsonb:='[]'; v_before bigint; v_after bigint; v_nonce text:=gen_random_uuid()::text;
  v_connection jsonb; v_generation uuid; v_cipher text:='v1.'||repeat('A',16)||'.'||repeat('B',22)||'.SYNTHETIC_NOT_ENCRYPTED';
begin
  if (select count(*) from public.tracker_members)<>1 then raise exception 'Exactly one owner required'; end if;
  select user_id into v_owner from public.tracker_members;
  select count(*) into v_before from tracker_private.calendar_write_commands;
  insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until)
    values(v_owner,'fsu-calendar-api','calendar-rollback-'||v_nonce,'https://calendar.fsu.edu',repeat('a',64),'application/json',2,'synthetic-calendar-rollback-v1',now(),now(),now()+interval '1 day') returning id into v_capture;
  insert into public.opportunities(owner_id,source_id,native_id,title,description,source_url,capture_id,content_sha256)
    values(v_owner,'fsu-calendar-api','calendar-rollback-'||v_nonce,'SYNTHETIC rollback audit','<b>Synthetic audit only</b>','https://calendar.fsu.edu/event/synthetic-audit',v_capture,repeat('b',64)) returning id into v_opportunity;
  insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,starts_at,ends_at,date_precision,timezone,status,capture_id,content_sha256)
    values(v_owner,'fsu-calendar-api',v_opportunity,'calendar-rollback-'||v_nonce,clock_timestamp()+interval '30 days',clock_timestamp()+interval '30 days 1 hour','instant','America/New_York','scheduled',v_capture,repeat('c',64)) returning id into v_occurrence;
  insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,date_precision,status,capture_id,content_sha256)
    values(v_owner,'fsu-calendar-api',v_opportunity,'calendar-unknown-'||v_nonce,'unknown','unknown',v_capture,repeat('c',64)) returning id into v_unknown;
  insert into public.milestones(owner_id,source_id,opportunity_id,native_id,kind,uncertainty,capture_id,content_sha256)
    values(v_owner,'fsu-calendar-api',v_opportunity,'calendar-reminder-'||v_nonce,'ticket_release','Source timezone unknown',v_capture,repeat('d',64)) returning id into v_milestone;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','private_commands_rls_and_no_direct_api_grants','passed',
    (select relrowsecurity from pg_class where oid='tracker_private.calendar_write_commands'::regclass)
    and not has_table_privilege('anon','tracker_private.calendar_write_commands','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','tracker_private.calendar_write_commands','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role','tracker_private.calendar_write_commands','SELECT,INSERT,UPDATE,DELETE')));
  for v_test in select * from (values
    ('preview','calendar_write_preview(text,uuid)'),('approve','calendar_write_approve(text,uuid,text,timestamptz,timestamptz)'),
    ('get','calendar_write_get(uuid)'),('list','calendar_write_list()'),('claim','calendar_write_claim(uuid)'),
    ('finish','calendar_write_finish(uuid,uuid,text,text,integer)'),('scoped_connection','calendar_connection_put_scoped(text,uuid,text,boolean)')
  ) f(name,signature) loop
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_authenticated_only_public_and_private_grants','passed',
      has_function_privilege('authenticated','public.'||v_test.signature,'EXECUTE')
      and has_function_privilege('authenticated','tracker_private.'||v_test.signature,'EXECUTE')
      and not has_function_privilege('anon','public.'||v_test.signature,'EXECUTE')
      and not has_function_privilege('anon','tracker_private.'||v_test.signature,'EXECUTE')
      and not has_function_privilege('service_role','public.'||v_test.signature,'EXECUTE')
      and not has_function_privilege('service_role','tracker_private.'||v_test.signature,'EXECUTE')));
  end loop;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);execute 'set local role authenticated';
  v_connection:=public.calendar_connection_get();
  perform public.calendar_connection_put_scoped(v_cipher,(v_connection->>'revision')::uuid,'https://www.googleapis.com/auth/calendar.events.owned',true);
  v_connection:=public.calendar_connection_get();v_generation:=(v_connection->>'authorization_generation')::uuid;
  v_preview:=public.calendar_write_preview('occurrence',v_occurrence);
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','owner_preview_without_approval','passed',(v_preview->>'canApprove')::boolean and v_preview->>'fingerprint' ~ '^[a-f0-9]{64}$' and v_preview->'existingCommand'='null'::jsonb));
  v_pass:=false;begin perform public.calendar_write_approve('occurrence',v_occurrence,repeat('0',64));exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','stale_fingerprint_rejected','passed',v_pass));
  v_command:=public.calendar_write_approve('occurrence',v_occurrence,v_preview->>'fingerprint');
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','explicit_owner_approval_exact_safe_payload','passed',v_command->>'state'='pending'
    and v_command->'payload'->>'summary'=v_preview->>'calendarTitle'
    and v_command->'payload'->>'description'=v_preview->>'calendarDescription'
    and v_command->'payload'->>'description' !~ '<b>'
    and v_command->'payload'->'extendedProperties'->'private'->>'opptrackCommandId'=v_command->>'id'
    and v_command->>'providerEventId' ~ '^opp[a-f0-9]+$'
    and v_command->'payload'->'reminders'='{"useDefault":false}'::jsonb));
  v_again:=public.calendar_write_approve('occurrence',v_occurrence,v_preview->>'fingerprint');
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','duplicate_approval_reuses_command_and_provider_identity','passed',v_again=v_command));
  v_preview:=public.calendar_write_preview('occurrence',v_unknown);v_pass:=false;begin perform public.calendar_write_approve('occurrence',v_unknown,v_preview->>'fingerprint');exception when invalid_parameter_value then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','unknown_interval_denied','passed',v_pass and not (v_preview->>'canApprove')::boolean));
  v_preview:=public.calendar_write_preview('milestone',v_milestone);v_pass:=false;begin perform public.calendar_write_approve('milestone',v_milestone,v_preview->>'fingerprint');exception when invalid_parameter_value then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','milestone_requires_separate_explicit_reminder_time','passed',v_pass));
  v_again:=public.calendar_write_approve('milestone',v_milestone,v_preview->>'fingerprint',clock_timestamp()+interval '20 days',clock_timestamp()+interval '20 days 15 minutes');
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','reminder_has_distinct_command_and_provider_id','passed',v_again->>'id'<>v_command->>'id' and v_again->>'providerEventId'<>v_command->>'providerEventId' and v_again->'payload'->>'summary' ~ '^Reminder: '));
  v_again:=public.calendar_write_claim((v_command->>'id')::uuid);v_lease:=(v_again->>'leaseToken')::uuid;
  v_again:=public.calendar_write_claim((v_command->>'id')::uuid);
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','overlapping_claim_cannot_get_active_lease','passed',v_lease is not null and not(v_again?'leaseToken')));
  v_pass:=false;begin perform public.calendar_write_finish((v_command->>'id')::uuid,v_other,'succeeded');exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','wrong_lease_cannot_finish','passed',v_pass));
  v_again:=public.calendar_write_finish((v_command->>'id')::uuid,v_lease,'uncertain','rate_limited',60);
  v_again:=public.calendar_write_claim((v_command->>'id')::uuid);
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','retry_after_floor_blocks_early_explicit_retry','passed',v_again->>'state'='uncertain' and not(v_again?'leaseToken') and (v_again->>'retryNotBefore')::timestamptz>clock_timestamp()));
  execute 'reset role';
  update tracker_private.calendar_write_commands set retry_not_before=clock_timestamp()-interval '1 second' where id=(v_command->>'id')::uuid;
  execute 'set local role authenticated';v_old_lease:=v_lease;
  v_again:=public.calendar_write_claim((v_command->>'id')::uuid);v_lease:=(v_again->>'leaseToken')::uuid;
  v_pass:=false;begin perform public.calendar_write_finish((v_command->>'id')::uuid,v_old_lease,'succeeded');exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','retry_fences_old_lease_and_preserves_payload','passed',v_pass and v_lease<>v_old_lease and v_again->'payload'=v_command->'payload'));
  v_again:=public.calendar_write_finish((v_command->>'id')::uuid,v_lease,'succeeded');
  v_again:=public.calendar_write_claim((v_command->>'id')::uuid);
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','successful_command_cannot_be_claimed_again','passed',v_again->>'state'='succeeded' and not(v_again?'leaseToken')));
  perform public.calendar_connection_put_scoped(v_cipher,(v_connection->>'revision')::uuid,'https://www.googleapis.com/auth/calendar.events.owned',false);
  v_connection:=public.calendar_connection_get();
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','refresh_preserves_authorization_generation','passed',(v_connection->>'authorization_generation')::uuid=v_generation));
  perform public.calendar_connection_put_scoped(v_cipher,(v_connection->>'revision')::uuid,'https://www.googleapis.com/auth/calendar.events.owned',true);
  v_connection:=public.calendar_connection_get();v_pass:=false;
  begin perform public.calendar_write_claim((v_command->>'id')::uuid);exception when serialization_failure then v_pass:=true;end;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','new_consent_rotates_generation_and_blocks_old_delivery','passed',(v_connection->>'authorization_generation')::uuid<>v_generation and v_pass));
  execute 'reset role';
  for v_test in select * from(values('nonowner','authenticated',v_other::text),('anonymous','anon',''),('worker','service_role','')) r(name,db_role,subject) loop
    perform set_config('request.jwt.claim.sub',v_test.subject,true);execute format('set local role %I',v_test.db_role);
    v_pass:=false;begin perform public.calendar_write_preview('occurrence',v_occurrence);exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_preview_denied','passed',v_pass));
    v_pass:=false;begin perform public.calendar_write_approve('occurrence',v_occurrence,repeat('a',64));exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_approval_denied','passed',v_pass));
    v_pass:=false;begin perform public.calendar_write_claim((v_command->>'id')::uuid);exception when insufficient_privilege then v_pass:=true;end;
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test',v_test.name||'_claim_denied','passed',v_pass));
    execute 'reset role';
  end loop;
  select count(*) into v_after from tracker_private.calendar_write_commands;
  v_checks:=v_checks||jsonb_build_array(jsonb_build_object('test','only_two_synthetic_commands_added_inside_rollback_transaction','passed',v_after=v_before+2));
  v_result:=jsonb_build_object('checked_at',clock_timestamp(),'test_count',jsonb_array_length(v_checks),'failed',(select count(*) from jsonb_array_elements(v_checks)c where not(c->>'passed')::boolean),'checks',v_checks,'persistent_row_changes',0,'rollback_required',true,'google_calls',0,'scope','Real SQL roles/local claims and synthetic rollback facts; not hosted JWT HTTP or Google consent/provider evidence');
  perform set_config('opportunity_tracker.calendar_write_checks',v_result::text,true);
end $$;
select current_setting('opportunity_tracker.calendar_write_checks')::jsonb as calendar_write_checks;
rollback;
