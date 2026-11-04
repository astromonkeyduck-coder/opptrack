import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { extractCandidates } from '../lib/extraction/text-v5';
import { validateExtractionResult } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';
function run(text: string, method: ExtractionUnit['method'] = 'ocr') {
  const unit: ExtractionUnit = { assetId: 'synthetic-slide', page: method === 'pdf-text-and-ocr' ? 1 : null, status: 'processed', text, method, sha256: createHash('sha256').update(text).digest('hex'), issues: [] };
  const before = JSON.stringify(unit), candidates = extractCandidates([unit]);
  validateExtractionResult({ version: 'stage2-result-v1', units: [unit], candidates, issues: [], complete: true, stats: { processedAssets: 1, expectedAssets: 1, processedPages: 1, engine: 'synthetic-native2-text', elapsedMs: 0 } });
  assert.equal(JSON.stringify(unit), before);
  for (const candidate of candidates) for (const claim of candidate.claims) for (const span of claim.evidence) assert.equal(span.quote, text.slice(span.start, span.end));
  return candidates;
}
const flyer = 'Community Film Night\nNovember 12, 2026\n7 PM–9 PM\nLocation: Student Union Cinema\nApplication deadline: November 10, 2026';
test('native2 sparse/adaptive processor titles are replaced with original-source title evidence', () => {
  const candidates = run(`[Visual OCR sparse]\n${flyer}\n\n[Visual OCR adaptive]\n${flyer}`);
  assert.equal(candidates.filter(candidate => candidate.kind === 'event').length, 1);
  assert.ok(candidates.length > 1);
  assert.ok(candidates.every(candidate => candidate.fields.title === 'Community Film Night'));
  assert.ok(candidates.every(candidate => candidate.claims.find(claim => claim.field === 'title')!.evidence.every(span => span.quote === 'Community Film Night')));
});
test('an empty first pass never promotes the adaptive processor label', () => {
  const candidate = run(`[Visual OCR sparse]\n\n[Visual OCR adaptive]\n${flyer}`).find(candidate => candidate.kind === 'event')!;
  assert.equal(candidate.fields.title, 'Community Film Night');
});
test('PDF text-layer and OCR views preserve literal title and original offsets', () => {
  const candidate = run(`[PDF text layer]\r\n${flyer}\r\n[Visual OCR]\r\n[Visual OCR sparse]\r\n${flyer}\r\n[Visual OCR adaptive]\r\n${flyer}`, 'pdf-text-and-ocr').find(candidate => candidate.kind === 'event')!;
  assert.equal(candidate.fields.title, 'Community Film Night');
});
test('header-bearing structured-looking passes are one observation, never duplicate performances', () => {
  const text = 'Title: Campus Concert\nStart: 2027-07-10T19:00:00-04:00\nEnd: 2027-07-10T21:00:00-04:00';
  const candidates = run(`[Visual OCR sparse]\n${text}\n[Visual OCR adaptive]\n${text}`);
  assert.equal(candidates.filter(candidate => candidate.kind === 'event').length, 1);
  assert.ok(!candidates.some(candidate => String(candidate.fields.title).includes('Visual OCR')));
});
test('title repair does not remove contradictory clocks across OCR passes', () => {
  const candidate = run('[Visual OCR sparse]\nCampus Concert\nNovember 18, 2027\n7 PM–9 PM EST\n[Visual OCR adaptive]\nCampus Concert\nNovember 18, 2027\n8 PM–10 PM EST').find(candidate => candidate.kind === 'event')!;
  assert.equal(candidate.fields.title, 'Campus Concert'); assert.equal(candidate.fields.startAt, null); assert.equal(candidate.fields.endAt, null);
  assert.ok(candidate.issues.includes('conflicting_media_clocks_require_review'));
});
test('ordinary negative photo remains empty with processor labels', () => {
  assert.equal(run('[Visual OCR sparse]\nBoat at the dock\nPhoto by Alex\n[Visual OCR adaptive]\nBoat at the dock\nPhoto by Alex').length, 0);
});
