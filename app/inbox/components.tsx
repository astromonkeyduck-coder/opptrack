import type { ReactNode } from 'react';
import { safeExternalUrl, sourceIsStale } from '../../lib/intake/presentation';

export type InboxRow = {
  id: string; opportunity_id: string; title: string; description: string | null; source_url: string | null;
  categories: string[] | null; uncertainties: string[] | null; starts_at: string | null; ends_at: string | null;
  start_date?: string | null; all_day?: boolean; local_start_text: string | null; timezone: string | null;
  date_precision: string; location: string | null; status: string; revision: number; source_id: string;
  source_health: string; source_last_success_at: string | null; source_last_attempt_at: string | null;
  source_cadence_seconds?: number | null; coverage_note: string | null; decision: string | null;
};

export function timestamp(value: string | null) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'Never';
}
function occurrenceDate(row: InboxRow) {
  if (row.date_precision === 'date') {
    const date = row.start_date?.slice(0, 10) || row.starts_at?.slice(0, 10) || 'Date unknown';
    if (row.all_day) return `${date} · all day`;
    return row.local_start_text ? `${row.local_start_text} · timezone unverified` : `${date} · time unknown`;
  }
  if (row.starts_at && !Number.isNaN(Date.parse(row.starts_at))) return timestamp(row.starts_at);
  return row.local_start_text ? `${row.local_start_text} · exact time/zone unverified` : 'Date or time unknown';
}
export function OpportunityCard({ row, actions }: { row: InboxRow; actions?: ReactNode }) {
  const url = safeExternalUrl(row.source_url);
  return <article className="opportunity">
    <div className="card-date">{occurrenceDate(row)}{row.ends_at ? <span>End: {timestamp(row.ends_at)}</span> : <span>End time unverified</span>}</div>
    <div className="card-content"><div className="tags"><span>{row.source_id}</span>{row.decision && <span className="decision">{row.decision === 'save' ? 'Saved' : 'Rejected'}</span>}{row.status !== 'scheduled' && <span>{row.status}</span>}{sourceIsStale(row.source_last_success_at, row.source_cadence_seconds ?? null) && <span>Source stale or never collected</span>}</div><h3>{row.title}</h3><p className="location">{row.location || 'Location unverified'}</p>{row.description && <p className="description">{row.description}</p>}<p className="uncertainty">{[...new Set(['Ticket availability unverified', ...(row.uncertainties || [])])].join(' · ')}</p><p className="small">Last successful collection: {timestamp(row.source_last_success_at)} · Health: {row.source_health}</p><div className="card-actions">{url && <a href={url} rel="noopener noreferrer" target="_blank">Source listing ↗</a>}{actions}</div></div>
  </article>;
}
export function InboxList({ rows, renderActions }: { rows: InboxRow[]; renderActions?: (row: InboxRow) => ReactNode }) {
  return <div className="opportunity-list">{rows.map(row => <OpportunityCard key={row.id} row={row} actions={renderActions?.(row)} />)}</div>;
}
