import { calendarWeek, uniqueOccurrences, type CalendarDay, type DatedOccurrence } from './deck';

export type CalendarDisplayEvent = { id: string; title: string; start: string; end: string; allDay: boolean };
export type CalendarDisplayState = 'loading' | 'connected' | 'partial' | 'unconfigured' | 'disconnected' | 'reconnect_required' | 'unavailable' | 'unauthenticated' | 'invalid_request';
export type CalendarDisplayResponse = { state: CalendarDisplayState; events: CalendarDisplayEvent[]; complete: boolean; notice?: string; updatedAt?: string };
export type CalendarOccurrence = DatedOccurrence & { ends_at?: string | null };

const eastern = 'America/New_York';
const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: eastern, year: 'numeric', month: '2-digit', day: '2-digit' });
const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: eastern, timeZoneName: 'longOffset' });
const wallFormatter = new Intl.DateTimeFormat('en-US', { timeZone: eastern, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: eastern, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: eastern, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
function dateKeyValid(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function instantValid(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !dateKeyValid(value.slice(0, 10))) return false;
  const clock = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  return Boolean(clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 && Number(clock[3] || 0) < 60 && Number.isFinite(Date.parse(value)));
}

export function easternDateKey(value: string): string | null {
  if (dateKeyValid(value)) return value;
  if (!instantValid(value)) return null;
  const parts = dateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/** The sidebar is an Eastern calendar. A date-only source still has no invented instant. */
export function reviewCalendarDate(row: DatedOccurrence): string | null {
  if (row.date_precision === 'instant') return row.starts_at && instantValid(row.starts_at) ? easternDateKey(row.starts_at) : null;
  const key = row.date_precision === 'date' && row.start_date && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(row.start_date) ? row.start_date.slice(0, 10) : null;
  return key && dateKeyValid(key) ? key : null;
}

export function calendarPreviewWeek<T extends CalendarOccurrence>(anchor: string, rows: readonly T[]): CalendarDay<T>[] {
  const saved = uniqueOccurrences(rows).filter(row => row.decision === 'save').map(row => ({ row, span: occurrenceSpan(row) }));
  return calendarWeek<T>(anchor, []).map(day => ({ ...day, occurrences: saved.filter(item => item.span && item.span.from <= day.dateKey && item.span.to >= day.dateKey).map(item => item.row) }));
}

export function shiftCalendarDay(key: string, days: number): string {
  if (!dateKeyValid(key) || !Number.isInteger(days)) return key;
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const shifted = date.toISOString().slice(0, 10);
  return dateKeyValid(shifted) ? shifted : key;
}

function easternMidnight(key: string) {
  // Eastern changes offset after local midnight, so the offset at UTC midnight
  // on this date is also the offset at its local midnight, including DST days.
  const offset = offsetFormatter.formatToParts(new Date(`${key}T00:00:00Z`)).find(part => part.type === 'timeZoneName')?.value.replace('GMT', '');
  return offset ? Date.parse(`${key}T00:00:00${offset}`) : Number.NaN;
}

export function calendarDayInterval(key: string): { start: number; end: number } | null {
  if (!dateKeyValid(key)) return null;
  const start = easternMidnight(key), end = easternMidnight(shiftCalendarDay(key, 1));
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/** Both ends are exclusive when intersecting the selected day's midnight bounds. */
export function eventsForCalendarDay(events: readonly CalendarDisplayEvent[], key: string): CalendarDisplayEvent[] {
  const day = calendarDayInterval(key);
  if (!day) return [];
  return events.filter(event => event.allDay
    ? event.start <= key && event.end > key
    : Date.parse(event.start) < day.end && Date.parse(event.end) > day.start);
}

function wallMinutes(value: string) {
  const parts = wallFormatter.formatToParts(new Date(value));
  return Number(parts.find(item => item.type === 'hour')?.value) * 60 + Number(parts.find(item => item.type === 'minute')?.value);
}

export type CalendarTimedInterval = { startMinute: number; endMinute: number | null; durationKnown: boolean };
export function timedIntervalForDay(start: string, end: string | null | undefined, key: string): CalendarTimedInterval | null {
  const day = calendarDayInterval(key);
  if (!day || !instantValid(start)) return null;
  const begins = Date.parse(start);
  if (!end) return easternDateKey(start) === key ? { startMinute: wallMinutes(start), endMinute: null, durationKnown: false } : null;
  if (!instantValid(end)) return null;
  const finishes = Date.parse(end);
  if (finishes <= begins || begins >= day.end || finishes <= day.start) return null;
  return {
    startMinute: begins < day.start ? 0 : wallMinutes(start),
    endMinute: finishes >= day.end ? 1440 : wallMinutes(end), durationKnown: true,
  };
}

function occurrenceSpan(row: CalendarOccurrence): { from: string; to: string } | null {
  const from = reviewCalendarDate(row);
  if (!from) return null;
  if (row.date_precision !== 'instant' || !row.ends_at) return { from, to: from };
  if (!instantValid(row.ends_at) || Date.parse(row.ends_at) <= Date.parse(row.starts_at!)) return null;
  const to = easternDateKey(new Date(Date.parse(row.ends_at) - 1).toISOString());
  return to ? { from, to } : null;
}

export function occurrenceForCalendarDay(row: CalendarOccurrence, key: string): boolean {
  if (!dateKeyValid(key)) return false;
  const span = occurrenceSpan(row);
  return Boolean(span && span.from <= key && span.to >= key);
}

export function calendarTimelineBounds(key: string, events: readonly CalendarDisplayEvent[], rows: readonly CalendarOccurrence[]) {
  const intervals = [
    ...events.filter(event => !event.allDay).map(event => timedIntervalForDay(event.start, event.end, key)),
    ...uniqueOccurrences(rows).filter(row => row.date_precision === 'instant' && row.starts_at).map(row => timedIntervalForDay(row.starts_at!, row.ends_at, key)),
  ].filter((interval): interval is CalendarTimedInterval => interval !== null);
  return {
    startHour: Math.max(0, Math.min(9, ...intervals.map(interval => Math.floor(interval.startMinute / 60)))),
    endHour: Math.min(24, Math.max(20, ...intervals.map(interval => interval.endMinute === null ? Math.floor(interval.startMinute / 60) + 1 : Math.ceil(interval.endMinute / 60)))),
  };
}

/** Unknown durations are a minimum-size marker, never a guessed 45-minute event. */
export function calendarBlockPosition(interval: CalendarTimedInterval, startHour: number, scale = 44) {
  return {
    top: Math.max(0, (interval.startMinute / 60 - startHour) * scale),
    height: interval.endMinute === null ? 34 : Math.max(34, (interval.endMinute - interval.startMinute) / 60 * scale),
  };
}

export type CalendarLaneInput = { id: string; interval: CalendarTimedInterval };
export type CalendarLane<T> = T & { lane: number; laneCount: number; leftPercent: number; widthPercent: number };

/** Widths describe visual overlap, never free/busy availability or an unknown event duration. */
export function calendarLaneLayout<T extends CalendarLaneInput>(items: readonly T[], scale = 44): CalendarLane<T>[] {
  const pixelsPerHour = Number.isFinite(scale) && scale > 0 ? scale : 44;
  const entries = uniqueOccurrences(items).filter(item => Number.isFinite(item.interval.startMinute) && (item.interval.endMinute === null || Number.isFinite(item.interval.endMinute))).map(item => ({
    item,
    start: item.interval.startMinute,
    // Unknown ends occupy only the 14px start marker for collision avoidance.
    end: item.interval.endMinute === null ? item.interval.startMinute + 14 / pixelsPerHour * 60 : Math.max(item.interval.startMinute + 1 / pixelsPerHour * 60, item.interval.endMinute),
  })).sort((a, b) => a.start - b.start || b.end - a.end || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  const result: CalendarLane<T>[] = [];
  let cluster: Array<{ item: T; lane: number }> = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  function finishCluster() {
    const laneCount = laneEnds.length;
    for (const { item, lane } of cluster) result.push({ ...item, lane, laneCount, leftPercent: lane / laneCount * 100, widthPercent: 100 / laneCount });
    cluster = []; laneEnds = []; clusterEnd = Number.NEGATIVE_INFINITY;
  }
  for (const entry of entries) {
    if (cluster.length && entry.start >= clusterEnd) finishCluster();
    let lane = laneEnds.findIndex(end => end <= entry.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = entry.end;
    cluster.push({ item: entry.item, lane });
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  finishCluster();
  return result;
}

/** A candidate is a side rail; it cannot cover real calendar entries. */
export function candidateMarkerPosition(interval: CalendarTimedInterval, startHour: number, scale = 44) {
  return {
    top: Math.max(0, (interval.startMinute / 60 - startHour) * scale),
    height: interval.endMinute === null ? 8 : Math.max(2, (interval.endMinute - interval.startMinute) / 60 * scale),
  };
}

export function calendarTime(value: string, includeDate = false): string {
  if (!instantValid(value)) return 'Time unconfirmed';
  return (includeDate ? dateTimeFormatter : timeFormatter).format(new Date(value));
}

export function calendarTimeRange(start: string, end: string | null | undefined, selected: string): string {
  const beginning = calendarTime(start, easternDateKey(start) !== selected);
  return end ? `${beginning}–${calendarTime(end, easternDateKey(end) !== selected)}` : `${beginning} · end unknown`;
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

/** Validate the client API contract before a successful empty view can be shown. */
export function parseCalendarResponse(value: unknown): CalendarDisplayResponse {
  const states = ['connected', 'partial', 'unconfigured', 'disconnected', 'reconnect_required', 'unavailable', 'unauthenticated', 'invalid_request'];
  if (!object(value) || typeof value.state !== 'string' || !states.includes(value.state) || value.readOnly !== true || value.calendar !== 'primary' || !Array.isArray(value.events) || value.events.length > 200 || typeof value.complete !== 'boolean') throw new Error('Invalid calendar response');
  const connected = value.state === 'connected' || value.state === 'partial';
  if (value.connected !== connected || value.complete !== (value.state === 'connected') || !connected && value.events.length > 0) throw new Error('Invalid calendar response');
  if (value.notice !== undefined && (typeof value.notice !== 'string' || value.notice.length > 4000) || value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || !instantValid(value.updatedAt))) throw new Error('Invalid calendar response');
  const seen = new Set<string>();
  const events = value.events.map((entry: unknown): CalendarDisplayEvent => {
    if (!object(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 1024 || seen.has(entry.id) || typeof entry.title !== 'string' || entry.title.length > 1000 || typeof entry.start !== 'string' || typeof entry.end !== 'string' || typeof entry.allDay !== 'boolean') throw new Error('Invalid calendar event');
    const datesValid = entry.allDay ? dateKeyValid(entry.start) && dateKeyValid(entry.end) : instantValid(entry.start) && instantValid(entry.end);
    if (!datesValid || Date.parse(entry.end) <= Date.parse(entry.start)) throw new Error('Invalid calendar event');
    seen.add(entry.id);
    return { id: entry.id, title: entry.title, start: entry.start, end: entry.end, allDay: entry.allDay };
  });
  return {
    state: value.state as CalendarDisplayState, complete: value.complete, events,
    ...(typeof value.notice === 'string' ? { notice: value.notice } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}
