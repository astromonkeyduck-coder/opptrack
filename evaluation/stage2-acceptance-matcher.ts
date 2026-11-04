/** Frozen generic scoring-time association only. No source/gold I/O or prediction repair. */
import type { HumanLabels } from './stage2-acceptance-guards';
import type { ExtractionCandidate, Primitive } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';

type Observation = HumanLabels['cases'][number]['observations'][number];
export type AcceptanceMatchInput = {
  caseId: string;
  observations: HumanLabels['cases'][number]['observations'];
  candidates: ExtractionCandidate[];
  /** Only this case's frozen units; the caller must retain case membership. */
  units: ExtractionUnit[];
};
export type AcceptanceMatches = {
  matches: Array<{ observationId: string; candidateKey: string }>;
  ambiguous: Array<{ observationIds: string[]; candidateKeys: string[]; reason: string }>;
  /** Includes ambiguous nodes: ambiguity cannot conceal misses or extra predictions. */
  unmatchedObservationIds: string[];
  unmatchedCandidateKeys: string[];
};
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const literal = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const caseSensitiveIdentityField = (field?: string) => {
  const name = field?.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return name === 'timezone' || name === 'time_zone' || ['id', 'ids', 'url', 'urls', 'uri', 'uris', 'link', 'links'].includes(name?.split('_').at(-1) ?? '');
};
const urlLike = (value: string) => /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|urn:)/i.test(value);
function instant(value: string): number | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/i);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59
    || Number(match[6] || 0) > 14 || Number(match[7] || 0) > 59 || Number(match[6]) === 14 && Number(match[7]) !== 0) return null;
  const day = Date.parse(match[1] + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1]) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
/** No aliases, edit distance, number coercion or inferred timezone. */
export function acceptancePrimitiveEquivalent(expected: Primitive, actual: Primitive, field?: string): boolean {
  if (typeof expected === 'string' && typeof actual === 'string') {
    // URL paths, provider IDs and named zones cannot acquire case/space aliases.
    if (caseSensitiveIdentityField(field) || urlLike(expected) || urlLike(actual)) return expected === actual;
    if (field === undefined || /(?:At|_at)$/.test(field)) {
      const left = instant(expected), right = instant(actual);
      if (left !== null && right !== null) return left === right;
    }
    return literal(expected) === literal(actual);
  }
  return typeof expected === 'number' && typeof actual === 'number'
    ? Number.isFinite(expected) && Number.isFinite(actual) && expected === actual
    : expected === actual;
}
export function acceptanceValuesEquivalent(left: Primitive, right: Primitive): boolean {
  return acceptancePrimitiveEquivalent(left, right);
}
// Provider identifiers remain exact; textual case folding is not an ID alias rule.
const nativeEquivalent = (left: Primitive, right: Primitive) => typeof left === typeof right && left === right;
const known = (observation: Observation, field: string): Primitive | undefined => {
  const label = observation.fields[field];
  return label?.state === 'known' && label.value !== null ? label.value : undefined;
};
const predicted = (candidate: ExtractionCandidate, field: string): Primitive | undefined => candidate.fields[field] ?? undefined;
const nativeFields = ['nativeId', 'sourceNativeId'];
const timeFields = {
  event: ['startAt', 'startLocal', 'date', 'sourceDate', 'eventLocalDate', 'dateStart', 'dateEndInclusive', 'year', 'month', 'day', 'startClock'],
  action: ['occursAt', 'actionLocal', 'occursOn', 'sourceDate', 'dateStart', 'dateEndInclusive', 'year', 'month', 'day', 'actionClock', 'deadlineYear', 'deadlineMonth', 'deadlineDay', 'deadlineClock'],
  resource: [],
};
type CandidateEvidence = { anchors: Set<string>; supported: (field: string, sourceIds: Set<string>) => boolean };
function evidenceFor(candidate: ExtractionCandidate, units: Map<string, ExtractionUnit>): CandidateEvidence | null {
  const anchors = new Set<string>();
  for (const claim of candidate.claims) {
    if (!Object.hasOwn(candidate.fields, claim.field) || candidate.fields[claim.field] !== claim.value || !claim.evidence.length) return null;
    for (const span of claim.evidence) {
      const unit = units.get(span.unitId);
      if (!unit || unit.status !== 'processed' || !Number.isInteger(span.start) || !Number.isInteger(span.end)
        || span.start < 0 || span.end <= span.start || !span.quote || unit.text.slice(span.start, span.end) !== span.quote) return null;
      anchors.add(span.unitId);
    }
  }
  return { anchors, supported: (field, sourceIds) => candidate.claims.some(claim => claim.field === field && claim.evidence.some(span => sourceIds.has(span.unitId))) };
}
function rank(observation: Observation, candidate: ExtractionCandidate, proof: CandidateEvidence, caseId: string): number | null {
  if (observation.kind !== candidate.kind) return null;
  for (const field of ['caseId', 'sourceCaseId']) {
    const declared = predicted(candidate, field), human = known(observation, field);
    if (declared !== undefined && declared !== caseId || human !== undefined && human !== caseId) return null;
  }
  const sources = new Set(observation.sourceUnitIds);
  if (![...proof.anchors].some(id => sources.has(id))) return null;
  const same = (field: string) => {
    const left = known(observation, field), right = predicted(candidate, field);
    return left !== undefined && right !== undefined && acceptancePrimitiveEquivalent(left, right, field) && proof.supported(field, sources);
  };
  const differs = (field: string) => {
    const left = known(observation, field), right = predicted(candidate, field);
    return left !== undefined && right !== undefined && !acceptancePrimitiveEquivalent(left, right, field);
  };
  const leftIds = nativeFields.flatMap(field => known(observation, field) === undefined ? [] : [known(observation, field)!]);
  const rightIds = nativeFields.flatMap(field => predicted(candidate, field) === undefined ? [] : [{ field, value: predicted(candidate, field)! }]);
  // A stated conflicting native/action/time identity may never fall through to a title match.
  if (nativeFields.some(field => known(observation, field) !== undefined && predicted(candidate, field) !== undefined && !nativeEquivalent(known(observation, field)!, predicted(candidate, field)!))
    || leftIds.length && rightIds.length && !leftIds.some(left => rightIds.some(right => nativeEquivalent(left, right.value)))) return null;
  if (candidate.kind === 'action' && differs('actionType') || timeFields[candidate.kind].some(differs)) return null;
  const nativeMatch = leftIds.some(left => rightIds.some(right => nativeEquivalent(left, right.value) && proof.supported(right.field, sources)));
  if (nativeMatch) return 4;
  if (differs('title')) return null;
  if (candidate.kind === 'action' && !same('actionType')) return 0;
  const primary = candidate.kind === 'action' ? ['occursAt', 'actionLocal'] : candidate.kind === 'event' ? ['startAt', 'startLocal'] : [];
  if (primary.some(same)) return 3;
  const dates = candidate.kind === 'action' ? ['occursOn', 'sourceDate'] : candidate.kind === 'event' ? ['date', 'sourceDate', 'eventLocalDate'] : [];
  if (dates.some(field => typeof known(observation, field) === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(known(observation, field))) && same(field))) return 2;
  return same('title') ? 1 : 0;
}
/** Uses only mutually unique strongest identities. It never forces leftover ordinal/fuzzy matches. */
export function matchAcceptanceObservations(input: AcceptanceMatchInput): AcceptanceMatches {
  const unitMap = new Map(input.units.map(unit => [`${unit.assetId}:${unit.page ?? 0}`, unit]));
  if (unitMap.size !== input.units.length || new Set(input.observations.map(item => item.id)).size !== input.observations.length
    || new Set(input.candidates.map(item => item.key)).size !== input.candidates.length) throw new Error('Duplicate case unit, observation or candidate identity');
  const proofs = input.candidates.map(candidate => evidenceFor(candidate, unitMap));
  const edges: Array<{ observation: number; candidate: number; rank: number }> = [];
  input.observations.forEach((observation, oi) => input.candidates.forEach((candidate, ci) => {
    if (!proofs[ci]) return;
    const strength = rank(observation, candidate, proofs[ci]!, input.caseId);
    if (strength !== null) edges.push({ observation: oi, candidate: ci, rank: strength });
  }));
  const best = (side: 'observation' | 'candidate', index: number) => {
    const eligible = edges.filter(edge => edge[side] === index && edge.rank > 0);
    const maximum = Math.max(0, ...eligible.map(edge => edge.rank));
    return eligible.filter(edge => edge.rank === maximum);
  };
  const selected = edges.filter(edge => edge.rank > 0 && best('observation', edge.observation).length === 1
    && best('observation', edge.observation)[0] === edge && best('candidate', edge.candidate).length === 1 && best('candidate', edge.candidate)[0] === edge);
  const matchedObservations = new Set(selected.map(edge => edge.observation)), matchedCandidates = new Set(selected.map(edge => edge.candidate));
  const remaining = edges.filter(edge => !matchedObservations.has(edge.observation) && !matchedCandidates.has(edge.candidate));
  const ambiguous: AcceptanceMatches['ambiguous'] = [], visited = new Set<string>();
  for (const initial of remaining) {
    if (visited.has('o' + initial.observation)) continue;
    const obs = new Set<number>(), candidates = new Set<number>(), queue: Array<['o' | 'c', number]> = [['o', initial.observation]];
    while (queue.length) {
      const [side, index] = queue.shift()!, key = side + index;
      if (visited.has(key)) continue;
      visited.add(key);
      if (side === 'o') { obs.add(index); for (const edge of remaining.filter(edge => edge.observation === index)) queue.push(['c', edge.candidate]); }
      else { candidates.add(index); for (const edge of remaining.filter(edge => edge.candidate === index)) queue.push(['o', edge.observation]); }
    }
    const positive = remaining.some(edge => obs.has(edge.observation) && candidates.has(edge.candidate) && edge.rank > 0);
    ambiguous.push({ observationIds: [...obs].map(index => input.observations[index].id).sort(order), candidateKeys: [...candidates].map(index => input.candidates[index].key).sort(order), reason: positive ? 'competing_or_non_unique_identity' : 'insufficient_explicit_identity' });
  }
  return {
    matches: selected.map(edge => ({ observationId: input.observations[edge.observation].id, candidateKey: input.candidates[edge.candidate].key })).sort((a, b) => order(a.observationId, b.observationId)),
    ambiguous: ambiguous.sort((a, b) => order(a.observationIds.join('\u0000'), b.observationIds.join('\u0000'))),
    unmatchedObservationIds: input.observations.filter((_, index) => !matchedObservations.has(index)).map(item => item.id).sort(order),
    unmatchedCandidateKeys: input.candidates.filter((_, index) => !matchedCandidates.has(index)).map(item => item.key).sort(order),
  };
}
