/** Read only frozen, specifically approved public examples; no network/provider/database calls. */
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { EXTRACTOR_VERSION, SUPPORTED_EXTRACTOR_VERSIONS } from '../lib/extraction/contracts';
import { evaluationSha256, validateCorpus, type EvaluationCorpus } from '../evaluation/stage2-evaluator';
import { prepareReviewedReference, reviewedSha256, REVIEWED_PREPARATION_VERSION, scoreReviewedScope, SOURCE_TRANSFORM_VERSION, validateReviewedPrediction, type ApprovedReference, type ReviewedExample } from '../evaluation/stage2-reviewed-contract';

const approvalFile = 'reports/stage-2-first-ten-human-review.json';
const argumentsList = process.argv.slice(2);
if (argumentsList.length > 1 || argumentsList.some(argument => !argument.startsWith('--extractor='))) throw new Error('Use only an optional --extractor=stage2-rules-v1 or --extractor=stage2-rules-v2.');
const extractorVersion = argumentsList[0]?.slice('--extractor='.length) ?? EXTRACTOR_VERSION;
if (!(SUPPORTED_EXTRACTOR_VERSIONS as readonly string[]).includes(extractorVersion)) throw new Error('Unsupported extractor version.');
type ApprovalReport = { reviewId: string; confirmationRecordedAt: string; exactReviewTimeKnown: boolean; snapshotId: string; frozenInventorySha256: string; privateReviewOverlay: string; privateReviewOverlaySha256: string; examples: ApprovedReference[] };
const approvalBytes = await readFile(approvalFile), approval = JSON.parse(approvalBytes.toString('utf8')) as ApprovalReport;
const snapshot = `private/stage2-review/snapshot-${approval.snapshotId.slice(0,16)}`;
function snapshotPath(file: string) {
  const resolved = path.resolve(file), allowed = path.resolve(snapshot) + path.sep;
  if (!resolved.startsWith(allowed)) throw new Error('A review reference escaped its exact frozen snapshot.');
  return resolved;
}
async function boundedRead(file: string, maxBytes: number) {
  if ((await stat(file)).size > maxBytes) throw new Error('A frozen file exceeds its bounded preparation limit.');
  return readFile(file);
}
if (approval.examples.length !== 10 || new Set(approval.examples.map(item => item.exampleId)).size !== 10) throw new Error('Only the approved first ten are authorized.');
const inventoryBytes = await boundedRead(`${snapshot}/inventory.json`, 2 * 1024 * 1024);
if (reviewedSha256(inventoryBytes) !== approval.frozenInventorySha256) throw new Error('Frozen inventory hash differs from the approval.');
const inventory = JSON.parse(inventoryBytes.toString('utf8')) as { humanReviewPacket: { exampleIds: string[] } };
if (JSON.stringify(inventory.humanReviewPacket.exampleIds) !== JSON.stringify(approval.examples.map(item => item.exampleId))) throw new Error('Approval does not match the exact first-ten packet.');
const overlayBytes = await boundedRead(snapshotPath(approval.privateReviewOverlay), 2 * 1024 * 1024);
if (reviewedSha256(overlayBytes) !== approval.privateReviewOverlaySha256) throw new Error('Private review overlay hash mismatch.');
const overlay = JSON.parse(overlayBytes.toString('utf8')) as ApprovalReport;
if (evaluationSha256(overlay.examples) !== evaluationSha256(approval.examples) || overlay.reviewId !== approval.reviewId) throw new Error('Public/private approval scope differs.');

const captureHashes = new Map<string, string>(), prepared: Array<ReturnType<typeof prepareReviewedReference>> = [];
for (const reference of approval.examples) {
  const bytes = await boundedRead(snapshotPath(reference.examplePath), 2 * 1024 * 1024);
  if (reviewedSha256(bytes) !== reference.exampleContentSha256) throw new Error('An approved frozen example changed.');
  const example = JSON.parse(bytes.toString('utf8')) as ReviewedExample;
  const labels = example.members.map(member => ({ sourceId: member.sourceId, silverLabels: member.silverLabels }));
  if (evaluationSha256(labels) !== reference.originalLabelsSha256) throw new Error('Approved original labels changed.');
  for (const member of example.members) for (const evidence of member.evidence) {
    const capture = snapshotPath(evidence.capturePath);
    let hash = captureHashes.get(capture);
    if (!hash) { const body = await boundedRead(capture, 5 * 1024 * 1024); hash = reviewedSha256(body); captureHashes.set(capture, hash); }
    if (hash !== evidence.bodySha256) throw new Error('Original public capture hash mismatch.');
  }
  prepared.push(prepareReviewedReference(example, reference, approval.confirmationRecordedAt));
}
if (new Set(prepared.map(item => item.item.familyId)).size !== 10) throw new Error('The exact ten approved family assignments must be retained.');
const corpus: EvaluationCorpus = { schemaVersion: 1, corpusVersion: REVIEWED_PREPARATION_VERSION,
  provenanceNotice: 'Ten owner-approved real public-source development references projected onto a partial canonical scope. Source JSON/ICS/HTML are converted to retained text; no OCR or untouched holdout.',
  targetVariedHumanLabeledExamples: 100, recallTarget: 0.95, minimumHumanReviewedHoldout: 40, cases: prepared.map(item => item.item) };
const corpusErrors = validateCorpus(corpus); if (corpusErrors.length) throw new Error(corpusErrors.join('\n'));
const referenceHash = evaluationSha256({ corpus, scopes: prepared.map(item => item.scopeNotes), version: SOURCE_TRANSFORM_VERSION });
const runtimeFile = extractorVersion === 'stage2-rules-v1' ? 'lib/extraction/text-v1.ts' : 'lib/extraction/text.ts';
const registryFile = 'lib/extraction/versions.ts';
const runtimeSha256 = reviewedSha256(await readFile(runtimeFile)), registrySha256 = reviewedSha256(await readFile(registryFile));
const { extractCandidatesForVersion } = await import('../lib/extraction/versions');
const results = prepared.map(item => {
  const started = performance.now();
  // Source input is the only input to extraction. Expected labels are not passed.
  const candidates = extractCandidatesForVersion(extractorVersion, item.input.units, { publishedAt: item.input.publishedAt, timeZone: item.input.timeZone });
  const elapsedMs = performance.now() - started, prediction = validateReviewedPrediction(item.input, candidates);
  return { prediction, candidates, elapsedMs, score: scoreReviewedScope(item.item, prediction) };
});
if (reviewedSha256(await readFile(runtimeFile)) !== runtimeSha256 || reviewedSha256(await readFile(registryFile)) !== registrySha256) throw new Error('Runtime/registry changed during the diagnostic; rerun against one exact version.');
const fields = { expected: 0, correct: 0, missed: 0, labeledPredicted: 0, wrongOrUnsupported: 0, unscoredMatchedFields: 0, totalPredictedNonnullFields: 0, unscoredExtraUnitFields: 0 };
const units = { event: { expected: 0, correct: 0, missed: 0 }, action: { expected: 0, correct: 0, missed: 0 } };
for (const result of results) {
  const score = result.score;
  for (const field of ['expected','correct','missed','labeledPredicted','wrongOrUnsupported'] as const) fields[field] += score.fields[field];
  fields.unscoredMatchedFields += score.fields.unscoredPredicted;
  fields.totalPredictedNonnullFields += score.totalPredictedNonnullFields;
  fields.unscoredExtraUnitFields += score.extraPredictedUnitsUnscored.reduce((sum, unit) => sum + unit.nonnullFields.length, 0);
  for (const kind of ['event','action'] as const) for (const field of ['expected','correct','missed'] as const) units[kind][field] += score.units[kind][field];
}
const preparationRevision = REVIEWED_PREPARATION_VERSION.split('-').at(-1)!;
const privateDirectory = `private/stage2-reviewed/development-${preparationRevision}`;
for (const directory of ['private/stage2-reviewed', privateDirectory]) { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
async function frozenWrite(file: string, value: unknown) {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  try { await writeFile(file, serialized, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await readFile(file, 'utf8')) !== serialized) throw new Error('A frozen development artifact changed; preserve it under a new content identity.'); }
  await chmod(file, 0o600);
}
const referencesFile = `${privateDirectory}/references-${referenceHash.slice(0,16)}.json`;
await frozenWrite(referencesFile, { schemaVersion: 1, preparationVersion: REVIEWED_PREPARATION_VERSION, sourceTransformVersion: SOURCE_TRANSFORM_VERSION, reviewId: approval.reviewId, referenceHash, corpus, scopes: prepared.map(item => ({ caseId: item.item.id, unitSetExhaustive: false, notes: item.scopeNotes })), inputs: prepared.map(item => item.input) });
const runtimeFileOutput = `${privateDirectory}/runtime-${runtimeSha256.slice(0,16)}-${referenceHash.slice(0,16)}.json`;
// Timings are run telemetry, so keep each diagnostic run separately.
const recordedAt = new Date().toISOString();
const runtimeRecord = { recordedAt, extractorVersion, runtimeSha256, registrySha256, referenceHash, results };
const runtimeRunFile = runtimeFileOutput.replace(/\.json$/, `-${recordedAt.replace(/[:.]/g,'-')}.json`);
await frozenWrite(runtimeRunFile, runtimeRecord);
const countByField = (notes: Array<{ field: string }>) => Object.fromEntries([...new Set(notes.map(note => note.field))].sort().map(field => [field, notes.filter(note => note.field === field).length]));
const unscoredTotal = fields.unscoredMatchedFields + fields.unscoredExtraUnitFields;
const report = { schemaVersion: 1, recordedAt, preparationVersion: REVIEWED_PREPARATION_VERSION, sourceTransformVersion: SOURCE_TRANSFORM_VERSION,
  status: 'real_owner_reviewed_development_partial_scope_diagnostic_not_acceptance',
  review: { file: approvalFile, sha256: reviewedSha256(approvalBytes), reviewId: approval.reviewId, confirmationRecordedAt: approval.confirmationRecordedAt, exactReviewTimeKnown: approval.exactReviewTimeKnown, method: 'explicit_batch_chat_confirmation', adjudicated: false },
  input: { approvedFamilies: prepared.length, sourceMembers: prepared.reduce((sum,item) => sum + new Set(item.input.references.map(reference => reference.memberIndex)).size, 0), retainedDerivedTextUnits: prepared.reduce((sum,item) => sum + item.input.units.length, 0), frozenCapturesVerified: captureHashes.size, formats: [...new Set(prepared.flatMap(item => item.input.references.map(reference => reference.contentType)))].sort(), sourceSnapshot: approval.snapshotId, referenceHash, allDevelopment: true, holdoutReadOrScored: false, originalFrozenArtifactsChanged: false },
  runtime: { extractorVersion, file: runtimeFile, sha256: runtimeSha256, registryFile, registrySha256, independentSourceOnlyPrediction: true, quoteSpansValidated: true, validatedClaims: results.reduce((sum,item) => sum + item.candidates.reduce((n,candidate) => n + candidate.claims.length,0),0), validatedSpans: results.reduce((sum,item) => sum + item.candidates.reduce((n,candidate) => n + candidate.claims.reduce((s,claim) => s + claim.evidence.length,0),0),0), elapsedMs: results.reduce((sum,item) => sum + item.elapsedMs, 0), originalMediaOrOcrRun: false },
  scopedMeasurements: { fields: { ...fields, unscoredTotal, labeledScopePrecision: fields.labeledPredicted ? fields.correct / fields.labeledPredicted : null, labeledFactRecovery: fields.expected ? fields.correct / fields.expected : null, predictionLabelCoverage: fields.totalPredictedNonnullFields ? fields.labeledPredicted / fields.totalPredictedNonnullFields : null },
    criticalUnitCompleteness: units, casesWithAllScoredFactsMatching: results.filter(item => item.score.passed).length, cases: results.length,
    extraPredictedUnitsUnscored: results.reduce((sum,item) => sum + item.score.extraPredictedUnitsUnscored.length,0),
    notice: 'Partial canonical reference scope only. Entity sets and null abstention boundaries were not exhaustively reviewed. Extra predictions are listed as unscored; complete precision, detection recall and full-case accuracy are not established.' },
  needsReview: { count: prepared.reduce((sum,item) => sum + item.scopeNotes.length,0), fields: countByField(prepared.flatMap(item => item.scopeNotes)), sourceConflicts: prepared.flatMap(item => item.scopeNotes.filter(note => /conflict|clock differs/i.test(note.reason)).map(note => ({ caseId:item.item.id,...note }))), exhaustiveEntityAndNullBoundaryReviewPending: true },
  cases: results.map((item,index) => ({ caseId: item.score.caseId, familyId: prepared[index].item.familyId, primarySource: approval.examples[index].primarySource, scopedFields: prepared[index].item.expected.units.map(unit => ({ key: unit.key, kind: unit.kind, fields: Object.keys(unit.fields) })), score: item.score, scopeNotes: prepared[index].scopeNotes })),
  privateArtifacts: { references: referencesFile, runtime: runtimeRunFile, fileMode: '0600', directoryMode: '0700' },
  costsAndCalls: { providerRequests: 0, modelRequests: 0, modelCostUsd: 0, localCpuCostUsd: null, httpRequests: 0, databaseCalls: 0, calendarCalls: 0, paidServices: 0 },
  limitations: ['Single-owner batch-approved inherited parser facts, not independent adjudication or a representative holdout.', 'Canonical field projection and original-source-to-text transforms are new engineering contracts and have not received a separate human review.', 'Exact claims cite retained derived text. HTML is DOM text, JSON uses fixed literal content fields, ICS retains literal compact dates; none is OCR or a production official-adapter benchmark.', 'Null/unknown facts are explicitly unscored pending canonical abstention labeling; no scheduled status, timezone, duration or date was invented for scoring.', 'Literal venue aliases can differ without establishing a factual error; those differences require semantic adjudication.', 'Source conflicts, program/resource mapping, visible ticket-link semantics and exhaustive entity sets remain review work.', 'Matching keys use original source units, actual predicted kind/action type and source-local ordinal. Missing opens cannot shift a detected deadline onto the wrong reference. Reconciliation of repeated detail/listing text is not extraction field scoring.', 'The preserved initial preparation-v1 report used global ordinal keys and could compare a deadline with an application-open reference. It is a scoring-association artifact; preparation-v2 fixed that association, and preparation-v3 also excludes start-derived precision when start time conflicts. Contract changes are not extraction-quality improvements.', 'No comparison to the synthetic diagnostic establishes quality improvement; no model/prompt comparison or holdout acceptance occurred.'],
  stage2Accepted: false, completeRuntimeAccuracyEstablished: false, independentHoldoutAccepted: false };
await mkdir('reports', { recursive: true });
const versionReportPath = `reports/stage-2-reviewed-development-${extractorVersion}.json`;
try {
  const previousBytes = await readFile(versionReportPath), previous = JSON.parse(previousBytes.toString('utf8')) as { preparationVersion?: string };
  if (previous.preparationVersion && previous.preparationVersion !== REVIEWED_PREPARATION_VERSION && /^stage2-reviewed-development-v\d+$/.test(previous.preparationVersion)) {
    const revision = previous.preparationVersion.split('-').at(-1);
    try { await writeFile(`reports/stage-2-reviewed-development-${revision}-${extractorVersion}.json`, previousBytes, { flag:'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await writeFile('reports/stage-2-reviewed-development.json', JSON.stringify(report, null, 2) + '\n');
await writeFile(versionReportPath, JSON.stringify(report, null, 2) + '\n');
await writeFile(`reports/stage-2-reviewed-development-${preparationRevision}-${extractorVersion}.json`, JSON.stringify(report, null, 2) + '\n');
try { await writeFile('reports/stage-2-reviewed-development-initial.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
const manifest = { schemaVersion:1, preparationVersion:REVIEWED_PREPARATION_VERSION, referenceHash, reviewId:approval.reviewId, reviewReportSha256:reviewedSha256(approvalBytes), split:'development_only_not_holdout', cases:prepared.map((item,index)=>({ id:item.item.id, familyId:item.item.familyId, originalExampleSha256:approval.examples[index].exampleContentSha256, originalLabelsSha256:approval.examples[index].originalLabelsSha256, inputSha256:evaluationSha256(item.input), projectedCaseSha256:evaluationSha256(item.item), canonicalScopeReviewPending:true })) };
await frozenWrite(`evaluation/stage2-reviewed-development-${preparationRevision}-manifest.json`, manifest);
try {
  const files = ['reports/stage-2-reviewed-development-stage2-rules-v1.json','reports/stage-2-reviewed-development-stage2-rules-v2.json'];
  const bytes = await Promise.all(files.map(file => readFile(file)));
  const [before,after] = bytes.map(value => JSON.parse(value.toString('utf8')) as typeof report);
  const comparable = before.preparationVersion === after.preparationVersion && before.input.referenceHash === after.input.referenceHash && before.sourceTransformVersion === after.sourceTransformVersion && before.review.sha256 === after.review.sha256;
  if (comparable) {
    const comparison = { schemaVersion:1, recordedAt, status:'same_contract_deterministic_development_comparison_not_acceptance', preparationVersion:before.preparationVersion, sourceTransformVersion:before.sourceTransformVersion, referenceHash:before.input.referenceHash,
      reviewedFamilies:10, allDevelopment:true, holdoutReadOrScored:false,
      versions:[before,after].map((value,index)=>({ extractorVersion:value.runtime.extractorVersion, report:files[index], reportSha256:reviewedSha256(bytes[index]), runtime:value.runtime, measurements:value.scopedMeasurements })),
      interpretation:'The runtime implementations differ on the same frozen source-input and partial reference scope. These are development canonical-agreement results, not representative full factual accuracy or a model/prompt comparison. Contract-v1/v2 association/scope artifacts are excluded from this comparison.',
      remaining:['Human adjudication of canonical null boundaries, venue aliases, entity completeness and conflicting source facts.','Ninety real units and independent holdout remain unreviewed; real image/carousel/negative variety is missing.','Compact ICS support, unknown-year action context and explicit scheduled-status semantics remain incomplete.'],
      modelOrPromptComparisonRun:false, providerCalls:0, modelCostUsd:0, localCpuCostUsd:null, stage2Accepted:false, completeAccuracyEstablished:false };
    await writeFile('reports/stage-2-reviewed-development-comparison.json',JSON.stringify(comparison,null,2)+'\n');
  }
} catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
console.log(JSON.stringify({ extractorVersion, cases:report.input.approvedFamilies, scoredCorrect:fields.correct, labeledPredicted:fields.labeledPredicted, totalPredicted:fields.totalPredictedNonnullFields, unscored:unscoredTotal, recovered:fields.correct, expected:fields.expected, criticalUnits:units, scopedMatchingCases:report.scopedMeasurements.casesWithAllScoredFactsMatching, completeAccuracyEstablished:false, modelCalls:0, report:`reports/stage-2-reviewed-development-${extractorVersion}.json` }));
// Successful preparation is distinct from passing the scored development facts.
process.exitCode = results.every(item => item.score.passed) ? 0 : 1;
