import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSplitManifest, evaluationSha256, evaluatePredictions, fieldEquivalent, scoreCase, scoreReconciliation, validateCorpus, validateSplitManifest, wilsonInterval, type EvaluationCase, type EvaluationCorpus, type Prediction, type SplitManifest } from '../evaluation/stage2-evaluator';

const corpus = JSON.parse(readFileSync(new URL('../evaluation/stage2-cases.json', import.meta.url), 'utf8')) as EvaluationCorpus;
const manifest = JSON.parse(readFileSync(new URL('../evaluation/stage2-split-manifest.json', import.meta.url), 'utf8')) as SplitManifest;
const copy = <T>(value: T): T => structuredClone(value);
function oracle(item: EvaluationCase): Prediction {
  return { caseId: item.id, units: item.expected.units.map(unit => ({ key: unit.key, kind: unit.kind, fields: copy(unit.fields), evidenceFields: Object.keys(unit.fields).filter(field => unit.fields[field] !== null) })),
    status: item.expected.status, processedMedia: [...item.expected.processedMedia], issues: [...item.expected.issues] };
}
const one = (id: string) => corpus.cases.find(item => item.id === id)!;

test('synthetic families have frozen assignments without pretending to be human-reviewed data', () => {
  assert.deepEqual(validateCorpus(corpus), []);
  assert.deepEqual(validateSplitManifest(corpus, manifest), []);
  assert.equal(corpus.cases.length, 28);
  assert.equal(corpus.cases.filter(item => item.labelStatus !== 'agent_labeled_unreviewed').length, 0);
  assert.ok(corpus.cases.some(item => item.split === 'holdout'));
});

test('an oracle self-check never promotes synthetic labels into a factual acceptance benchmark', () => {
  const result = evaluatePredictions(corpus, manifest, corpus.cases.map(oracle), 'oracle-self-check-not-a-runtime-model');
  assert.equal(result.allRegressionCases.passedCases, 28);
  assert.equal(result.allRegressionCases.events.recall, 1);
  assert.equal(result.allRegressionCases.actions.recall, 1);
  assert.equal(result.counts.humanReviewedHoldout, 0);
  assert.equal(result.acceptance.state, 'not_evaluated');
  assert.equal(result.acceptance.stage2Accepted, false);
  assert.equal(result.humanReviewedHoldout.events.recall, null);
  assert.equal(result.cost.unmeasuredCases, 28);
  assert.equal(result.cost.measuredCases, 0);
});

test('family leakage and altered frozen source/label content are rejected', () => {
  const leaked = copy(corpus);
  leaked.cases.find(item => item.id === 'missing_end_no_duration_guess')!.split = 'holdout';
  assert.ok(validateCorpus(leaked).some(error => error.includes('family leaks')));
  const changed = copy(corpus);
  changed.cases[0].expected.units[0].fields.startAt = '2027-11-06T19:00:00-05:00';
  assert.ok(validateSplitManifest(changed, manifest).some(error => error.includes('Frozen')));
  assert.throws(() => evaluatePredictions(changed, manifest, changed.cases.map(oracle), 'changed'), /Frozen/);
});

test('correct-looking values without validated field evidence are unsupported predictions', () => {
  const item = one('film_explicit_interval'), prediction = oracle(item);
  prediction.units[0].evidenceFields = prediction.units[0].evidenceFields.filter(field => field !== 'startAt');
  const score = scoreCase(item, prediction);
  assert.equal(score.fields.unsupported, 1);
  assert.equal(score.fields.unsupportedCritical, 1);
  assert.equal(score.units.event.correct, 0);
  assert.equal(score.units.event.missed, 1);
});

test('an invented duration is a critical false positive even if its evidence flag is asserted', () => {
  const item = one('missing_end_no_duration_guess'), prediction = oracle(item);
  prediction.units[0].fields.endAt = '2026-11-06T20:00:00-05:00';
  prediction.units[0].evidenceFields.push('endAt');
  const score = scoreCase(item, prediction);
  assert.equal(score.passed, false);
  assert.equal(score.fields.unsupportedCritical, 1);
  assert.equal(score.units.event.falsePositive, 1);
});

test('wrong critical dates count as both a missed truth and an incorrect predicted event', () => {
  const item = one('tomorrow_original_publication'), prediction = oracle(item);
  prediction.units[0].fields.startAt = '2026-11-06T19:00:00-05:00';
  const score = scoreCase(item, prediction);
  assert.equal(score.fields.missed, 1);
  assert.equal(score.fields.wrongOrUnsupported, 1);
  assert.equal(score.units.event.correct, 0);
});

test('negative captures penalize invented events rather than forcing one event per capture', () => {
  const item = one('irrelevant_thanks_photos'), prediction = oracle(item);
  prediction.units.push({ key: 'event:0', kind: 'event', fields: { title: 'Invented event', startAt: '2026-11-10T10:00:00Z' }, evidenceFields: ['title', 'startAt'] });
  const score = scoreCase(item, prediction);
  assert.equal(score.negativeCorrect, false);
  assert.equal(score.units.event.falsePositive, 1);
  assert.equal(score.fields.unsupportedCritical, 2);
});

test('absent predictions remain misses and duplicates cannot inflate correct-event counts', () => {
  const item = one('film_explicit_interval'), prediction = oracle(item);
  prediction.units.push(copy(prediction.units[0]));
  const score = scoreCase(item, prediction);
  assert.equal(score.units.event.correct, 1);
  assert.equal(score.units.event.falsePositive, 1);
  assert.equal(score.duplicatePredictionKeys, 1);
  const report = evaluatePredictions(corpus, manifest, [], 'missing-runtime-output');
  assert.equal(report.counts.missingPredictions.length, 28);
  assert.equal(report.allRegressionCases.events.correct, 0);
  assert.ok(report.allRegressionCases.events.missed > 0);
});

test('all media includes missing or unreadable units in its honest coverage denominator', () => {
  const item = one('carousel_missing_middle_slide'), prediction = oracle(item);
  const score = scoreCase(item, prediction);
  assert.equal(score.passed, true);
  assert.equal(score.media.declared, 3);
  assert.equal(score.media.processedDeclared, 2);
  prediction.status = 'complete';
  assert.equal(scoreCase(item, prediction).passed, false);
  const complete = one('complete_three_slide_carousel'), truncated = oracle(complete);
  truncated.processedMedia = ['slide-0'];
  assert.equal(scoreCase(complete, truncated).passed, false);
});

test('equivalent timezone offsets preserve instants while unknown local/date facts stay unknown', () => {
  assert.equal(fieldEquivalent('startAt', '2026-11-06T19:00:00-05:00', '2026-11-07T00:00:00Z'), true);
  assert.equal(fieldEquivalent('occursOn', '2026-11-06', '2026-11-06T00:00:00Z'), false);
  assert.equal(fieldEquivalent('startAt', null, '2026-11-06T00:00:00Z'), false);
  assert.equal(fieldEquivalent('location', 'Student  Union', 'Student Union'), true);
});

test('a human review needs provenance and a tiny perfect sample does not pass the declared holdout gate', () => {
  const reviewed = copy(corpus);
  const item = reviewed.cases.find(value => value.split === 'holdout')!;
  item.labelStatus = 'human_reviewed';
  assert.ok(validateCorpus(reviewed).some(error => error.includes('reviewer and timestamp')));
  item.reviewedBy = 'Synthetic test reviewer identity — not an actual review';
  item.reviewedAt = '2026-11-02T12:00:00Z';
  const result = evaluatePredictions(reviewed, createSplitManifest(reviewed, '2026-11-02T12:00:00Z'), reviewed.cases.map(oracle), 'synthetic-review-metadata-test');
  assert.equal(result.counts.humanReviewedHoldout, 1);
  assert.equal(result.acceptance.state, 'not_met');
  assert.ok(result.acceptance.reasons.some(reason => reason.includes('40-case target')));
  assert.equal(result.acceptance.stage2Accepted, false);
});

test('known zero costs remain separate from unmeasured costs and malformed telemetry fails', () => {
  const predictions = corpus.cases.map(oracle);
  predictions[0].costUsd = 0;
  predictions[0].providerRequests = 0;
  const result = evaluatePredictions(corpus, manifest, predictions, 'telemetry-self-check');
  assert.equal(result.cost.knownUsd, 0);
  assert.equal(result.cost.measuredCases, 1);
  assert.equal(result.cost.unmeasuredCases, 27);
  predictions[0].costUsd = -1;
  assert.throws(() => evaluatePredictions(corpus, manifest, predictions, 'invalid-cost'), /Invalid measured cost/);
});

test('the uncertainty interval exposes how weak a small perfect score is', () => {
  assert.equal(wilsonInterval(0, 0), null);
  const result = wilsonInterval(5, 5)!;
  assert.ok(result.low < 0.6);
  assert.equal(result.high, 1);
  assert.throws(() => wilsonInterval(2, 1), /Invalid binomial counts/);
});

test('reconciliation separates false merges, retained duplicates, review and missing pairs', () => {
  const labels = [
    { id: 'different_club_gbm', expected: 'separate' as const },
    { id: 'explicit_same_link', expected: 'same' as const },
    { id: 'ambiguous_title', expected: 'review' as const },
    { id: 'unscored_pair', expected: 'separate' as const },
  ];
  const result = scoreReconciliation(labels, [
    { id: 'different_club_gbm', result: 'same' }, { id: 'explicit_same_link', result: 'separate' }, { id: 'ambiguous_title', result: 'review' },
  ]);
  assert.deepEqual(result.wrongMerges, ['different_club_gbm']);
  assert.deepEqual(result.duplicatesRetained, ['explicit_same_link']);
  assert.deepEqual(result.missedPairs, ['unscored_pair']);
  assert.equal(result.correct, 1);
  assert.throws(() => scoreReconciliation(labels, [{ id: 'unknown', result: 'same' }]), /Unknown reconciliation/);
});

test('the synthetic reconciliation pairs are frozen and related families retain their extraction split', () => {
  const data = JSON.parse(readFileSync(new URL('../evaluation/stage2-reconciliation-cases.json', import.meta.url), 'utf8')) as { corpusVersion: string; pairs: Array<{ id: string; familyId: string; split: string; labelStatus: string; expected: 'same' | 'separate' | 'review' }> };
  const frozen = JSON.parse(readFileSync(new URL('../evaluation/stage2-reconciliation-manifest.json', import.meta.url), 'utf8'));
  const rows = data.pairs.map(pair => ({ id: pair.id, familyId: pair.familyId, split: pair.split, sha256: evaluationSha256(pair) })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(rows, frozen.cases);
  assert.equal(evaluationSha256({ corpusVersion: data.corpusVersion, cases: rows }), frozen.contentSha256);
  const families = new Map(corpus.cases.map(item => [item.familyId, item.split as string]));
  for (const pair of data.pairs) {
    if (families.has(pair.familyId)) assert.equal(families.get(pair.familyId), pair.split);
    families.set(pair.familyId, pair.split);
    assert.equal(pair.labelStatus, 'agent_labeled_unreviewed');
  }
  assert.equal(data.pairs.length, 12);
});
