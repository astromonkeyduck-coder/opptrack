import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeBaselineCandidates, predictStage2Baseline } from '../evaluation/predict-stage2-baseline';
import type { EvaluationCase } from '../evaluation/stage2-evaluator';
import type { ExtractionCandidate } from '../lib/extraction/contracts';
import { providedTextUnit } from '../lib/extraction/text';

function sourceInput(): EvaluationCase['input'] {
  return { publishedAt: null, fetchedAt: '2027-01-01T00:00:00Z', timeZone: null, declaredMedia: [],
    units: [{ id: 'caption', kind: 'text', index: 0, text: 'Concert test\nJanuary 20, 2027\n7 pm–9 pm Eastern Time\nLocation: Test Hall', status: 'available' }] };
}

test('input-only adapter is callable without a corpus or expected-label argument', () => {
  assert.equal(typeof predictStage2Baseline, 'function');
  assert.equal(predictStage2Baseline('input-only', sourceInput()).caseId, 'input-only');
});

test('captions are excluded from processed visual media and scheduled status is never invented', () => {
  const prediction = predictStage2Baseline('caption', sourceInput());
  assert.deepEqual(prediction.processedMedia, []);
  assert.equal(prediction.status, 'complete');
  assert.equal(prediction.units[0].fields.status, null);
  assert.equal(prediction.units[0].evidenceFields.includes('status'), false);
  assert.ok(prediction.units[0].evidenceFields.includes('startAt'));
  assert.equal(prediction.providerRequests, 0);
  assert.equal(prediction.costUsd, 0);
});

test('all available image/page transcripts count once while missing middle media stay partial', () => {
  const input = sourceInput();
  input.declaredMedia = ['image-0', 'image-1', 'page-2'];
  input.units.push({ id: 'image-0', kind: 'image', index: 0, text: 'Literal image transcript', status: 'available' },
    { id: 'image-1', kind: 'image', index: 1, text: null, status: 'missing' },
    { id: 'page-2', kind: 'pdf_page', index: 2, text: 'Literal page transcript', status: 'available' });
  const prediction = predictStage2Baseline('partial', input);
  assert.deepEqual(prediction.processedMedia, ['image-0', 'page-2']);
  assert.equal(prediction.status, 'partial');
  assert.ok(prediction.issues.includes('input_unavailable'));
  assert.ok(prediction.issues.includes('declared_media_unavailable'));
  input.units.forEach(unit => { unit.status = 'unreadable'; unit.text = null; });
  assert.equal(predictStage2Baseline('blocked', input).status, 'blocked');
});

test('a missing declared asset and unavailable text cannot be reported complete', () => {
  const input = sourceInput();
  input.declaredMedia.push('not-retained');
  assert.equal(predictStage2Baseline('missing-declared', input).status, 'partial');
  input.declaredMedia = [];
  input.units[0].status = 'missing'; input.units[0].text = null;
  assert.equal(predictStage2Baseline('missing-text', input).status, 'blocked');
});

function literalCandidate(): ExtractionCandidate {
  return { key: 'event:0', kind: 'event', fields: { price: 'Tickets: $12', status: null },
    claims: [{ field: 'price', value: 'Tickets: $12', evidence: [{ unitId: 'text:0', start: 0, end: 12, quote: 'Tickets: $12' }] }], issues: [] };
}

test('fixed price alias maps field and validated evidence together without altering literal values', () => {
  const mapped = canonicalizeBaselineCandidates([providedTextUnit('Tickets: $12')], [literalCandidate()])[0];
  assert.deepEqual(mapped.fields, { cost: 'Tickets: $12', status: null });
  assert.deepEqual(mapped.evidenceFields, ['cost']);
});

test('evidence flags reject mismatched field values, source IDs, offsets and altered quotes', () => {
  const unit = providedTextUnit('Tickets: $12');
  const mutations: Array<(candidate: ExtractionCandidate) => void> = [
    candidate => { candidate.claims[0].value = 'Tickets: $0'; },
    candidate => { candidate.claims[0].evidence[0].unitId = 'missing:0'; },
    candidate => { candidate.claims[0].evidence[0].start = -1; },
    candidate => { candidate.claims[0].evidence[0].end = 100; },
    candidate => { candidate.claims[0].evidence[0].quote = 'Tickets: $0'; },
    candidate => { candidate.claims[0].evidence = []; },
    candidate => { candidate.claims = []; },
  ];
  for (const mutate of mutations) {
    const candidate = literalCandidate(); mutate(candidate);
    assert.throws(() => canonicalizeBaselineCandidates([unit], [candidate]), /Claim|evidence/);
  }
  assert.throws(() => canonicalizeBaselineCandidates([{ ...unit, status: 'blocked' }], [literalCandidate()]), /exact retained/);
});

test('colliding price and cost fields cannot silently overwrite each other', () => {
  const candidate = literalCandidate(); candidate.fields.cost = null;
  assert.throws(() => canonicalizeBaselineCandidates([providedTextUnit('Tickets: $12')], [candidate]), /Conflicting canonical/);
});
