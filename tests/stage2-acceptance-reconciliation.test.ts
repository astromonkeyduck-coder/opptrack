/** Synthetic source-only records/results; never opens real holdout/gold/source files. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { proposeAcceptanceReconciliation } from '../evaluation/stage2-acceptance-reconciliation';
import type { AcceptancePredictionBody, SourceOnlyInput } from '../evaluation/stage2-acceptance-predictions';
import type { ExtractionCandidate, Primitive } from '../lib/extraction/contracts';
const id = 'SYNTHETIC-candidate', start = '2099-03-04T18:00:00-05:00', end = '2099-03-04T19:00:00-05:00';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture(caseId: string, provider: string, options: { sourceUrl?: string | null; description?: string; start?: string; end?: string; status?: string | null; origin?: 'json.url' | 'json.localist_url' | 'ics.URL' } = {}) {
  const fields: Record<string, Primitive> = { title: 'SYNTHETIC OPPORTUNITY', startAt: options.start ?? start, endAt: options.end ?? end, datePrecision: 'instant', status: options.status ?? null };
  const record = { id: caseId, title: fields.title, url: options.sourceUrl ?? null, description: options.description ?? '', ...fields };
  const text = JSON.stringify(record), sha256 = hash(text), unitId = 'source-1:0';
  const source: SourceOnlyInput = { description: { caseId, assets: [{ assetId: 'source-1', sha256, mimeType: 'application/json', expectedPages: null, kind: 'text' }], views: [{ caseId, unitId, sha256, text }] }, textUnits: [{ assetId: 'source-1', sha256, text }], mediaAssets: [],
    reconciliationSources: [{ sourceId: provider, unitId, start: 0, end: text.length, text, sourceUrl: record.url ? { value: record.url, origin: options.origin ?? 'json.url' } : null, description: record.description }] };
  const candidate: ExtractionCandidate = { key: 'event', kind: 'event', fields, issues: [], claims: Object.entries(fields).filter(([, value]) => value !== null).map(([field, value]) => {
    const quote = String(value), start = text.indexOf(quote); assert.ok(start >= 0);
    return { field, value, evidence: [{ unitId, start, end: start + quote.length, quote }] };
  }) };
  const row: AcceptancePredictionBody['predictionExtractionResults'][number] = { candidateId: id, caseId, status: 'completed', failure: null, result: { version: 'stage2-result-v1', units: [{ assetId: 'source-1', page: null, status: 'processed', method: 'provided-text', text, sha256, issues: [] }], candidates: [candidate], complete: true, issues: [], stats: { expectedAssets: 0, processedAssets: 0, processedPages: 0, engine: 'SYNTHETIC', elapsedMs: 0 } } };
  return { source, row };
}
const propose = (...fixtures: Array<ReturnType<typeof fixture>>) => proposeAcceptanceReconciliation({ sources: fixtures.map(item => item.source), predictionExtractionResults: fixtures.map(item => item.row), candidateId: id });

test('common explicit native opportunity URL and verified equal interval yield source-only production-policy refs', () => {
  const a = fixture('SYNTHETIC-A', 'synthetic-provider-a', { sourceUrl: 'https://example.test/opportunity/one' });
  const b = fixture('SYNTHETIC-B', 'synthetic-provider-b', { sourceUrl: 'https://example.test/opportunity/one', origin: 'ics.URL', start: '2099-03-04T23:00:00.000Z', end: '2099-03-05T00:00:00.000Z' });
  const before = JSON.stringify([a, b]);
  assert.deepEqual(propose(a, b), [{ left: { caseId: 'SYNTHETIC-A', candidateKey: 'event' }, right: { caseId: 'SYNTHETIC-B', candidateKey: 'event' }, relation: 'same_occurrence' }]);
  assert.equal(JSON.stringify([a, b]), before);
});
test('literal original HQ authority links work with null URL and unknown status remains unknown', () => {
  const description = 'SYNTHETIC original source: https://hq.fsu.edu/rsvp?id=999999999';
  const a = fixture('SYNTHETIC-A', 'synthetic-a', { description }), b = fixture('SYNTHETIC-B', 'synthetic-b', { description });
  assert.equal(propose(a, b).length, 1);
  const scheduled = fixture('SYNTHETIC-C', 'synthetic-c', { description, status: 'scheduled' });
  assert.deepEqual(propose(a, scheduled), []); // No default scheduled status for a.
});
test('requested/feed/index URLs cannot become opportunity authority', () => {
  const a = fixture('SYNTHETIC-A', 'synthetic-a'), b = fixture('SYNTHETIC-B', 'synthetic-b');
  Object.assign(a.source, { requestedUrl: 'https://example.test/events' }); Object.assign(b.source, { requestedUrl: 'https://example.test/events' });
  assert.deepEqual(propose(a, b), []);
  for (const item of [a, b]) item.source.reconciliationSources[0].sourceUrl = { value: 'https://example.test/events', origin: 'requested-feed' as 'json.url' };
  assert.deepEqual(propose(a, b), []);
});
test('same URL at a different occurrence interval or within the same literal provider never forces a relation', () => {
  const a = fixture('SYNTHETIC-A', 'synthetic-a', { sourceUrl: 'https://example.test/opportunity/one' });
  const b = fixture('SYNTHETIC-B', 'synthetic-b', { sourceUrl: 'https://example.test/opportunity/one', start: '2099-03-05T18:00:00-05:00', end: '2099-03-05T19:00:00-05:00' });
  assert.deepEqual(propose(a, b), []);
  const sameProvider = fixture('SYNTHETIC-C', 'synthetic-a', { sourceUrl: 'https://example.test/opportunity/one' });
  assert.deepEqual(propose(a, sameProvider), []);
});
test('wrong source case, unit body or claim source record cannot authorize a relation', () => {
  for (const mode of ['case', 'body', 'record'] as const) {
    const a = fixture('SYNTHETIC-A', 'synthetic-a', { sourceUrl: 'https://example.test/opportunity/one' });
    const b = fixture('SYNTHETIC-B', 'synthetic-b', { sourceUrl: 'https://example.test/opportunity/one' });
    if (mode === 'case') b.row.caseId = 'SYNTHETIC-WRONG-CASE';
    if (mode === 'body') { b.row.result!.units[0].text = a.row.result!.units[0].text; b.row.result!.units[0].sha256 = a.row.result!.units[0].sha256; }
    if (mode === 'record') b.source.reconciliationSources[0].start = 1;
    assert.deepEqual(propose(a, b), []);
  }
});
test('missing provider, incomplete read, invalid interval, unrelated cohort or ambiguous contexts abstain', () => {
  for (const mode of ['provider', 'incomplete', 'interval', 'cohort', 'ambiguous'] as const) {
    const a = fixture('SYNTHETIC-A', 'synthetic-a', { sourceUrl: 'https://example.test/opportunity/one' });
    const b = fixture('SYNTHETIC-B', 'synthetic-b', { sourceUrl: 'https://example.test/opportunity/one' });
    if (mode === 'provider') b.source.reconciliationSources[0].sourceId = '';
    if (mode === 'incomplete') b.row.result!.complete = false;
    if (mode === 'interval') { b.row.result!.candidates[0].fields.endAt = start; const claim = b.row.result!.candidates[0].claims.find(claim => claim.field === 'endAt')!; claim.value = start; const at = b.row.result!.units[0].text.indexOf(start); claim.evidence = [{ unitId: 'source-1:0', start: at, end: at + start.length, quote: start }]; }
    if (mode === 'cohort') b.row.candidateId = 'SYNTHETIC-OTHER';
    if (mode === 'ambiguous') b.source.reconciliationSources.push(structuredClone(b.source.reconciliationSources[0]));
    assert.deepEqual(propose(a, b), []);
  }
});
test('all valid pairs are retained beyond the production UI suggestion limit without invented different/unresolved links', () => {
  const fixtures = Array.from({ length: 9 }, (_, index) => fixture(`SYNTHETIC-${index}`, `synthetic-provider-${index}`, { sourceUrl: 'https://example.test/opportunity/shared' }));
  const proposals = propose(...fixtures);
  assert.equal(proposals.length, 36);
  assert.ok(proposals.every(item => item.relation === 'same_occurrence'));
});
