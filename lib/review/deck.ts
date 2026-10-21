/** Pure presentation helpers. A review decision never performs a calendar write. */
export type ReviewDecision = 'save' | 'reject';

export type DatedOccurrence = {
  id: string;
  starts_at: string | null;
  start_date?: string | null;
  date_precision: string;
  timezone?: string | null;
  local_start_text?: string | null;
  all_day?: boolean;
  decision?: string | null;
};

export type OccurrenceSchedule = {
  dateKey: string | null;
  dateLabel: string;
  weekday: string | null;
  day: string | null;
  month: string | null;
  timeLabel: string;
  timezoneLabel: string | null;
  localText: string | null;
  precision: 'instant' | 'date' | 'unknown';
  uncertain: boolean;
};

type SwipeInput = {
  dx: number;
  dy: number;
  width: number;
  /** Set when the gesture began on a link, button, input or another control. */
  interactive?: boolean;
  cancelled?: boolean;
};

function swipeThreshold(width: number) {
  return Math.max(76, Math.min(144, width * 0.24));
}

/** A tap, vertical scroll, cancelled pointer or control interaction cannot decide a card. */
export function swipeIntent({ dx, dy, width, interactive = false, cancelled = false }: SwipeInput): ReviewDecision | null {
  if (interactive || cancelled || ![dx, dy, width].every(Number.isFinite) || width <= 0) return null;
  if (Math.abs(dx) < swipeThreshold(width) || Math.abs(dx) < Math.abs(dy) * 1.35) return null;
  return dx > 0 ? 'save' : 'reject';
}

/** Progress drives an edge glow; it is feedback, never an implicit decision. */
export function swipeFeedback(dx: number, width: number): { direction: ReviewDecision | null; progress: number } {
  if (![dx, width].every(Number.isFinite) || width <= 0 || Math.abs(dx) < 8) return { direction: null, progress: 0 };
  return { direction: dx > 0 ? 'save' : 'reject', progress: Math.min(1, Math.abs(dx) / swipeThreshold(width)) };
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sourceDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const key = value.slice(0, 10);
  return validDateKey(key) ? key : null;
}

function validInstant(value: string | null): Date | null {
  // A bare local clock is not an instant; parsing it would depend on the device timezone.
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !sourceDate(value)) return null;
  const time = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function validTimezone(value: string | null | undefined): value is string {
  if (!value) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true; }
  catch { return false; }
}

function dateLabels(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  const options = { timeZone: 'UTC' };
  return {
    dateLabel: date.toLocaleDateString('en-US', { ...options, month: 'short', day: 'numeric', year: 'numeric' }),
    weekday: date.toLocaleDateString('en-US', { ...options, weekday: 'long' }),
    day: date.toLocaleDateString('en-US', { ...options, day: 'numeric' }),
    month: date.toLocaleDateString('en-US', { ...options, month: 'short' }),
  };
}

/** Optional display-zone conversion changes labels only; date-only facts retain the source calendar day. */
export function occurrenceSchedule(row: DatedOccurrence, displayTimezone?: string): OccurrenceSchedule {
  const localText = row.local_start_text?.trim() || null;
  const unknown: OccurrenceSchedule = {
    dateKey: null, dateLabel: 'Date unconfirmed', weekday: null, day: null, month: null,
    timeLabel: 'Time unconfirmed', timezoneLabel: null, localText, precision: 'unknown', uncertain: true,
  };
  if (row.date_precision === 'date') {
    const key = sourceDate(row.start_date);
    if (!key) return unknown;
    return {
      ...unknown, ...dateLabels(key), dateKey: key, precision: 'date',
      timeLabel: row.all_day ? 'All day' : 'Time unconfirmed',
      timezoneLabel: row.all_day ? null : 'Source local time unconfirmed',
      uncertain: !row.all_day,
    };
  }
  if (row.date_precision !== 'instant') return unknown;
  const instant = validInstant(row.starts_at);
  if (!instant) return unknown;
  const declaredZone = validTimezone(row.timezone) ? row.timezone : null;
  const timeZone = validTimezone(displayTimezone) ? displayTimezone : declaredZone ?? 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  const key = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(instant).find(item => item.type === 'timeZoneName')?.value || timeZone;
  return {
    ...dateLabels(key), dateKey: key,
    timeLabel: instant.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }),
    timezoneLabel: declaredZone ? zone : `${zone} · source timezone unconfirmed`,
    localText, precision: 'instant', uncertain: !declaredZone,
  };
}

/** The first row wins, preserving server ordering and a single card per occurrence identity. */
export function uniqueOccurrences<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export type CalendarDay<T> = {
  dateKey: string;
  label: string;
  day: string;
  isAnchor: boolean;
  occurrences: T[];
};

/** A private saved-items preview, not Google Calendar, an RSVP or an approved reminder. */
export function calendarWeek<T extends DatedOccurrence>(anchorDateKey: string, rows: readonly T[], weekStartsOn = 1): CalendarDay<T>[] {
  if (!validDateKey(anchorDateKey) || !Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) return [];
  const anchor = new Date(`${anchorDateKey}T12:00:00Z`);
  const offset = (anchor.getUTCDay() - weekStartsOn + 7) % 7;
  const first = new Date(anchor);
  first.setUTCDate(first.getUTCDate() - offset);
  const saved = uniqueOccurrences(rows).filter(row => row.decision === 'save').map(row => ({ row, schedule: occurrenceSchedule(row) }));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      dateKey: key,
      label: date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
      day: String(date.getUTCDate()), isAnchor: key === anchorDateKey,
      occurrences: saved.filter(item => item.schedule.dateKey === key).map(item => item.row),
    };
  });
}

export type DeckHistoryEntry = { id: string; previous: ReviewDecision | null; next: ReviewDecision };
export type DeckState = { decisions: Record<string, ReviewDecision>; history: DeckHistoryEntry[] };

export function createDeckState(rows: readonly { id: string; decision?: string | null }[] = []): DeckState {
  const decisions: Record<string, ReviewDecision> = {};
  for (const row of uniqueOccurrences(rows)) if (row.decision === 'save' || row.decision === 'reject') decisions[row.id] = row.decision;
  return { decisions, history: [] };
}

/** Repeated delivery of the same decision cannot advance the deck or create another undo step. */
export function recordDeckDecision(state: DeckState, id: string, decision: ReviewDecision): DeckState {
  if (!id || !['save', 'reject'].includes(decision)) return state;
  const previous = Object.hasOwn(state.decisions, id) ? state.decisions[id] : null;
  if (previous === decision) return state;
  return { decisions: { ...state.decisions, [id]: decision }, history: [...state.history, { id, previous, next: decision }] };
}

/** Local state only. The caller must separately persist or revert the occurrence decision. */
export function undoDeckDecision(state: DeckState): DeckState {
  const latest = state.history.at(-1);
  if (!latest) return state;
  const decisions = { ...state.decisions };
  if (latest.previous === null) delete decisions[latest.id];
  else decisions[latest.id] = latest.previous;
  return { decisions, history: state.history.slice(0, -1) };
}

/** IDs stay stable if server rows are reordered or repeated while a request is in flight. */
export function nextUndecidedId(rows: readonly { id: string }[], decisions: DeckState['decisions'], afterId?: string): string | null {
  const unique = uniqueOccurrences(rows);
  const start = afterId ? unique.findIndex(row => row.id === afterId) + 1 : 0;
  for (let offset = 0; offset < unique.length; offset++) {
    const row = unique[(start + offset) % unique.length];
    if (!Object.hasOwn(decisions, row.id)) return row.id;
  }
  return null;
}
