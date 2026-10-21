import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarWeek, createDeckState, nextUndecidedId, occurrenceSchedule, recordDeckDecision, swipeFeedback, swipeIntent, undoDeckDecision, uniqueOccurrences, type DatedOccurrence } from '../lib/review/deck';

// Synthetic interaction/date fixtures only; no external service or calendar is invoked.
const occurrence: DatedOccurrence = {
  id: 'fixture-one', date_precision: 'instant', starts_at: '2026-10-22T00:30:00Z',
  timezone: 'America/New_York', local_start_text: null, decision: null,
};

test('swipe commits require meaningful horizontal distance with a vertical-scroll guard', () => {
  assert.equal(swipeIntent({ dx: 110, dy: 12, width: 390 }), 'save');
  assert.equal(swipeIntent({ dx: -110, dy: 12, width: 390 }), 'reject');
  assert.equal(swipeIntent({ dx: 0, dy: 0, width: 390 }), null);
  assert.equal(swipeIntent({ dx: 72, dy: 0, width: 390 }), null);
  assert.equal(swipeIntent({ dx: 110, dy: 100, width: 390 }), null);
  assert.equal(swipeIntent({ dx: 5, dy: 200, width: 390 }), null);
  assert.equal(swipeIntent({ dx: 145, dy: 0, width: 1000 }), 'save');
  assert.equal(swipeIntent({ dx: 75, dy: 0, width: 150 }), null);
});

test('cancelled pointers, interactive controls and invalid geometry never decide a card', () => {
  assert.equal(swipeIntent({ dx: 300, dy: 0, width: 390, cancelled: true }), null);
  assert.equal(swipeIntent({ dx: -300, dy: 0, width: 390, interactive: true }), null);
  for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(swipeIntent({ dx: 300, dy: 0, width }), null);
  assert.equal(swipeIntent({ dx: Number.NaN, dy: 0, width: 390 }), null);
  assert.equal(swipeIntent({ dx: 300, dy: Number.NaN, width: 390 }), null);
});

test('edge feedback grows gradually, has a tap dead zone and is capped independently of committing', () => {
  assert.deepEqual(swipeFeedback(4, 390), { direction: null, progress: 0 });
  const early = swipeFeedback(20, 390);
  const later = swipeFeedback(70, 390);
  assert.equal(early.direction, 'save');
  assert.ok(early.progress > 0 && early.progress < later.progress && later.progress < 1);
  assert.deepEqual(swipeFeedback(-1000, 390), { direction: 'reject', progress: 1 });
  assert.deepEqual(swipeFeedback(100, 0), { direction: null, progress: 0 });
  assert.deepEqual(swipeFeedback(Number.NaN, 390), { direction: null, progress: 0 });
});

test('an instant uses its declared timezone and retains the year across a UTC date boundary', () => {
  const result = occurrenceSchedule(occurrence);
  assert.equal(result.dateKey, '2026-10-21');
  assert.equal(result.dateLabel, 'Oct 21, 2026');
  assert.equal(result.weekday, 'Wednesday');
  assert.equal(result.timeLabel, '8:30 PM');
  assert.equal(result.timezoneLabel, 'EDT');
  assert.equal(result.uncertain, false);
  assert.equal(occurrenceSchedule({ ...occurrence, timezone: 'Europe/London' }).dateKey, '2026-10-22');
});

test('source date-only values keep their calendar day rather than shifting to the previous evening', () => {
  const result = occurrenceSchedule({ ...occurrence, date_precision: 'date', start_date: '2026-11-01', starts_at: null, all_day: true });
  assert.equal(result.dateKey, '2026-11-01');
  assert.equal(result.weekday, 'Sunday');
  assert.equal(result.timeLabel, 'All day');
  assert.equal(result.timezoneLabel, null);
  assert.equal(result.uncertain, false);
  const legacyDate = occurrenceSchedule({ ...occurrence, date_precision: 'date', start_date: '2026-11-01T00:00:00.000Z', starts_at: '2026-10-31T23:00:00Z' });
  assert.equal(legacyDate.dateKey, '2026-11-01');
  assert.equal(legacyDate.timeLabel, 'Time unconfirmed');
});

test('unverified source-local time text remains separate from a verified instant', () => {
  const result = occurrenceSchedule({ ...occurrence, date_precision: 'date', start_date: '2026-10-21', starts_at: null, local_start_text: 'October 21, 2026 at 7 pm' });
  assert.equal(result.dateKey, '2026-10-21');
  assert.equal(result.timeLabel, 'Time unconfirmed');
  assert.equal(result.localText, 'October 21, 2026 at 7 pm');
  assert.equal(result.timezoneLabel, 'Source local time unconfirmed');
  assert.equal(result.uncertain, true);
});

test('Eastern fallback is explicit for missing or invalid source timezone', () => {
  for (const timezone of [null, '', 'Invalid/Timezone']) {
    const result = occurrenceSchedule({ ...occurrence, timezone });
    assert.equal(result.dateKey, '2026-10-21');
    assert.equal(result.timeLabel, '8:30 PM');
    assert.equal(result.timezoneLabel, 'EDT · source timezone unconfirmed');
    assert.equal(result.uncertain, true);
  }
});

test('daylight saving uses the declared zone rather than a fixed Eastern offset', () => {
  const before = occurrenceSchedule({ ...occurrence, starts_at: '2026-11-01T05:30:00Z' });
  const after = occurrenceSchedule({ ...occurrence, starts_at: '2026-11-01T06:30:00Z' });
  assert.equal(before.timeLabel, '1:30 AM');
  assert.equal(after.timeLabel, '1:30 AM');
  assert.equal(before.timezoneLabel, 'EDT');
  assert.equal(after.timezoneLabel, 'EST');
  assert.equal(before.dateKey, after.dateKey);
});

test('unknown, malformed and timezone-free clocks cannot invent a calendar date or midnight', () => {
  for (const row of [
    { ...occurrence, date_precision: 'unknown' },
    { ...occurrence, starts_at: null },
    { ...occurrence, starts_at: '2026-10-21T19:00:00' },
    { ...occurrence, starts_at: '2026-02-30T19:00:00Z' },
    { ...occurrence, starts_at: '2026-10-21T24:00:00Z' },
    { ...occurrence, date_precision: 'date', start_date: '2026-02-30' },
    { ...occurrence, date_precision: 'date', start_date: null },
  ]) {
    const result = occurrenceSchedule(row);
    assert.equal(result.dateKey, null);
    assert.equal(result.dateLabel, 'Date unconfirmed');
    assert.equal(result.timeLabel, 'Time unconfirmed');
    assert.equal(result.uncertain, true);
  }
});

test('calendar week uses saved source dates, excludes undated/rejected rows and deduplicates occurrences', () => {
  const saved = { ...occurrence, decision: 'save' };
  const dateOnly = { ...occurrence, id: 'date-only', decision: 'save', date_precision: 'date', start_date: '2026-10-25', starts_at: null };
  const week = calendarWeek('2026-10-21', [saved, { ...saved }, dateOnly, { ...saved, id: 'rejected', decision: 'reject' }, { ...saved, id: 'unknown', date_precision: 'unknown' }]);
  assert.equal(week.length, 7);
  assert.equal(week[0].dateKey, '2026-10-19');
  assert.equal(week[6].dateKey, '2026-10-25');
  assert.equal(week.find(day => day.isAnchor)?.dateKey, '2026-10-21');
  assert.deepEqual(week.flatMap(day => day.occurrences.map(row => row.id)), ['fixture-one', 'date-only']);
  assert.equal(week[2].occurrences[0], saved);
});

test('week arithmetic crosses month, year and DST boundaries without skipping or repeating days', () => {
  assert.deepEqual(calendarWeek('2027-01-01', []).map(day => day.dateKey), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.deepEqual(calendarWeek('2026-11-01', [], 0).map(day => day.dateKey), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.deepEqual(calendarWeek('not-a-date', []), []);
  assert.deepEqual(calendarWeek('2026-02-30', []), []);
  assert.deepEqual(calendarWeek('2026-10-21', [], 7), []);
});

test('deck identity is occurrence-based, and repeating a pending decision cannot consume another card', () => {
  const rows = [{ id: 'a', decision: null }, { id: 'a', decision: 'save' }, { id: 'b', decision: 'reject' }];
  assert.deepEqual(uniqueOccurrences(rows), [rows[0], rows[2]]);
  const initial = createDeckState(rows);
  assert.deepEqual(initial, { decisions: { b: 'reject' }, history: [] });
  const saved = recordDeckDecision(initial, 'a', 'save');
  assert.equal(recordDeckDecision(saved, 'a', 'save'), saved);
  assert.equal(saved.history.length, 1);
  assert.deepEqual(initial.decisions, { b: 'reject' });
  assert.equal(initial.history.length, 0);
  assert.equal(nextUndecidedId(rows, initial.decisions), 'a');
  assert.equal(nextUndecidedId(rows, saved.decisions), null);
});

test('undo restores the prior decision or removes a new decision without mutating older state', () => {
  const initial = createDeckState([{ id: 'a', decision: 'reject' }]);
  const saved = recordDeckDecision(initial, 'a', 'save');
  assert.deepEqual(undoDeckDecision(saved), initial);
  const second = recordDeckDecision(saved, 'b', 'reject');
  assert.deepEqual(undoDeckDecision(second), saved);
  assert.deepEqual(undoDeckDecision(undoDeckDecision(second)), initial);
  assert.equal(undoDeckDecision(initial), initial);
  assert.equal(second.decisions.b, 'reject');
  assert.equal(recordDeckDecision(initial, '', 'save'), initial);
});

test('next card uses stable identities after reorder and wraps once without returning decided cards', () => {
  const decisions = { a: 'save' as const, c: 'reject' as const };
  assert.equal(nextUndecidedId([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'b' }], decisions, 'a'), 'b');
  assert.equal(nextUndecidedId([{ id: 'b' }, { id: 'c' }, { id: 'a' }], decisions, 'a'), 'b');
  assert.equal(nextUndecidedId([{ id: 'a' }], decisions, 'removed-id'), null);
  assert.equal(nextUndecidedId([], decisions), null);
});
