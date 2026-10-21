import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { CalendarDraftLink } from '../app/inbox/calendar-draft-link';
import { OpportunityCard, type InboxRow } from '../app/inbox/components';
import { manualCalendarDraft, type CalendarDraftOccurrence } from '../lib/review/calendar-draft';

// Synthetic public event facts. Opening/saving a real Google event is never exercised here.
const event: CalendarDraftOccurrence = {
  id: 'fixture-only', title: 'Synthetic concert & talk', starts_at: '2026-10-21T20:00:00-04:00',
  ends_at: '2026-10-21T21:30:00-04:00', date_precision: 'instant', timezone: 'America/New_York',
  all_day: false, status: 'scheduled', location: 'Synthetic Hall, Room 2',
  source_url: 'https://calendar.fsu.edu/event/synthetic', description: 'A synthetic description.',
};

function draftUrl(row: CalendarDraftOccurrence) {
  const draft = manualCalendarDraft(row);
  if (!draft.ready) throw new Error(draft.reason);
  return new URL(draft.url);
}

test('a one-off Google editor draft uses precise UTC instants across a local date boundary', () => {
  const url = draftUrl(event);
  assert.equal(url.origin, 'https://calendar.google.com');
  assert.equal(url.pathname, '/calendar/r/eventedit');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('dates'), '20261022T000000Z/20261022T013000Z');
  assert.equal(url.searchParams.get('stz'), 'America/New_York');
  assert.equal(url.searchParams.get('etz'), 'America/New_York');
  assert.equal(url.searchParams.get('text'), event.title);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['action', 'dates', 'details', 'etz', 'location', 'stz', 'text']);
});

test('the repeated autumn clock preserves the true one-hour interval rather than becoming zero length', () => {
  const url = draftUrl({ ...event, starts_at: '2026-11-01T01:30:00-04:00', ends_at: '2026-11-01T01:30:00-05:00' });
  assert.equal(url.searchParams.get('dates'), '20261101T053000Z/20261101T063000Z');
});

test('an absolute source instant with no valid named timezone uses explicit UTC, without guessing Eastern', () => {
  for (const timezone of [null, 'Invalid/Timezone']) {
    const url = draftUrl({ ...event, timezone });
    assert.equal(url.searchParams.get('dates'), '20261022T000000Z/20261022T013000Z');
    assert.equal(url.searchParams.get('stz'), 'UTC');
    assert.equal(url.searchParams.get('etz'), 'UTC');
  }
});

test('missing, invalid, timezone-free and conflicting intervals cannot acquire an invented duration', () => {
  for (const row of [
    { ...event, ends_at: null },
    { ...event, starts_at: null },
    { ...event, ends_at: '2026-10-21T21:30:00' },
    { ...event, starts_at: '2026-02-30T20:00:00-04:00' },
    { ...event, ends_at: '2026-10-21T20:00:00-04:00' },
    { ...event, ends_at: '2026-10-21T19:00:00-04:00' },
    { ...event, date_precision: 'unknown' },
    { ...event, date_precision: 'date', start_date: '2026-10-21' },
    { ...event, starts_at: '2026-10-21T20:00:00.100Z', ends_at: '2026-10-21T20:00:00.200Z' },
  ]) assert.equal(manualCalendarDraft(row).ready, false);
});

test('all-day drafts require a known exclusive end and retain source days through DST and year boundaries', () => {
  const allDay = { ...event, all_day: true, date_precision: 'date', start_date: '2026-11-01', end_date: '2026-11-03', starts_at: null, ends_at: null };
  const url = draftUrl(allDay);
  assert.equal(url.searchParams.get('dates'), '20261101/20261103');
  assert.equal(url.searchParams.has('stz'), false);
  assert.equal(draftUrl({ ...allDay, start_date: '2026-12-31', end_date: '2027-01-01' }).searchParams.get('dates'), '20261231/20270101');
  for (const end_date of [null, '', '2026-11-01', '2026-10-31', '2026-02-30', '2026-11-03T00:00:00Z']) {
    assert.equal(manualCalendarDraft({ ...allDay, end_date }).ready, false);
  }
});

test('cancelled, postponed, unknown-status and untitled events do not offer an add link', () => {
  for (const status of ['cancelled', 'postponed', 'unknown']) assert.equal(manualCalendarDraft({ ...event, status }).ready, false);
  assert.equal(manualCalendarDraft({ ...event, title: '  ' }).ready, false);
});

test('untrusted source text stays in encoded data and cannot inject guests, recurrence or reminder parameters', () => {
  const title = 'Example &add=outsider@example.com&recur=RRULE:FREQ=DAILY';
  const url = draftUrl({ ...event, title, location: 'Room &add=outsider@example.com', description: '<script>example</script>\n&reminders=true', source_url: 'javascript:alert(1)' });
  assert.equal(url.searchParams.get('text'), title);
  assert.equal(url.searchParams.get('location'), 'Room &add=outsider@example.com');
  assert.equal(url.searchParams.has('add'), false);
  assert.equal(url.searchParams.has('recur'), false);
  assert.equal(url.searchParams.has('reminders'), false);
  assert.equal(url.searchParams.get('details')?.includes('javascript:'), false);
  assert.equal(url.searchParams.get('details')?.includes('Ticket availability is unverified.'), true);
});

test('the rendered action says it opens a draft requiring Google Save, while an unknown end offers no link', () => {
  const html = renderToStaticMarkup(createElement(CalendarDraftLink, { row: event }));
  assert.ok(html.includes('Add to Google Calendar'));
  assert.ok(html.includes('Opens a draft. Review it in Google and press Save'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('referrerPolicy="no-referrer"') || html.includes('referrerpolicy="no-referrer"'));
  assert.equal(html.includes('<form'), false);
  const unknown = renderToStaticMarkup(createElement(CalendarDraftLink, { row: { ...event, ends_at: null } }));
  assert.equal(unknown.includes('<a'), false);
  assert.ok(unknown.includes('end is unverified'));
});

test('a saved occurrence keeps the manual action while a passed occurrence never offers it', () => {
  const row: InboxRow = {
    ...event, description: event.description!, source_url: event.source_url!, location: event.location!,
    timezone: event.timezone!, opportunity_id: 'fixture-opportunity', revision: 1, categories: [],
    uncertainties: [], source_id: 'fsu-calendar-api', source_health: 'success',
    source_last_success_at: null, source_last_attempt_at: null, coverage_note: null,
    local_start_text: null, decision: 'save',
  };
  const saved = renderToStaticMarkup(createElement(OpportunityCard, { row }));
  assert.ok(saved.includes('Add to Google Calendar'));
  assert.ok(saved.includes('press Save to add it yourself'));
  const passed = renderToStaticMarkup(createElement(OpportunityCard, { row: { ...row, decision: 'reject' } }));
  assert.equal(passed.includes('calendar.google.com'), false);
});
