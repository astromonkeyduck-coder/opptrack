import type { EvidenceSpan, ExtractionCandidate, Primitive } from './contracts';
import { extractionUnitId } from './contracts';
import type { ExtractionUnit } from './media-types';
import type { ExtractionContext } from './text';
import { extractProseCandidates } from './text-prose-v4';

// Source-only media rules. No filenames, evaluation IDs, approved labels or current date.
const monthNames = 'January February March April May June July August September October November December'.split(' ');
const monthPattern = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const monthNumber = (s: string) => monthNames.findIndex(m => m.toLowerCase().startsWith(s.replace('.', '').toLowerCase())) + 1;
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const validDay = (year: number | null, month: number, day: number) => month > 0 && day > 0 && day <= new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
type Piece = { text: string; start: number; end: number };
function pieces(text: string): Piece[] {
  const result: Piece[] = [];
  for (const match of text.matchAll(/[^\n]+/g)) {
    const raw = match[0], leading = raw.search(/\S/);
    if (leading < 0 || /^\s*\[(?:PDF text layer|Visual OCR[^\]]*)\]/.test(raw)) continue;
    result.push({ text: raw.trimEnd(), start: match.index!, end: match.index! + raw.trimEnd().length });
  }
  return result;
}
function span(unit: ExtractionUnit, start: number, end: number): EvidenceSpan {
  return { unitId: extractionUnitId(unit), start, end, quote: unit.text.slice(start, end) };
}
function evidence(unit: ExtractionUnit, p: Piece): EvidenceSpan { return span(unit, p.start, p.end); }
function put(candidate: ExtractionCandidate, field: string, value: Primitive, refs: EvidenceSpan[]) {
  candidate.fields[field] = value;
  candidate.claims = candidate.claims.filter(claim => claim.field !== field);
  if (value !== null) candidate.claims.push({ field, value, evidence: refs });
}
function make(unit: ExtractionUnit, kind: ExtractionCandidate['kind'], suffix: string): ExtractionCandidate {
  return { key: `${extractionUnitId(unit)}:${suffix}`, kind, fields: {}, claims: [], issues: ['unreviewed_extraction', ...unit.issues] };
}

function titleFromLayout(unit: ExtractionUnit): { value: string; refs: EvidenceSpan[] } | null {
  // A quoted display title is useful only alongside event facts, never a testimonial alone.
  const quoted = [...unit.text.matchAll(/[“"]([^”"\n]{4,200}(?:\n[^”"]{2,180})?)[”"]/g)]
    .find(m => !/\b(?:I |my |our |because|applied|experience working)\b/i.test(m[1]) && normalize(m[1]).length < 240);
  if (quoted) return { value: normalize(quoted[1]), refs: [span(unit, quoted.index!, quoted.index! + quoted[0].length)] };
  const textEnd = unit.text.indexOf('[Visual OCR');
  const lines = pieces(textEnd >= 0 ? unit.text.slice(0, textEnd) : unit.text);
  // Preserve a compact multi-line heading before the first prose paragraph.
  const first = lines.findIndex(p => !/^\s*(?:st|nd|rd|th)\s*$/.test(p.text) && /\w/.test(p.text));
  if (first < 0) return null;
  const block: Piece[] = [];
  for (const p of lines.slice(first, first + 7)) {
    const v = p.text.trim();
    if (v.length > 55 || v.split(/\s+/).length > 7 || /[.!?]$/.test(v)) break;
    block.push(p);
  }
  if (block.length < 2 || !/\b(?:workshop|lecture|concert|festival|symposium|recital|screening)\b/i.test(block.map(p => p.text).join(' '))) return null;
  let value = normalize(block.map(p => p.text).join(' '));
  const ordinal = first > 0 ? lines[first - 1] : null;
  if (ordinal && /^(?:st|nd|rd|th)$/.test(ordinal.text.trim()) && /^\d+\b/.test(value)) {
    value = value.replace(/^(\d+)/, `$1${ordinal.text.trim()}`); block.unshift(ordinal);
  }
  return { value, refs: block.map(p => evidence(unit, p)) };
}

function programTitle(unit: ExtractionUnit): { value: string; refs: EvidenceSpan[] } | null {
  const lines = pieces(unit.text.split('[Visual OCR')[0]);
  const first = lines.findIndex(p => {
    const left = p.text.search(/\S/), v = p.text.trim().split(/\s{3,}/)[0];
    return left < 20 && v.length >= 15 && /[A-Z]/.test(v) && !/[a-z]/.test(v) && !/^(?:ELIGIBILITY|CONTACT|PHONE|FLORIDA STATE UNIVERSITY)/.test(v);
  });
  if (first < 0) return null;
  const heading: Piece[] = [];
  for (const p of lines.slice(first, first + 4)) {
    const v = p.text.trim().split(/\s{3,}/)[0];
    if (p.text.search(/\S/) >= 20 || v.length < 5 || /[a-z]/.test(v)) break;
    const start = p.start + p.text.indexOf(v); heading.push({ text: v, start, end: start + v.length });
  }
  return heading.length ? { value: normalize(heading.map(p => p.text).join(' ')), refs: heading.map(p => evidence(unit, p)) } : null;
}

/** Extract partial calendar facts without converting missing years/zones into instants. */
export function extractMediaCandidates(unit: ExtractionUnit, context: ExtractionContext = {}): ExtractionCandidate[] {
  if (unit.status !== 'processed') return [];
  const base = extractProseCandidates(unit, context);
  if (base.filter(c => c.kind === 'event').length > 1) {
    for (const candidate of base) candidate.issues.push('multi_event_media_scope_requires_review');
    return base;
  }
  const event = base.find(c => c.kind === 'event');
  const dates = [...unit.text.matchAll(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th|°)?(?:\\s*[-–]\\s*(\\d{1,2})(?!\\d))?(?:,?\\s+(20\\d{2})(?!\\d))?`, 'gi'))];
  const clockOptions = [...unit.text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/gi)].filter(m => {
    const lineStart = unit.text.lastIndexOf('\n', m.index!) + 1;
    return !/\b(?:doors|applications?|tickets?|register|deadline|registration)\b/i.test(unit.text.slice(lineStart, m.index!));
  });
  const clockVariants = new Set(clockOptions.map(m => [m[1],m[2] || '00',(m[3] || m[6]).toUpperCase(),m[4],m[5] || '00',m[6].toUpperCase()].join('/')));
  const clock = clockVariants.size === 1 ? clockOptions[0] : undefined;
  const eventDates = dates.filter(m => !/\b(?:register by|apply by|deadline|by)\s*$/i.test(unit.text.slice(Math.max(0, m.index! - 24), m.index!)));
  const dateVariants = new Set(eventDates.map(m => [monthNumber(m[1]), m[2], m[3] ?? '', m[4] ?? ''].join('/')));
  const primary = dateVariants.size === 1 ? eventDates[0] : undefined;
  const clear = (candidate: ExtractionCandidate, fields: string[]) => { for (const field of fields) if (field in candidate.fields) put(candidate,field,null,[]); };
  if (event && dateVariants.size > 1) {
    clear(event,['date','dateStart','dateEndInclusive','datePrecision','year','month','day','startAt','endAt','startLocal','endLocal','startClock','endClock']);
    event.issues.push('conflicting_media_dates_require_review');
  }
  if (event && clockVariants.size > 1) {
    clear(event,['startAt','endAt','startLocal','endLocal','startClock','endClock']);
    event.issues.push('conflicting_media_clocks_require_review');
  }
  if (event && primary) {
    const month = monthNumber(primary[1]), day = Number(primary[2]), year = primary[4] ? Number(primary[4]) : null;
    if (validDay(year, month, day) && (!primary[3] || validDay(year, month, Number(primary[3])))) {
      const refs = [span(unit, primary.index!, primary.index! + primary[0].length)];
      put(event, 'month', month, refs); put(event, 'day', day, refs); put(event, 'year', year, refs);
      if (primary[3]) {
        put(event, 'dateStart', year ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null, refs);
        put(event, 'dateEndInclusive', year ? `${year}-${String(month).padStart(2, '0')}-${primary[3].padStart(2, '0')}` : null, refs);
        put(event, 'date', null, []); put(event, 'startAt', null, []); put(event, 'endAt', null, []);
        if ('startLocal' in event.fields) put(event, 'startLocal', null, []);
        if ('endLocal' in event.fields) put(event, 'endLocal', null, []);
        put(event, 'datePrecision', year ? 'date_range' : 'month_day_range', refs);
        event.issues.push('date_range_not_single_occurrence');
      }
      if (!year) event.issues.push('year_missing');
    }
    const title = titleFromLayout(unit);
    if (title) { put(event, 'title', title.value, title.refs); event.issues = event.issues.filter(i => i !== 'headline_rule_requires_review'); }
    if (clock) {
      const startMeridiem = (clock[3] || clock[6]).toUpperCase(), endMeridiem = clock[6].toUpperCase();
      const h1 = Number(clock[1]), h2 = Number(clock[4]), m1 = Number(clock[2] || '0'), m2 = Number(clock[5] || '0');
      if (!clock[3] && h1 > h2) event.issues.push('ambiguous_clock_range_requires_review');
      else if (h1 >= 1 && h1 <= 12 && h2 >= 1 && h2 <= 12 && m1 < 60 && m2 < 60) {
        const localClock = (h: number, m: number, ap: string) => `${String(h % 12 + (ap === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const refs = [span(unit, clock.index!, clock.index! + clock[0].length)];
        put(event, 'startClock', localClock(h1, m1, startMeridiem), refs); put(event, 'endClock', localClock(h2, m2, endMeridiem), refs);
      }
    }
    if (!event.fields.timeZone) event.issues.push('timezone_missing');
    const speaker = /\b([A-Z][a-z]+(?: [A-Z][a-z]+){1,2}) (?:serves as|leads the|will speak|is speaking)/.exec(unit.text);
    if (speaker) put(event, 'speaker', speaker[1], [span(unit, speaker.index!, speaker.index! + speaker[0].length)]);
    const price = /\bAdmission is [Ff]ree!/.exec(unit.text);
    if (price) put(event, 'price', price[0], [span(unit, price.index!, price.index! + price[0].length)]);
    const street = /\b\d{2,6} [A-Z][A-Za-z. ]{2,45}\b(?:Hwy|Highway|Street|St|Road|Rd|Avenue|Ave)\.?\s*\d*\b/i.exec(unit.text);
    const city = /\b(?:St\.?\s+)?[A-Z][a-z]+(?: [A-Z][a-z]+)*,\s*[A-Z]{2}\s+\d{5}\b/i.exec(unit.text);
    if (street && city) {
      const address = normalize(`${street[0]}, ${city[0]}`).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/, ([A-Z][a-z]) (\d{5})$/, (_, state: string, zip: string) => `, ${state.toUpperCase()} ${zip}`);
      put(event, 'location', address, [span(unit, street.index!, street.index! + street[0].length), span(unit, city.index!, city.index! + city[0].length)]);
    }
    const room = /^\s*([A-Z]{2,8} \d{2,5})\s*$/m.exec(unit.text), place = /^\s*([A-Z][A-Z ]{3,24})\s*$/m.exec(unit.text);
    if (!event.fields.location && room && place && !/ELIGIBILITY|MATERIALS|WORKSHOP/.test(place[1])) put(event, 'location', `${room[1]}, ${place[1].toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}`, [span(unit, room.index!, room.index! + room[0].length), span(unit, place.index!, place.index! + place[0].length)]);
  }
  // Keep exact source phase/month wording for deadlines; do not invent a day or time.
  const actions: ExtractionCandidate[] = [];
  for (const m of unit.text.matchAll(new RegExp(`\\bRegister\\s+by\\s+(${monthPattern})\\.?\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?`, 'gi'))) {
    const month = monthNumber(m[1]), day = Number(m[2]), year = m[3] ? Number(m[3]) : null;
    if (!validDay(year, month, day) || actions.some(a => a.fields.actionType === 'registration_deadline')) continue;
    const a = make(unit, 'action', 'registration-deadline'), refs = [span(unit, m.index!, m.index! + m[0].length)];
    for (const [field, value] of Object.entries({ actionType: 'registration_deadline', month, day, year, dateText: m[0], datePrecision: year ? 'date' : 'month_day' })) put(a, field, value, refs);
    a.fields.occursAt = null; a.fields.timeZone = null; a.fields.occursOn = year ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
    if (a.fields.occursOn) put(a, 'occursOn', a.fields.occursOn, refs);
    a.issues.push('deadline_clock_missing', ...(year ? [] : ['year_missing'])); actions.push(a);
  }
  const primaryText = unit.text.split('[Visual OCR')[0] || unit.text;
  for (const m of primaryText.matchAll(new RegExp(`\\b((?:(?:Early|Mid|Late)[- ]+)?(${monthPattern}),?\\s+(20\\d{2}))[^\\n]{0,30}?\\b(Campus|National) Deadline[^\\n]*`, 'gi'))) {
    const phase = m[4].toLowerCase(); if (actions.some(a => a.fields.actionPhase === phase)) continue;
    const a = make(unit, 'action', `${phase}-deadline`), refs = [span(unit, m.index!, m.index! + m[0].length)];
    for (const [field, value] of Object.entries({ actionType: 'application_deadline', actionPhase: phase, dateText: m[1], month: monthNumber(m[2]), year: Number(m[3]), datePrecision: /^(?:Early|Mid|Late)/i.test(m[1]) ? 'part_of_month' : 'month' })) put(a, field, value, refs);
    a.fields.day = null; a.fields.occursAt = null; a.fields.occursOn = null; a.fields.timeZone = null; a.issues.push('exact_deadline_day_missing', 'source_cycle_requires_review'); actions.push(a);
  }
  if (!event) {
    const resource = base.find(c => c.kind === 'resource'), heading = programTitle(unit);
    if (resource && heading) put(resource, 'title', heading.value, heading.refs);
    const eligibility = /\bELIGIBILITY\b/.exec(primaryText);
    if (resource && eligibility) {
      put(resource, 'eligibilityHeading', eligibility[0], [span(unit, eligibility.index!, eligibility.index! + eligibility[0].length)]);
      const endMatch = /\b(?:INTERESTED IN APPLYING|CONTACT THE OFFICE|CONTACT US)\b/.exec(primaryText.slice(eligibility.index! + eligibility[0].length));
      const end = Math.min(eligibility.index! + 2000, endMatch ? eligibility.index! + eligibility[0].length + endMatch.index! : primaryText.length);
      const raw = primaryText.slice(eligibility.index!, end);
      if (raw.length <= 2000) put(resource, 'eligibilityText', raw, [span(unit, eligibility.index!, end)]);
      // Text-layer columns must not be flattened into an invented sentence.
      // Retain the complete literal block separately and expose the first left-column criterion.
      const rows = pieces(raw).slice(1), criterion: Piece[] = [];
      for (const row of rows) {
        const left = row.text.trim().split(/\s{3,}/)[0];
        if (!left) continue;
        if (criterion.length && /^[A-Z]/.test(left)) break;
        const start = eligibility.index! + row.start + row.text.indexOf(left);
        criterion.push({ text: left, start, end: start + left.length });
        if (criterion.length === 4) break;
      }
      if (criterion.length) put(resource, 'eligibility', normalize(criterion.map(p => p.text).join(' ')), criterion.map(p => evidence(unit, p)));
    }
  }
  // Replace weak generic deadline candidates only when a source-specific phase is explicit.
  const replacedTypes = new Set(actions.map(c => c.fields.actionType));
  const kept = actions.length ? base.filter(c => c.kind !== 'action' || !replacedTypes.has(c.fields.actionType)) : base;
  return [...kept, ...actions];
}
