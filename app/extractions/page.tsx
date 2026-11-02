import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import { pageNumber } from '../../lib/intake/presentation';
import { AppShell } from '../components/app-shell';
import { EXTRACTION_PAGE_SIZE, ExtractionJobResult, extractionPageLink, extractionStateLabel, extractionTargetId, extractionTimestamp, type ExtractionJobDetail, type ExtractionJobSummary } from './components';

export const dynamic = 'force-dynamic';
const messages: Record<string, string> = {
  opened: 'Your private submission is saved. Its recorded reading progress is shown below.',
  queued: 'Submission queued. Repeating the same request opens its existing input version.',
  retry_queued: 'Retry queued for this same saved input.',
  invalid: 'Choose one existing private submission or retained post.',
  enqueue_failed: 'The submission could not be queued. Access, queue capacity or source availability may need attention. No read or calendar addition is confirmed.',
  retry_failed: 'This read could not be retried. Check its attempt limit, retry time and current access.',
};

export default async function Extractions({ searchParams }: { searchParams: Promise<{ page?: string; job?: string; message?: string }> }) {
  const { supabase } = await requireTrackerSession();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const day = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
  const [list, daily] = await Promise.all([
    supabase.from('extraction_jobs').select('id,manual_intake_id,instagram_update_id,state,attempts,error_code,extractor_version,created_at,finished_at,retry_not_before', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * EXTRACTION_PAGE_SIZE, page * EXTRACTION_PAGE_SIZE - 1),
    supabase.from('extraction_jobs').select('id', { count: 'exact', head: true }).gte('first_started_at', day),
  ]);
  const rows = (list.data || []) as ExtractionJobSummary[];
  const selectedId = extractionTargetId(params.job) ? params.job : params.job ? null : rows[0]?.id;
  const selected = selectedId ? await supabase.from('extraction_jobs').select('id,owner_id,manual_intake_id,instagram_update_id,state,attempts,error_code,extractor_version,created_at,finished_at,retry_not_before,input_snapshot,result').eq('id', selectedId).maybeSingle() : null;
  const message = params.message && messages[params.message];
  const count = list.count || 0;
  return <AppShell active="extractions">
    <div className="workspace-heading"><div className="page-heading"><p className="kicker">Your source material</p><h1>Flyer details.</h1><p className="subtitle">Read a saved flyer, PDF or caption. Check every suggestion against its source.</p></div><Link className="button-secondary" href="/intake">+ Add a flyer</Link></div>
    {message && <p className="notice" role={params.message === 'queued' || params.message === 'retry_queued' ? 'status' : 'alert'}>{message}</p>}
    <aside className="extraction-budget"><p><strong>Daily limits: two new submissions and 12 image/PDF pages, using UTC days.</strong> {daily.error ? 'Today’s usage could not be loaded.' : `${daily.count || 0} new submissions started today.`} Jobs are picked up by the hourly worker; queueing does not run a read immediately.</p><p className="small">Upload every slide together. Retained Instagram captions can be read, but Instagram images and Stories are unavailable while Meta repair is paused. Saved links are not fetched.</p></aside>
    <p className="small">Results stay private and unverified. Extraction does not add opportunities to the calendar or submit applications. <Link href="/extractions/matches">Review matching listings →</Link></p>
    {list.error ? <p role="alert" className="notice">The extraction queue could not be loaded. This is an access or database error, not an empty queue.</p> : <>
      <div className="inbox-context"><span>{count} queued or recorded submission{count === 1 ? '' : 's'}</span><Link href="/inbox">Open private submissions →</Link></div>
      {!rows.length ? <div className="empty"><h2>No reads queued yet.</h2><p>Open a private submission or retained Instagram post and choose its read-details button.</p><Link href="/intake">Add source material →</Link></div> : <div className="extraction-layout"><nav className="extraction-queue" aria-label="Recorded extraction jobs">{rows.map((job, index) => <Link key={job.id} href={extractionPageLink(page, job.id)} aria-current={job.id === selectedId ? 'page' : undefined}><strong>{job.instagram_update_id ? 'Instagram caption' : 'Private submission'} {(page - 1) * EXTRACTION_PAGE_SIZE + index + 1}</strong><span>{extractionStateLabel(job.state)}</span><small>{extractionTimestamp(job.created_at)}</small></Link>)}</nav><div>{selected?.error || selectedId && !selected?.data || params.job && !extractionTargetId(params.job) ? <p role="alert" className="notice">This recorded submission could not be opened. Choose an item from your queue.</p> : selected?.data ? <ExtractionJobResult job={selected.data as ExtractionJobDetail} /> : null}</div></div>}
      <nav className="pagination" aria-label="Extraction queue pages">{page > 1 && <Link href={extractionPageLink(page - 1)}>← Previous</Link>}<span>Page {page}</span>{page * EXTRACTION_PAGE_SIZE < count && <Link href={extractionPageLink(page + 1)}>Next →</Link>}</nav>
    </>}
  </AppShell>;
}
