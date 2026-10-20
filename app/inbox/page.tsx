import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import { cleanSearch, pageNumber, safeExternalUrl, sourceIsStale } from '../../lib/intake/presentation';
import { decide, signOut } from '../actions';
import { InboxList, timestamp, type InboxRow } from './components';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 30;
type SourceRow = { id: string; enabled: boolean; url: string; health_status: string; health_message: string | null; last_success_at: string | null; last_attempt_at: string | null; cadence_seconds: number | null; coverage_note: string | null };
type ManualRow = { id: string; source_url: string | null; note: string | null; media: Array<{ storage_path: string; mime_type: string; byte_count: number }>; status: string; created_at: string; retention_until: string; media_purged_at: string | null };

export default async function Inbox({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; manual_page?: string; decision?: string; message?: string }> }) {
  const { supabase } = await requireTrackerSession();
  const params = await searchParams;
  const q = cleanSearch(params.q || '');
  const page = pageNumber(params.page);
  const manualPage = pageNumber(params.manual_page);
  const decisionFilter = ['save', 'reject'].includes(params.decision || '') ? params.decision! : '';
  let query = supabase.from('review_inbox').select('*', { count: 'exact' }).order('starts_at', { ascending: true, nullsFirst: false }).order('id');
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (decisionFilter) query = query.eq('decision', decisionFilter);
  let manualQuery = supabase.from('manual_intakes').select('id,source_url,note,media,status,created_at,retention_until,media_purged_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id');
  if (q) manualQuery = manualQuery.or(`note.ilike.%${q}%,source_url.ilike.%${q}%`);
  const [inbox, sourceResult, manualResult] = await Promise.all([
    query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from('sources').select('id,enabled,url,health_status,health_message,last_success_at,last_attempt_at,cadence_seconds,coverage_note').order('enabled', { ascending: false }).order('id').limit(100),
    manualQuery.range((manualPage - 1) * PAGE_SIZE, manualPage * PAGE_SIZE - 1),
  ]);
  const rows = (inbox.data || []) as InboxRow[];
  const sources = (sourceResult.data || []) as SourceRow[];
  const manual = (manualResult.data || []) as ManualRow[];
  const anyError = inbox.error || sourceResult.error || manualResult.error;
  const count = inbox.count || 0;
  const manualCount = manualResult.count || 0;
  function pageLink(nextPage: number, nextManualPage = manualPage) { return `/inbox?${new URLSearchParams({ q, page: String(nextPage), manual_page: String(nextManualPage), decision: decisionFilter })}`; }
  return <main className="inbox-shell">
    <header><Link className="wordmark" href="/inbox"><span className="mark" aria-hidden="true">F</span>Opportunity Tracker</Link><nav><Link href="/intake">Add a flyer or link</Link><form action={signOut}><button className="text-button">Sign out</button></form></nav></header>
    <section className="inbox-intro"><p className="eyebrow">Campus comes first</p><h1>Your review inbox</h1><p className="lead">A broad catalog of real source listings. Save what interests you; each occurrence keeps its own decision.</p><p className="approval">Calendar writes disabled · No RSVP, purchase, or messages are sent.</p></section>
    {anyError && <p role="alert" className="notice">The private catalog or source health could not be loaded completely. This is a data-access failure; the visible count may be incomplete. Check migrations and service access.</p>}
    {params.message === 'decision_failed' && <p role="alert" className="notice">The decision could not be saved. The occurrence may have changed; review its latest facts and try again.</p>}
    {params.message === 'decision_saved' && <p role="status" className="notice success">Decision saved for that occurrence. Calendar remains disabled.</p>}
    {params.message === 'intake_saved' && <p role="status" className="notice success">Private intake saved below, awaiting verification. All supplied files are retained; no model has extracted their contents.</p>}
    <section className="coverage" aria-label="Coverage limits"><strong>Coverage to keep in view</strong><p>HQ public listings cover a limited subset; member-only activity is unverified. Ticket availability and on-sale times remain unknown unless stated with evidence. Social and Stories collection is unconfigured. Stale and failed sources are shown below.</p></section>
    <form className="search" role="search" action="/inbox"><label>Search the catalog<input name="q" type="search" defaultValue={q} maxLength={120} placeholder="Concert, research, film…" /></label><label>Decisions<select name="decision" defaultValue={decisionFilter}><option value="">All occurrences</option><option value="save">Saved</option><option value="reject">Rejected</option></select></label><button>Search</button></form>
    <div className="list-heading"><h2>Collected opportunities</h2><span className="small">{inbox.error ? 'Count unavailable' : `${count} matching occurrences`} · Page {page}</span></div>
    {!inbox.error && !rows.length && <div className="empty"><h3>{q || decisionFilter ? 'No matching occurrences' : 'No collected occurrences yet'}</h3><p>{q || decisionFilter ? 'Try a broader search. Source failures and gaps remain visible below.' : 'Run the configured dispatcher to collect the central calendar and independent producer. An empty inbox alone does not establish successful collection.'}</p></div>}
    <InboxList rows={rows} renderActions={row => <form action={decide}><input type="hidden" name="occurrence_id" value={row.id} /><input type="hidden" name="revision" value={row.revision} /><button name="action" value="save" className="secondary">Save occurrence</button><button name="action" value="reject" className="text-button">Reject occurrence</button></form>} />
    <nav className="pagination" aria-label="Catalog pages">{page > 1 && <Link href={pageLink(page - 1)}>← Previous</Link>}{page * PAGE_SIZE < count && <Link href={pageLink(page + 1)}>Next →</Link>}</nav>
    <section className="manual-list"><div className="list-heading"><h2>Private manual intake</h2><Link href="/intake">Add a flyer or link</Link></div><p className="small">Unverified submissions stay separate from source-confirmed event facts. All supplied slides/files are retained privately; OCR and model extraction have not run. {manualResult.error ? '' : `${manualCount} matching submissions · Page ${manualPage}.`}</p>{manualResult.error ? <p className="notice">Manual intake could not be loaded.</p> : !manual.length ? <p className="small">{q ? 'No private submissions match this search.' : 'No private submissions yet.'}</p> : manual.map(item => <article className="manual-item" key={item.id}><strong>Pending verification</strong><p>{item.note || 'No notes supplied.'}</p>{safeExternalUrl(item.source_url) && <a href={safeExternalUrl(item.source_url)!} rel="noopener noreferrer" target="_blank">Saved source link ↗</a>}<p className="small">Submitted {timestamp(item.created_at)} · {item.media.length} supplied file(s)</p>{item.media_purged_at ? <p className="small">Private media deleted on {timestamp(item.media_purged_at)} under the retention policy. Notes and this deletion marker remain.</p> : <><p className="small">Private file retention target: {timestamp(item.retention_until)}. Automated cleanup is not enabled yet.</p><ul>{item.media.map((media, index) => <li key={media.storage_path}><a href={`/api/private-media?path=${encodeURIComponent(media.storage_path)}`}>Download private file {index + 1}</a> · {media.mime_type}</li>)}</ul></>}</article>)}<nav className="pagination" aria-label="Manual intake pages">{manualPage > 1 && <Link href={pageLink(page, manualPage - 1)}>← Previous submissions</Link>}{manualPage * PAGE_SIZE < manualCount && <Link href={pageLink(page, manualPage + 1)}>More submissions →</Link>}</nav></section>
    <section className="source-health"><h2>Source health and access gaps</h2><p className="small">Attempt and success are separate. A blocked, partial or failed run is never “nothing new.” Disabled sources have no active schedule.</p>{sourceResult.error ? <p className="notice">Source health unavailable.</p> : sources.map(source => <details key={source.id}><summary><span>{source.id}</span><span className="small">{source.enabled ? source.health_status : `Disabled · ${source.health_status}`}{source.enabled && sourceIsStale(source.last_success_at, source.cadence_seconds) ? ' · stale / never succeeded' : ''}</span></summary><p>{source.health_message || source.coverage_note || 'Coverage and access have not been established for this route.'}</p><p className="small">Last attempt: {timestamp(source.last_attempt_at)}<br />Last success: {timestamp(source.last_success_at)}</p>{source.coverage_note && <p className="small">{source.coverage_note}</p>}</details>)}</section>
    <footer><span>Broad discovery. Individual decisions.</span><span>Calendar writes disabled.</span></footer>
  </main>;
}
