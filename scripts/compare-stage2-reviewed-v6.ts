/** Unchanged approved development corpora only. No holdout, new labels or services. */
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { performance } from 'node:perf_hooks';
import { evaluationSha256, validateCorpus, type EvaluationCorpus, type Prediction } from '../evaluation/stage2-evaluator';
import { REVIEWED_PREPARATION_VERSION, SOURCE_TRANSFORM_VERSION, reviewedSha256, scoreReviewedScope, validateReviewedPrediction, type PreparedInput } from '../evaluation/stage2-reviewed-contract';
import { extractCandidatesForVersion } from '../lib/extraction/versions';
import type { ExtractionCandidate } from '../lib/extraction/contracts';

if (process.argv.length !== 2) throw new Error('Usage: node --import tsx scripts/compare-stage2-reviewed-v6.ts');
const firstReportPath = 'reports/stage-2-reviewed-development-stage2-rules-v3.json';
const nextReportPath = 'reports/stage-2-next20-reviewed-development.json';
const firstApprovalPath = 'reports/stage-2-first-ten-human-review.json';
const nextApprovalPath = 'reports/stage-2-next25-human-review.json';
const inputHashes = new Map<string, string>();
async function readPinned(file: string, maximum = 8 * 1024 * 1024) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve('.') + path.sep) || /(?:^|[/\\])(?:holdout|acceptance)(?:[/\\]|$)/i.test(file)) throw new Error('Input escaped the approved development paths.');
  if ((await stat(resolved)).size > maximum) throw new Error('A pinned input exceeds the bounded comparison size.');
  const bytes = await readFile(resolved); inputHashes.set(file, reviewedSha256(bytes)); return bytes;
}
const json = async (file: string) => JSON.parse((await readPinned(file)).toString('utf8'));
const firstReport = await json(firstReportPath), nextReport = await json(nextReportPath);
const firstApproval = await json(firstApprovalPath), nextApproval = await json(nextApprovalPath);
const firstReferencesPath = firstReport.privateArtifacts.references as string;
const firstRuntimePath = firstReport.privateArtifacts.runtime as string;
const nextRunPath = nextReport.preservation.privateRun as string;
if (!firstReferencesPath.startsWith('private/stage2-reviewed/development-v3/references-') || !firstRuntimePath.startsWith('private/stage2-reviewed/development-v3/runtime-') || !nextRunPath.startsWith('private/stage2-reviewed/next20-approved-v1/v3-')) throw new Error('Only the established first10/next20 private artifacts are supported.');
const first = await json(firstReferencesPath), firstRuntime = await json(firstRuntimePath), next = await json(nextRunPath);
const firstManifestPath = 'evaluation/stage2-reviewed-development-v3-manifest.json';
const firstManifest = await json(firstManifestPath);
await readPinned('reports/stage-2-reviewed-development-comparison.json');
assert.equal(first.preparationVersion, REVIEWED_PREPARATION_VERSION); assert.equal(first.sourceTransformVersion, SOURCE_TRANSFORM_VERSION);
assert.equal(nextReport.preparationContract, REVIEWED_PREPARATION_VERSION); assert.equal(nextReport.sourceTransform, SOURCE_TRANSFORM_VERSION);
assert.equal(evaluationSha256({ corpus: first.corpus, scopes: first.scopes.map((scope: { notes: unknown }) => scope.notes), version: SOURCE_TRANSFORM_VERSION }), first.referenceHash);
assert.equal(first.referenceHash, firstReport.input.referenceHash);
assert.equal(evaluationSha256({ corpus: next.corpus, scopes: next.scopes.map((scope: { scopeNotes: unknown }) => scope.scopeNotes), preparationVersion: REVIEWED_PREPARATION_VERSION, sourceTransform: SOURCE_TRANSFORM_VERSION }), next.projectionHash);
assert.equal(next.projectionHash, nextReport.projectionHash);
assert.equal(firstRuntime.runtimeSha256, firstReport.runtime.sha256);
assert.equal(firstRuntime.referenceHash, first.referenceHash);

type SavedResult = { prediction: Prediction };
type Group = { name: string; corpus: EvaluationCorpus; inputs: PreparedInput[]; scopes: unknown[]; baseline: SavedResult[]; historical: typeof firstReport };
const groups: Group[] = [
  { name: 'original-first10', corpus: first.corpus, inputs: first.inputs, scopes: first.scopes, baseline: firstRuntime.results, historical: firstReport },
  { name: 'original-next20', corpus: next.corpus, inputs: next.inputs, scopes: next.scopes, baseline: next.results, historical: nextReport },
];
const allIds = new Set<string>(), families = new Set<string>();
for (const [groupIndex, group] of groups.entries()) {
  assert.equal(group.corpus.cases.length, groupIndex ? 20 : 10);
  assert.equal(group.inputs.length, group.corpus.cases.length); assert.equal(group.baseline.length, group.corpus.cases.length);
  const errors = validateCorpus(group.corpus); if (errors.length) throw new Error(errors.join('\n'));
  const approvedIds = new Set((groupIndex ? nextApproval.inventoryExamples : firstApproval.examples).map((reference: { exampleId: string }) => reference.exampleId));
  assert.equal(approvedIds.size, group.corpus.cases.length);
  for (const [index, item] of group.corpus.cases.entries()) {
    assert.equal(item.split, 'development'); assert.equal(item.labelStatus, 'human_reviewed');
    assert.ok(approvedIds.has(item.id)); assert.equal(group.inputs[index].caseId, item.id);
    assert.ok(!allIds.has(item.id) && !families.has(item.familyId)); allIds.add(item.id); families.add(item.familyId);
    if (!groupIndex) {
      const reference = firstManifest.cases.find((reference: { id: string }) => reference.id === item.id);
      assert.ok(reference); assert.equal(evaluationSha256(group.inputs[index]), reference.inputSha256); assert.equal(evaluationSha256(item), reference.projectedCaseSha256);
    }
    for (const unit of group.inputs[index].units) { assert.equal(unit.method, 'provided-text'); assert.equal(unit.sha256, reviewedSha256(unit.text)); }
    for (const reference of group.inputs[index].references) {
      if (!reference.capturePath.startsWith('private/stage2-review/snapshot-861858544d6817c5/captures/')) throw new Error('Unexpected original development capture.');
      assert.equal(reviewedSha256(await readPinned(reference.capturePath)), reference.captureSha256);
    }
  }
}
assert.equal(allIds.size, 30); assert.equal(families.size, 30);
const postingVersusOpeningNotes = groups.flatMap(group => group.inputs.flatMap(input => input.units.flatMap(unit => {
  const match = /[^\r\n]*\b(?:experiences|positions|opportunities)\s+(?:are\s+)?posted\b[^\r\n]*(?:\r?\n[^\r\n]*)?/i.exec(unit.text);
  if (!match) return [];
  const reference = group.corpus.cases.find(item => item.id === input.caseId)!;
  return [{ caseId: input.caseId, unitId: `${unit.assetId}:${unit.page ?? 0}`, sourceTextSha256: reviewedSha256(unit.text), evidence: { start: match.index, end: match.index + match[0].length, quote: unit.text.slice(match.index, match.index + match[0].length) }, oldApplicationOpenReferenceRetained: reference.expected.units.some(item => item.kind === 'action' && item.fields.actionType === 'application_open'), sourceBackedInterpretation: 'A posting/publication date establishes an opportunity-posted notice. It does not establish when applications open, and a program term does not establish the posting-date year. The unchanged application_open reference remains scored as before; it is not silently satisfied by opportunity_posted.' }];
})));

// Pin the runner, repository import graph and complete installed dependency
// package trees, including unused export alternatives. Built-ins are identified
// by Node's exact versions; package manifests/lockfile additionally pin installs.
async function dependencyHashes() {
  const pending = ['scripts/compare-stage2-reviewed-v6.ts', 'lib/extraction/versions.ts', 'evaluation/stage2-reviewed-contract.ts', 'evaluation/stage2-evaluator.ts'];
  const found = new Map<string, string>(), builtins = new Set<string>(), packages = new Set<string>();
  async function packageDirectory(specifier: string, parent: string) {
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    let directory = path.resolve(path.dirname(parent));
    while (directory.startsWith(path.resolve('.'))) {
      const candidate = path.join(directory, 'node_modules', name);
      try { if ((await stat(path.join(candidate, 'package.json'))).isFile()) return candidate; } catch { /* Search installed ancestor dependencies. */ }
      const next = path.dirname(directory); if (next === directory) break; directory = next;
    }
    throw new Error('A runtime dependency package is missing.');
  }
  async function packageFiles(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue; // Each installed nested dependency is visited separately.
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('A dependency symlink requires an explicit pinning policy.');
      if (entry.isDirectory()) await packageFiles(file);
      else if (entry.isFile()) { if (found.size > 15000) throw new Error('Dependency file manifest exceeds its bound.'); found.set(path.relative('.', file), reviewedSha256(await readFile(file))); }
    }
  }
  async function pinPackage(directory: string) {
    if (packages.has(directory)) return; packages.add(directory);
    await packageFiles(directory);
    const manifestFile = path.join(directory, 'package.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies || {})) await pinPackage(await packageDirectory(dependency, manifestFile));
    for (const dependency of Object.keys(manifest.optionalDependencies || {})) {
      try { await pinPackage(await packageDirectory(dependency, manifestFile)); } catch (error) { if ((error as Error).message !== 'A runtime dependency package is missing.') throw error; }
    }
  }
  while (pending.length) {
    const file = pending.pop()!; if (found.has(file)) continue;
    const bytes = await readFile(file); found.set(file, reviewedSha256(bytes));
    if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(file)) continue;
    const imports = [...bytes.toString('utf8').matchAll(/\b(?:import|export)\s+[^;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/g)].map(match => match[1] || match[2]);
    for (const specifier of imports) {
      if (isBuiltin(specifier)) { builtins.add(specifier); continue; }
      if (!specifier.startsWith('.')) { await pinPackage(await packageDirectory(specifier, file)); continue; }
      const base = path.resolve(path.dirname(file), specifier);
      const candidates = [base, base + '.ts', base + '.tsx', base + '.mjs', base + '.js', base + '.json', path.join(base, 'index.ts'), path.join(base, 'index.js')];
      let selected: string | undefined;
      for (const candidate of candidates) { try { if ((await stat(candidate)).isFile()) { selected = candidate; break; } } catch { /* Try local extension resolution. */ } }
      if (!selected) throw new Error('Could not pin a local static dependency.');
      const relative = path.relative('.', selected);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('A dependency escaped the project installation.');
      pending.push(relative);
    }
  }
  for (const file of ['package.json', 'package-lock.json']) found.set(file, reviewedSha256(await readFile(file)));
  return { strategy: 'Repository static import closure plus complete installed dependency-package file trees and recursive runtime dependencies, including unused ESM/CJS/type alternatives; no vendor export-resolution assumptions.', files: [...found].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })), dependencyPackages: [...packages].map(directory => path.relative('.', directory)).sort(), builtins: [...builtins].sort(), node: process.version, versions: process.versions };
}
const runtime = await dependencyHashes();
assert.equal(runtime.files.find(file => file.file === 'lib/extraction/text.ts')?.sha256, firstReport.runtime.sha256);
assert.equal(runtime.files.find(file => file.file === 'lib/extraction/text.ts')?.sha256, nextReport.runtime.sha256);

type Version = 'stage2-rules-v3' | 'stage2-rules-v6';
type Result = { group: string; caseId: string; version: Version; prediction: Prediction; candidates: ExtractionCandidate[]; error: string | null; elapsedMs: number; score: ReturnType<typeof scoreReviewedScope> };
const results: Result[] = [];
for (const group of groups) for (const [index, item] of group.corpus.cases.entries()) {
  const input = group.inputs[index];
  for (const version of ['stage2-rules-v3', 'stage2-rules-v6'] as const) {
    const started = performance.now(); let candidates: ExtractionCandidate[] = [], prediction: Prediction, error: string | null = null;
    try { candidates = extractCandidatesForVersion(version, input.units, { publishedAt: input.publishedAt, timeZone: input.timeZone }); prediction = validateReviewedPrediction(input, candidates); }
    catch (failure) { error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 250); prediction = { caseId: item.id, units: [], processedMedia: [], status: 'blocked', issues: ['runtime_validation_failed'], providerRequests: 0, costUsd: 0 }; }
    if (version === 'stage2-rules-v3') assert.equal(evaluationSha256(prediction), evaluationSha256(group.baseline[index].prediction), 'Fresh v3 must exactly reproduce the saved baseline predictions.');
    results.push({ group: group.name, caseId: item.id, version, candidates, prediction, error, elapsedMs: performance.now() - started, score: scoreReviewedScope(item, prediction) });
  }
}
function measurements(selected: Result[]) {
  const fields = { expected: 0, correct: 0, missed: 0, labeledPredicted: 0, wrongOrUnsupported: 0, totalPredictedNonnullFields: 0, unscoredMatchedFields: 0, unscoredExtraUnitFields: 0 };
  const units = { event: { expected: 0, complete: 0, missed: 0 }, action: { expected: 0, complete: 0, missed: 0 } };
  const failures: Record<string, { missing: number; incorrectOrUnsupported: number }> = {};
  const unscored: Record<string, number> = {};
  for (const result of selected) {
    const score = result.score;
    for (const field of ['expected', 'correct', 'missed', 'labeledPredicted', 'wrongOrUnsupported'] as const) fields[field] += score.fields[field];
    fields.totalPredictedNonnullFields += score.totalPredictedNonnullFields; fields.unscoredMatchedFields += score.fields.unscoredPredicted;
    fields.unscoredExtraUnitFields += score.extraPredictedUnitsUnscored.reduce((sum, item) => sum + item.nonnullFields.length, 0);
    for (const kind of ['event', 'action'] as const) { units[kind].expected += score.units[kind].expected; units[kind].complete += score.units[kind].correct; units[kind].missed += score.units[kind].missed; }
    for (const failure of score.criticalFieldFailures) { const key = `${failure.kind}:${failure.field}`; failures[key] ||= { missing: 0, incorrectOrUnsupported: 0 }; failures[key][failure.reason === 'missing' ? 'missing' : 'incorrectOrUnsupported']++; }
    for (const field of score.unscoredFields) { const key = `${field.kind}:${field.field}`; unscored[key] = (unscored[key] || 0) + 1; }
  }
  return { cases: selected.length, fields: { ...fields, unscoredTotal: fields.unscoredMatchedFields + fields.unscoredExtraUnitFields, labeledScopePrecision: fields.labeledPredicted ? fields.correct / fields.labeledPredicted : null, scopedFactRecovery: fields.expected ? fields.correct / fields.expected : null, predictionLabelCoverage: fields.totalPredictedNonnullFields ? fields.labeledPredicted / fields.totalPredictedNonnullFields : null }, strictScopedUnits: units, casesAllScopedFactsMatch: selected.filter(item => item.score.passed).length, extraPredictedUnitsUnscored: selected.reduce((sum, item) => sum + item.score.extraPredictedUnitsUnscored.length, 0), validationFailures: selected.filter(item => item.error).map(item => ({ caseId: item.caseId, error: item.error })), elapsedMs: selected.reduce((sum, item) => sum + item.elapsedMs, 0), criticalMissClasses: Object.fromEntries(Object.entries(failures).sort(([a], [b]) => a.localeCompare(b))), unscoredMatchedFieldClasses: Object.fromEntries(Object.entries(unscored).sort(([a], [b]) => a.localeCompare(b))) };
}
const perGroup = groups.map(group => ({ group: group.name, versions: (['stage2-rules-v3', 'stage2-rules-v6'] as const).map(version => ({ version, measurements: measurements(results.filter(result => result.group === group.name && result.version === version)) })) }));
for (const group of groups) {
  const actual = measurements(results.filter(result => result.group === group.name && result.version === 'stage2-rules-v3'));
  const original = group.historical.scopedMeasurements;
  for (const field of ['expected', 'correct', 'missed', 'labeledPredicted', 'wrongOrUnsupported', 'unscoredTotal']) assert.equal(actual.fields[field as keyof typeof actual.fields], original.fields[field]);
}
assert.equal(evaluationSha256(await dependencyHashes()), evaluationSha256(runtime), 'A runtime/dependency changed during evaluation.');
for (const [file, expected] of inputHashes) assert.equal(reviewedSha256(await readFile(file)), expected, 'An original artifact changed during evaluation.');

const recordedAt = new Date().toISOString(), directory = 'private/stage2-reviewed/v6-same-contract-comparison';
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
const runFile = `${directory}/run-${recordedAt.replace(/[:.]/g, '-')}.json`;
const privateRecord = { recordedAt, runtime, inputFiles: [...inputHashes].map(([file, sha256]) => ({ file, sha256 })), postingVersusOpeningNotes, groups: groups.map(group => ({ name: group.name, corpus: group.corpus, inputs: group.inputs, scopes: group.scopes })), results };
const privateBytes = JSON.stringify(privateRecord, null, 2) + '\n';
await writeFile(runFile, privateBytes, { flag: 'wx', mode: 0o600 }); await chmod(runFile, 0o600);
const combined = (['stage2-rules-v3', 'stage2-rules-v6'] as const).map(version => ({ version, measurements: measurements(results.filter(result => result.version === version)) }));
const report = { schemaVersion: 1, recordedAt, command: 'node --import tsx scripts/compare-stage2-reviewed-v6.ts', evidenceClass: 'Same frozen 30 single-owner-reviewed development inputs/corpora and unchanged source/scoring contract; independent fresh v3/v6 predictions, not acceptance or a holdout.', status: 'development_quality_diagnostic_not_stage2_acceptance', preparationContract: REVIEWED_PREPARATION_VERSION, sourceTransform: SOURCE_TRANSFORM_VERSION, input: { first10ReferenceHash: first.referenceHash, next20ProjectionHash: next.projectionHash, cases: 30, distinctFrozenFamilies: families.size, sourceTextUnits: groups.reduce((sum, group) => sum + group.inputs.reduce((count, input) => count + input.units.length, 0), 0), allDevelopment: true, holdoutReadOrScored: false, pendingAdjudicationsApplied: false }, preservation: { originalInputReferenceReportFiles: [...inputHashes].map(([file, sha256]) => ({ file, sha256 })), originalFilesUnchanged: true, freshV3PredictionsExactlyMatchSavedBaselines: true, priorReportedV3FieldCountsReproduced: true }, runtime, perGroup, combined, sourceBackedCanonicalDisputes: { postingVersusOpeningNotes, referenceChanged: false, pendingHumanAdjudicationApplied: false }, privateRun: { path: runFile, sha256: reviewedSha256(privateBytes), permissions: '0600, parent0700', containsFullPredictionsAndCorpora: true }, boundaries: { modelCalls: 0, httpRequests: 0, databaseCalls: 0, calendarCalls: 0, newHumanApprovals: 0, paidUpgrades: 0 }, costs: { apiCostUsd: 0, localCpuCostMeasured: false }, limitations: ['Frozen inherited scheduled-status/IANA-timezone/venue projections remain scored exactly as before; known canonical disputes were not removed or relabeled.', 'Publication visibility is not event status. No scheduled state, missing year, civil timezone or duration is invented to satisfy a reference.', 'Strict scoped completion requires all old critical fields. It is not title-only detection recall or a campus coverage estimate.', 'Unmatched units and unlabeled fields remain explicitly unscored; labeled-scope precision does not establish full factual accuracy.', 'These30 examples are development data sharing source captures and provisional family groupings. They do not establish independent organizer diversity, an untouched human holdout, real reconciliation accuracy or production-media quality.', 'Raw inputs, full predictions and failure details remain private. The separate native-media comparison uses its own fixed protocol.'], stage2Accepted: false, independentHoldoutAccepted: false, completeFactualAccuracyEstablished: false };
const reportFile = 'reports/stage-2-reviewed-v6-same-contract-comparison.json';
try { const old = await readFile(reportFile); await writeFile(`reports/stage-2-reviewed-v6-comparison-history-${reviewedSha256(old).slice(0, 16)}.json`, old, { flag: 'wx' }); } catch (error) { if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: reportFile, versions: combined.map(result => ({ version: result.version, ...result.measurements })), allOldArtifactsPreserved: true, holdoutRead: false, modelCalls: 0 }));
process.exitCode = results.filter(result => result.version === 'stage2-rules-v6').every(result => result.score.passed) ? 0 : 1;
