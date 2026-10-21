import { manualCalendarDraft, type CalendarDraftOccurrence } from '../../lib/review/calendar-draft';

/** A normal external link: Google asks the user to review and press Save. */
export function CalendarDraftLink({ row }: { row: CalendarDraftOccurrence }) {
  const draft = manualCalendarDraft(row);
  if (!draft.ready) return <p className="small">{draft.reason}</p>;
  return <div>
    <a className="button-secondary" href={draft.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Add to Google Calendar ↗</a>
    <p className="small">Opens a draft. Review it in Google and press Save to add it yourself.</p>
  </div>;
}
