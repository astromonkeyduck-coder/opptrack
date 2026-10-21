-- Apply only after the tested official adapters and migration are deployed.
-- Idempotent exact-source activation. Existing enabled health/cursor/lease/due state is retained.
begin;
do $$
declare item jsonb; s public.sources; owner uuid; v_now timestamptz:=clock_timestamp();
begin
  if (select count(*) from public.tracker_members)<>1 then raise exception 'Exactly one owner is required'; end if;
  select user_id into owner from public.tracker_members;
  for item in select value from jsonb_array_elements('[{"source_id": "fsu-onf-dates", "name": "Office of National Fellowships deadlines", "url": "https://onf.fsu.edu/important-dates", "cadence_seconds": 21600, "coverage_note": "Only the explicitly labelled fellowship-deadlines section. Individual rows without a year stay undated; academic-year headings do not invent an exact year. TBA and expired-cycle records remain visible.", "adapter": "official-deadlines-v1"}, {"source_id": "fsu-cre-applications", "name": "CRE public research applications", "url": "https://fsu-cre.smapply.us/prog/ds/?page=1&base_query=all", "cadence_seconds": 21600, "coverage_note": "Complete public paginated program directory, including explicit application windows, historical programs and rolling/unknown closing dates. No login, applicant records or submissions.", "adapter": "official-deadlines-v1"}, {"source_id": "fsu-career-deadlines", "name": "Career Center Intern FSU deadlines", "url": "https://career.fsu.edu/programs-services/internfsu", "cadence_seconds": 21600, "coverage_note": "Only student application opening/deadline rows in the labelled Intern FSU hiring timeline. Missing row years/timezones remain unknown. NoleNetwork listings and other employers are not collected.", "adapter": "official-deadlines-v1"}, {"source_id": "fsu-opening-nights", "name": "Opening Nights official ticket notices", "url": "https://www.openingnights.fsu.edu/events", "adapter": "official-tickets-v1", "cadence_seconds": 3600, "coverage_note": "Current official Opening Nights listing and every linked show detail; explicit visible sale notices and observed ticket-link state only. A Buy/Get Tickets link is link_observed, not verified available seats, sale-open timing or eligibility. A missing/disabled link does not imply sold out. Only explicit visible Tickets go on sale month day year at local clock copy creates ticket_release. No timezone is assumed. JSON-LD offer validFrom/availabilityStarts is ignored because observed metadata reuses performance time."}]'::jsonb) loop
    insert into public.sources(id,owner_id,name,adapter,url,enabled,health_status,health_message,coverage_note)
      values(item->>'source_id',owner,item->>'name','unconfigured',item->>'url',false,'setup_needed','Official adapter not activated',item->>'coverage_note') on conflict(id) do nothing;
    select * into s from public.sources where id=item->>'source_id' for update;
    if s.owner_id<>owner then raise exception 'Official source owner mismatch'; end if;
    if s.enabled and s.adapter=item->>'adapter' and s.cadence_seconds=(item->>'cadence_seconds')::integer and s.url=item->>'url' then continue; end if;
    if s.enabled or s.lease_token is not null or s.adapter not in ('unconfigured','official-deadlines-v1','official-tickets-v1') or s.url<>item->>'url' then raise exception 'Unexpected official source state; review before activation'; end if;
    update public.sources set enabled=true,adapter=item->>'adapter',name=item->>'name',cadence_seconds=(item->>'cadence_seconds')::integer,
      next_poll_at=tracker_private.poll_slot_at((item->>'cadence_seconds')::integer,v_now),
      next_due_at=greatest(tracker_private.poll_slot_at((item->>'cadence_seconds')::integer,v_now),retry_not_before),
      health_status='setup_needed',health_message='Official monitor enabled; awaiting first real collection',coverage_note=item->>'coverage_note',updated_at=v_now where id=s.id;
  end loop;
end $$;
commit;
