/** Offline scoring only. This module has no collector, model, calendar or delivery authority. */
import { createHash } from 'node:crypto';

export type Primitive = string | number | boolean | null;
export type UnitKind = 'event' | 'action' | 'resource';
export type LabelStatus = 'agent_labeled_unreviewed' | 'human_reviewed' | 'adjudicated';
export interface CanonicalUnit {
  key: string;
  kind: UnitKind;
  fields: Record<string, Primitive>;
  /** Only include fields whose source spans have already passed runtime validation. */
  evidenceFields: string[];
}
export interface ExpectedUnit {
  key: string;
  kind: UnitKind;
  fields: Record<string, Primitive>;
  criticalFields: string[];
}
export interface EvaluationCase {
  id: string;
  familyId: string;
  split: 'development' | 'holdout';
  provenance: 'synthetic' | 'public_capture' | 'permitted_manual';
  labelStatus: LabelStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  tags: string[];
  input: {
    publishedAt: string | null;
    fetchedAt: string;
    timeZone: string | null;
    declaredMedia: string[];
    units: Array<{ id: string; kind: 'text' | 'image' | 'pdf_page'; index: number; text: string | null; status: 'available' | 'missing' | 'unreadable' }>;
    [key: string]: unknown;
  };
  expected: {
    units: ExpectedUnit[];
    processedMedia: string[];
    status: 'complete' | 'partial' | 'blocked';
    issues: string[];
  };
}
export interface EvaluationCorpus {
  schemaVersion: 1;
  corpusVersion: string;
  provenanceNotice: string;
  targetVariedHumanLabeledExamples: number;
  recallTarget: number;
  minimumHumanReviewedHoldout: number;
  cases: EvaluationCase[];
}
export interface Prediction {
  caseId: string;
  units: CanonicalUnit[];
  processedMedia: string[];
  status: 'complete' | 'partial' | 'blocked';
  issues: string[];
  costUsd?: number | null;
  providerRequests?: number;
}
export interface SplitManifest {
  schemaVersion: 1;
  corpusVersion: string;
  frozenAt: string;
  notice: string;
  cases: Array<{ id: string; familyId: string; split: 'development' | 'holdout'; sha256: string }>;
  contentSha256: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry)).join(',') + '}';
  return JSON.stringify(value);
}
export function evaluationSha256(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
const unique = (values: string[]) => [...new Set(values)].sort();
const sameSet = (a: string[], b: string[]) => canonical(unique(a)) === canonical(unique(b));

export function validateCorpus(corpus: EvaluationCorpus): string[] {
  const errors: string[] = [];
  if (corpus.schemaVersion !== 1 || !corpus.corpusVersion) errors.push('Unsupported corpus identity.');
  if (!Array.isArray(corpus.cases) || !corpus.cases.length) return [...errors, 'Cases are required.'];
  if (!(corpus.recallTarget > 0 && corpus.recallTarget <= 1) || !Number.isInteger(corpus.minimumHumanReviewedHoldout) || corpus.minimumHumanReviewedHoldout < 1) errors.push('Invalid declared thresholds.');
  const ids = new Set<string>(), families = new Map<string, string>();
  for (const item of corpus.cases) {
    if (!/^[a-z0-9][a-z0-9_-]+$/.test(item.id) || ids.has(item.id)) errors.push(`${item.id}: duplicate or invalid case ID.`);
    ids.add(item.id);
    if (!item.familyId || !['development', 'holdout'].includes(item.split)) errors.push(`${item.id}: family/split is required.`);
    if (families.has(item.familyId) && families.get(item.familyId) !== item.split) errors.push(`${item.id}: family leaks across splits.`);
    families.set(item.familyId, item.split);
    if (!['synthetic', 'public_capture', 'permitted_manual'].includes(item.provenance)) errors.push(`${item.id}: provenance is required.`);
    if (!['agent_labeled_unreviewed', 'human_reviewed', 'adjudicated'].includes(item.labelStatus)) errors.push(`${item.id}: label status is required.`);
    if (item.labelStatus !== 'agent_labeled_unreviewed' && (!item.reviewedBy?.trim() || !item.reviewedAt || !Number.isFinite(Date.parse(item.reviewedAt)))) errors.push(`${item.id}: human review needs its reviewer and timestamp.`);
    if (item.labelStatus === 'agent_labeled_unreviewed' && (item.reviewedBy !== null || item.reviewedAt !== null)) errors.push(`${item.id}: an unreviewed label cannot claim a reviewer.`);
    const media = item.input.units.map(unit => unit.id);
    if (new Set(media).size !== media.length || new Set(item.input.declaredMedia).size !== item.input.declaredMedia.length) errors.push(`${item.id}: media IDs must be unique.`);
    if (item.expected.processedMedia.some(id => !media.includes(id))) errors.push(`${item.id}: expected processing names nonexistent media.`);
    for (const unit of item.input.units) {
      if (!Number.isInteger(unit.index) || unit.index < 0 || !['text', 'image', 'pdf_page'].includes(unit.kind)) errors.push(`${item.id}: invalid source unit.`);
      if (unit.status === 'available' && typeof unit.text !== 'string') errors.push(`${item.id}: available source unit lacks text.`);
    }
    const keys = new Set<string>();
    for (const unit of item.expected.units) {
      if (!unit.key || keys.has(unit.key) || !['event', 'action', 'resource'].includes(unit.kind)) errors.push(`${item.id}: expected unit identity is invalid.`);
      keys.add(unit.key);
      if (unit.criticalFields.some(field => !(field in unit.fields))) errors.push(`${item.id}: critical field has no explicit expected value.`);
      if (Object.values(unit.fields).some(value => value !== null && (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)))) errors.push(`${item.id}: fields must be finite primitives or null.`);
    }
  }
  return errors;
}

export function createSplitManifest(corpus: EvaluationCorpus, frozenAt: string): SplitManifest {
  const errors = validateCorpus(corpus); if (errors.length) throw new Error(errors.join('\n'));
  const cases = corpus.cases.map(item => ({ id: item.id, familyId: item.familyId, split: item.split, sha256: evaluationSha256(item) })).sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: 1, corpusVersion: corpus.corpusVersion, frozenAt,
    notice: 'Frozen synthetic assignment only. No human-reviewed or untouched acceptance holdout is established by this manifest.',
    cases, contentSha256: evaluationSha256({ corpusVersion: corpus.corpusVersion, cases }) };
}
export function validateSplitManifest(corpus: EvaluationCorpus, manifest: SplitManifest): string[] {
  const errors = validateCorpus(corpus);
  if (errors.length) return errors;
  if (manifest.schemaVersion !== 1 || manifest.corpusVersion !== corpus.corpusVersion) errors.push('Manifest version differs from the corpus.');
  const actual = createSplitManifest(corpus, manifest.frozenAt);
  if (manifest.contentSha256 !== actual.contentSha256 || canonical(manifest.cases) !== canonical(actual.cases)) errors.push('Frozen case/split/label content changed; create an explicit new corpus version and record exposure before re-freezing.');
  return errors;
}

/** ISO instants may use different offsets; dates and unsupported local clocks stay literal. */
export function fieldEquivalent(field: string, expected: Primitive, actual: Primitive | undefined): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (typeof expected === 'string' && typeof actual === 'string') {
    const instant = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/;
    if (/(?:At|_at)$/.test(field) && instant.test(expected) && instant.test(actual)) return Number.isFinite(Date.parse(expected)) && Date.parse(expected) === Date.parse(actual);
    return expected.trim().replace(/\s+/g, ' ') === actual.trim().replace(/\s+/g, ' ');
  }
  return Object.is(expected, actual);
}
export function wilsonInterval(successes: number, total: number): { low: number; high: number } | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < successes) throw new Error('Invalid binomial counts.');
  if (!total) return null;
  const z = 1.959963984540054, p = successes / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
type Counter = { expected: number; predicted: number; correct: number; missed: number; falsePositive: number };
const counter = (): Counter => ({ expected: 0, predicted: 0, correct: 0, missed: 0, falsePositive: 0 });
const criticalFields = new Set(['title', 'startAt', 'endAt', 'date', 'datePrecision', 'timeZone', 'status', 'doorsAt', 'occursAt', 'occursOn', 'actionType', 'availability', 'eligibility', 'location', 'cost']);

function validatePrediction(prediction: Prediction) {
  if (!['complete', 'partial', 'blocked'].includes(prediction.status) || !Array.isArray(prediction.units) || !Array.isArray(prediction.processedMedia) || !Array.isArray(prediction.issues)) throw new Error('Invalid prediction envelope.');
  if (prediction.costUsd !== undefined && prediction.costUsd !== null && (!Number.isFinite(prediction.costUsd) || prediction.costUsd < 0)) throw new Error('Invalid measured cost.');
  if (prediction.providerRequests !== undefined && (!Number.isInteger(prediction.providerRequests) || prediction.providerRequests < 0)) throw new Error('Invalid provider request count.');
  for (const unit of prediction.units) {
    if (!unit.key || !['event', 'action', 'resource'].includes(unit.kind) || !Array.isArray(unit.evidenceFields) || !unit.evidenceFields.every(field => typeof field === 'string')) throw new Error('Invalid canonical prediction unit.');
    if (!unit.fields || typeof unit.fields !== 'object' || Array.isArray(unit.fields) || Object.values(unit.fields).some(value => value !== null && (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)))) throw new Error('Prediction fields must be finite primitives or null.');
  }
}

export function scoreCase(item: EvaluationCase, prediction: Prediction) {
  validatePrediction(prediction);
  if (item.id !== prediction.caseId) throw new Error('Prediction belongs to another case.');
  const fields = { expected: 0, predicted: 0, labeledPredicted: 0, correct: 0, wrongOrUnsupported: 0, missed: 0, unsupported: 0, unsupportedCritical: 0, nullAbstentions: 0, unscoredPredicted: 0, unscoredMissingEvidence: 0 };
  const unscoredFields: Array<{ key: string; kind: UnitKind; field: string; evidencePresent: boolean }> = [];
  const criticalFieldFailures: Array<{ key: string; kind: UnitKind; field: string; reason: 'missing' | 'incorrect_or_unsupported' }> = [];
  const units = { event: counter(), action: counter(), resource: counter() };
  const unmatched = new Set(prediction.units.map((_, index) => index));
  for (const expected of item.expected.units) {
    units[expected.kind].expected++;
    const index = prediction.units.findIndex((unit, i) => unmatched.has(i) && unit.key === expected.key && unit.kind === expected.kind);
    const actual = index < 0 ? null : prediction.units[index]; if (index >= 0) unmatched.delete(index);
    let criticalCorrect = !!actual;
    for (const [field, truth] of Object.entries(expected.fields)) {
      const value = actual?.fields[field];
      const present = value !== null && value !== undefined;
      const supported = !!actual?.evidenceFields.includes(field);
      const correct = fieldEquivalent(field, truth, value) && (!present || supported);
      if (truth !== null) { fields.expected++; if (!correct) fields.missed++; }
      else if (!present) fields.nullAbstentions++;
      if (expected.criticalFields.includes(field) && !correct) {
        criticalCorrect = false;
        criticalFieldFailures.push({ key: expected.key, kind: expected.kind, field, reason: !present && truth !== null ? 'missing' : 'incorrect_or_unsupported' });
      }
    }
    if (criticalCorrect) units[expected.kind].correct++; else units[expected.kind].missed++;
    if (actual) {
      units[actual.kind].predicted++;
      if (!criticalCorrect) units[actual.kind].falsePositive++;
      for (const [field, value] of Object.entries(actual.fields)) {
        if (value === null) continue;
        fields.predicted++;
        if (!Object.hasOwn(expected.fields, field)) {
          const evidencePresent = actual.evidenceFields.includes(field);
          fields.unscoredPredicted++;
          if (!evidencePresent) fields.unscoredMissingEvidence++;
          unscoredFields.push({ key: actual.key, kind: actual.kind, field, evidencePresent });
          continue;
        }
        fields.labeledPredicted++;
        const truth = expected.fields[field];
        const supported = actual.evidenceFields.includes(field);
        if (truth !== undefined && truth !== null && fieldEquivalent(field, truth, value) && supported) fields.correct++;
        else { fields.wrongOrUnsupported++; if (!supported || truth === undefined || truth === null) fields.unsupported++; if (expected.criticalFields.includes(field) || criticalFields.has(field)) fields.unsupportedCritical++; }
      }
    }
  }
  for (const index of unmatched) {
    const actual = prediction.units[index]; units[actual.kind].predicted++; units[actual.kind].falsePositive++;
    // The expected unit list is complete: an unexpected unit is still an error,
    // even though fields on a matched, partially labeled unit can be unscored.
    for (const [field, value] of Object.entries(actual.fields)) if (value !== null) { fields.predicted++; fields.labeledPredicted++; fields.wrongOrUnsupported++; fields.unsupported++; if (criticalFields.has(field)) fields.unsupportedCritical++; }
  }
  const declared = unique(item.input.declaredMedia);
  const processed = unique(prediction.processedMedia);
  const media = { declared: declared.length, processedDeclared: declared.filter(id => processed.includes(id)).length,
    expectedProcessedMatch: sameSet(item.expected.processedMedia, prediction.processedMedia),
    undeclaredProcessed: processed.filter(id => !declared.includes(id)).length,
    nonVisualProcessed: processed.filter(id => item.input.units.some(unit => unit.id === id && unit.kind === 'text')).length,
    unavailableProcessed: processed.filter(id => item.input.units.some(unit => unit.id === id && unit.status !== 'available')).length };
  const missingIssues = item.expected.issues.filter(issue => !prediction.issues.includes(issue));
  const statusMatch = item.expected.status === prediction.status;
  const negativeCorrect = item.expected.units.length === 0 && prediction.units.length === 0 && statusMatch;
  return { caseId: item.id, split: item.split, labelStatus: item.labelStatus, provenance: item.provenance,
    passed: fields.wrongOrUnsupported === 0 && fields.missed === 0 && fields.unscoredMissingEvidence === 0 && Object.values(units).every(unit => unit.missed === 0 && unit.falsePositive === 0) && statusMatch && media.expectedProcessedMatch && media.undeclaredProcessed === 0 && media.nonVisualProcessed === 0 && media.unavailableProcessed === 0 && missingIssues.length === 0,
    fields, units, media, statusMatch, missingIssues, negative: item.expected.units.length === 0, negativeCorrect,
    unscoredFields, criticalFieldFailures,
    duplicatePredictionKeys: prediction.units.length - new Set(prediction.units.map(unit => unit.kind + ':' + unit.key)).size };
}

function aggregate(scores: Array<ReturnType<typeof scoreCase>>) {
  const fields = { expected: 0, predicted: 0, labeledPredicted: 0, correct: 0, wrongOrUnsupported: 0, missed: 0, unsupported: 0, unsupportedCritical: 0, nullAbstentions: 0, unscoredPredicted: 0, unscoredMissingEvidence: 0 };
  const units = { event: counter(), action: counter(), resource: counter() };
  let mediaDeclared = 0, mediaProcessed = 0;
  for (const score of scores) {
    for (const name of Object.keys(fields) as Array<keyof typeof fields>) fields[name] += score.fields[name];
    for (const kind of ['event', 'action', 'resource'] as const) for (const name of Object.keys(units[kind]) as Array<keyof Counter>) units[kind][name] += score.units[kind][name];
    mediaDeclared += score.media.declared; mediaProcessed += score.media.processedDeclared;
  }
  const recall = (value: Counter) => ({ ...value, recall: value.expected ? value.correct / value.expected : null, recallWilson95: wilsonInterval(value.correct, value.expected) });
  return { cases: scores.length, passedCases: scores.filter(score => score.passed).length,
    fields: { ...fields, precision: fields.labeledPredicted ? fields.correct / fields.labeledPredicted : null, recall: fields.expected ? fields.correct / fields.expected : null,
      precisionScope: 'Explicitly labeled fields and unexpected units only; unscored extra fields are excluded, not declared correct.', predictionLabelCoverage: fields.predicted ? fields.labeledPredicted / fields.predicted : null },
    events: recall(units.event), actions: recall(units.action), resources: recall(units.resource),
    media: { declared: mediaDeclared, processed: mediaProcessed, coverage: mediaDeclared ? mediaProcessed / mediaDeclared : null },
    negatives: { cases: scores.filter(score => score.negative).length, correct: scores.filter(score => score.negativeCorrect).length },
    unscoredFields: scores.flatMap(score => score.unscoredFields.map(field => ({ caseId: score.caseId, ...field }))),
    criticalFieldFailures: scores.flatMap(score => score.criticalFieldFailures.map(field => ({ caseId: score.caseId, ...field }))),
    failures: scores.filter(score => !score.passed).map(score => ({ caseId: score.caseId, fields: score.fields, units: score.units, missingIssues: score.missingIssues, statusMatch: score.statusMatch, media: score.media, criticalFieldFailures: score.criticalFieldFailures })) };
}

export function evaluatePredictions(corpus: EvaluationCorpus, manifest: SplitManifest, predictions: Prediction[], candidateId: string, scope: { splits?: Array<'development' | 'holdout'> } = {}) {
  const errors = validateSplitManifest(corpus, manifest); if (errors.length) throw new Error(errors.join('\n'));
  if (!candidateId.trim()) throw new Error('Candidate identity is required.');
  const splits = scope.splits ?? ['development', 'holdout'];
  if (!splits.length || splits.some(split => !['development', 'holdout'].includes(split))) throw new Error('Invalid evaluation split scope.');
  const selectedCases = corpus.cases.filter(item => splits.includes(item.split));
  const byId = new Map<string, Prediction>();
  for (const prediction of predictions) {
    if (byId.has(prediction.caseId) || !selectedCases.some(item => item.id === prediction.caseId)) throw new Error('Duplicate, unknown or out-of-scope prediction case.');
    byId.set(prediction.caseId, prediction);
  }
  const missing = selectedCases.filter(item => !byId.has(item.id)).map(item => item.id);
  const scores = selectedCases.map(item => scoreCase(item, byId.get(item.id) ?? { caseId: item.id, units: [], processedMedia: [], status: 'blocked', issues: ['prediction_missing'] }));
  const reviewedHoldout = scores.filter(score => score.split === 'holdout' && score.labelStatus !== 'agent_labeled_unreviewed');
  const reviewed = scores.filter(score => score.labelStatus !== 'agent_labeled_unreviewed');
  const human = aggregate(reviewedHoldout), reasons: string[] = [];
  if (!reviewedHoldout.length) reasons.push('No human-reviewed holdout ground truth.');
  if (reviewedHoldout.length < corpus.minimumHumanReviewedHoldout) reasons.push(`Human-reviewed holdout is below the declared ${corpus.minimumHumanReviewedHoldout}-case target.`);
  if (!human.events.expected || !human.actions.expected) reasons.push('Reviewed holdout must include separate event and action units.');
  if (human.events.recall !== null && human.events.recall < corpus.recallTarget || human.actions.recall !== null && human.actions.recall < corpus.recallTarget) reasons.push('Reviewed event/action recall is below the declared target.');
  if (human.fields.unsupportedCritical > 0) reasons.push('Reviewed holdout contains unsupported or incorrect critical fields.');
  if (human.fields.unscoredPredicted > 0) reasons.push('Reviewed holdout does not label all predicted fields; labeled-scope precision does not establish correctness of unscored fields.');
  if (human.events.falsePositive || human.actions.falsePositive || human.negatives.correct < human.negatives.cases) reasons.push('Reviewed holdout contains invented or incorrect event/action units.');
  if (missing.length) reasons.push('One or more case predictions are missing.');
  const knownCosts = predictions.filter(value => typeof value.costUsd === 'number' && Number.isFinite(value.costUsd) && value.costUsd >= 0);
  return { schemaVersion: 1, candidateId, corpusVersion: corpus.corpusVersion, manifestSha256: manifest.contentSha256,
    evaluationScope: { selectedSplits: unique(splits), selectedCases: selectedCases.length, corpusCases: corpus.cases.length, holdoutScored: splits.includes('holdout') },
    unitRecallDefinition: 'Strict labeled critical-field completeness, not title-only event detection. Missing required status or any other critical fact keeps a unit incorrect.',
    benchmarkClass: 'Agent-labeled synthetic regression scoring unless separately marked human-reviewed; not campus-wide recall or live social proof',
    counts: { total: selectedCases.length, corpusTotal: corpus.cases.length, development: scores.filter(score => score.split === 'development').length, holdoutAssigned: scores.filter(score => score.split === 'holdout').length, humanReviewed: reviewed.length, humanReviewedHoldout: reviewedHoldout.length, synthetic: scores.filter(score => score.provenance === 'synthetic').length, missingPredictions: missing },
    development: aggregate(scores.filter(score => score.split === 'development')), holdoutAssigned: aggregate(scores.filter(score => score.split === 'holdout')), humanReviewedHoldout: human,
    allRegressionCases: aggregate(scores), caseScores: scores,
    cost: { knownUsd: knownCosts.reduce((sum, value) => sum + value.costUsd!, 0), measuredCases: knownCosts.length, unmeasuredCases: predictions.length - knownCosts.length, providerRequests: predictions.reduce((sum, value) => sum + (value.providerRequests ?? 0), 0), invoiceOrMonthlyAverageEstablished: false },
    acceptance: { state: !reviewedHoldout.length ? 'not_evaluated' : reasons.length ? 'not_met' : 'meets_scored_thresholds', stage2Accepted: false, reasons, targetVariedHumanLabeledExamples: corpus.targetVariedHumanLabeledExamples,
      limitation: 'Scored thresholds alone do not establish Stage 2 acceptance, holdout non-exposure, real OCR/media handling, model comparison, reconciliation safety or source coverage.' } };
}

export type ReconciliationLabel = { id: string; expected: 'same' | 'separate' | 'review' };
export function scoreReconciliation(labels: ReconciliationLabel[], predictions: Array<{ id: string; result: 'same' | 'separate' | 'review' }>) {
  if (new Set(labels.map(item => item.id)).size !== labels.length || new Set(predictions.map(item => item.id)).size !== predictions.length) throw new Error('Duplicate reconciliation pair ID.');
  const byId = new Map(predictions.map(item => [item.id, item.result]));
  if (predictions.some(item => !labels.some(label => label.id === item.id))) throw new Error('Unknown reconciliation pair ID.');
  return { pairs: labels.length, correct: labels.filter(item => byId.get(item.id) === item.expected).length,
    wrongMerges: labels.filter(item => item.expected !== 'same' && byId.get(item.id) === 'same').map(item => item.id),
    duplicatesRetained: labels.filter(item => item.expected === 'same' && byId.get(item.id) === 'separate').map(item => item.id),
    needsReviewUnresolved: labels.filter(item => item.expected === 'same' && byId.get(item.id) === 'review').map(item => item.id),
    missedPairs: labels.filter(item => !byId.has(item.id)).map(item => item.id),
    fixtureClass: 'Pair labels require independent review before they establish measured merge accuracy' };
}
