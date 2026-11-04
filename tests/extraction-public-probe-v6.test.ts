import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { publicPdfProbeV6 } from '../lib/extraction/public-probe-v6';
import { PUBLIC_PDF_SOURCE } from '../lib/extraction/public-probe';
const original = Buffer.from('%PDF-synthetic public response');
const sha256 = createHash('sha256').update(original).digest('hex');
test('v6 public diagnostic keeps fixed-source/network bounds and returns no source contents or facts', async () => {
  let requests = 0;
  const result = await publicPdfProbeV6({ fetch: async (url, options) => {
    requests++; assert.equal(String(url), PUBLIC_PDF_SOURCE); assert.equal(options?.redirect, 'manual');
    return new Response(original, { headers: { 'content-type': 'application/pdf' } });
  }, readiness: async () => ({ engine: 'synthetic-native2', ready: true, tools: { tesseract: { available: true, version: 'synthetic' }, pdfinfo: { available: true, version: 'synthetic' }, pdftotext: { available: true, version: 'synthetic' }, pdftoppm: { available: true, version: 'synthetic' } } }), media: async (assets, options) => {
    assert.equal(options?.maxVisualPages, 6); assert.equal(assets.length, 1); assert.equal(assets[0].expectedSha256, sha256);
    return { engine: 'synthetic-native2', complete: true, units: [{ assetId: assets[0].assetId, sha256, page: 1, expectedPages: 1, status: 'processed', attempted: true, method: 'pdf-text-and-ocr', text: '[Visual OCR sparse]\nSynthetic Club Lecture\nJune 18, 2027\n7 PM–8 PM\n[Visual OCR adaptive]\nSynthetic Club Lecture\nJune 18, 2027\n7 PM–8 PM', issues: [] }] };
  } });
  assert.equal(requests, 1); assert.equal(result.supabaseCalls, 0); assert.equal(result.privateJobsClaimed, 0); assert.equal(result.calendarCalls, 0); assert.equal(result.modelCalls, 0);
  assert.equal(result.extraction?.processorHeadingTitles, 0); assert.equal(result.extraction?.evidenceValidated, true);
  assert.equal(result.sourceContentsReturned, false); assert.equal(result.semanticAccuracyEstablished, false);
  assert.ok(!JSON.stringify(result).includes('Synthetic Club Lecture'));
});
test('public diagnostic does not replace failed collection with an empty semantic success', async () => {
  let mediaCalls = 0;
  await assert.rejects(publicPdfProbeV6({ fetch: async () => new Response('Unavailable', { status: 503 }), media: async () => { mediaCalls++; throw Error('unreachable'); } }), /fetch failed/);
  assert.equal(mediaCalls, 0);
});
