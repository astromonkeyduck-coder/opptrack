/** File-only, development-only evaluation helpers. Source text has no tool authority. */
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { NormalizedMilestone, NormalizedOccurrence, NormalizedOpportunity } from '../lib/collection/types';
import { RESULT_VERSION, validateExtractionResult, type ExtractionCandidate } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';
import { scoreCase, type EvaluationCase, type ExpectedUnit, type Prediction, type Primitive } from './stage2-evaluator';

export const REVIEWED_PREPARATION_VERSION = 'stage2-reviewed-development-v3';
export const SOURCE_TRANSFORM_VERSION = 'frozen-public-content-to-text-v1';
export const reviewedSha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export type FrozenSourceEvidence = { capturePath: string; bodySha256: string; byteCount: number; fetchedAt: string; contentType: string; originalPointer: string; rawInput: string; sourceUrl: string };
export type SourceOnlyMember = { sourceId: string; evidence: FrozenSourceEvidence[] };
export type ReviewedMember = SourceOnlyMember & { sourcePublicationAt: string | null; silverLabels: { opportunity: NormalizedOpportunity; occurrences: NormalizedOccurrence[]; actions: NormalizedMilestone[] } };
export type ReviewedExample = { exampleId: string; familyId: string; primarySource: string; members: ReviewedMember[] };
export type ApprovedReference = { exampleId: string; familyId: string; examplePath: string; exampleContentSha256: string; originalLabelsSha256: string; primarySource: string; decision: string; split: string; reviewer: string; reviewMethod: string; adjudicated: boolean };
export type PreparedInput = { caseId: string; familyId: string; units: ExtractionUnit[]; publishedAt: string | null; timeZone: null; references: Array<{ unitId: string; memberIndex: number; evidenceIndex: number; contentType: string; capturePath: string; captureSha256: string; originalPointer: string; derivedTextSha256: string }> };
export type ScopeNote = { memberIndex: number; unitKey: string | null; field: string; reason: string };

function visibleHtml(raw: string): string {
  const $ = load(raw);
  $('script,style,noscript,svg').remove();
  $('br').replaceWith('\n');
  $('td,th').each((_, node) => { $(node).append(' | '); });
  $('h1,h2,h3,h4,h5,h6,p,div,li,tr,section,article').each((_, node) => { $(node).prepend('\n').append('\n'); });
  return $.root().text().split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const literal = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const textValue = (value: unknown) => { const text = literal(value); return text ? /<[^>]+>/.test(text) ? visibleHtml(text) : text : null; };

/** Fixed content selectors use original source fields, never expected labels. */
export function sourceEvidenceToText(evidence: Pick<FrozenSourceEvidence, 'contentType' | 'rawInput'>): string {
  if (evidence.contentType.includes('json')) {
    const value = record(JSON.parse(evidence.rawInput));
    if (!value) throw new Error('Expected a frozen public JSON object.');
    const lines: string[] = [];
    const add = (label: string | null, value: unknown) => { const text = textValue(value); if (text) lines.push(label ? `${label}: ${text}` : text); };
    add(null, value.title ?? value.name);
    add('Description', value.description_text ?? value.description ?? value.tag_line);
    add('Location', value.location_name ?? value.location); add('Room', value.room_number);
    add('Published status', value.status);
    if (Array.isArray(value.event_instances)) for (const wrapped of value.event_instances) {
      const instance = record(record(wrapped)?.event_instance);
      if (instance) { add('Start', instance.start); add('End', instance.end); }
    }
    add('Application start', value.startdate); add('Application deadline', value.deadline); add('Published timeline', value.timeline);
    if (!lines.length) throw new Error('No supported literal public content in JSON excerpt.');
    return lines.join('\n');
  }
  if (evidence.contentType.includes('calendar')) {
    const unfolded = evidence.rawInput.replace(/\r?\n[ \t]/g, '');
    const properties = unfolded.split(/\r?\n/).map(line => {
      const colon = line.indexOf(':'); return colon < 0 ? null : { key: line.slice(0, colon).split(';')[0].toUpperCase(), value: line.slice(colon + 1).replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1') };
    }).filter((value): value is { key: string; value: string } => !!value);
    const order = ['SUMMARY', 'DESCRIPTION', 'DTSTART', 'DTEND', 'LOCATION', 'STATUS'];
    return order.flatMap(key => properties.filter(property => property.key === key).map(property => key === 'SUMMARY' ? property.value : `${key}: ${property.value}`)).join('\n');
  }
  if (evidence.contentType.includes('html')) return visibleHtml(evidence.rawInput);
  throw new Error('Unsupported frozen source content type.');
}

/** No silverLabels argument is accepted by the prediction-input transform. */
export function prepareSourceInputs(caseId: string, familyId: string, members: SourceOnlyMember[]): PreparedInput {
  const units: ExtractionUnit[] = [], references: PreparedInput['references'] = [], publication = new Set<string>();
  members.forEach((member, memberIndex) => member.evidence.forEach((evidence, evidenceIndex) => {
    const text = sourceEvidenceToText(evidence), assetId = `m${memberIndex}-source${evidenceIndex}`, hash = reviewedSha256(text);
    if (!text.trim() || Buffer.byteLength(text) > 65536) throw new Error('A transformed source is empty or exceeds the retained text limit.');
    units.push({ assetId, page: null, method: 'provided-text', status: 'processed', text, sha256: hash, issues: ['derived_public_source_text_not_native_media'] });
    references.push({ unitId: `${assetId}:0`, memberIndex, evidenceIndex, contentType: evidence.contentType, capturePath: evidence.capturePath, captureSha256: evidence.bodySha256, originalPointer: evidence.originalPointer, derivedTextSha256: hash });
    if (evidence.contentType.includes('json')) { const value = record(JSON.parse(evidence.rawInput)), created = literal(value?.created_at); if (created && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(created) && Number.isFinite(Date.parse(created))) publication.add(created); }
  }));
  return { caseId, familyId, units, references, publishedAt: publication.size === 1 ? [...publication][0] : null, timeZone: null };
}

const monthNumber: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function monthDay(text: string): string | null {
  const match = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  return match ? `${monthNumber[match[1].slice(0,3).toLowerCase()]}-${Number(match[2])}` : null;
}
/** Source-only conflict detection; a conflict removes a gold assertion, never repairs a prediction. */
export function sourceScopeConflicts(member: SourceOnlyMember): Array<{ field: string; reason: string }> {
  const conflicts: Array<{ field: string; reason: string }> = [];
  for (const evidence of member.evidence) if (evidence.contentType.includes('json')) {
    const value = record(JSON.parse(evidence.rawInput)); if (!value) continue;
    const description = textValue(value.description_text ?? value.description ?? value.tag_line) ?? '';
    const due = description.match(/\bapplications?\s+(?:are\s+)?due\s+(?:on\s+)?([^.!\n]+)/i)?.[1];
    if (due && literal(value.deadline) && monthDay(due) && monthDay(due) !== monthDay(String(value.deadline))) conflicts.push({ field: 'action:application_deadline:time', reason: 'Description due date conflicts with the published structured deadline; canonical deadline needs adjudication.' });
    const start = description.match(/\b(?:event|bingo|concert|screening|performance)\s+(?:starts?|begins?)\s+at\s+(\d{1,2})(?::(\d\d))?/i);
    if (start && Array.isArray(value.event_instances)) for (const wrapped of value.event_instances) {
      const structured = literal(record(record(wrapped)?.event_instance)?.start)?.match(/T(\d\d):(\d\d)/);
      if (structured && (Number(start[1]) % 12 !== Number(structured[1]) % 12 || Number(start[2] ?? 0) !== Number(structured[2]))) conflicts.push({ field: 'event:startAt', reason: 'Description event-start clock differs from the structured occurrence clock; doors versus event start needs adjudication.' });
    }
  }
  return conflicts;
}

function scoringBase(assetId: string, kind: string, actionType: unknown) {
  return `${assetId}:${kind}${kind === 'action' ? `:${typeof actionType === 'string' ? actionType : 'unknown'}` : ''}`;
}
function nextScoringKey(counters: Map<string, number>, base: string) {
  const index = counters.get(base) ?? 0; counters.set(base, index + 1); return `${base}:${index}`;
}
function referenceAsset(member: ReviewedMember, memberIndex: number, pointer: string): string | null {
  const matches = member.evidence.map((evidence, evidenceIndex) => ({ evidenceIndex, pointer: evidence.originalPointer })).filter(evidence => pointer === evidence.pointer || pointer.startsWith(evidence.pointer + '/')).sort((a,b) => b.pointer.length - a.pointer.length);
  const selected = matches[0]?.evidenceIndex ?? (member.evidence.length === 1 ? 0 : null);
  return selected === null ? null : `m${memberIndex}-source${selected}`;
}

export function prepareReviewedReference(example: ReviewedExample, approval: ApprovedReference, confirmationRecordedAt: string) {
  if (example.exampleId !== approval.exampleId || example.familyId !== approval.familyId || approval.split !== 'development' || approval.decision !== 'approve_no_corrections' || approval.adjudicated) throw new Error('Only the exact single-owner-approved development references are in scope.');
  const expected: ExpectedUnit[] = [], scopeNotes: ScopeNote[] = [], counters = new Map<string, number>();
  example.members.forEach((member, memberIndex) => {
    const conflicts = sourceScopeConflicts(member);
    const add = (unitKey: string, fields: Record<string, Primitive>, field: string, value: Primitive | undefined, reason?: string) => {
      if (reason || value === null || value === undefined || value === 'unknown') scopeNotes.push({ memberIndex, unitKey, field, reason: reason ?? 'Reference is null/unknown; canonical abstention boundary has not been separately adjudicated.' });
      else fields[field] = value;
    };
    for (const occurrence of member.silverLabels.occurrences) {
      const asset = referenceAsset(member, memberIndex, occurrence.evidencePointer);
      if (!asset) { scopeNotes.push({ memberIndex, unitKey:null, field:'event_identity', reason:'Reference has no unique frozen evidence anchor; unit requires review.' }); continue; }
      const key = nextScoringKey(counters, scoringBase(asset, 'event', null)), fields: Record<string, Primitive> = {};
      add(key, fields, 'title', member.silverLabels.opportunity.title);
      add(key, fields, 'date', occurrence.startDate);
      const startConflict = conflicts.find(conflict => conflict.field === 'event:startAt')?.reason;
      add(key, fields, 'startAt', occurrence.startAt, startConflict);
      add(key, fields, 'endAt', occurrence.endAt);
      add(key, fields, 'datePrecision', occurrence.datePrecision, startConflict ? 'Start-clock conflict also leaves start-derived canonical precision pending adjudication.' : undefined);
      add(key, fields, 'timeZone', occurrence.timezone);
      add(key, fields, 'status', occurrence.lifecycle);
      add(key, fields, 'location', occurrence.location);
      for (const field of ['doorsAt', 'cost', 'eligibility']) scopeNotes.push({ memberIndex, unitKey: key, field, reason: 'No approved canonical field for this fact; any prediction stays unscored.' });
      expected.push({ key, kind: 'event', fields, criticalFields: Object.keys(fields) });
    }
    for (const action of member.silverLabels.actions) {
      if (action.kind === 'ticket_link') { scopeNotes.push({ memberIndex, unitKey: null, field: 'ticket_link', reason: 'A visible purchase link is not a timed release; canonical resource/action mapping and exhaustive entity labeling need review.' }); continue; }
      const asset = referenceAsset(member, memberIndex, action.evidencePointer);
      if (!asset) { scopeNotes.push({ memberIndex, unitKey:null, field:'action_identity', reason:'Reference has no unique frozen evidence anchor; unit requires review.' }); continue; }
      const key = nextScoringKey(counters, scoringBase(asset, 'action', action.kind)), fields: Record<string, Primitive> = {};
      add(key, fields, 'title', member.silverLabels.opportunity.title); add(key, fields, 'actionType', action.kind);
      const conflict = conflicts.find(item => item.field === `action:${action.kind}:time`)?.reason;
      add(key, fields, 'occursAt', action.occursAt, conflict); add(key, fields, 'occursOn', action.occursOn, conflict);
      // Fixed-offset source zones and named civil-time zones have different semantics.
      add(key, fields, 'timeZone', action.timezone, action.timezone?.startsWith('Etc/GMT') ? 'Reference uses a fixed offset; equivalence to a named source zone needs canonical adjudication.' : undefined);
      for (const field of ['datePrecision', 'availability', 'eligibility']) scopeNotes.push({ memberIndex, unitKey: key, field, reason: 'Canonical field semantics are not independently labeled by this reference.' });
      expected.push({ key, kind: 'action', fields, criticalFields: Object.keys(fields) });
    }
    if (member.silverLabels.opportunity.kind === 'program') scopeNotes.push({ memberIndex, unitKey: null, field: 'resource_units', reason: 'Program-to-resource unit mapping and exhaustive entities are not separately human labeled.' });
  });
  const input = prepareSourceInputs(example.exampleId, example.familyId, example.members);
  const item: EvaluationCase = { id: example.exampleId, familyId: example.familyId, split: 'development', provenance: 'public_capture', labelStatus: 'human_reviewed', reviewedBy: approval.reviewer, reviewedAt: confirmationRecordedAt,
    tags: ['real_public_source', 'single_owner_batch_approval', 'partial_canonical_scope'],
    input: { publishedAt: input.publishedAt, fetchedAt: example.members.flatMap(member => member.evidence.map(evidence => evidence.fetchedAt)).sort().at(-1)!, timeZone: null, declaredMedia: [], units: input.units.map((unit, index) => ({ id: unit.assetId, kind: 'text', index, text: unit.text, status: 'available' })) },
    expected: { units: expected, processedMedia: [], status: 'complete', issues: [] } };
  return { item, input, scopeNotes, unitSetExhaustive: false as const, reviewMethod: approval.reviewMethod, adjudicated: false as const };
}

/** Independent runtime outputs pass the real extraction validator before scoring. */
export function validateReviewedPrediction(input: PreparedInput, candidates: ExtractionCandidate[]): Prediction {
  const result = validateExtractionResult({ version: RESULT_VERSION, units: input.units, candidates, complete: true, issues: [], stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'provided-source-text', elapsedMs: 0 } });
  const counters = new Map<string, number>();
  return { caseId: input.caseId, units: result.candidates.map(candidate => {
    const anchors = [...new Set(candidate.claims.flatMap(claim => claim.evidence.map(span => span.unitId)))];
    const source = anchors.length === 1 ? input.units.find(unit => `${unit.assetId}:${unit.page ?? 0}` === anchors[0])?.assetId : null;
    const key = source ? nextScoringKey(counters, scoringBase(source, candidate.kind, candidate.fields.actionType)) : `unresolved:${candidate.key}`;
    const fields: Record<string,Primitive> = {};
    for (const [field,value] of Object.entries(candidate.fields)) {
      const canonical = field === 'price' ? 'cost' : field;
      if (Object.hasOwn(fields, canonical)) throw new Error('Conflicting canonical field aliases.');
      fields[canonical] = value;
    }
    return { key, kind: candidate.kind, fields,
    evidenceFields: [...new Set(candidate.claims.map(claim => claim.field === 'price' ? 'cost' : claim.field))] };
  }),
    processedMedia: [], status: 'complete', issues: [...new Set(result.candidates.flatMap(candidate => candidate.issues))], providerRequests: 0, costUsd: 0 };
}

/** Partial entity scope is explicit; unmatched predictions require new labels. */
export function scoreReviewedScope(item: EvaluationCase, prediction: Prediction) {
  const known = new Set(item.expected.units.map(unit => `${unit.kind}:${unit.key}`));
  const extraUnits = prediction.units.filter(unit => !known.has(`${unit.kind}:${unit.key}`));
  const scoped = { ...prediction, units: prediction.units.filter(unit => known.has(`${unit.kind}:${unit.key}`)) };
  const score = scoreCase(item, scoped);
  return { ...score, fullCaseAccepted: false, unitSetExhaustive: false,
    scopeNotice: 'Only explicitly projected approved reference units/fields are scored. Extra entity predictions require labels, not an automatic correctness judgment. This is not complete precision or detection recall.',
    extraPredictedUnitsUnscored: extraUnits.map(unit => ({ key: unit.key, kind: unit.kind, nonnullFields: Object.entries(unit.fields).filter(([,value]) => value !== null).map(([field]) => field) })),
    totalPredictedUnits: prediction.units.length, totalPredictedNonnullFields: prediction.units.reduce((sum,unit) => sum + Object.values(unit.fields).filter(value => value !== null).length, 0) };
}
