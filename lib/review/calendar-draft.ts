import { safeExternalUrl } from '../intake/presentation';
import { occurrenceSchedule, type DatedOccurrence } from './deck';

export type CalendarDraftOccurrence = DatedOccurrence & {
  title: string;
  ends_at: string | null;
  /** A source-confirmed exclusive end date. Never inferred from a missing duration. */
  end_date?: string | null;
  description?: string | null;
  source_url?: string | null;
  location?: string | null;
  status: string;
};

export type CalendarDraft = { ready: true; url: string } | { ready: false; reason: string };

function validDateOnly(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function compactInstant(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Opens Google's prefilled editor only; following the link cannot save an event.
 * Google documents this user-controlled, one-off route at:
 * https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#provide_a_link_for_users_to_add_the_event
 * No API authorization, invitees, recurrence, reminders or tracker decisions are attached.
 */
export function manualCalendarDraft(row: CalendarDraftOccurrence): CalendarDraft {
  if (row.status !== 'scheduled') return { ready: false, reason: 'Confirm this event’s status before adding it to Google Calendar.' };
  if (!row.title.trim()) return { ready: false, reason: 'An event title is needed before preparing a calendar draft.' };
  const start = occurrenceSchedule(row);
  let dates: string;
  let timezone: string | null = null;
  if (row.all_day) {
    if (start.precision !== 'date' || !start.dateKey || !validDateOnly(row.end_date) || row.end_date <= start.dateKey) {
      return { ready: false, reason: 'The all-day end date is unverified. Check the source before adding it yourself.' };
    }
    dates = `${start.dateKey.replaceAll('-', '')}/${row.end_date.replaceAll('-', '')}`;
  } else {
    const end = occurrenceSchedule({ ...row, starts_at: row.ends_at });
    if (start.precision !== 'instant' || !row.starts_at || end.precision !== 'instant' || !row.ends_at) {
      return { ready: false, reason: 'The time or end is unverified. Check the source before adding it yourself.' };
    }
    if (Date.parse(row.ends_at) <= Date.parse(row.starts_at)) return { ready: false, reason: 'The event’s start and end conflict. Check the source before adding it yourself.' };
    const from = compactInstant(row.starts_at);
    const to = compactInstant(row.ends_at);
    if (to <= from) return { ready: false, reason: 'The event’s duration is unverified. Check the source before adding it yourself.' };
    dates = `${from}/${to}`;
    // UTC instants remain precise when the source has no valid named timezone.
    timezone = start.uncertain ? 'UTC' : row.timezone!;
  }
  const url = new URL('https://calendar.google.com/calendar/r/eventedit');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', row.title);
  url.searchParams.set('dates', dates);
  if (timezone) {
    url.searchParams.set('stz', timezone);
    url.searchParams.set('etz', timezone);
  }
  const source = safeExternalUrl(row.source_url);
  const details = [row.description?.trim(), source ? `Source: ${source}` : null, 'Review the source and these details before saving. Ticket availability is unverified.'].filter(Boolean).join('\n\n');
  url.searchParams.set('details', details);
  if (row.location?.trim()) url.searchParams.set('location', row.location.trim());
  return { ready: true, url: url.href };
}
