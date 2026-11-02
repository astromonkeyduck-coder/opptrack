/** Development-only transcript diagnostic. No OCR, network, database or calendar authority. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractCandidates } from '../lib/extraction/text';
import { extractionUnitId, type ExtractionCandidate } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';
import { evaluatePredictions, validateSplitManifest, type CanonicalUnit, type EvaluationCase, type EvaluationCorpus, type Prediction, type SplitManifest } from './stage2-evaluator';

export const BASELINE_ADAPTER_VERSION = 'stage2-evaluation-adapter-v2';

/** Fixed schema alias independent of expected labels. Values stay literal. */
function canonicalField(field: string) { return field === 'price' ? 'cost' : field; }

/** Field-value and exact retained-span checks used by the runtime validator. */
export function canonicalizeBaselineCandidates(units: ExtractionUnit[], candidates: ExtractionCandidate[]): CanonicalUnit[] {
  const sources = new Map<string, ExtractionUnit>();
  for (const unit of units) {
    const id = extractionUnitId(unit);
    if (sources.has(id)) throw new Error('Duplicate extraction source unit.');
    sources.set(id, unit);
  }
  return candidates.map(candidate => {
    const evidenceFields = new Set<string>();
    for (const claim of candidate.claims) {
      if (!Object.hasOwn(candidate.fields, claim.field) || !Object.is(candidate.fields[claim.field], claim.value)) throw new Error('Claim differs from its field.');
      if (!claim.evidence.length) throw new Error('Claim lacks source evidence.');
      for (const span of claim.evidence) {
        const source = sources.get(span.unitId);
        if (!source || source.status !== 'processed' || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > source.text.length || !span.quote || source.text.slice(span.start, span.end) !== span.quote) throw new Error('Extraction evidence is not an exact retained text span.');
      }
      evidenceFields.add(canonicalField(claim.field));
    }
    const fields: CanonicalUnit['fields'] = {};
    for (const [field, value] of Object.entries(candidate.fields)) {
      const canonical = canonicalField(field);
      if (Object.hasOwn(fields, canonical)) throw new Error('Conflicting canonical field aliases.');
      if (value !== null && !candidate.claims.some(claim => claim.field === field)) throw new Error('A non-null field lacks evidence.');
      fields[canonical] = value;
    }
    return { key: candidate.key, kind: candidate.kind, fields, evidenceFields: [...evidenceFields] };
  });
}

/** Accept only input/context, so expected labels cannot influence the prediction. */
export function predictStage2Baseline(caseId: string, input: EvaluationCase['input']): Prediction {
  const units: ExtractionUnit[] = input.units.map(unit => ({
    assetId: unit.id, page: unit.kind === 'pdf_page' ? unit.index + 1 : null,
    status: unit.status === 'available' ? 'processed' : 'blocked', method: 'provided-text', text: unit.text || '',
    sha256: unit.status === 'available' ? createHash('sha256').update(unit.text || '').digest('hex') : null,
    issues: unit.status === 'available' ? [] : ['input_unavailable'],
  }));
  const candidates = extractCandidates(units, { publishedAt: input.publishedAt, timeZone: input.timeZone });
  // Captions are not media. These supplied transcript IDs do not prove OCR.
  const processedMedia = input.units.filter(unit => unit.kind !== 'text' && unit.status === 'available').map(unit => unit.id);
  const missingDeclared = input.declaredMedia.filter(id => !processedMedia.includes(id));
  const complete = missingDeclared.length === 0 && input.units.every(unit => unit.status === 'available');
  return {
    caseId, units: canonicalizeBaselineCandidates(units, candidates), processedMedia,
    status: complete ? 'complete' : input.units.some(unit => unit.status === 'available') ? 'partial' : 'blocked',
    issues: [...new Set([...units.flatMap(unit => unit.issues), ...candidates.flatMap(candidate => candidate.issues), ...(missingDeclared.length ? ['declared_media_unavailable'] : [])])],
    providerRequests: 0, costUsd: 0,
  };
}

async function main() {
  const corpus = JSON.parse(await readFile('evaluation/stage2-cases.json', 'utf8')) as EvaluationCorpus;
  const manifest = JSON.parse(await readFile('evaluation/stage2-split-manifest.json', 'utf8')) as SplitManifest;
  const errors = validateSplitManifest(corpus, manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  const predictions = corpus.cases.filter(item => item.split === 'development').map(item => predictStage2Baseline(item.id, item.input));
  await mkdir('private/stage2-evaluation', { recursive: true, mode: 0o700 });
  await writeFile('private/stage2-evaluation/rules-development-predictions.json', JSON.stringify({ candidateId: 'stage2-rules-v1', adapterVersion: BASELINE_ADAPTER_VERSION, predictions }, null, 2) + '\n', { mode: 0o600 });
  const report = evaluatePredictions(corpus, manifest, predictions, 'stage2-rules-v1', { splits: ['development'] });
  const initialReportPath = 'reports/stage-2-rules-diagnostic-initial.json';
  const initialSha256 = createHash('sha256').update(await readFile(initialReportPath)).digest('hex');
  const result = {
    ...report, recordedAt: new Date().toISOString(), adapterVersion: BASELINE_ADAPTER_VERSION,
    executionClass: 'Development synthetic supplied text transcripts only; not real OCR or human-reviewed extraction accuracy',
    methodology: {
      initialReport: { path: initialReportPath, sha256: initialSha256, notice: 'Original diagnostic preserved byte-for-byte. It mixed a visual-media adapter error with penalties for fields absent from partial gold; its synthetic holdout was exposed by the original run.' },
      changes: ['Development cases only; assigned holdout answers not scored or diagnosed in this rerun.', 'Only nontext units can be processedMedia.', 'Canonical field alias price→cost is fixed without consulting answers; literal values remain unchanged.', 'Every evidence flag requires a matching runtime field value and exact retained source quote/offsets.', 'Matched-unit fields absent from partial labels are unscored, separately counted and never called correct. Explicit null labels and unexpected units remain penalized.', 'No scheduled status is inferred. Strict critical-field unit recall still fails when required status or other facts are missing.'],
      remainingLimits: ['Source quotes require human semantic review.', 'Synthetic required scheduled-status labels are unreviewed and require adjudication; strict failure is not zero event detection and does not justify inventing status.', 'Issue-code vocabularies and extraction-versus-reconciliation boundaries remain unresolved; missing required flags are still failures.', 'The zero cost measurement is provider charges only: no provider requests occurred; local CPU cost was not measured.', 'No model comparison, human-reviewed holdout, original-media accuracy or production extraction acceptance was established.'],
    },
    modelOrPromptComparisonRun: false, realMediaProbe: 'reports/stage-2-native-media-supplied-probe.json',
  };
  await writeFile('reports/stage-2-rules-diagnostic.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ candidateId: report.candidateId, adapterVersion: BASELINE_ADAPTER_VERSION, cases: predictions.length, passedCases: report.development.passedCases, report: 'reports/stage-2-rules-diagnostic.json', humanReviewedAcceptance: report.acceptance.state, providerRequests: 0 }));
  process.exitCode = report.development.passedCases === report.development.cases ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
