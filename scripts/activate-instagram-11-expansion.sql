-- Run only after the 27-account worker is Deployed. No credentials or owner UUID here.
-- Inserts precisely the 11 user-approved, live-proven accounts; preserves existing sources.
with approved(handle,url) as (values
  ('durpfsu','https://www.instagram.com/durpfsu/'),
  ('emhs_fsu','https://www.instagram.com/emhs_fsu/'),
  ('fsu_cre','https://www.instagram.com/fsu_cre/'),
  ('fsucollegeoflaw','https://www.instagram.com/fsucollegeoflaw/'),
  ('fsueconomicsdept','https://www.instagram.com/fsueconomicsdept/'),
  ('fsuhsa','https://www.instagram.com/fsuhsa/'),
  ('fsuigc','https://www.instagram.com/fsuigc/'),
  ('fsumofa','https://www.instagram.com/fsumofa/'),
  ('musicfsu','https://www.instagram.com/musicfsu/'),
  ('onf.fsu','https://www.instagram.com/onf.fsu/'),
  ('openingnights','https://www.instagram.com/openingnights/')
), guard as (
 select user_id from public.tracker_members
 where (select count(*) from public.tracker_members)=1
 and (select count(*) from public.sources where enabled and adapter='instagram-business-discovery-v1' and id in ('instagram-clubdownunderfsu','instagram-fsustudentengagement','instagram-fsustudentaffairs','instagram-fsustudentunion','instagram-aslc_fsu','instagram-fsuhomecoming','instagram-fsusga','instagram-fsucampusrec','instagram-fsuhonors','instagram-fsucareercenter','instagram-fsuip','instagram-fsucge','instagram-thecenterfsu','instagram-fsusustainable','instagram-fsucosspp','instagram-fsucossppslc'))=16
 and not exists(select 1 from public.sources where id in (select 'instagram-'||handle from approved))
), inserted as (
 insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,health_status,health_message,coverage_note)
 select 'instagram-'||a.handle,g.user_id,'Instagram @'||a.handle,'instagram-business-discovery-v1',a.url,true,3600,date_trunc('hour',now()),date_trunc('hour',now()),'setup_needed',
 'Approved live-sample account activated; first production collection pending',
 'Latest 25 parent captions and ordered child IDs/types only; no media files, Stories, OCR, event dates or verified ticket availability. Full history is incomplete.'
 from approved a cross join guard g
 returning id,enabled,cadence_seconds,next_due_at
)
select clock_timestamp() as activated_at,(select count(*) from inserted) as inserted_count,(select jsonb_agg(inserted order by id) from inserted) as inserted_sources;
