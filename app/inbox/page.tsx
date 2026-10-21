import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import { cleanSearch, pageNumber, safeExternalUrl, sourceIsStale } from '../../lib/intake/presentation';
import { decide } from '../actions';
import { AppShell } from '../components/app-shell';
import { ReviewDeck } from './review-deck';
import { InboxList, timestamp, type InboxRow } from './components';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 30;
type SourceRow = { id: string; enabled: boolean; url: string; health_status: string; health_message: string | null; last_success_at: string | null; last_attempt_at: string | null; cadence_seconds: number | null; coverage_note: string | null };
type ManualRow = { id: string; source_url: string | null; note: string | null; media: Array<{ storage_path: string; mime_type: string; byte_count: number }>; status: string; created_at: string; retention_until: string; media_purged_at: string | null };

export default async function Inbox({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; manual_page?: string; decision?: string; message?: string; calendar?: string }> }) {
  const { supabase } = await requireTrackerSession();
  const params = await searchParams;
  const q = cleanSearch(params.q || '');
  const page = pageNumber(params.page);
  const manualPage = pageNumber(params.manual_page);
  const decisionFilter = ['save', 'reject', 'all'].includes(params.decision || '') ? params.decision! : 'new';
  let query = supabase.from('review_inbox').select('*', { count: 'exact' }).order('starts_at', { ascending: true, nullsFirst: false }).order('id');
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (decisionFilter === 'new') {
    const now = new Date().toISOString();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    query = query.is('decision', null).or(`starts_at.gte.${now},ends_at.gte.${now},and(starts_at.is.null,start_date.gte.${today}),and(starts_at.is.null,start_date.is.null)`);
  }
  else if (decisionFilter !== 'all') query = query.eq('decision', decisionFilter);
  let manualQuery = supabase.from('manual_intakes').select('id,source_url,note,media,status,created_at,retention_until,media_purged_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id');
  if (q) manualQuery = manualQuery.or(`note.ilike.%${q}%,source_url.ilike.%${q}%`);
  const [inbox, sourceResult, manualResult, savedResult] = await Promise.all([
    query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from('sources').select('id,enabled,url,health_status,health_message,last_success_at,last_attempt_at,cadence_seconds,coverage_note').order('enabled', { ascending: false }).order('id').limit(100),
    manualQuery.range((manualPage - 1) * PAGE_SIZE, manualPage * PAGE_SIZE - 1),
    supabase.from('review_inbox').select('*', { count: 'exact' }).eq('decision', 'save').order('starts_at', { ascending: true, nullsFirst: false }).order('id').limit(300),
  ]);
  const rows = (inbox.data || []) as InboxRow[];
  const sources = (sourceResult.data || []) as SourceRow[];
  const manual = (manualResult.data || []) as ManualRow[];
  const savedRows = (savedResult.data || []) as InboxRow[];
  const affected = sources.filter(source => source.enabled && (source.health_status !== 'success' || sourceIsStale(source.last_success_at, source.cadence_seconds)));
  const anyError = inbox.error || sourceResult.error || manualResult.error;
  const count = inbox.count || 0;
  const manualCount = manualResult.count || 0;
  function pageLink(nextPage: number, nextManualPage = manualPage) { return `/inbox?${new URLSearchParams({ q, page: String(nextPage), manual_page: String(nextManualPage), decision: decisionFilter })}`; }
  return <AppShell active={decisionFilter === 'save' ? 'saved' : 'discover'}>
    <div className="workspace-heading"><div className="page-heading"><p className="kicker">Florida State · Tallahassee</p><h1>{decisionFilter === 'save' ? 'Your saved events.' : decisionFilter === 'reject' ? 'Passed for now.' : 'Find your next thing.'}</h1><p className="subtitle">{decisionFilter === 'save' ? 'The things you want to keep in mind.' : 'One event at a time. Keep what catches your eye.'}</p></div><Link className="button-secondary add-link" href="/intake">+ Add something</Link></div>
    {anyError && <p role="alert" className="notice">Part of your inbox could not be loaded. The count or source status may be incomplete. This is an access error, not an empty collection.</p>}
    {savedResult.error && <p role="alert" className="notice">Saved events could not be loaded for the calendar preview.</p>}
    {(savedResult.count || 0) > savedRows.length && <p className="notice">The tracker calendar preview shows the first {savedRows.length} saved occurrences. Google Calendar is loaded separately.</p>}
    {params.message === 'decision_failed' && <p role="alert" className="notice">The event may have changed. Review its latest details and try saving again.</p>}
    {params.message === 'decision_saved' && <p role="status" className="notice success">Decision saved. Nothing added to your calendar.</p>}
    {params.message === 'intake_saved' && <p role="status" className="notice success">Submission saved privately. It is awaiting verification.</p>}
    <form className="search" role="search" action="/inbox"><label className="form-field"><span className="sr-only">Search the catalog</span><input name="q" type="search" defaultValue={q} maxLength={120} placeholder="Search events, ideas, opportunities…" /></label><label className="form-field"><span className="sr-only">Decisions</span><select name="decision" defaultValue={decisionFilter}><option value="new">To review</option><option value="all">All occurrences</option><option value="save">Saved</option><option value="reject">Passed</option></select></label><button className="button-primary">Search</button></form>
    <div className="inbox-context"><span>{inbox.error ? 'Count unavailable' : `${count} ${decisionFilter === 'new' ? 'upcoming or undated to review' : 'matching events'}`}</span><Link href="/sources" className={affected.length ? 'health-warning' : ''}>{sourceResult.error ? 'Source status unavailable' : affected.length ? `${affected.length} sources need attention` : 'Source status'} ↗</Link></div>
    {decisionFilter === 'save' || decisionFilter === 'reject' ? <><InboxList rows={rows} renderActions={row => <form action={decide}><input type="hidden" name="occurrence_id" value={row.id} /><input type="hidden" name="revision" value={row.revision} /><button name="action" value={decisionFilter === 'save' ? 'reject' : 'save'} className="button-secondary">{decisionFilter === 'save' ? 'Pass on this' : 'Save occurrence'}</button></form>} />{!inbox.error && !rows.length && <div className="empty"><h2>{q ? 'No matches.' : decisionFilter === 'save' ? 'Nothing saved yet.' : 'No passed events.'}</h2><p>{q ? 'Try another search.' : 'Your decisions will appear here.'}</p><Link href="/inbox">Back to discovery →</Link></div>}<nav className="pagination" aria-label="Catalog pages">{page > 1 && <Link href={pageLink(page - 1)}>← Previous</Link>}{page * PAGE_SIZE < count && <Link href={pageLink(page + 1)}>Next →</Link>}</nav></> : <ReviewDeck key={`${q}:${decisionFilter}:${page}`} rows={rows} savedRows={savedRows} total={count} page={page} calendarMessage={params.calendar} nextPage={page * PAGE_SIZE < count ? pageLink(page + 1) : undefined} previousPage={page > 1 ? pageLink(page - 1) : undefined} continueReviewLink={decisionFilter === 'new' ? pageLink(1) : undefined} />}
    <p className="feed-limits">Tickets and HQ member coverage may be incomplete. <Link href="/sources">See coverage & monitoring</Link>.</p>
    <details className="manual-list"><summary>Your submissions <span>{manualResult.error ? 'Unavailable' : manualCount}</span></summary><div className="manual-content"><div className="list-heading"><h2>Private submissions</h2><Link href="/intake">Add a flyer or link ↗</Link></div><p className="small">Unverified submissions are separate from event facts. Files stay private; OCR and extraction have not run.</p>{manualResult.error ? <p className="notice">Your submissions could not be loaded.</p> : !manual.length ? <p className="small">{q ? 'No submissions match this search.' : 'No submissions yet.'}</p> : manual.map(item => <article className="manual-item" key={item.id}><span className="muted">Awaiting verification</span><p>{item.note || 'No notes supplied.'}</p>{safeExternalUrl(item.source_url) && <a href={safeExternalUrl(item.source_url)!} rel="noopener noreferrer" target="_blank">Saved source link ↗</a>}<details><summary>Files & submission details</summary><p className="small">Submitted {timestamp(item.created_at)} · {item.media.length} file(s)</p>{item.media_purged_at ? <p className="small">Private media deleted on {timestamp(item.media_purged_at)}. Notes and this deletion marker remain.</p> : <><p className="small">Retention target: {timestamp(item.retention_until)}. Automated cleanup is not enabled.</p><ul>{item.media.map((media, index) => <li key={media.storage_path}><a href={`/api/private-media?path=${encodeURIComponent(media.storage_path)}`}>Download private file {index + 1}</a> · {media.mime_type}</li>)}</ul></>}</details></article>)}<nav className="pagination" aria-label="Manual intake pages">{manualPage > 1 && <Link href={pageLink(page, manualPage - 1)}>← Previous submissions</Link>}{manualPage * PAGE_SIZE < manualCount && <Link href={pageLink(page, manualPage + 1)}>More submissions →</Link>}</nav></div></details>
  </AppShell>;
}
