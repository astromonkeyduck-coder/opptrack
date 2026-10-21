import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarBlockPosition, calendarDayInterval, calendarLaneLayout, calendarPreviewWeek, calendarTimeRange, calendarTimelineBounds, candidateMarkerPosition, easternDateKey, eventsForCalendarDay, occurrenceForCalendarDay, parseCalendarResponse, reviewCalendarAnchor, reviewCalendarDate, shiftCalendarDay, timedIntervalForDay, type CalendarDisplayEvent, type CalendarOccurrence } from '../lib/review/calendar-layout';

// Synthetic calendar fixtures. These exercise display semantics without Google requests or writes.
const event: CalendarDisplayEvent = { id: 'fixture-event', title: 'A private plan', start: '2026-10-21T15:00:00-04:00', end: '2026-10-21T16:00:00-04:00', allDay: false };
const saved: CalendarOccurrence = { id: 'fixture-saved', starts_at: '2026-10-22T00:30:00+01:00', ends_at: '2026-10-22T01:30:00+01:00', date_precision: 'instant', timezone: 'Europe/London', decision: 'save' };
const envelope = (events: CalendarDisplayEvent[] = [event]) => ({ state: 'connected', connected: true, readOnly: true, calendar: 'primary', complete: true, events });

test('the Eastern calendar groups instants by Eastern day while retaining date-only source days', () => {
  assert.equal(reviewCalendarDate(saved), '2026-10-21');
  assert.equal(easternDateKey(saved.starts_at!), '2026-10-21');
  assert.equal(reviewCalendarDate({ ...saved, date_precision: 'date', start_date: '2026-10-22', starts_at: null }), '2026-10-22');
  assert.equal(reviewCalendarDate({ ...saved, date_precision: 'unknown' }), null);
  assert.equal(reviewCalendarDate({ ...saved, starts_at: '2026-10-21' }), null);
  const days = calendarPreviewWeek('2026-10-21', [saved, { ...saved }, { ...saved, id: 'passed', decision: 'reject' }]);
  assert.deepEqual(days.find(day => day.dateKey === '2026-10-21')?.occurrences.map(row => row.id), [saved.id]);
  assert.deepEqual(days.find(day => day.dateKey === '2026-10-22')?.occurrences, []);
});

test('invalid, timezone-free or impossible date values never become an Eastern calendar date', () => {
  for (const value of ['', '2026-02-30', '2026-02-30T18:00:00Z', '2026-10-21T24:00:00Z', '2026-10-21T19:00:00', 'not-a-date']) assert.equal(easternDateKey(value), null);
});

test('a known ongoing span anchors today without replacing its actual start or splitting sessions', () => {
  const ongoing = { ...saved, starts_at: '2026-10-14T16:00:00Z', ends_at: '2026-10-28T20:00:00Z', timezone: 'UTC' };
  assert.equal(reviewCalendarDate(ongoing), '2026-10-14');
  assert.equal(reviewCalendarAnchor(ongoing, '2026-10-21T19:45:00Z'), '2026-10-21');
  assert.equal(reviewCalendarAnchor(ongoing, '2026-10-22T00:30:00Z'), '2026-10-21');
  assert.equal(occurrenceForCalendarDay(ongoing, '2026-10-21'), true);
  assert.equal(ongoing.starts_at, '2026-10-14T16:00:00Z');
});

test('future, ended, unknown-end and date-only candidates keep their existing start-day anchor', () => {
  const future = { ...saved, starts_at: '2026-10-23T00:30:00Z', ends_at: '2026-10-23T01:30:00Z', timezone: 'UTC' };
  assert.equal(reviewCalendarAnchor(future, '2026-10-21T19:45:00Z'), '2026-10-22');
  assert.equal(reviewCalendarAnchor(future, future.ends_at), '2026-10-22');
  assert.equal(reviewCalendarAnchor({ ...future, ends_at: null }, '2026-10-26T19:45:00Z'), '2026-10-22');
  assert.equal(reviewCalendarAnchor({ ...future, ends_at: 'bad-end' }, '2026-10-26T19:45:00Z'), '2026-10-22');
  assert.equal(reviewCalendarAnchor({ ...future, date_precision: 'date', start_date: '2026-10-23', starts_at: null, all_day: true }, '2026-10-21T19:45:00Z'), '2026-10-23');
});

test('ongoing anchor uses Eastern DST days and the end remains exclusive', () => {
  const span = { ...saved, starts_at: '2026-10-31T23:00:00Z', ends_at: '2026-11-02T05:00:00Z', timezone: 'UTC' };
  assert.equal(reviewCalendarAnchor(span, '2026-11-01T03:30:00Z'), '2026-10-31');
  assert.equal(reviewCalendarAnchor(span, '2026-11-01T05:30:00Z'), '2026-11-01');
  assert.equal(reviewCalendarAnchor(span, '2026-11-01T06:30:00Z'), '2026-11-01');
  assert.equal(reviewCalendarAnchor(span, span.ends_at), '2026-10-31');
});

test('day intervals preserve real 23-hour and 25-hour Eastern DST days', () => {
  const spring = calendarDayInterval('2026-03-08')!;
  const fall = calendarDayInterval('2026-11-01')!;
  assert.equal((spring.end - spring.start) / 3600000, 23);
  assert.equal((fall.end - fall.start) / 3600000, 25);
  assert.equal(calendarDayInterval('2026-02-30'), null);
  assert.equal(shiftCalendarDay('2026-12-31', 1), '2027-01-01');
});

test('exclusive ends prevent a midnight-ending event from appearing again on the next day', () => {
  const midnight = { ...event, start: '2026-10-21T23:00:00-04:00', end: '2026-10-22T00:00:00-04:00' };
  assert.equal(eventsForCalendarDay([midnight], '2026-10-21').length, 1);
  assert.equal(eventsForCalendarDay([midnight], '2026-10-22').length, 0);
  assert.equal(timedIntervalForDay(midnight.start, midnight.end, '2026-10-22'), null);
  const allDay = { ...event, allDay: true, start: '2026-10-21', end: '2026-10-23' };
  assert.equal(eventsForCalendarDay([allDay], '2026-10-22').length, 1);
  assert.equal(eventsForCalendarDay([allDay], '2026-10-23').length, 0);
});

test('cross-midnight known intervals clip to the selected day and saved previews remain visible on both days', () => {
  const overnight = { ...saved, starts_at: '2026-10-21T23:30:00-04:00', ends_at: '2026-10-22T02:00:00-04:00' };
  assert.deepEqual(timedIntervalForDay(overnight.starts_at, overnight.ends_at, '2026-10-21'), { startMinute: 1410, endMinute: 1440, durationKnown: true });
  assert.deepEqual(timedIntervalForDay(overnight.starts_at, overnight.ends_at, '2026-10-22'), { startMinute: 0, endMinute: 120, durationKnown: true });
  assert.equal(occurrenceForCalendarDay(overnight, '2026-10-22'), true);
  assert.equal(occurrenceForCalendarDay(overnight, '2026-10-23'), false);
  assert.equal(calendarPreviewWeek('2026-10-21', [overnight]).filter(day => day.occurrences.length).length, 2);
});

test('saved early and late events expand timeline bounds even without Google events or a candidate', () => {
  const early = { ...saved, id: 'early', starts_at: '2026-10-21T07:00:00-04:00', ends_at: '2026-10-21T08:00:00-04:00' };
  const late = { ...saved, id: 'late', starts_at: '2026-10-21T23:00:00-04:00', ends_at: '2026-10-21T23:45:00-04:00' };
  assert.deepEqual(calendarTimelineBounds('2026-10-21', [], [early, late]), { startHour: 7, endHour: 24 });
  assert.deepEqual(calendarTimelineBounds('2026-10-21', [], []), { startHour: 9, endHour: 20 });
});

test('unknown end times stay unknown and use a marker rather than a guessed event duration', () => {
  const interval = timedIntervalForDay('2026-10-21T23:10:00-04:00', null, '2026-10-21')!;
  assert.deepEqual(interval, { startMinute: 1390, endMinute: null, durationKnown: false });
  assert.equal(calendarBlockPosition(interval, 9).height, 34);
  assert.equal(timedIntervalForDay('2026-10-21T23:10:00-04:00', null, '2026-10-22'), null);
  assert.ok(calendarTimeRange('2026-10-21T23:10:00-04:00', null, '2026-10-21').endsWith('end unknown'));
});

test('all overlapping returned events remain available to the agenda and DST time labels are distinguishable', () => {
  const overlap = { ...event, id: 'overlap', start: '2026-10-21T15:15:00-04:00', end: '2026-10-21T15:45:00-04:00' };
  assert.deepEqual(eventsForCalendarDay([event, overlap], '2026-10-21').map(item => item.id), [event.id, overlap.id]);
  const label = calendarTimeRange('2026-11-01T01:30:00-04:00', '2026-11-01T01:45:00-05:00', '2026-11-01');
  assert.ok(label.includes('EDT'));
  assert.ok(label.includes('EST'));
});

test('a valid complete empty response is distinct from partial and failed access', () => {
  assert.deepEqual(parseCalendarResponse(envelope([])), { state: 'connected', complete: true, events: [] });
  assert.deepEqual(parseCalendarResponse({ ...envelope([]), state: 'partial', complete: false, notice: 'Some events may be missing.' }), { state: 'partial', complete: false, events: [], notice: 'Some events may be missing.' });
  const unavailable = parseCalendarResponse({ ...envelope([]), state: 'unavailable', connected: false, complete: false, notice: 'Availability unknown.' });
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.complete, false);
});

test('malformed API envelopes cannot crash the inbox or become a successful empty calendar', () => {
  for (const value of [
    null, {}, { state: 'connected' }, { ...envelope(), events: {} }, { ...envelope(), connected: false },
    { ...envelope(), complete: false }, { ...envelope(), readOnly: false }, { ...envelope(), calendar: 'secondary' },
    { ...envelope(), state: 'unknown' }, { ...envelope(), state: 'unavailable', connected: false, complete: false },
    { ...envelope(), notice: 42 }, { ...envelope(), updatedAt: 'not-a-date' },
  ]) assert.throws(() => parseCalendarResponse(value), /Invalid calendar response/);
});

test('malformed, duplicate, reversed and oversized event collections are rejected before rendering', () => {
  for (const events of [
    [null], [{ ...event, title: {} }], [{ ...event, allDay: 'false' }], [event, event],
    [{ ...event, end: event.start }], [{ ...event, start: '2026-10-21T15:00:00' }],
    [{ ...event, allDay: true, start: '2026-02-30', end: '2026-03-02' }],
  ]) assert.throws(() => parseCalendarResponse({ ...envelope(), events }), /Invalid calendar event/);
  assert.throws(() => parseCalendarResponse(envelope(Array.from({ length: 201 }, (_, index) => ({ ...event, id: `event-${index}` })))), /Invalid calendar response/);
});

const laneItem = (id: string, startMinute: number, endMinute: number | null) => ({ id, interval: { startMinute, endMinute, durationKnown: endMinute !== null } });

test('overlapping Google and saved intervals share visible lanes sized to cluster concurrency', () => {
  const items = [laneItem('google-long', 9 * 60, 12 * 60), laneItem('saved-short', 9.5 * 60, 10 * 60), laneItem('google-next', 10 * 60, 11 * 60), laneItem('google-third', 10.5 * 60, 11.5 * 60)];
  const before = JSON.stringify(items);
  const layout = calendarLaneLayout(items);
  assert.equal(layout.length, 4);
  assert.ok(layout.every(item => item.laneCount === 3 && item.widthPercent === 100 / 3));
  for (const item of layout) for (const other of layout) {
    if (item.id === other.id) continue;
    if (item.interval.startMinute < other.interval.endMinute! && item.interval.endMinute! > other.interval.startMinute) assert.notEqual(item.lane, other.lane);
  }
  assert.equal(layout.find(item => item.id === 'saved-short')?.lane, layout.find(item => item.id === 'google-next')?.lane);
  assert.equal(JSON.stringify(items), before);
});

test('exclusive adjacent ends reuse a full-width lane and disconnected clusters reset their widths', () => {
  const adjacent = calendarLaneLayout([laneItem('a', 540, 600), laneItem('b', 600, 660)]);
  assert.ok(adjacent.every(item => item.lane === 0 && item.laneCount === 1 && item.widthPercent === 100));
  const separate = calendarLaneLayout([laneItem('a', 540, 600), laneItem('b', 570, 630), laneItem('later', 720, 780)]);
  assert.equal(separate.find(item => item.id === 'later')?.laneCount, 1);
  assert.equal(separate.find(item => item.id === 'a')?.laneCount, 2);
});

test('multiday clipped intervals keep lanes separate until the exclusive midnight end', () => {
  const overnight = timedIntervalForDay('2026-10-20T23:00:00-04:00', '2026-10-21T02:00:00-04:00', '2026-10-21')!;
  const layout = calendarLaneLayout([{ id: 'overnight', interval: overnight }, laneItem('overlap', 30, 60), laneItem('after', 120, 180)]);
  assert.equal(layout.find(item => item.id === 'overnight')?.laneCount, 2);
  assert.equal(layout.find(item => item.id === 'after')?.laneCount, 1);
});

test('unknown ends occupy only a small start marker and never gain a fabricated duration', () => {
  const input = [laneItem('unknown', 540, null), laneItem('known', 545, 600)];
  const layout = calendarLaneLayout(input);
  assert.equal(layout.find(item => item.id === 'unknown')?.interval.endMinute, null);
  assert.equal(layout.find(item => item.id === 'unknown')?.interval.durationKnown, false);
  assert.equal(layout.find(item => item.id === 'known')?.laneCount, 2);
  assert.deepEqual(candidateMarkerPosition(input[0].interval, 9), { top: 0, height: 8 });
  assert.deepEqual(candidateMarkerPosition(laneItem('seven-hours', 540, 960).interval, 9), { top: 0, height: 308 });
});

test('lane assignment is deterministic, occurrence-safe and rejects nonfinite geometry', () => {
  const a = laneItem('a', 540, 600), b = laneItem('b', 540, 600);
  assert.deepEqual(calendarLaneLayout([b, a]), calendarLaneLayout([a, b]));
  assert.equal(calendarLaneLayout([a, a]).length, 1);
  assert.deepEqual(calendarLaneLayout([laneItem('invalid', Number.NaN, 600)]), []);
});
