/** Replay previously retained synthetic-slide native output, never holdout data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractCandidatesForVersion } from '../lib/extraction/versions';
import { validateExtractionResult } from '../lib/extraction/contracts';
const units = JSON.parse(readFileSync('private/stage2-v4-native-units-for-v5-replay.json', 'utf8'));
const before = JSON.stringify(units);
const previous = extractCandidatesForVersion('stage2-rules-v5', units);
const current = extractCandidatesForVersion('stage2-rules-v6', units);
validateExtractionResult({ version: 'stage2-result-v1', units, candidates: current, complete: true, issues: [], stats: { expectedAssets: 2, processedAssets: 2, processedPages: 2, elapsedMs: 0, engine: 'actual-cloud-native2-text/local-v6-replay' } });
if (before !== JSON.stringify(units)) throw Error('Original native units changed');
const report = {
  recordedAt: new Date().toISOString(),
  evidenceClass: 'Local v6 replay on exact retained native2 units from hosted v4 synthetic-slide job. Real native output, synthetic contents; no hosted private-v6 execution or human accuracy claim.',
  hostedOriginalJob: '5aab53bd-b30c-4999-9093-2cc931ba6bd3',
  originalUnitsSha256: createHash('sha256').update(before).digest('hex'),
  oldVersion: 'stage2-rules-v5', newVersion: 'stage2-rules-v6',
  oldCandidates: previous.length, newCandidates: current.length,
  oldTitles: previous.map(candidate => candidate.fields.title), newTitles: current.map(candidate => candidate.fields.title),
  newProcessorHeadingTitles: current.filter(candidate => /^\[(?:PDF text layer|Visual OCR)/.test(String(candidate.fields.title))).length,
  originalUnitsUnchanged: true, evidenceValidationPassed: true,
  modelCalls: 0, networkCalls: 0, calendarCalls: 0, stage2Accepted: false,
};
writeFileSync('reports/stage-2-v6-actual-native-unit-replay.json', JSON.stringify(report, null, 2) + '\n');
writeFileSync('private/stage2-v6-actual-native-unit-replay-result.json', JSON.stringify({ units, candidates: current }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ oldCandidates: previous.length, newCandidates: current.length, processorHeadingTitles: report.newProcessorHeadingTitles, evidenceValidated: true }));
