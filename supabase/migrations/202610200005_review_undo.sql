-- Review gestures change only the owner's private review state. A clear marker
-- restores an undecided item without deleting the prior decision audit trail.
alter table public.user_decisions drop constraint user_decisions_action_check;
alter table public.user_decisions add constraint user_decisions_action_check
  check(action in ('save','reject','clear'));

create or replace view public.review_inbox with (security_invoker=true) as
select oc.id,oc.owner_id,oc.opportunity_id,op.title,op.description,op.source_url,op.categories,op.uncertainties,
  oc.starts_at,oc.ends_at,oc.start_date,oc.all_day,oc.local_start_text,oc.timezone,oc.date_precision,oc.location,oc.status,oc.revision,oc.source_id,
  s.name as source_name,s.cadence_seconds as source_cadence_seconds,s.health_status as source_health,s.last_success_at as source_last_success_at,s.last_attempt_at as source_last_attempt_at,s.coverage_note,
  nullif(d.action,'clear') as decision,d.created_at as decision_at
from public.occurrences oc
join public.opportunities op on op.id=oc.opportunity_id and op.owner_id=oc.owner_id
join public.sources s on s.id=oc.source_id and s.owner_id=oc.owner_id
left join lateral (select action,created_at from public.user_decisions where occurrence_id=oc.id and owner_id=oc.owner_id order by decision_index desc limit 1) d on true;
revoke all on public.review_inbox from anon;
grant select on public.review_inbox to authenticated,service_role;

-- Keep the existing save/reject RPC as the only writer of those decisions.
-- Its parent occurrence lock is shared with undo and source revisions. Holding
-- that lock here also makes the previous state returned to the client exact.
create function public.record_review_decision(p_occurrence_id uuid,p_action text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_occurrence public.occurrences; v_previous text; v_id uuid;
begin
  if auth.uid() is null or not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_action is null or p_action not in ('save','reject') then raise exception 'Only save/reject are enabled' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'Invalid revision' using errcode='22023'; end if;
  select * into v_occurrence from public.occurrences where id=p_occurrence_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_occurrence.revision<>p_expected_revision then raise exception 'Occurrence changed; review current facts' using errcode='40001'; end if;
  select nullif(action,'clear') into v_previous from public.user_decisions
    where owner_id=auth.uid() and occurrence_id=p_occurrence_id order by decision_index desc limit 1;
  v_id:=public.record_decision(p_occurrence_id,p_action,p_expected_revision);
  return jsonb_build_object('decision_id',v_id,'previous_decision',v_previous);
end $$;
revoke all on function public.record_review_decision(uuid,text,integer) from public,anon;
grant execute on function public.record_review_decision(uuid,text,integer) to authenticated;

-- Both the current decision's immutable ID and its action must match. Matching
-- only the action would allow an old undo to overwrite a newer identical swipe.
create function public.restore_review_decision(
  p_occurrence_id uuid,p_expected_revision integer,p_expected_action text,
  p_previous_action text,p_expected_decision_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_occurrence public.occurrences; v_current public.user_decisions; v_previous text; v_id uuid;
begin
  if auth.uid() is null or not public.is_tracker_member() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_expected_action is null or p_expected_action not in ('save','reject')
    or (p_previous_action is not null and p_previous_action not in ('save','reject'))
    or p_expected_decision_id is null or p_expected_revision is null or p_expected_revision<1
  then raise exception 'Invalid review state' using errcode='22023'; end if;
  select * into v_occurrence from public.occurrences where id=p_occurrence_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_occurrence.revision<>p_expected_revision then raise exception 'Occurrence changed; review current facts' using errcode='40001'; end if;
  select * into v_current from public.user_decisions where owner_id=auth.uid() and occurrence_id=p_occurrence_id order by decision_index desc limit 1;
  if not found or v_current.id is distinct from p_expected_decision_id or v_current.action is distinct from p_expected_action
  then raise exception 'Review changed; reload before undoing' using errcode='40001'; end if;
  select nullif(action,'clear') into v_previous from public.user_decisions
    where owner_id=auth.uid() and occurrence_id=p_occurrence_id and decision_index<v_current.decision_index
    order by decision_index desc limit 1;
  if v_previous is distinct from p_previous_action
  then raise exception 'Previous review changed; reload before undoing' using errcode='40001'; end if;
  insert into public.user_decisions(owner_id,occurrence_id,action,target_revision)
    values(auth.uid(),p_occurrence_id,coalesce(v_previous,'clear'),p_expected_revision) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.restore_review_decision(uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.restore_review_decision(uuid,integer,text,text,uuid) to authenticated;
