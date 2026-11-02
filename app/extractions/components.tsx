import { validateExtractionResult, extractionUnitId, type ExtractionCandidate, type ExtractionResult, type Primitive } from '../../lib/extraction/contracts';
import { ownsStoragePath } from '../../lib/intake/validation';
import { safeExternalUrl } from '../../lib/intake/presentation';
import { enqueueExtraction, retryExtraction } from './actions';

export const EXTRACTION_PAGE_SIZE = 30;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ExtractionState = 'queued' | 'processing' | 'succeeded' | 'partial' | 'failed' | 'blocked';
export type ExtractionJobSummary = {
  id: string; manual_intake_id: string | null; instagram_update_id: string | null;
  state: ExtractionState; attempts: number; error_code: string | null; extractor_version: string;
  created_at: string; finished_at: string | null; retry_not_before: string | null;
};
export type ExtractionJobDetail = ExtractionJobSummary & { owner_id: string; input_snapshot: Record<string, unknown>; result: unknown };

export function extractionTargetId(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
export function extractionPageLink(page: number, job?: string | null) {
  const params = new URLSearchParams({ page: String(page) });
  if (extractionTargetId(job)) params.set('job', job);
  return `/extractions?${params}`;
}
export function extractionTimestamp(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' ET' : 'Unknown';
}
export function extractionStateLabel(state: ExtractionState) {
  return { queued: 'Queued', processing: 'Reading source material', succeeded: 'Read complete · unverified', partial: 'Partial read · unverified', failed: 'Read failed', blocked: 'Read blocked' }[state];
}
export function canRetryExtraction(job: Pick<ExtractionJobSummary, 'state' | 'attempts' | 'retry_not_before'>, now = Date.now()) {
  if (!['partial', 'failed', 'blocked'].includes(job.state) || job.attempts >= 3) return false;
  return !job.retry_not_before || Number.isFinite(Date.parse(job.retry_not_before)) && Date.parse(job.retry_not_before) <= now;
}
export function parseDisplayedExtraction(value: unknown): ExtractionResult | null {
  try { return validateExtractionResult(value); } catch { return null; }
}

export function QueueExtractionForm({ kind, targetId, label = 'Read flyer details' }: { kind: 'manual' | 'instagram'; targetId: string; label?: string }) {
  if (!extractionTargetId(targetId)) return null;
  return <form action={enqueueExtraction} className="extraction-enqueue"><input type="hidden" name="kind" value={kind} /><input type="hidden" name="target_id" value={targetId} /><button type="submit" className="button-secondary">{label}</button></form>;
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = { title: 'Title', startAt: 'Starts', endAt: 'Ends', date: 'Date', timeZone: 'Source timezone', datePrecision: 'Date detail', status: 'Event status', location: 'Location', cost: 'Cost', organizer: 'Organizer', doorsAt: 'Doors open', occursAt: 'Action time', occursOn: 'Action date', actionType: 'Action', availability: 'Availability', eligibility: 'Eligibility' };
  return labels[field] || field.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
}
function fieldValue(field: string, value: Primitive) {
  if (value === null || value === '') return 'Unknown';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field === 'datePrecision') return { instant: 'Date and time', date: 'Date only', unknown: 'Unknown' }[String(value)] || String(value);
  if(typeof value==='string'&&/At$/.test(field)&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)))return extractionTimestamp(value);
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value)))return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'long'}).format(new Date(`${value}T12:00:00Z`));
  if(field==='actionType')return String(value).replaceAll('_',' ');
  return String(value);
}
function issueText(issue:string){
  const labels:Record<string,string>={unreviewed_extraction:'Check this suggestion against the original.',headline_rule_requires_review:'Confirm the suggested title.',year_missing:'The source does not state a year.',timezone_missing:'The source timezone is unknown.',date_unknown:'The event date is unknown.',end_time_missing:'No event end time was found.',multiple_or_conflicting_dates_require_review:'Multiple dates need review before an occurrence can be identified.',invalid_or_ambiguous_local_time:'This local time is invalid or occurs twice at a daylight-saving change.',timezone_abbreviation_conflict:'The stated timezone conflicts with daylight-saving time on this date.',relative_date_without_original_publication_context:'A relative date could not be anchored to an original publication date.',source_contains_instruction_like_text:'The source includes instruction-like text. It was treated as content only.',recurrence_or_exception_requires_review:'Recurring dates or exceptions need review.',doors_time_separate_from_event_start:'Doors-open time is separate from the event start.',retained_caption_only_media_and_stories_unavailable:'Only the retained caption was read. Instagram images and Stories are unavailable.',instagram_media_not_collected:'Instagram image or video bytes are unavailable.',pdf_text_and_visual_differ:'The PDF text layer and visual reading differ; compare them with the original.',native_work_unconfirmed:'Processing stopped without a confirmed result. Its reserved daily budget is retained.'};
  return labels[issue]||issue.replaceAll('_',' ');
}
function unitLabel(result: ExtractionResult, unitId: string) {
  const unit = result.units.find(item => extractionUnitId(item) === unitId);
  return !unit ? 'Unavailable source unit' : unit.assetId === 'text' ? 'Saved notes or caption' : `File ${unit.assetId}${unit.page === null ? '' : ` · page ${unit.page}`}`;
}
function ResultCandidate({ candidate, result }: { candidate: ExtractionCandidate; result: ExtractionResult }) {
  const title = typeof candidate.fields.title === 'string' && candidate.fields.title ? candidate.fields.title : candidate.kind === 'event' ? 'Possible event' : candidate.kind === 'action' ? 'Possible action' : 'Possible resource';
  return <article className="extraction-candidate">
    <header><span className="muted">{candidate.kind === 'event' ? 'Event suggestion' : candidate.kind === 'action' ? 'Deadline or action suggestion' : 'Resource suggestion'} · Unverified</span><h3>{title}</h3></header>
    <dl className="extraction-fields">{Object.entries(candidate.fields).filter(([field]) => field !== 'title').map(([field, value]) => <div key={field}><dt>{fieldLabel(field)}</dt><dd>{fieldValue(field, value)}</dd></div>)}</dl>
    {candidate.issues.length > 0 && <ul className="small">{candidate.issues.map((issue, index) => <li key={`${index}:${issue}`}>{issueText(issue)}</li>)}</ul>}
    <details className="post-details"><summary>Check the source evidence</summary>{candidate.claims.length ? candidate.claims.map((claim, claimIndex) => <section className="extraction-claim" key={`${claimIndex}:${claim.field}`}><h4>{fieldLabel(claim.field)}: {fieldValue(claim.field, claim.value)}</h4>{claim.evidence.map((span, index) => <div key={`${span.unitId}:${span.start}:${index}`}><p className="small">{unitLabel(result, span.unitId)} · characters {span.start}–{span.end}</p><blockquote>{span.quote}</blockquote></div>)}</section>) : <p>No supported field claims were retained.</p>}</details>
  </article>;
}

export function ExtractionJobResult({ job }: { job: ExtractionJobDetail }) {
  const result = job.result === null ? null : parseDisplayedExtraction(job.result);
  const source = typeof job.input_snapshot.sourceUrl === 'string' ? safeExternalUrl(job.input_snapshot.sourceUrl) : null;
  const media = Array.isArray(job.input_snapshot.media) ? job.input_snapshot.media : [];
  const retryable = canRetryExtraction(job);
  const kind = job.instagram_update_id ? 'Retained Instagram post' : 'Private submission';
  return <section className="extraction-result" aria-label="Selected flyer details">
    <header className="list-heading"><div><p className="kicker">{kind}</p><h2>{extractionStateLabel(job.state)}</h2></div><span className="muted">Submitted {extractionTimestamp(job.created_at)}</span></header>
    <p className="notice">These are unverified suggestions. Source quotes may be incomplete or wrong. They do not create catalog events, calendar entries, applications or reservations.</p>
    {source && <p><a href={source} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open the saved source link ↗</a></p>}
    {job.state === 'queued' && <p>The submission is waiting for the hourly worker. Daily limits can keep a job queued until a later day. Refresh this page to check its recorded progress.</p>}
    {job.state === 'processing' && <p>The worker has started reading this submission. Completion has not been confirmed yet.</p>}
    {job.state === 'failed' && <p role="alert" className="notice">The read failed. This does not mean the source contains no opportunities.</p>}
    {job.state === 'blocked' && <p role="alert" className="notice">The source could not be read. Its contents remain unknown.</p>}
    {job.state === 'partial' && <p role="alert" className="notice">Only part of the supplied material was read. Missing or unreadable slides/pages may contain additional opportunities.</p>}
    {job.result !== null && !result && <p role="alert" className="notice">The stored result could not be safely displayed. No facts from it have been accepted.</p>}
    {result && <>
      <p className="small">{result.stats.processedAssets} of {result.stats.expectedAssets} files read · {result.stats.processedPages} visual pages read · {result.complete ? 'Input read complete' : 'Input read incomplete'}</p>
      {result.issues.length > 0 && <ul className="small">{result.issues.map((issue, index) => <li key={`${index}:${issue}`}>{issueText(issue)}</li>)}</ul>}
      {!result.candidates.length && <p>{result.complete && job.state === 'succeeded' ? 'No opportunities were identified in the processed material. This is an extraction result, not a completeness guarantee.' : 'No supported suggestions are available from this incomplete or failed read. Unread material remains unknown.'}</p>}
      <div className="extraction-candidates">{result.candidates.map(candidate => <ResultCandidate key={candidate.key} candidate={candidate} result={result} />)}</div>
      <details className="post-details"><summary>Every supplied file and page</summary><ol className="extraction-units">{result.units.map(unit => <li key={extractionUnitId(unit)}><strong>{unitLabel(result, extractionUnitId(unit))}</strong> · {unit.status}{unit.issues.length > 0 && <p className="small">{unit.issues.map(issueText).join(' · ')}</p>}<details><summary>Read text</summary><pre className="extraction-source-text">{unit.text || 'No text available.'}</pre></details></li>)}</ol></details>
    </>}
    {media.length > 0 && <details className="post-details"><summary>Original private files</summary><ul>{media.map((value, index) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const path = typeof item.storagePath === 'string' && ownsStoragePath(job.owner_id, item.storagePath) ? item.storagePath : null;
      return <li key={index}>{path ? <a href={`/api/private-media?path=${encodeURIComponent(path)}`}>Download original file {index + 1}</a> : <span>File {index + 1}: original bytes unavailable{job.instagram_update_id ? ' · Instagram media has not been downloaded' : ''}</span>}</li>;
    })}</ul></details>}
    {retryable && <form action={retryExtraction}><input type="hidden" name="job_id" value={job.id} /><button type="submit" className="button-secondary">Retry this read</button><p className="small">Keeps the same saved input. A retry does not fetch the source URL or add anything to your calendar.</p></form>}
    {['partial', 'failed', 'blocked'].includes(job.state) && !retryable && <p className="small">{job.attempts >= 3 ? 'This input has reached its three-attempt limit.' : `A retry is waiting until ${extractionTimestamp(job.retry_not_before)}.`}</p>}
    {job.error_code && <details className="post-details"><summary>Recorded failure details</summary><p>{job.error_code.replaceAll('_', ' ')}</p></details>}
  </section>;
}
