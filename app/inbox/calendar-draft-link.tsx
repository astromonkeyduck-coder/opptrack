import { manualCalendarDraft, type CalendarDraftOccurrence } from '../../lib/review/calendar-draft';

/** Opens one approval preview (or Google's unsaved editor); following a link never adds an event. */
export function CalendarDraftLink({ row, calendarWritesEnabled = false, compact = false }: { row: CalendarDraftOccurrence & { id?: string }; calendarWritesEnabled?: boolean; compact?: boolean }) {
  const draft = manualCalendarDraft(row);
  if (calendarWritesEnabled && row.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) return <div>
    <a className="button-secondary" href={`/calendar?kind=occurrence&id=${encodeURIComponent(row.id)}`}>Add to Google Calendar →</a>
    <p className="small">{compact ? 'Review and approve this one event on the next screen.' : 'Review and approve this occurrence on the next screen. Saving for later is separate from calendar approval.'}</p>
    {!compact && (draft.ready ? <details className="post-details"><summary>Open a Google draft instead</summary><a href={draft.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open unsaved Google draft ↗</a><p className="small">Review it in Google and press Save yourself. A draft saved there cannot be reconciled by this app; use one addition route for this occurrence.</p></details> : <p className="small">{draft.reason}</p>)}
  </div>;
  if (!draft.ready) return <p className="small">{draft.reason}</p>;
  return <div>
    <a className="button-secondary" href={draft.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Add to Google Calendar ↗</a>
    <p className="small">Opens a draft. Review it in Google and press Save to add it yourself.</p>
  </div>;
}

export function SavedForLaterNotice({ row, calendarWritesEnabled = false }: { row: CalendarDraftOccurrence & { id?: string }; calendarWritesEnabled?: boolean }) {
  return <div className="review-save-notice" role="status"><p><strong>Saved for later.</strong> {row.title}</p><CalendarDraftLink row={row} calendarWritesEnabled={calendarWritesEnabled} compact /></div>;
}
