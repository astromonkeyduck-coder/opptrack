-- Hosted official milestone row-policy checks with actual SQL roles; no signed-JWT or Storage HTTP claim.
begin isolation level repeatable read;
do $$
declare owner uuid; other uuid:='22222222-2222-4222-8222-222222222222'; checks jsonb:='[]'; n bigint; role_name text; subject text; label text; denied boolean; query_text text;
begin
 select user_id into strict owner from public.tracker_members;
 if owner=other then other:='33333333-3333-4333-8333-333333333333'; end if;
 for role_name,subject,label in select * from (values ('authenticated',owner::text,'owner'),('authenticated',other::text,'other'),('anon','','anonymous')) as r(role_name,subject,label) loop
  perform set_config('request.jwt.claim.sub',subject,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role',role_name)::text,true);
  execute format('set local role %I',role_name);
  for query_text in select * from (values
   ('select count(*) from public.milestones where source_id in (''fsu-onf-dates'',''fsu-cre-applications'',''fsu-career-deadlines'',''fsu-opening-nights'')'),
   ('select count(*) from public.milestone_inbox where source_id in (''fsu-onf-dates'',''fsu-cre-applications'',''fsu-career-deadlines'',''fsu-opening-nights'')'),
   ('select count(*) from public.captures where source_id in (''fsu-onf-dates'',''fsu-cre-applications'',''fsu-career-deadlines'',''fsu-opening-nights'')')
  ) q(query_text) loop
   denied:=false;n:=-1;
   begin execute query_text into n; exception when insufficient_privilege then denied:=true;end;
   checks:=checks||jsonb_build_array(jsonb_build_object('role',label,'query',query_text,'count',case when denied then null else n end,'passed',case when label='owner' then not denied and n>0 else denied or n=0 end));
  end loop;
  execute 'reset role';
 end loop;
 checks:=checks||jsonb_build_array(
 jsonb_build_object('test','worker_lease_only','passed',has_function_privilege('service_role','public.lease_due_official_sources(integer,integer)','execute') and not has_function_privilege('anon','public.lease_due_official_sources(integer,integer)','execute') and not has_function_privilege('authenticated','public.lease_due_official_sources(integer,integer)','execute')),
 jsonb_build_object('test','captures_bucket_private','passed',(select not public from storage.buckets where id='captures')),
 jsonb_build_object('test','owner_cannot_mutate_source_state','passed',not has_table_privilege('authenticated','public.sources','update'))
 );
 if exists(select 1 from jsonb_array_elements(checks) c where not (c->>'passed')::boolean) then raise exception 'Official hosted policy audit failed: %',checks; end if;
 perform set_config('tracker.official_audit',jsonb_build_object('checked_at',clock_timestamp(),'checks',checks,'passed',jsonb_array_length(checks),'persistent_changes',0,'scope','Actual SQL roles and local claims; not signed-JWT or Storage HTTP proof')::text,true);
end $$;
select current_setting('tracker.official_audit')::jsonb as official_policy_checks;
rollback;
