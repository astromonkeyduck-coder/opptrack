/** Source-only evaluation adapter for the unchanged production suggestion policy. */
import { createHash } from 'node:crypto';
import { suggestOccurrenceMatches, type MatchableOccurrence } from '../lib/extraction/reconciliation';
import { validateExtractionResult, type ExtractionCandidate } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';
import type { AcceptancePredictionBody, AcceptanceReconciliationSource, RelationProposal, SourceOnlyInput } from './stage2-acceptance-predictions';

export type AcceptanceReconciliationInput = {
  sources: SourceOnlyInput[];
  predictionExtractionResults: AcceptancePredictionBody['predictionExtractionResults'];
  candidateId: string;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sourceOrigins = new Set(['json.url', 'json.localist_url', 'ics.URL']);
function explicitHttpsUrl(source: AcceptanceReconciliationSource): string | null {
  if (!source.sourceUrl || !sourceOrigins.has(source.sourceUrl.origin)) return null;
  try {
    const url = new URL(source.sourceUrl.value);
    return url.protocol === 'https:' && !url.username && !url.password ? source.sourceUrl.value : null;
  } catch { return null; }
}
function verifiedInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/i);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4] || 0) > 59
    || Number(parts[6] || 0) > 14 || Number(parts[7] || 0) > 59 || Number(parts[6]) === 14 && Number(parts[7]) !== 0) return false;
  const day = Date.parse(parts[1] + 'T00:00:00Z');
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === parts[1] && Number.isFinite(Date.parse(value));
}
function exactSourceUnit(input: SourceOnlyInput, resultUnits: ExtractionUnit[], source: AcceptanceReconciliationSource) {
  if (!source.sourceId.trim() || !Number.isInteger(source.start) || !Number.isInteger(source.end) || source.start < 0 || source.end <= source.start) return null;
  const original = input.textUnits.find(unit => `${unit.assetId}:0` === source.unitId);
  const view = input.description.views.find(view => view.unitId === source.unitId && view.text === original?.text && view.sha256 === original?.sha256);
  const result = resultUnits.find(unit => `${unit.assetId}:${unit.page ?? 0}` === source.unitId);
  if (!original || !view || !result || result.status !== 'processed' || result.method !== 'provided-text'
    || hash(original.text) !== original.sha256 || result.sha256 !== original.sha256 || result.text !== original.text
    || source.end > original.text.length || original.text.slice(source.start, source.end) !== source.text) return null;
  return result;
}
function belongsToOneRecord(candidate: ExtractionCandidate, source: AcceptanceReconciliationSource) {
  // Every supplied field claim must stay inside this one source record. In
  // particular, a title from one feed item cannot authorize another item's clock.
  return candidate.claims.length > 0 && candidate.claims.every(claim => claim.evidence.length > 0 && claim.evidence.every(span =>
    span.unitId === source.unitId && span.start >= source.start && span.end <= source.end));
}
/** No gold/canonical IDs, new inference, URL fetch, source mutation or forced relations. */
export function proposeAcceptanceReconciliation(input: AcceptanceReconciliationInput): RelationProposal[] {
  const sourceByCase = new Map(input.sources.map(source => [source.description.caseId, source]));
  if (sourceByCase.size !== input.sources.length) throw new Error('Duplicate reconciliation source case');
  const refs = new Map<string, RelationProposal['left']>();
  const grouped = new Map<string, MatchableOccurrence[]>();
  const seenCases = new Set<string>();
  for (const row of input.predictionExtractionResults) {
    if (row.candidateId !== input.candidateId) continue;
    if (seenCases.has(row.caseId)) throw new Error('Duplicate reconciliation prediction case');
    seenCases.add(row.caseId);
    const source = sourceByCase.get(row.caseId);
    if (!source || row.status !== 'completed' || !row.result || !row.result.complete) continue;
    const result = validateExtractionResult(row.result);
    for (const candidate of result.candidates) {
      const fields = candidate.fields;
      if (candidate.kind !== 'event' || fields.datePrecision !== 'instant' || typeof fields.title !== 'string' || !fields.title.trim()
        || !verifiedInstant(fields.startAt) || !verifiedInstant(fields.endAt) || Date.parse(fields.endAt) <= Date.parse(fields.startAt)) continue;
      const value = fields.status;
      if (value !== undefined && value !== null && (typeof value !== 'string' || !['scheduled', 'cancelled', 'postponed'].includes(value))) continue;
      const status = typeof value === 'string' ? value : undefined;
      const contexts = source.reconciliationSources.filter(context => exactSourceUnit(source, result.units, context) && belongsToOneRecord(candidate, context));
      if (contexts.length !== 1) continue;
      const context = contexts[0], ref = { caseId: row.caseId, candidateKey: candidate.key }, id = JSON.stringify([ref.caseId, ref.candidateKey]);
      if (refs.has(id)) throw new Error('Duplicate reconciliation candidate reference');
      refs.set(id, ref);
      const occurrence: MatchableOccurrence = { id, title: fields.title, source_id: context.sourceId,
        source_url: explicitHttpsUrl(context), description: context.description,
        starts_at: fields.startAt, ends_at: fields.endAt, date_precision: 'instant', ...(status === undefined ? {} : { status }) };
      const group = JSON.stringify([Date.parse(fields.startAt), Date.parse(fields.endAt), status ?? null]);
      const rows = grouped.get(group) ?? []; rows.push(occurrence); grouped.set(group, rows);
    }
  }
  const proposals: RelationProposal[] = [];
  // Pairwise invocation preserves the production policy while avoiding its UI
  // suggestion-count cap truncating the acceptance relation ledger.
  for (const rows of grouped.values()) for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
    if (rows[a].source_id === rows[b].source_id) continue;
    for (const suggestion of suggestOccurrenceMatches([rows[a], rows[b]], 1)) {
      proposals.push({ left: refs.get(suggestion.leftId)!, right: refs.get(suggestion.rightId)!, relation: 'same_occurrence' });
    }
  }
  return proposals.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
