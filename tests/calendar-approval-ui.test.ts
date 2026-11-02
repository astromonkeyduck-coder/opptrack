import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarApproval } from '../app/calendar/components';
import { approvalTime, calendarApprovalPreview, type CalendarApprovalPreview } from '../app/calendar/presentation';
import { CalendarDraftLink } from '../app/inbox/calendar-draft-link';
import type { CalendarDraftOccurrence } from '../lib/review/calendar-draft';
import { MilestoneCard } from '../app/deadlines/components';
import type { MilestoneRow } from '../lib/milestones/presentation';
import { CalendarApprovalHistory } from '../app/calendar/history';

// Synthetic render fixtures; these tests perform no OAuth, Google or database requests.
const id = '11111111-1111-4111-8111-111111111111';
const preview: CalendarApprovalPreview = {
  kind: 'occurrence', targetId: id, title: 'Synthetic campus event', description: 'A source description.',
  calendarTitle: 'Synthetic campus event', calendarDescription: 'Source: https://calendar.fsu.edu/event/synthetic\nAdded after explicit approval in opptrack. Ticket availability unverified.',
  sourceUrl: 'https://calendar.fsu.edu/event/synthetic', location: 'Synthetic hall',
  startsAt: '2027-01-05T19:00:00Z', endsAt: '2027-01-05T20:00:00Z', sourceLocalText: null,
  timezone: 'UTC', uncertainties: ['Ticket availability unverified'], sourceHealth: 'success',
  lastSuccessAt: '2026-11-01T17:00:00Z', cadenceSeconds: 3600, fingerprint: 'a'.repeat(64),
  canApprove: true, blockedReason: null, existingCommand: null,
};
const approvedMetadata = { private: { opptrackCommandId: id, opptrackFingerprint: preview.fingerprint } };
const html = (value: CalendarApprovalPreview, connected = true) => renderToStaticMarkup(createElement(CalendarApproval, { preview: value, connected }));

test('calendar approval displays one exact interval and an unchecked, disabled-by-default approval', () => {
  const rendered = html(preview);
  assert.match(rendered, /Tuesday, January 5, 2027 at 2:00 PM EST/);
  assert.match(rendered, /Tuesday, January 5, 2027 at 3:00 PM EST/);
  assert.match(rendered, /Primary Google Calendar/); assert.match(rendered, /Synthetic hall/);
  assert.match(rendered, /America\/New_York/); assert.match(rendered, /Approve this event &amp; add to Google/);
  assert.match(rendered, /type="checkbox"/); assert.ok(!rendered.includes('checked=""'));
  assert.match(rendered, /button-primary" disabled=""/); assert.match(rendered, /Other saved items will not be added/);
  assert.ok(!rendered.includes('action="/api/calendar/approve"')); // No automatic form navigation or mount request.
});

test('read-only or absent grant offers a separate explicit connection without an approval control', () => {
  const rendered = html(preview, false);
  assert.match(rendered, /action="\/api\/calendar\/connect\?mode=write"/);
  assert.match(rendered, /permission to view and edit events on calendars you own/);
  assert.match(rendered, /Connecting adds no events/);
  assert.ok(!rendered.includes('type="checkbox"')); assert.ok(!rendered.includes('Approve this event &amp; add'));
});

test('unknown source interval remains blocked and cannot prompt a needless write grant', () => {
  const rendered = html({ ...preview, canApprove: false, startsAt: null, endsAt: null, blockedReason: 'unknown_interval' }, false);
  assert.match(rendered, /no verified timed start and end/); assert.match(rendered, /Unverified/);
  assert.ok(!rendered.includes('mode=write')); assert.ok(!rendered.includes('type="checkbox"'));
});

test('milestone reminder never defaults its chosen time to a source deadline or release', () => {
  const rendered = html({ ...preview, kind: 'milestone', calendarTitle: 'Reminder: Synthetic campus event', sourceLocalText: 'Tickets at 11 am; timezone unknown', timezone: null });
  assert.match(rendered, /Reminder: Synthetic campus event/);
  assert.equal((rendered.match(/type="datetime-local"/g) ?? []).length, 2);
  assert.equal((rendered.match(/value=""/g) ?? []).length, 2);
  assert.match(rendered, /your choice, not a verified source deadline or release instant/);
  assert.match(rendered, /Choose a 15-minute reminder/); assert.match(rendered, /Source timezone: Unconfirmed/);
  assert.ok(!rendered.includes('January 5, 2027 at 2:00 PM EST'));
  assert.match(rendered, /button-primary" disabled=""/);
});

test('retry shows the frozen previously approved payload even when source details have changed', () => {
  const rendered = html({ ...preview, title: 'Changed source title', fingerprint: 'b'.repeat(64), existingCommand: { id, kind: 'occurrence', targetId: id, state: 'uncertain', approvedAt: '2026-11-01T18:00:00Z', payload: { extendedProperties: approvedMetadata, summary: 'Original approved title', description: 'Original description', location: 'Original room', start: { dateTime: '2027-01-06T22:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2027-01-06T23:00:00Z', timeZone: 'America/New_York' } } } });
  assert.match(rendered, /Original approved title/); assert.match(rendered, /Original room/); assert.match(rendered, /Wednesday, January 6, 2027 at 5:00 PM EST/);
  assert.match(rendered, /Check existing Google event/); assert.match(rendered, /Current source title: Changed source title/);
  assert.match(rendered, /<h2>Original approved title<\/h2>/);
  assert.match(rendered, /Current source differs from this approval/);
  assert.match(rendered, /A new event will not be inserted/);
  assert.match(rendered, /Current source start: Tuesday, January 5, 2027 at 2:00 PM EST/);
});

test('completed approval has no create or retry control and untrusted source text stays escaped', () => {
  const rendered = html({ ...preview, title: '<script>unsafe</script>', sourceUrl: 'javascript:alert(1)', uncertainties: ['<img src=x>'], existingCommand: { id, kind: 'occurrence', targetId: id, state: 'succeeded', approvedAt: '2026-11-01T18:00:00Z', payload: { extendedProperties: approvedMetadata, summary: '<script>unsafe</script>', description: '', start: { dateTime: preview.startsAt!, timeZone: 'America/New_York' }, end: { dateTime: preview.endsAt!, timeZone: 'America/New_York' } } } });
  assert.match(rendered, /already on your primary Google Calendar/); assert.ok(!rendered.includes('<button'));
  assert.match(rendered, /&lt;script&gt;unsafe/); assert.match(rendered, /&lt;img src=x/);
  assert.ok(!rendered.includes('javascript:')); assert.ok(!rendered.includes('<script>'));
});

test('a previously approved cancelled, started or incomplete occurrence still shows its current block and permits only a check', () => {
  const command = { id, kind: 'occurrence' as const, targetId: id, state: 'uncertain', approvedAt: '2026-11-01T18:00:00Z', payload: { extendedProperties: approvedMetadata, summary: preview.calendarTitle, description: preview.calendarDescription, start: { dateTime: preview.startsAt!, timeZone: 'America/New_York' }, end: { dateTime: preview.endsAt!, timeZone: 'America/New_York' } } };
  for (const [blockedReason, message] of [['not_scheduled', /does not currently mark this event as scheduled/], ['event_started', /already started/], ['unknown_interval', /no verified timed start and end/]] as const) {
    const rendered = html({ ...preview, canApprove: false, blockedReason, existingCommand: command });
    assert.match(rendered, message); assert.match(rendered, /current source no longer permits this addition/);
    assert.match(rendered, /A new event will not be inserted/); assert.match(rendered, /Check existing Google event/);
    assert.match(rendered, /Check only this previously approved Google event; do not insert a new event/);
    assert.ok(!rendered.includes('Approve this event &amp; add to Google'));
  }
});

test('preview validation rejects malformed or mismatched private commands', () => {
  assert.deepEqual(calendarApprovalPreview(preview), preview);
  assert.equal(calendarApprovalPreview({ ...preview, targetId: 'bad' }), null);
  assert.equal(calendarApprovalPreview({ ...preview, fingerprint: 'not-a-fingerprint' }), null);
  assert.equal(calendarApprovalPreview({ ...preview, existingCommand: { id, kind: 'milestone', targetId: id } }), null);
  assert.equal(calendarApprovalPreview({ ...preview, uncertainties: [42] }), null);
  assert.equal(approvalTime('2026-11-01T01:30:00'), 'Unverified');
  assert.match(approvalTime('2026-11-01T05:30:00Z'), /EDT/); assert.match(approvalTime('2026-11-01T06:30:00Z'), /EST/);
});

test('event entry points offer a single-item review only behind the explicit server flag', () => {
  const row: CalendarDraftOccurrence & { id: string } = { id, title: preview.title, starts_at: preview.startsAt, ends_at: preview.endsAt, start_date: null, date_precision: 'instant', local_start_text: null, timezone: 'UTC', status: 'scheduled' };
  const disabled = renderToStaticMarkup(createElement(CalendarDraftLink, { row }));
  assert.match(disabled, /Add to Google Calendar/); assert.ok(!disabled.includes('/calendar?kind='));
  const enabled = renderToStaticMarkup(createElement(CalendarDraftLink, { row, calendarWritesEnabled: true }));
  assert.match(enabled, /Review calendar addition/); assert.match(enabled, new RegExp(`/calendar\\?kind=occurrence&amp;id=${id}`));
  assert.match(enabled, /Open unsaved Google draft/); assert.match(enabled, /use one addition route/);
});

test('milestone entry point is a separate chosen-time approval and never a direct calendar writer', () => {
  const originalFlag = process.env.CALENDAR_WRITES_ENABLED;
  const row: MilestoneRow = { id, title: preview.title, kind: 'application_deadline', occurs_at: preview.startsAt, occurs_on: null, source_name: 'Synthetic source', source_url: preview.sourceUrl, action_url: null, timezone: 'UTC', health_status: 'success', last_success_at: preview.lastSuccessAt, last_attempt_at: preview.lastSuccessAt, cadence_seconds: 3600, uncertainties: [], revision: 1, source_id: 'synthetic', availability: 'within_published_window', uncertainty: null, description: null, categories: [], health_message: null, coverage_note: null, changed_at: preview.lastSuccessAt, source_local_text: null };
  try {
    process.env.CALENDAR_WRITES_ENABLED = 'false';
    assert.ok(!renderToStaticMarkup(createElement(MilestoneCard, { row })).includes('Choose reminder time'));
    process.env.CALENDAR_WRITES_ENABLED = 'true';
    const rendered = renderToStaticMarkup(createElement(MilestoneCard, { row }));
    assert.match(rendered, /Choose reminder time/); assert.match(rendered, new RegExp(`/calendar\\?kind=milestone&amp;id=${id}`));
    assert.ok(!rendered.includes('<button')); assert.ok(!rendered.includes('/api/calendar/approve'));
  } finally { if (originalFlag === undefined) delete process.env.CALENDAR_WRITES_ENABLED; else process.env.CALENDAR_WRITES_ENABLED = originalFlag; }
});

test('recorded history provides explicit recovery links and never executes uncertain approvals', () => {
  const command = { id, kind: 'occurrence' as const, targetId: id, state: 'uncertain', approvedAt: '2026-11-01T18:00:00Z', payload: { extendedProperties: approvedMetadata, summary: preview.calendarTitle, description: preview.calendarDescription, start: { dateTime: preview.startsAt!, timeZone: 'America/New_York' }, end: { dateTime: preview.endsAt!, timeZone: 'America/New_York' } } };
  const rendered = renderToStaticMarkup(createElement(CalendarApprovalHistory, { commands: [command], error: false }));
  assert.match(rendered, /State: uncertain/); assert.match(rendered, /Review recorded approval/);
  assert.match(rendered, new RegExp(`/calendar\\?kind=occurrence&amp;id=${id}`));
  assert.ok(!rendered.includes('<form')); assert.ok(!rendered.includes('<button'));
  const failed = renderToStaticMarkup(createElement(CalendarApprovalHistory, { commands: [], error: true }));
  assert.match(failed, /empty history is not confirmed/); assert.ok(!failed.includes('No calendar approvals have been recorded'));
});
