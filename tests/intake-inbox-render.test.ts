import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InboxList, OpportunityCard, type InboxRow } from '../app/inbox/components';

// Explicit synthetic render fixtures; integration evidence comes from fresh captures.
const syntheticRow: InboxRow = {
  id: '00000000-0000-4000-8000-000000000001', opportunity_id: '00000000-0000-4000-8000-000000000002',
  title: 'Synthetic <script> test title', description: '<img src=x onerror=alert(1)>', source_url: 'https://calendar.fsu.edu/event/synthetic',
  categories: [], uncertainties: ['Synthetic date conflict'], starts_at: null, ends_at: null,
  local_start_text: null, timezone: null, date_precision: 'unknown', location: null,
  status: 'unknown', revision: 1, source_id: 'synthetic-test-source', source_health: 'failed',
  source_last_success_at: null, source_last_attempt_at: '2026-10-20T12:00:00Z', coverage_note: 'Synthetic fixture only', decision: null,
};

test('inbox cards escape source text and retain visible unknown facts and failed source status', () => {
  const html = renderToStaticMarkup(createElement(OpportunityCard, { row: syntheticRow }));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('Date or time unknown'));
  assert.ok(html.includes('End time unverified'));
  assert.ok(html.includes('Location unverified'));
  assert.ok(html.includes('Ticket availability unverified'));
  assert.ok(html.includes('Source stale or never collected'));
  assert.ok(html.includes('Health: failed'));
});

test('date-only facts do not acquire a midnight or a previous-day timezone conversion', () => {
  const row = { ...syntheticRow, date_precision: 'date', start_date: '2026-11-01', all_day: false };
  const html = renderToStaticMarkup(createElement(OpportunityCard, { row }));
  assert.ok(html.includes('2026-11-01 · time unknown'));
  assert.ok(!html.includes('Oct 31'));
});

test('saved occurrence decisions retain unknown ends without unsafe links or invented calendar drafts', () => {
  const row = { ...syntheticRow, decision: 'save', source_url: 'javascript:alert(1)' };
  const html = renderToStaticMarkup(createElement(InboxList, { rows: [row] }));
  assert.ok(html.includes('Saved'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('Add to calendar'));
});

test('source local clocks survive while their missing timezone remains visible', () => {
  const row = { ...syntheticRow, date_precision: 'date', start_date: '2026-10-20T00:00:00.000Z', local_start_text: 'October 20, 2026 7:00 pm', all_day: false };
  const html = renderToStaticMarkup(createElement(OpportunityCard, { row }));
  assert.ok(html.includes('October 20, 2026 7:00 pm · timezone unverified'));
  assert.ok(!html.includes('T00:00:00'));
});

test('Music cards use their six-hour collection cadence for freshness', context => {
  context.mock.method(Date, 'now', () => Date.parse('2026-10-20T20:00:00Z'));
  const row = { ...syntheticRow, source_id: 'fsu-music-events', source_cadence_seconds: 6 * 3600, source_last_success_at: '2026-10-20T14:00:00Z' };
  const freshHtml = renderToStaticMarkup(createElement(OpportunityCard, { row }));
  assert.ok(!freshHtml.includes('Source stale or never collected'));
  const staleHtml = renderToStaticMarkup(createElement(OpportunityCard, { row: { ...row, source_last_success_at: '2026-10-20T07:59:00Z' } }));
  assert.ok(staleHtml.includes('Source stale or never collected'));
});
