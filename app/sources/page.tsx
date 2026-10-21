import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import { safeExternalUrl, sourceIsStale } from '../../lib/intake/presentation';
import watchlist from '../../config/instagram-watchlist.json';
import { AppShell } from '../components/app-shell';
import { instagramCredentialExpiry } from '../instagram/components';

export const dynamic = 'force-dynamic';

type SourceRow = {
  id: string; name: string; enabled: boolean; url: string;
  health_status: string; health_message: string | null;
  last_success_at: string | null; last_attempt_at: string | null;
  cadence_seconds: number | null; coverage_note: string | null;
  next_due_at: string | null;
};

function dateTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' ET';
}

function cadence(seconds: number | null) {
  if (!seconds) return 'No schedule';
  if (seconds === 3600) return 'Hourly';
  if (seconds % 3600 === 0) return `Every ${seconds / 3600} hours`;
  return `Every ${Math.round(seconds / 60)} minutes`;
}

function sourceState(source: SourceRow, now: number) {
  if (!source.enabled) return 'Not monitoring';
  if (!source.last_attempt_at) return 'Awaiting first check';
  const labels: Record<string, string> = {
    blocked: 'Access blocked', failed: 'Collection failed', rate_limited: 'Rate limited',
    partial: 'Incomplete collection', setup_needed: 'Setup needed',
  };
  if (source.health_status !== 'success') return labels[source.health_status] || 'Check needs review';
  if (sourceIsStale(source.last_success_at, source.cadence_seconds, now)) return 'Collection overdue';
  return 'Last collection succeeded';
}

function needsAttention(source: SourceRow, now: number) {
  return source.enabled && (!source.last_attempt_at || source.health_status !== 'success' || sourceIsStale(source.last_success_at, source.cadence_seconds, now));
}

function SourceDetails({ source, now }: { source: SourceRow; now: number }) {
  const url = safeExternalUrl(source.url);
  const attention = needsAttention(source, now);
  return <details className="source-row" id={source.id}>
    <summary>
      <span><strong>{source.name}</strong><span className="source-cadence">{source.enabled ? cadence(source.cadence_seconds) : 'Inactive route'}</span></span>
      <span className={`source-state${attention ? ' needs-attention' : source.enabled ? ' is-current' : ''}`}>{sourceState(source, now)}</span>
    </summary>
    <div className="source-detail">
      {source.health_message && <p className={attention ? 'source-warning' : ''}>{source.health_message}</p>}
      <dl className="source-timestamps">
        <div><dt>Last attempt</dt><dd>{dateTime(source.last_attempt_at)}</dd></div>
        <div><dt>Last success</dt><dd>{dateTime(source.last_success_at)}</dd></div>
        <div><dt>Next scheduled check</dt><dd>{source.enabled ? dateTime(source.next_due_at) : 'Not scheduled'}</dd></div>
      </dl>
      <p>{source.coverage_note || 'Coverage has not been established for this route.'}</p>
      {source.enabled && <p className="small">Scheduled checks can start later because of processing, retries or provider spreading. A previous success does not prove that the source has no new items.</p>}
      {url && <a className="source-link" href={url} target="_blank" rel="noopener noreferrer">Visit source ↗</a>}
    </div>
  </details>;
}

export default async function SourcesPage() {
  const { supabase } = await requireTrackerSession();
  const result = await supabase.from('sources')
    .select('id,name,enabled,url,health_status,health_message,last_success_at,last_attempt_at,cadence_seconds,coverage_note,next_due_at', { count: 'exact' })
    .order('enabled', { ascending: false }).order('name').limit(100);
  const sources = (result.data || []) as SourceRow[];
  const now = Date.now();
  const enabled = sources.filter(source => source.enabled);
  const inactive = sources.filter(source => !source.enabled);
  const attention = enabled.filter(source => needsAttention(source, now));
  const expiry = instagramCredentialExpiry(watchlist.production_monitoring, now);

  return <AppShell active="sources">
    <div className="page-heading">
      <p className="kicker">Behind your inbox</p>
      <h1>Sources</h1>
      <p className="subtitle">See what is being checked, and where coverage stops.</p>
    </div>

    {result.error ? <section className="notice" role="alert"><strong>Source status is unavailable.</strong><p>The source records could not be loaded. This is a collection-status error, not confirmation that monitoring is healthy or that there is nothing new.</p></section> : <>
      <section className="sources-overview" aria-label="Monitoring summary">
        <div><strong>{enabled.length}</strong><span>Automatically checked</span></div>
        <div><strong>{attention.length}</strong><span>Need attention</span></div>
        <div><strong>{inactive.length}</strong><span>Inactive routes</span></div>
      </section>
      {attention.length > 0 && <section className="notice" role="alert"><strong>{attention.length} monitored source{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} attention.</strong><p>Some checks are blocked, incomplete, overdue or awaiting a first attempt. Previous items remain in your inbox; failed checks never mean there is nothing new.</p></section>}
      {(result.count || 0) > sources.length && <p className="notice">Showing {sources.length} of {result.count} source records. Counts and status below cover only the records shown.</p>}
      <section className="source-list" aria-labelledby="monitoring-heading">
        <div className="list-heading"><h2 id="monitoring-heading">Monitoring</h2><span className="small">Attempt and success are recorded separately</span></div>
        {enabled.length ? enabled.map(source => <SourceDetails key={source.id} source={source} now={now} />) : <p className="empty">No automatic sources are enabled.</p>}
      </section>
      <details className="inactive-sources">
        <summary>Inactive routes <span>{inactive.length}</span></summary>
        <p className="small">These sources have no active schedule. Some need credentials or a verified collection route; others are manual-only.</p>
        <div className="source-list">{inactive.map(source => <SourceDetails key={source.id} source={source} now={now} />)}</div>
      </details>
    </>}

    <section className="coverage-notes" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">What the tracker can see</h2>
      <p>Central Calendar and the Music preview provide event records. Instagram checks the latest 25 posts per enabled account, retaining captions and ordered media metadata. Older posts, changes outside that window and posts between checks can be missed.</p>
      <details><summary>Coverage limits and account access</summary>
        <p>Instagram images and videos have not been downloaded or read. Stories are manual-only. Post publication times are not event dates; ticket availability, deadlines and event details are unverified unless an event source provides them.</p>
        <p>HQ member-only opportunities and private club announcements are not covered automatically. Disabled or unconfigured social routes do not have live monitoring. A loaded public page is not proof of collection, and there is no campus-wide completeness guarantee.</p>
        <p>{expiry.summary}. {expiry.detail}</p>
        <p>Have something the sources missed? <Link href="/intake">Add a link or flyer privately</Link>.</p>
      </details>
    </section>
  </AppShell>;
}
