/** V6: independent native views may corroborate a fact, never override a conflict. */
import type { EvidenceSpan, ExtractionCandidate, Primitive } from './contracts';
import { extractionUnitId } from './contracts';
import type { ExtractionUnit } from './media-types';
import type { ExtractionContext } from './text';
import { sourceDates } from './text';
import { extractCandidates as extractV5 } from './text-v5';
import { extractMediaCandidates as extractV5Media } from './text-media-v5';
import { extractProseCandidates } from './text-prose-v4';
import { extractStructuredCandidates } from './structured-v6';

type View = { text: string; start: number };
const heading = /^\[(?:PDF text layer|Visual OCR(?: sparse| adaptive)?)\]$/;
const temporalFields = new Set(['date','dateStart','dateEndInclusive','endDateExclusive','datePrecision','year','month','day','startAt','endAt','startLocal','endLocal','startClock','endClock','timeZone','utcOffset','sourceTimeZoneAbbreviation','allDay']);
const clockFields = new Set(['startAt','endAt','startLocal','endLocal','startClock','endClock']);
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
const unknown = (value: Primitive) => typeof value === 'string' && /^(?:[?-]+|null|false|true|none|n\/?a|not applicable|not provided|not specified|pending|coming soon|see (?:website|link|details)|varies|tba|tbd|unknown|to be announced|to be determined|to be confirmed|not yet announced)$/i.test(normalized(value).replace(/^(?:price|cost|eligibility|organizer|location|venue)\s*:\s*/i, ''));

/** These are positions in the unchanged retained text, not independently fetched sources. */
function views(text: string): View[] {
  const boundaries: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    if (heading.test(match[0].replace(/[\r\n]+$/, '').trim())) boundaries.push({ start: match.index!, end: match.index! + match[0].length });
  }
  if (!boundaries.length) return [{ text, start: 0 }];
  const result: View[] = [];
  if (text.slice(0, boundaries[0].start).trim()) result.push({ text: text.slice(0, boundaries[0].start), start: 0 });
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].end, end = boundaries[i + 1]?.start ?? text.length;
    if (text.slice(start, end).trim()) result.push({ text: text.slice(start, end), start });
  }
  return result;
}
function copy(candidate: ExtractionCandidate): ExtractionCandidate {
  return { ...candidate, fields: { ...candidate.fields }, claims: candidate.claims.map(claim => ({ ...claim, evidence: claim.evidence.map(span => ({ ...span })) })), issues: [...candidate.issues] };
}
function clear(candidate: ExtractionCandidate, field: string) {
  candidate.fields[field] = null;
  candidate.claims = candidate.claims.filter(claim => claim.field !== field);
}
function nonTitle(value: Primitive): boolean {
  if (typeof value !== 'string') return false;
  const text = normalized(value);
  if (!text || heading.test(text) || unknown(text) || /^(?:https?:\/\/|mailto:|\S+@\S+\.\S+)/i.test(text)) return true;
  if (/^(?:date|start|end|time|time ?zone|location|venue|price|cost|eligibility|organizer|deadline|application deadline|registration deadline)\s*:/i.test(text)) return true;
  if (/^\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:[A-Z]{2,5})?$/i.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return true;
  return sourceDates(text).some(date => date.start === 0 && date.end === text.length);
}
const seriesHeading = /^(?:(?:lecture|talk|film|concert|speaker|seminar|workshop|recital|screening)\s+series|(?:upcoming\s+)?events?)$/i;
const sectionHeading = /^(?:interested in applying\b|contact(?:\s+the\s+office)?\b|eligibility\s*$|award amounts\s*$|apply now\s*$|learn more\s*$|questions\s*\??$)/i;
function publisherFragment(text: string, span: EvidenceSpan): boolean {
  const value = normalized(span.quote);
  if (/\b(?:workshop|lecture|concert|festival|recital|screening|symposium|performance|meeting)\b/i.test(value)) return false;
  if (/^(?:office of|department of|college of|school of|national laboratory|university of)\b/i.test(value)) return true;
  if (value !== value.toUpperCase() || value.split(/\s+/).length > 4) return false;
  const previous = text.slice(0, span.start).split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean).at(-1);
  if (previous && /^contact(?:\s+the\s+office(?:\s+of)?)?\s*$/i.test(previous)) return true;
  const following = text.slice(span.end).split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => /[A-Za-z]{3}/.test(line)).slice(0, 2);
  return following.some(line => /^(?:national\s+)?(?:laboratory|university|college|department|institute|office|school)\b/i.test(line));
}
function explicitDisplayTitles(text: string, kind: ExtractionCandidate['kind']): Array<{ value: string; start: number; end: number }> {
  const result: Array<{ value: string; start: number; end: number }> = [];
  const lines = text.split(/\r\n|\r|\n/), header = lines.slice(0, 12).join('\n');
  const cutoff = lines.find(line => line.trim().length > 130);
  const end = cutoff ? text.indexOf(cutoff) : Math.min(text.length, header.length + 24);
  if (kind === 'event') for (const match of text.matchAll(/[“"]([^”"\n]{4,200}(?:\r?\n[^”"]{2,180})?)[”"]/g)) {
    if (match.index! >= end || normalized(match[1]).length > 240 || /\b(?:I |my |our |because|applied|experience working)\b/i.test(match[1])) continue;
    const prefix = text.slice(text.lastIndexOf('\n', match.index!) + 1, match.index!);
    if (prefix.trim()) continue;
    result.push({ value: normalized(match[1]), start: match.index!, end: match.index! + match[0].length });
  }
  if (kind === 'resource') for (const match of text.matchAll(/\b20\d{2}[ \t]+[A-Z][A-Z \t'-]{3,110}\bAPPLICATION[ \t]+PROCESS\b/g)) {
    if (match.index! < end) result.push({ value: normalized(match[0]), start: match.index!, end: match.index! + match[0].length });
  }
  return result;
}
function group(candidate: ExtractionCandidate): string {
  return JSON.stringify([candidate.kind, candidate.kind === 'action' ? candidate.fields.actionType ?? null : null, candidate.kind === 'action' ? candidate.fields.actionPhase ?? null : null]);
}
function signature(field: string, value: Primitive): string {
  if (typeof value !== 'string') return JSON.stringify([typeof value, value]);
  if (/(?:At)$/.test(field) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) return 'instant:' + Date.parse(value);
  if (/^(?:timeZone|.*(?:Id|Url|URL|Uri|URI))$/.test(field) || /^https?:\/\//i.test(value)) return 'literal:' + value;
  // A literal metadata label is not part of the underlying price/eligibility fact.
  const literal = ['price','eligibility','organizer'].includes(field) ? value.replace(/^(?:price|cost|eligibility|organizer)\s*:\s*/i, '') : value;
  return 'text:' + normalized(literal).toLowerCase();
}
function reanchor(candidate: ExtractionCandidate, view: View, original: ExtractionUnit): ExtractionCandidate {
  const result = copy(candidate), unitId = extractionUnitId(original);
  for (const claim of result.claims) for (const span of claim.evidence) {
    if (span.unitId !== unitId || span.start < 0 || span.end <= span.start || view.text.slice(span.start, span.end) !== span.quote) {
      for (const field of Object.keys(result.fields)) clear(result, field);
      result.issues.unshift('native_pass_evidence_reanchor_failed_requires_review');
      return result;
    }
    span.start += view.start; span.end += view.start; span.quote = original.text.slice(span.start, span.end);
  }
  return result;
}
function scopedCandidates(unit: ExtractionUnit, view: View, context: ExtractionContext): ExtractionCandidate[] {
  const scoped = { ...unit, text: view.text, words: undefined };
  const structured = extractStructuredCandidates(scoped, context);
  const old = extractV5([scoped], context);
  const candidates = structured === null ? old : [...structured, ...old.filter(candidate => candidate.kind !== 'event')];
  return candidates.map(candidate => {
    const source = copy(candidate), title = source.claims.find(claim => claim.field === 'title');
    // The inherited layout rule may stitch short date/time/price lines onto a
    // heading. Such a block cannot corroborate the event title. A uniquely
    // scoped prose heading may replace it; a clock or another record may not.
    if (structured === null && title?.evidence.some(span => nonTitle(span.quote))) {
      const alternatives = extractProseCandidates(scoped, context).filter(item => group(item) === group(source) && typeof item.fields.title === 'string' && !nonTitle(item.fields.title));
      clear(source, 'title');
      if (alternatives.length === 1) {
        const claim = alternatives[0].claims.find(value => value.field === 'title');
        if (claim) { source.fields.title = alternatives[0].fields.title; source.claims.push({ ...claim, evidence: claim.evidence.map(span => ({ ...span })) }); }
      }
      source.issues.unshift('native_title_layout_crosses_metadata_requires_review');
    }
    const titleClaim = source.claims.find(claim => claim.field === 'title');
    const weakTitle = typeof source.fields.title === 'string' && (seriesHeading.test(normalized(source.fields.title)) || sectionHeading.test(normalized(source.fields.title)) || titleClaim?.evidence.some(span => publisherFragment(view.text, span)));
    const display = explicitDisplayTitles(view.text, source.kind);
    if (display.length === 1 && (weakTitle || source.fields.title == null)) {
      clear(source, 'title'); source.fields.title = display[0].value;
      source.claims.push({ field: 'title', value: display[0].value, evidence: [{ unitId: extractionUnitId(scoped), start: display[0].start, end: display[0].end, quote: view.text.slice(display[0].start, display[0].end) }] });
    } else if (weakTitle || display.length > 1) {
      clear(source, 'title'); source.issues.unshift('native_publisher_or_section_heading_not_a_title_requires_review');
    }
    const location = source.claims.find(claim => claim.field === 'location');
    if (location && location.evidence.length > 1 && location.evidence.some(span => publisherFragment(view.text, span))) {
      clear(source, 'location'); source.issues.unshift('native_publisher_logo_not_a_venue_requires_review');
    }
    for (const field of ['eligibility','eligibilityText']) {
      const value = source.fields[field]; if (typeof value !== 'string') continue;
      const body = normalized(value.replace(/^\s*ELIGIBILITY\s*:?\s*/i, ''));
      if (body.replace(/[^A-Za-z]/g, '').length < 3 || /^(?:eligibility|eligible|requirements?)$/i.test(body)) {
        clear(source, field); source.issues.unshift('native_eligibility_heading_or_bullet_not_a_criterion_requires_review');
      }
    }
    const value = reanchor(source, view, unit);
    if (nonTitle(value.fields.title)) { clear(value, 'title'); value.issues.unshift('native_non_title_line_requires_review'); }
    if (structured === null) for (const line of view.text.split(/\r\n|\r|\n/)) {
      const metadata = line.match(/^\s*(Price|Cost|Eligibility|Organizer|Location|Venue)\s*:\s*(.*?)\s*$/i);
      if (!metadata || !unknown(metadata[2])) continue;
      const field = ({ cost: 'price', venue: 'location' } as Record<string, string>)[metadata[1].toLowerCase()] ?? metadata[1].toLowerCase();
      clear(value, field); value.issues.unshift(`native_explicit_${field}_unknown_requires_review`);
    }
    return value;
  });
}
function conflicting(candidate: ExtractionCandidate, field: string): boolean {
  const flatField = field.replace(/_/g, '').toLowerCase();
  return candidate.issues.some(issue => {
    const flat = issue.replace(/_/g, '').toLowerCase();
    if (issue.includes('conflict') && (flat.includes(flatField) || field === 'price' && issue.includes('cost'))) return true;
    if (issue.startsWith(`structured_${field}_`) && /(?:unknown|invalid|unsupported)/.test(issue)) return true;
    if (issue === `native_explicit_${field}_unknown_requires_review`) return true;
    // A withheld conflicting fact in one view is not mere OCR absence. Another
    // view may not silently fill it back in, even when its own parser succeeded.
    if (candidate.fields[field] == null && ['startAt','startLocal','startClock'].includes(field) && /conflict.*start|start.*conflict/.test(issue)) return true;
    if (candidate.fields[field] == null && temporalFields.has(field) && /invalid_date_or_source_instant|conflicting_structured_start/.test(issue)) return true;
    if (field === 'timeZone' && candidate.fields[field] == null && /timezone.*(?:invalid|unsupported|conflict)/.test(issue)) return true;
    return false;
  });
}
function sourceHeadingOnly(candidate: ExtractionCandidate, text: string): boolean {
  if (candidate.kind !== 'resource' || typeof candidate.fields.title !== 'string') return false;
  const title = candidate.fields.title;
  if (title !== title.toUpperCase() || title.split(/\s+/).length < 4 || !/\b(?:STUDY|LEARN|DISCOVER|EXPLORE|YOUR|CULTURAL|EXPERIENCE|OPPORTUNITIES)\b/.test(title) || /\b(?:AWARDS?|SCHOLARSHIPS?|FELLOWSHIPS?|GRANTS?|PROGRAM|FUND)\b/.test(title)) return false;
  const names = [...text.matchAll(/\b([A-Z][A-Za-z'-]*(?:[ \t]+[A-Z][A-Za-z'-]*){0,2}[ \t]+(?:Awards?|Scholarships?|Fellowships?|Grants?|Programs?|Funds?))\b/g)].map(match => normalized(match[1]).toLowerCase());
  return new Set(names).size > 1;
}

/** One native page retains one set of observations; OCR passes are never new performances. */
export function extractMediaCandidates(unit: ExtractionUnit, context: ExtractionContext = {}): ExtractionCandidate[] {
  if (unit.method === 'provided-text') return extractV5Media(unit, context);
  let base = extractV5Media(unit, context).map(copy);
  if (unit.status !== 'processed' || !base.length) return base;
  const observations = views(unit.text).map(view => scopedCandidates(unit, view, context));
  const singleAction = observations.some(items => items.some(item => item.kind === 'action')) && observations.every(items => items.filter(item => item.kind === 'action').length <= 1);
  if (singleAction && base.filter(item => item.kind === 'action').length > 1) {
    // Each view saw at most one action. Differing type words across views cannot
    // manufacture two real reminders. The seed supplies only an output shell;
    // every nonnull fact below must come from scoped corroboration.
    const actions = base.filter(item => item.kind === 'action'), seed = copy(actions[0]);
    seed.key = 'native-single-action-consensus';
    seed.issues = ['native_pass_action_type_scope_requires_review', ...new Set(actions.flatMap(item => item.issues))];
    base = [...base.filter(item => item.kind !== 'action'), seed];
  }
  const keyOf = (candidate: ExtractionCandidate) => singleAction && candidate.kind === 'action' ? 'single-native-action' : group(candidate);
  const baseKeys = base.map(keyOf);
  return base.map(candidate => {
    const issues: string[] = [], key = keyOf(candidate), local = observations.map(items => items.filter(item => keyOf(item) === key));
    // Without an unambiguous record association, don't borrow facts from another
    // event/program on this page or pair records by their array positions.
    if (baseKeys.filter(value => value === key).length > 1 || local.some(items => items.length > 1)) {
      for (const field of Object.keys(candidate.fields)) clear(candidate, field);
      issues.push('native_pass_record_scope_requires_review');
    } else {
      const records = local.flat();
      if (!records.length) {
        for (const field of Object.keys(candidate.fields)) clear(candidate, field);
        issues.push('native_pass_record_not_supported_requires_review');
      } else {
        const fields = [...new Set([...Object.keys(candidate.fields), ...records.flatMap(record => Object.keys(record.fields))])];
        for (const field of fields) {
          if (!(field in candidate.fields) && Object.keys(candidate.fields).length >= 40) { issues.push('native_pass_field_limit_requires_review'); continue; }
          const facts = records.filter(record => record.fields[field] !== null && record.fields[field] !== undefined);
          const values = new Set(facts.map(record => signature(field, record.fields[field])));
          if (values.size > 1 || records.some(record => conflicting(record, field)) || facts.some(record => unknown(record.fields[field]))) {
            clear(candidate, field); issues.push(`conflicting_native_pass_${field}_requires_review`); continue;
          }
          if (!facts.length) { clear(candidate, field); continue; }
          const selected = facts[0], value = selected.fields[field], references: EvidenceSpan[] = [];
          for (const record of facts) for (const claim of record.claims.filter(claim => claim.field === field)) for (const span of claim.evidence) {
            if (!references.some(old => old.start === span.start && old.end === span.end && old.unitId === span.unitId)) references.push({ ...span });
          }
          if (!references.length) { clear(candidate, field); issues.push('native_pass_field_evidence_missing_requires_review'); continue; }
          candidate.fields[field] = value;
          candidate.claims = candidate.claims.filter(claim => claim.field !== field);
          candidate.claims.push({ field, value, evidence: references.slice(0, 8) });
        }
        if (candidate.issues.includes('conflicting_media_dates_require_review')) for (const field of temporalFields) if (field in candidate.fields) clear(candidate, field);
        if (candidate.issues.includes('conflicting_media_clocks_require_review')) for (const field of clockFields) if (field in candidate.fields) clear(candidate, field);
        if (nonTitle(candidate.fields.title)) { clear(candidate, 'title'); issues.push('native_non_title_line_requires_review'); }
        if (sourceHeadingOnly(candidate, unit.text)) {
          if (Object.keys(candidate.fields).length < 40) {
            candidate.fields.sourceHeading = candidate.fields.title;
            candidate.claims.push(...candidate.claims.filter(claim => claim.field === 'title').map(claim => ({ ...claim, field: 'sourceHeading', evidence: claim.evidence.map(span => ({ ...span })) })));
          }
          clear(candidate, 'title'); issues.push('native_resource_program_title_scope_requires_review');
        }
      }
    }
    candidate.issues = [...new Set(['unreviewed_extraction', ...issues, ...candidate.issues, ...local.flatMap(record => record.flatMap(value => value.issues))])].slice(0, 30);
    return candidate;
  });
}
