/** Synthetic matcher contracts only. Never loads real holdout/gold/source artifacts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptancePrimitiveEquivalent, acceptanceValuesEquivalent, matchAcceptanceObservations } from '../evaluation/stage2-acceptance-matcher';
import type { HumanLabels } from '../evaluation/stage2-acceptance-guards';
import type { ExtractionCandidate, Primitive } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';
type Observation = HumanLabels['cases'][number]['observations'][number];
const text = 'SYNTHETIC FESTIVAL | native-one | native-two | application_open | application_deadline | 2099-03-04T18:00:00-05:00 | 2099-03-04T23:00:00.000Z | 2099-03-04T19:00:00-05:00 | 2099-03-04 | 2099-03-05';
const unit = (assetId = 'synthetic-case-a'): ExtractionUnit => ({ assetId, page: null, status: 'processed', text, method: 'provided-text', sha256: 'a'.repeat(64), issues: [] });
const unitId = (source: ExtractionUnit) => `${source.assetId}:0`;
function span(source: ExtractionUnit, value: Primitive) {
  const quoted = typeof value === 'string' && source.text.includes(value) ? value : 'SYNTHETIC';
  const start = source.text.indexOf(quoted);
  return { unitId: unitId(source), start, end: start + quoted.length, quote: quoted };
}
function observation(id: string, fields: Record<string, Primitive>, kind: Observation['kind'] = 'event', source = unit()): Observation {
  return { id, canonicalUnitId: 'canonical-' + id, kind, sourceUnitIds: [unitId(source)], fields: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, { state: value === null ? 'unknown' : 'known', value, critical: true, reason: value === null ? 'Synthetic unknown' : null, evidence: value === null ? [] : [{ type: 'text', ...span(source, value), sourceSha256: source.sha256! }] }])) };
}
function candidate(key: string, fields: Record<string, Primitive>, kind: ExtractionCandidate['kind'] = 'event', source = unit()): ExtractionCandidate {
  return { key, kind, fields, issues: [], claims: Object.entries(fields).filter(([, value]) => value !== null).map(([field, value]) => ({ field, value, evidence: [span(source, value)] })) };
}
const match = (observations: Observation[], candidates: ExtractionCandidate[], units = [unit()]) => matchAcceptanceObservations({ caseId: 'SYNTHETIC-CASE-A', observations, candidates, units });

test('unique same-source native identity matches with literal normalization and equivalent ISO offsets', () => {
  const result = match([observation('one', { nativeId: 'native-one', title: 'Synthetic Festival', startAt: '2099-03-04T18:00:00-05:00' })], [candidate('found', { sourceNativeId: 'native-one', title: ' SYNTHETIC   FESTIVAL ', startAt: '2099-03-04T23:00:00.000Z' })]);
  assert.deepEqual(result.matches, [{ observationId: 'one', candidateKey: 'found' }]);
  assert.deepEqual(result.unmatchedCandidateKeys, []);
  assert.equal(acceptancePrimitiveEquivalent(1, '1'), false);
  assert.equal(acceptanceValuesEquivalent('2099-03-04T18:00:00-05:00', '2099-03-04T23:00:00.000Z'), true);
  assert.equal(acceptanceValuesEquivalent('2099-02-30T00:00:00Z', '2099-03-02T00:00:00Z'), false);
  assert.equal(acceptancePrimitiveEquivalent('2099-03-04T18:00:00-05:00', '2099-03-04T23:00:00.000Z', 'startAt'), true);
  assert.equal(acceptancePrimitiveEquivalent('2099-03-04T18:00:00-05:00', '2099-03-04T23:00:00.000Z', 'nativeId'), false);
});
test('duplicate candidates remain ambiguous and cannot inflate recall or be ordinally selected', () => {
  const expected = observation('one', { title: 'SYNTHETIC FESTIVAL', startAt: '2099-03-04T23:00:00.000Z' });
  const fields = { title: 'SYNTHETIC FESTIVAL', startAt: '2099-03-04T23:00:00.000Z' };
  const result = match([expected], [candidate('second', fields), candidate('first', fields)]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguous, [{ observationIds: ['one'], candidateKeys: ['first', 'second'], reason: 'competing_or_non_unique_identity' }]);
  assert.deepEqual(result.unmatchedObservationIds, ['one']);
  assert.deepEqual(result.unmatchedCandidateKeys, ['first', 'second']);
});
test('wrong kind, wrong source, forged source spans and cross-case declarations cannot match', () => {
  const sourceB = unit('synthetic-case-b'), expected = observation('one', { title: 'SYNTHETIC FESTIVAL' });
  const forged = candidate('forged', { title: 'SYNTHETIC FESTIVAL' }); forged.claims[0].evidence[0].quote = 'NOT THE SOURCE';
  const result = match([expected], [candidate('wrong-kind', { title: 'SYNTHETIC FESTIVAL' }, 'resource'), candidate('other-case-unit', { title: 'SYNTHETIC FESTIVAL' }, 'event', sourceB), forged, candidate('other-case-field', { title: 'SYNTHETIC FESTIVAL', caseId: 'SYNTHETIC-CASE-B' })]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguous, []);
  assert.equal(result.unmatchedCandidateKeys.length, 4);
});
test('separate action types and clocks identify distinct actions without using array order', () => {
  const open = { title: 'SYNTHETIC FESTIVAL', actionType: 'application_open', occursAt: '2099-03-04T18:00:00-05:00' };
  const close = { title: 'SYNTHETIC FESTIVAL', actionType: 'application_deadline', occursAt: '2099-03-04T19:00:00-05:00' };
  const result = match([observation('open', open, 'action'), observation('close', close, 'action')], [candidate('closing', close, 'action'), candidate('opening', open, 'action')]);
  assert.deepEqual(result.matches, [{ observationId: 'close', candidateKey: 'closing' }, { observationId: 'open', candidateKey: 'opening' }]);
});
test('contradictory known native, action or time identities block lower-priority title fallback', () => {
  for (const [left, right, kind] of [
    [{ nativeId: 'native-one' }, { nativeId: 'native-two' }, 'event'],
    [{ nativeId: 'NATIVE-ONE' }, { nativeId: 'native-one' }, 'event'],
    [{ startAt: '2099-03-04T18:00:00-05:00' }, { startAt: '2099-03-04T19:00:00-05:00' }, 'event'],
    [{ date: '2099-03-04' }, { date: '2099-03-05' }, 'event'],
    [{ actionType: 'application_open' }, { actionType: 'application_deadline' }, 'action'],
  ] as const) {
    const result = match([observation('one', { title: 'SYNTHETIC FESTIVAL', ...left }, kind)], [candidate('found', { title: 'SYNTHETIC FESTIVAL', ...right }, kind)]);
    assert.deepEqual(result.matches, []);
    assert.deepEqual(result.unmatchedObservationIds, ['one']);
  }
});
test('unknown or partial dates permit only a mutually unique exact title identity', () => {
  const fields = { title: 'SYNTHETIC FESTIVAL', date: null, month: 3 };
  assert.deepEqual(match([observation('one', fields)], [candidate('found', fields)]).matches, [{ observationId: 'one', candidateKey: 'found' }]);
  const ambiguous = match([observation('one', fields), observation('two', fields)], [candidate('found', fields)]);
  assert.deepEqual(ambiguous.matches, []);
  assert.deepEqual(ambiguous.ambiguous[0].observationIds, ['one', 'two']);
  const unknown = match([observation('one', { title: null, date: null })], [candidate('found', { title: null, date: null, month: 3 })]);
  assert.deepEqual(unknown.matches, []);
  assert.equal(unknown.ambiguous[0].reason, 'insufficient_explicit_identity');
});
test('native identity wins over weaker title edges but leftover candidates are never force matched', () => {
  const result = match([observation('one', { title: 'SYNTHETIC FESTIVAL', nativeId: 'native-one' }), observation('two', { title: 'SYNTHETIC FESTIVAL' })], [candidate('explicit', { title: 'SYNTHETIC FESTIVAL', nativeId: 'native-one' }), candidate('title-only', { title: 'SYNTHETIC FESTIVAL' })]);
  assert.deepEqual(result.matches, [{ observationId: 'one', candidateKey: 'explicit' }]);
  assert.deepEqual(result.unmatchedObservationIds, ['two']);
  assert.deepEqual(result.unmatchedCandidateKeys, ['title-only']);
});
test('duplicate identities are rejected rather than counted as extra correct associations', () => {
  assert.throws(() => match([observation('one', {})], [candidate('same', {}), candidate('same', {})]), /Duplicate/);
  assert.throws(() => match([observation('one', {}), observation('one', {})], []), /Duplicate/);
  assert.throws(() => match([], [], [unit(), unit()]), /Duplicate/);
});


test('field comparison preserves URL paths, identifiers and named timezone case while ordinary text stays normalized', () => {
  for (const [field, expected, actual] of [
    ['sourceUrl', 'https://example.test/Event/A', 'https://example.test/event/A'],
    ['application_url', 'https://example.test/?key=AB', 'https://example.test/?key=ab'],
    ['nativeId', 'AbC', 'abc'],
    ['sourceNativeId', 'native-one', ' native-one '],
    ['timeZone', 'America/New_York', 'america/new_york'],
  ]) assert.equal(acceptancePrimitiveEquivalent(expected, actual, field), false);
  assert.equal(acceptanceValuesEquivalent('https://example.test/Event/A', 'https://example.test/event/a'), false);
  assert.equal(acceptancePrimitiveEquivalent('SYNTHETIC   FESTIVAL', ' synthetic festival ', 'title'), true);
  assert.equal(acceptancePrimitiveEquivalent('2099-03-04T18:00:00-05:00', '2099-03-04T23:00:00.000Z', 'startAt'), true);
});
