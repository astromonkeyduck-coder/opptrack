/** Credential-free native OCR probe. No URL fetch, database, model or calendar call. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import sharp from 'sharp';
import { nativeMediaReadiness, processMediaAssets, type MediaAsset } from '../lib/extraction/media';

const files = process.argv.slice(2);
if (files.includes('--help')) {
  console.log('node --import tsx scripts/probe-stage2-media.ts [--file=private/capture.png] [--file=private/document.pdf]');
  console.log('No files: create two clearly synthetic PNG slides and OCR both. Supplied files: read local bytes only. Full OCR stays private; report contains hashes/counts/status only.');
  process.exit(0);
}
if (files.some(arg => !arg.startsWith('--file=') || !arg.slice(7))) throw new Error('Use --file=local-path or --help');
const folder = resolve('private/stage2-native-media');
await mkdir(folder, { recursive: true, mode: 0o700 });
const inputs: MediaAsset[] = [];
const synthetic = !files.length;
if (synthetic) {
  const slides = [
    ['SYNTHETIC OCR TEST - SLIDE ONE', 'Campus Film Night', 'November 12, 2026', '7:00 PM - 9:00 PM Eastern', 'Student Union Cinema'],
    ['SYNTHETIC OCR TEST - SLIDE TWO', 'Applications close November 10, 2026', 'Deadline time not announced', 'Eligibility: FSU students', 'Tickets available while supplies last'],
  ];
  for (const [index, lines] of slides.entries()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><rect width="1400" height="900" fill="white"/>${lines.map((line, lineIndex) => `<text x="70" y="${130 + lineIndex * 130}" font-size="48" font-family="sans-serif" fill="black">${line}</text>`).join('')}</svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFile(`${folder}/slide-${index + 1}.png`, bytes, { mode: 0o600 });
    inputs.push({ assetId: `synthetic-slide-${index + 1}`, bytes, mimeType: 'image/png' });
  }
} else {
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };
  for (const [index, flag] of files.entries()) {
    const file = resolve(flag.slice(7)), mimeType = types[extname(file).toLowerCase()];
    if (!mimeType) throw new Error('Only PNG, JPEG, WebP and PDF local inputs are supported');
    const bytes = await readFile(file);
    inputs.push({ assetId: `supplied-asset-${index + 1}`, bytes, mimeType, expectedSha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
const readiness = await nativeMediaReadiness();
const start = Date.now();
const result = await processMediaAssets(inputs);
const elapsedMs = Date.now() - start;
const runId = randomUUID();
const privateResult = `private/stage2-native-media/ocr-result-${synthetic ? 'synthetic' : 'supplied'}-${runId}.json`;
await writeFile(privateResult, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const joined = result.units.map(unit => unit.text).join('\n').toLowerCase();
const expected = synthetic ? ['campus film night', 'november 12, 2026', '7:00 pm', 'student union cinema', 'applications close november 10, 2026', 'eligibility: fsu students'] : [];
const syntheticExpected = expected.map(text => ({ text, matched: joined.includes(text) }));
const report = {
  recordedAt: new Date().toISOString(),
  runId,
  command: 'node --import tsx scripts/probe-stage2-media.ts' + (synthetic ? '' : ' --file=<local input>...'),
  evidenceClass: synthetic ? 'Actual local native OCR of two generated synthetic image slides' : 'Actual local native processing of caller-supplied bytes; provenance/classification must be established separately',
  readiness, engine: result.engine, complete: result.complete, elapsedMs,
  assets: inputs.map(asset => ({ assetId: asset.assetId, mimeType: asset.mimeType, byteCount: asset.bytes.byteLength, sha256: createHash('sha256').update(asset.bytes).digest('hex') })),
  units: result.units.map(({ assetId, page, expectedPages, attempted, status, method, sha256, issues, text, words }) => ({ assetId, page, ...(expectedPages === undefined ? {} : { expectedPages }), ...(attempted === undefined ? {} : { attempted }), status, method, sha256, issues, textCharacters: text.length, wordBoxes: words?.length || 0 })),
  syntheticExpected,
  privateResult,
  providerCalls: 0, modelCalls: 0, databaseCalls: 0, calendarCalls: 0, credentialFilesRead: 0, paidServices: 0,
  limitations: ['OCR execution is not semantic field accuracy or a human-reviewed benchmark.', 'No Trigger Cloud execution or production Storage path is proven by this local probe.', 'All supplied PDF pages get text and visual passes only within declared bounds; rejected/partial units remain visible.'],
};
const reportPath = synthetic ? 'reports/stage-2-native-media-synthetic-probe.json' : 'reports/stage-2-native-media-supplied-probe.json';
let history: unknown[] = [];
try {
  const previous = JSON.parse(await readFile(reportPath, 'utf8'));
  history = previous.attemptHistory || [{ recordedAt: previous.recordedAt, readiness: previous.readiness, complete: previous.complete, elapsedMs: previous.elapsedMs, privateResult: previous.privateResult }];
} catch { /* First report. */ }
await writeFile(reportPath, JSON.stringify({ ...report, attemptHistory: [...history, { recordedAt: report.recordedAt, runId, readiness, complete: result.complete, elapsedMs, privateResult }] }, null, 2) + '\n');
console.log(JSON.stringify({ ready: readiness.ready, complete: result.complete, assets: inputs.length, units: result.units.length, elapsedMs, syntheticExpected }, null, 2));
process.exitCode = !readiness.ready ? 2 : !result.complete || syntheticExpected.some(item => !item.matched) ? 1 : 0;
