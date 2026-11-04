/**
 * Source-only extraction from explicit calendar/field records. All quotes refer
 * to the unchanged retained unit (including CRLF, folds and escaped text).
 * RFC 5545 §§3.1, 3.3.5, 3.6.1, 3.8.1.11 and 3.8.2 define the source syntax.
 * Recurrence, custom VTIMEZONE definitions and ambiguous civil times deliberately
 * abstain; this module neither evaluates instructions nor accesses services.
 */
import { createHash } from 'node:crypto';
import { extractionUnitId, type EvidenceSpan, type ExtractionCandidate, type Primitive } from './contracts';
import type { ExtractionUnit } from './media-types';

export type StructuredExtractionContext = { publishedAt?: string | null; timeZone?: string | null };
type Line = { text: string; start: number; end: number };
type Property = { name: string; value: string; params: Record<string, string>; line: Line; malformed: boolean };
type SourceRecord = { properties: Property[]; title?: Line; rawCalendar: boolean; issues: string[] };
type Time = { date: string; local: string | null; at: string | null; zone: string | null; offset: string | null; allDay: boolean; issues: string[] };
const MAX_CANDIDATES = 30;
const names: Record<string, string> = { TITLE: 'SUMMARY', START: 'DTSTART', 'PUBLISHED STATUS': 'PUBLISHED-STATUS', TIMEZONE: 'TIMEZONE', 'TIME ZONE': 'TIMEZONE' };
const instruction = /\b(?:ignore (?:all |the )?(?:previous|system)|system prompt|developer message|reveal (?:the )?(?:key|token|secret)|enable calendar writes|send (?:the )?credentials)\b/i;

function physicalLines(text: string): Line[] {
  const lines: Line[] = []; let start = 0;
  for (const newline of text.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ text: text.slice(start, newline.index), start, end: newline.index! });
    start = newline.index! + newline[0].length;
  }
  if (start < text.length) lines.push({ text: text.slice(start), start, end: text.length });
  return lines;
}
function unfoldedLines(lines: Line[]): Line[] {
  const result: Line[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line.text) && result.length) {
      const previous = result[result.length - 1];
      previous.text += line.text.slice(1); previous.end = line.end;
    } else result.push({ ...line });
  }
  return result;
}
function splitOutsideQuotes(text: string, separator: string): string[] | null {
  const parts: string[] = []; let quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (!quoted && text[i] === separator) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  if (quoted) return null;
  parts.push(text.slice(start)); return parts;
}
function property(line: Line): Property | null {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === '"') quoted = !quoted;
    if (line.text[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 1) return null;
  const header = splitOutsideQuotes(line.text.slice(0, colon).trim(), ';');
  if (!header || !/^[A-Za-z][A-Za-z0-9 -]*$/.test(header[0])) return null;
  const sourceName = header[0].toUpperCase(), value = line.text.slice(colon + 1).trim();
  // Calendar END closes a component; derived "End: 2027-…" is a date field.
  const name = sourceName === 'END' && /^\d/.test(value) ? 'DTEND' : names[sourceName] || sourceName;
  const params: Record<string, string> = {}; let malformed = false;
  for (const part of header.slice(1)) {
    const equal = part.indexOf('='), key = part.slice(0, equal).toUpperCase();
    if (equal < 1 || !/^[A-Z][A-Z0-9-]*$/.test(key) || key in params) { malformed = true; continue; }
    const value = part.slice(equal + 1); params[key] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return { name, value, params, line, malformed };
}
function decoded(value: string) { return value.replace(/\\([nN,;\\])/g, (_, escaped: string) => /[nN]/.test(escaped) ? '\n' : escaped).trim(); }
function calendarRecords(lines: Line[]): SourceRecord[] {
  const records: SourceRecord[] = [], stack: string[] = []; let current: SourceRecord | null = null, invalid = false;
  for (const line of unfoldedLines(lines)) {
    const p = property(line); if (!p) { if (line.text.trim()) invalid = true; continue; }
    if (p.name === 'BEGIN') {
      const component = p.value.toUpperCase();
      if (component === 'VEVENT') {
        if (current) { current.issues.push('structured_calendar_incomplete_requires_review'); invalid = true; }
        current = { properties: [], rawCalendar: true, issues: [] }; records.push(current);
      }
      stack.push(component); continue;
    }
    if (p.name === 'END') {
      if (stack.pop() !== p.value.toUpperCase()) invalid = true;
      if (p.value.toUpperCase() === 'VEVENT') current = null;
      continue;
    }
    // DTSTART inside VTIMEZONE or an alarm never becomes an event occurrence.
    if (current && stack.at(-1) === 'VEVENT') current.properties.push(p);
  }
  if (stack.length || current) invalid = true;
  if (invalid) {
    if (!records.length) records.push({ properties: [], rawCalendar: true, issues: [] });
    for (const record of records) record.issues.push('structured_calendar_incomplete_requires_review');
  }
  return records;
}
function fieldRecords(lines: Line[]): SourceRecord[] {
  const records: SourceRecord[] = []; let current: SourceRecord = { properties: [], rawCalendar: false, issues: [] }, description: Property | null = null;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const p = property(line);
    // In transformed prose a colon can be punctuation in a literal headline.
    // Calendar records use calendarRecords, so unknown X-properties there remain metadata.
    const fieldNames = ['SUMMARY','DESCRIPTION','DTSTART','DTEND','LOCATION','ROOM','PUBLISHED-STATUS','STATUS','TIMEZONE','RRULE','RDATE','EXDATE','EXRULE','RECURRENCE-ID','DURATION','UID','URL','DTSTAMP','CREATED','LAST-MODIFIED','ORGANIZER','CATEGORIES','SEQUENCE','CLASS','TRANSP','VERSION','PRODID','CALSCALE','METHOD','PUBLISHED','LAST UPDATED','DATE','TIME','APPLICATION START','APPLICATION DEADLINE','TICKET RELEASE','SOURCE','LINK'];
    if (p && !current.title && !current.properties.length && !fieldNames.includes(p.name) && !p.name.startsWith('X-') && line.text.length <= 240 && /[A-Za-z]/.test(p.value) && !/^https?:/i.test(p.value)) {
      current.title = line; continue;
    }
    if (p?.name === 'SUMMARY' && current.properties.some(item => item.name === 'DTSTART')) {
      records.push(current); current = { properties: [], rawCalendar: false, issues: [] }; description = null;
    }
    if (description && (!p || !['SUMMARY','DESCRIPTION','DTSTART','DTEND','LOCATION','ROOM','PUBLISHED-STATUS','STATUS','TIMEZONE','RRULE','RDATE','EXDATE','EXRULE','RECURRENCE-ID','DURATION'].includes(p.name))) {
      description.value += '\n' + line.text; description.line = { ...description.line, end: line.end };
    } else if (p) { current.properties.push(p); description = p.name === 'DESCRIPTION' ? p : null; }
    else if (!current.title && !current.properties.length) current.title = line;
  }
  if (current.properties.length || current.title) records.push(current);
  return records.flatMap(record => {
    const starts = record.properties.filter(p => p.name === 'DTSTART');
    if (starts.length < 2) return [record];
    const positions = starts.map(p => record.properties.indexOf(p));
    const paired = positions.slice(0, -1).every((position, index) => record.properties.slice(position + 1, positions[index + 1]).some(p => p.name === 'DTEND'));
    const dates = starts.map(p => p.value.match(/^(\d{4})-?(\d{2})-?(\d{2})/)?.slice(1).join('-'));
    const distinctDates = dates.every(Boolean) && new Set(dates).size === starts.length && !record.properties.some(p => p.name === 'DTEND');
    if (!paired && !distinctDates) return [record]; // Adjacent contradictory starts are not independent performances.
    const common = record.properties.slice(0, positions[0]);
    return positions.map((position, index) => ({ ...record, properties: [...common, ...record.properties.slice(position, positions[index + 1] ?? record.properties.length)], issues: [...record.issues] }));
  });
}
function sourceSpan(unit: ExtractionUnit, line: Line): EvidenceSpan | null {
  if (line.end <= line.start || line.end - line.start > 3000) return null;
  return { unitId: extractionUnitId(unit), start: line.start, end: line.end, quote: unit.text.slice(line.start, line.end) };
}
function set(item: ExtractionCandidate, unit: ExtractionUnit, field: string, value: Primitive, properties: Array<Property | Line>) {
  const evidence = properties.map(p => sourceSpan(unit, 'line' in p ? p.line : p)).filter((p): p is EvidenceSpan => p !== null).slice(0, 8);
  if (value === null || !evidence.length || typeof value === 'string' && value.length > 3000) {
    if (value !== null) item.issues.push('structured_field_exceeds_evidence_limit'); return;
  }
  item.fields[field] = value; item.claims = item.claims.filter(claim => claim.field !== field);
  item.claims.push({ field, value, evidence });
}
function unique(properties: Property[]) {
  return [...new Map(properties.map(p => [JSON.stringify([p.value.trim(), p.params]), p])).values()];
}
function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date ? date : null;
}
function civilInstant(local: string, zone: string): { at: string | null; issue?: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const format = (timestamp: number) => { const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`; };
    const naive = Date.parse(`${local}Z`), offsets = new Set<number>();
    // Sample both sides of transitions, including half-hour and date-line shifts.
    for (let hour = -36; hour <= 36; hour += 3) { const sample = naive + hour * 3600000; offsets.add(Date.parse(`${format(sample)}Z`) - sample); }
    const matches = [...offsets].map(offset => naive - offset).filter(timestamp => format(timestamp) === local);
    const distinct = [...new Set(matches)];
    return distinct.length === 1 ? { at: new Date(distinct[0]).toISOString() } : { at: null, issue: 'invalid_or_ambiguous_local_time' };
  } catch { return { at: null, issue: 'structured_timezone_unsupported_requires_review' }; }
}
function temporal(p: Property, rawCalendar: boolean, zoneProperty?: Property): Time | null {
  if (p.malformed || p.params.VALUE && !['DATE', 'DATE-TIME'].includes(p.params.VALUE.toUpperCase())) return null;
  const compact = p.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  const iso = p.value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/);
  const match = compact || (!rawCalendar ? iso : null); if (!match) return null;
  const date = validDate(Number(match[1]), Number(match[2]), Number(match[3])); if (!date) return null;
  const dateOnly = !match[4], declaredDate = p.params.VALUE?.toUpperCase() === 'DATE';
  if (declaredDate !== dateOnly && (declaredDate || rawCalendar)) return null;
  if (dateOnly) {
    if (p.params.TZID) return null;
    return { date, local: null, at: null, zone: null, offset: null, allDay: declaredDate, issues: [] };
  }
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59) return null;
  const local = `${date}T${match[4]}:${match[5]}:${match[6] || '00'}`;
  const designator = compact ? compact[7] : iso![8];
  const zone = p.params.TZID || zoneProperty?.value || null;
  if (designator) {
    if (p.params.TZID) return null; // RFC5545 forbids TZID on UTC values.
    if (designator === '-00:00') return { date, local, at: null, zone: null, offset: designator, allDay: false, issues: ['structured_unknown_utc_offset_requires_review'] };
    if (designator !== 'Z') {
      const hour = Number(designator.slice(1, 3)), minute = Number(designator.slice(4, 6));
      if (hour > 14 || minute > 59 || hour === 14 && minute !== 0) return null;
    }
    const at = new Date(`${local}${!compact && iso![7] ? iso![7] : ''}${designator}`).toISOString();
    if (zone) {
      const zoned = civilInstant(local, zone);
      if (zoned.at?.slice(0, 19) !== at.slice(0, 19)) return { date, local, at: null, zone: null, offset: designator, allDay: false, issues: ['structured_timezone_offset_conflict_requires_review'] };
    }
    return { date, local, at, zone: zone || (designator === 'Z' || designator === '+00:00' ? 'UTC' : null), offset: designator, allDay: false, issues: [] };
  }
  if (!zone) return { date, local, at: null, zone: null, offset: null, allDay: false, issues: ['structured_floating_time_requires_review'] };
  const instant = civilInstant(local, zone);
  return { date, local, at: instant.at, zone: instant.issue === 'structured_timezone_unsupported_requires_review' ? null : zone, offset: null, allDay: false, issues: instant.issue ? [instant.issue] : [] };
}
function eventStartConflict(record: SourceRecord, start: Time) {
  // Numeric-offset timestamps carry an explicit source-local clock. A UTC stamp
  // does not establish the zone of an unzoned prose clock on another date.
  if (!start.local || start.offset === 'Z' && !start.zone) return false;
  if (start.offset === 'Z' && !record.properties.some(p => p.name === 'TIMEZONE')) return false;
  const hour = Number(start.local.slice(11, 13)), minute = Number(start.local.slice(14, 16));
  return record.properties.filter(p => p.name === 'DESCRIPTION').some(p => [...decoded(p.value).matchAll(/\b(?:event\s+|show\s+|bingo\s+|concert\s+|performance\s+)?(?:starts?|begins?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi)].some(match => {
    const prefix = decoded(p.value).slice(Math.max(0, match.index! - 50), match.index).split(/[.!?\n;]/).at(-1) || '';
    if (!/^(?:event|show|bingo|concert|performance)\s/i.test(match[0]) && /\b(?:applications?|registration|doors|tickets?|sale)\b/i.test(prefix)) return false;
    const actualHour = Number(match[1]), actualMinute = Number(match[2] || 0);
    if (actualHour > 23 || actualMinute > 59) return false;
    return actualMinute !== minute || (match[3] ? actualHour % 12 + (/^p/i.test(match[3]) ? 12 : 0) !== hour : actualHour > 12 ? actualHour !== hour : actualHour % 12 !== hour % 12);
  }));
}
function candidate(unit: ExtractionUnit, record: SourceRecord, index: number): ExtractionCandidate {
  const item: ExtractionCandidate = { key: `structured-${createHash('sha256').update(`${extractionUnitId(unit)}:${record.properties[0]?.line.start ?? record.title?.start ?? 0}:${index}`).digest('hex').slice(0, 32)}`, kind: 'event', fields: { title: null, date: null, startAt: null, endAt: null, timeZone: null, datePrecision: null, status: null, location: null }, claims: [], issues: ['unreviewed_extraction', ...record.issues] };
  const props = (name: string) => record.properties.filter(p => p.name === name);
  const textField = (name: string, field: string) => {
    const values = unique(props(name));
    if (values.length > 1) item.issues.push(`conflicting_structured_${field}_requires_review`);
    else if (values.length && decoded(values[0].value)) set(item, unit, field, decoded(values[0].value), values);
  };
  textField('SUMMARY', 'title');
  if (!props('SUMMARY').length && record.title) {
    const leading = record.title.text.search(/\S/), title = record.title.text.trim();
    if (title && !instruction.test(title)) set(item, unit, 'title', title, [{ ...record.title, start: record.title.start + leading, end: record.title.start + record.title.text.trimEnd().length }]);
  }
  const locations = unique(props('LOCATION'));
  if (locations.some(p => /\b(?:sign in|log in|login|access restricted|members only|withheld)\b/i.test(p.value))) item.issues.push('location_access_restricted');
  else if (locations.some(p => /^(?:tba|tbd|unknown|to be announced|to be determined)$/i.test(p.value.trim()))) item.issues.push('location_unknown');
  else textField('LOCATION', 'location');
  textField('ROOM', 'room');
  if (typeof item.fields.location === 'string' && typeof item.fields.room === 'string' && !item.fields.location.toLowerCase().includes(item.fields.room.toLowerCase())) {
    // Both values belong to this same explicit record. Keep the source building
    // and room as separate claims as well as a useful complete venue label.
    set(item,unit,'building',item.fields.location,locations);
    set(item,unit,'location',`${item.fields.location}, ${item.fields.room}`,[...locations,...unique(props('ROOM'))]);
  }
  const statuses = unique(props('STATUS'));
  if (statuses.length > 1) item.issues.push('conflicting_structured_status_requires_review');
  else if (statuses.length) {
    const raw = statuses[0].value.toUpperCase(), status = ({ CONFIRMED: 'scheduled', CANCELLED: 'cancelled', CANCELED: 'cancelled', TENTATIVE: 'tentative', SCHEDULED: 'scheduled' } as Record<string, string>)[raw];
    if (status) set(item, unit, 'status', status, statuses); else item.issues.push('structured_event_status_unsupported_requires_review');
  }
  // Publication visibility such as Localist "live" is not attendance status.
  if (props('PUBLISHED-STATUS').length && !statuses.length) item.issues.push('publication_status_is_not_event_status');
  if (record.properties.some(p => p.malformed)) item.issues.push('structured_property_parameters_invalid_requires_review');
  const recurrence = record.properties.filter(p => ['RRULE', 'RDATE', 'EXDATE', 'EXRULE', 'RECURRENCE-ID'].includes(p.name));
  if (recurrence.length) { item.issues.push('structured_recurrence_or_exception_not_expanded_requires_review'); return item; }
  if (item.issues.includes('structured_calendar_incomplete_requires_review')) return item;
  const starts = unique(props('DTSTART')), ends = unique(props('DTEND')), zones = unique(props('TIMEZONE'));
  if (zones.length > 1) { item.issues.push('conflicting_structured_timezones_require_review'); return item; }
  if (!starts.length) { item.issues.push('structured_start_missing'); return item; }
  const parsed = starts.map(p => temporal(p, record.rawCalendar, zones[0]));
  if (starts.length > 1) {
    item.issues.push('conflicting_structured_start_times_require_review');
    const date = parsed[0]?.date;
    if (date && parsed.every(value => value?.date === date)) { set(item, unit, 'date', date, starts); set(item, unit, 'datePrecision', 'date', starts); }
    return item;
  }
  const start = parsed[0];
  if (!start) { item.issues.push('invalid_date_or_source_instant'); return item; }
  const startEvidence = zones[0] ? [starts[0], zones[0]] : starts;
  set(item, unit, 'date', start.date, starts); set(item, unit, 'datePrecision', start.at ? 'instant' : 'date', startEvidence);
  item.issues.push(...start.issues);
  if (eventStartConflict(record, start)) { item.issues.push('conflicting_event_start_times_require_review'); set(item, unit, 'datePrecision', 'date', starts); return item; }
  if (start.local) set(item, unit, 'startLocal', start.local.endsWith(':00') ? start.local.slice(0, -3) : start.local, startEvidence);
  if (start.zone) set(item, unit, 'timeZone', start.zone, startEvidence);
  if (start.offset) set(item, unit, 'utcOffset', start.offset, starts);
  if (start.at) set(item, unit, 'startAt', start.at, startEvidence);
  if (start.allDay) set(item, unit, 'allDay', true, starts);
  if (ends.length > 1) { item.issues.push('conflicting_structured_end_times_require_review'); return item; }
  if (props('DURATION').length) { item.issues.push('structured_duration_not_resolved_requires_review'); if (ends.length) item.issues.push('structured_dtend_and_duration_conflict_requires_review'); return item; }
  if (!ends.length) { item.issues.push('end_time_missing'); return item; }
  const end = temporal(ends[0], record.rawCalendar, zones[0]);
  if (!end || start.allDay !== end.allDay || Boolean(start.local) !== Boolean(end.local)) { item.issues.push('structured_end_type_or_value_invalid_requires_review'); return item; }
  item.issues.push(...end.issues);
  if (start.allDay && end.date > start.date) { set(item, unit, 'endDateExclusive', end.date, ends); item.issues.push('structured_all_day_dtend_is_exclusive'); return item; }
  if (start.allDay || start.at && end.at && Date.parse(end.at) <= Date.parse(start.at) || !start.at && start.local && end.local && end.local <= start.local) { item.issues.push('end_time_conflict_or_overnight_requires_review'); return item; }
  if (end.local) set(item, unit, 'endLocal', end.local.endsWith(':00') ? end.local.slice(0, -3) : end.local, ends);
  if (start.at && end.at) set(item, unit, 'endAt', end.at, zones[0] ? [ends[0], zones[0]] : ends);
  return item;
}

/** null means unsupported prose, [] means a valid structured source has no events. */
export function extractStructuredCandidates(unit: ExtractionUnit, _context: StructuredExtractionContext = {}): ExtractionCandidate[] | null {
  if (unit.status !== 'processed' || !unit.text.trim()) return null;
  const lines = physicalLines(unit.text), rawCalendar = lines.some(line => /^BEGIN:(?:VCALENDAR|VEVENT)\s*$/i.test(line.text));
  const fields = lines.some(line => /^(?:DTSTART(?:;[^:]*)?|Start)\s*:/i.test(line.text));
  if (!rawCalendar && !fields) return null;
  if (unit.text.length > 65536) return [{ key: `structured-oversize-${createHash('sha256').update(extractionUnitId(unit)).digest('hex').slice(0, 16)}`, kind: 'event', fields: { title: null, date: null, startAt: null, endAt: null, status: null }, claims: [], issues: ['unreviewed_extraction', 'structured_input_exceeds_retained_text_limit'] }];
  const records = rawCalendar ? calendarRecords(lines) : fieldRecords(lines);
  const result = records.slice(0, MAX_CANDIDATES).map((record, index) => candidate(unit, record, index));
  for (const item of result) {
    if (records.length > MAX_CANDIDATES) item.issues.push('structured_candidate_limit_additional_records_require_review');
    if (instruction.test(unit.text)) item.issues.push('source_contains_instruction_like_text');
    item.issues = [...new Set(item.issues)].slice(0, 30);
  }
  return result;
}
