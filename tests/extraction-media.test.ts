import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { MEDIA_LIMITS, nativeMediaReadiness, parseOcrTsv, processMediaAssets, type NativeRunner } from '../lib/extraction/media';

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
function tsv(text = 'Campus concert') {
  return `${header}\n${text.split(' ').map((word, i) => `5\t1\t1\t1\t1\t${i + 1}\t${i * 40}\t10\t35\t15\t92.1\t${word}`).join('\n')}\n`;
}
const png = () => sharp({ create: { width: 600, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
const pdf = Buffer.from('%PDF-1.4\nSYNTHETIC MOCK PROCESS INPUT; not a valid real PDF');
type Calls = Array<{ command: string; args: string[]; timeout: number; env: Record<string, string> }>;

function processes({ pages = 2, failPage = 0, info = '', ocrText = 'Campus concert' } = {}) {
  const calls: Calls = [];
  const run: NativeRunner = async (command, args, options) => {
    calls.push({ command, args, timeout: options.timeoutMs, env: options.env });
    if (command === 'pdfinfo') return { stdout: info || `Pages: ${pages}\nEncrypted: no\n`, stderr: '' };
    if (command === 'pdftotext') return { stdout: `PDF text on page ${args[1]}`, stderr: '' };
    if (command === 'pdftoppm') { await writeFile(`${args.at(-1)}.png`, await png()); return { stdout: '', stderr: '' }; }
    if (command === 'tesseract') {
      if (failPage && args[0].includes(`-page-${failPage}-`)) throw new Error('Synthetic native failure');
      const meta = await sharp(await readFile(args[0])).metadata();
      assert.ok(meta.width! <= MEDIA_LIMITS.longEdge && meta.height! <= MEDIA_LIMITS.longEdge);
      return { stdout: tsv(ocrText), stderr: '' };
    }
    throw new Error('Unexpected process');
  };
  return { run, calls };
}

test('ordered carousel assets each produce bound original-hash OCR evidence', async () => {
  const bytes = await png(), fixture = processes();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const result = await processMediaAssets([
    { assetId: 'slide-1', mimeType: 'image/png', bytes, expectedSha256: hash },
    { assetId: 'slide-2', mimeType: 'image/png', bytes },
  ], { run: fixture.run });
  assert.equal(result.complete, true);
  assert.deepEqual(result.units.map(unit => [unit.assetId, unit.page, unit.sha256, unit.status]), [['slide-1', null, hash, 'processed'], ['slide-2', null, hash, 'processed']]);
  assert.equal(result.units[0].text, 'Campus concert');
  assert.equal(result.units[1].words?.length, 2);
  assert.equal(fixture.calls.filter(call => call.command === 'tesseract').length, 2);
  const directory = dirname(fixture.calls[0].args[0]);
  await assert.rejects(access(directory));
});

test('all PDF pages receive both text and visual OCR even with nonempty text layers', async () => {
  const fixture = processes({ pages: 3, ocrText: 'Application closes' });
  const result = await processMediaAssets([{ assetId: 'document', mimeType: 'application/pdf', bytes: pdf }], { run: fixture.run });
  assert.equal(result.complete, true);
  assert.deepEqual(result.units.map(unit => unit.page), [1, 2, 3]);
  for (const unit of result.units) {
    assert.equal(unit.expectedPages, 3);
    assert.equal(unit.method, 'pdf-text-and-ocr');
    assert.match(unit.text, /PDF text on page/);
    assert.match(unit.text, /Application closes/);
    assert.ok(unit.issues.includes('pdf_text_and_visual_differ'));
  }
  assert.equal(fixture.calls.filter(call => call.command === 'pdftotext').length, 3);
  assert.equal(fixture.calls.filter(call => call.command === 'pdftoppm').length, 3);
  assert.equal(fixture.calls.filter(call => call.command === 'tesseract').length, 3);
});

test('one failed PDF visual pass leaves that page partial and later pages accounted for', async () => {
  const fixture = processes({ pages: 3, failPage: 2 });
  const result = await processMediaAssets([{ assetId: 'document', mimeType: 'application/pdf', bytes: pdf }], { run: fixture.run });
  assert.equal(result.complete, false);
  assert.deepEqual(result.units.map(unit => [unit.page, unit.status]), [[1, 'processed'], [2, 'failed'], [3, 'processed']]);
  assert.equal(result.units[1].text, 'PDF text on page 2');
  assert.ok(result.units.every(unit => unit.expectedPages === 3));
  assert.deepEqual(result.units[1].issues, ['media_processing_failed']);
});

test('encrypted or copy-restricted PDFs are blocked without password or override attempts', async () => {
  for (const info of ['Pages: 2\nEncrypted: yes (copy:no)\n', 'Pages: 2\nEncrypted: no\ncopy: no\n']) {
    const fixture = processes({ info });
    const result = await processMediaAssets([{ assetId: 'document', mimeType: 'application/pdf', bytes: pdf }], { run: fixture.run });
    assert.equal(result.complete, false);
    assert.deepEqual(result.units.map(unit => [unit.page, unit.status, unit.issues[0]]), [[1, 'blocked', 'pdf_encrypted_or_restricted'], [2, 'blocked', 'pdf_encrypted_or_restricted']]);
    assert.ok(result.units.every(unit => unit.expectedPages === 2));
    assert.deepEqual(fixture.calls.map(call => call.command), ['pdfinfo']);
  }
});

test('page limits account for every bounded known page without running OCR', async () => {
  const fixture = processes({ pages: 13 });
  const result = await processMediaAssets([{ assetId: 'large-document', mimeType: 'application/pdf', bytes: pdf }], { run: fixture.run });
  assert.equal(result.complete, false);
  assert.equal(result.units.length, 13);
  assert.ok(result.units.every(unit => unit.status === 'blocked' && unit.issues[0] === 'media_unit_limit_exceeded'));
  assert.ok(result.units.every(unit => unit.expectedPages === 13));
  assert.deepEqual(fixture.calls.map(call => call.command), ['pdfinfo']);
});

test('a database-granted visual budget can narrow but cannot increase the processing cap', async () => {
  const bytes = await png(), fixture = processes();
  const assets = ['one', 'two', 'three'].map(assetId => ({ assetId, mimeType: 'image/png', bytes }));
  const limited = await processMediaAssets(assets, { run: fixture.run, maxVisualPages: 2 });
  assert.deepEqual(limited.units.map(unit => unit.status), ['processed', 'processed', 'blocked']);
  assert.equal(fixture.calls.length, 2);
  for (const maxVisualPages of [0, -1, 1.5, 13]) {
    const noRun = processes();
    const result = await processMediaAssets(assets, { run: noRun.run, maxVisualPages });
    assert.equal(result.complete, false);
    assert.ok(result.units.every(unit => unit.status === 'blocked'));
    assert.equal(noRun.calls.length, 0);
  }
});

test('extreme or malformed page metadata cannot allocate an unbounded manifest', async () => {
  for (const info of ['Pages: 9999999999\nEncrypted: no\n', 'SYNTHETIC invalid PDF response']) {
    const fixture = processes({ info });
    const result = await processMediaAssets([{ assetId: 'bad-document', mimeType: 'application/pdf', bytes: pdf }], { run: fixture.run });
    assert.equal(result.complete, false);
    assert.equal(result.units.length, 1);
    assert.equal(result.units[0].page, null);
    assert.equal(result.units[0].expectedPages, undefined);
    assert.notEqual(result.units[0].status, 'processed');
    assert.equal(fixture.calls.length, 1);
  }
});

test('content mismatch and mismatched MIME stay visible without native execution', async () => {
  const bytes = await png(), fixture = processes();
  const result = await processMediaAssets([
    { assetId: 'modified-file', mimeType: 'image/png', bytes, expectedSha256: '0'.repeat(64) },
    { assetId: 'wrong-format', mimeType: 'image/jpeg', bytes },
  ], { run: fixture.run });
  assert.equal(result.complete, false);
  assert.deepEqual(result.units.map(unit => unit.issues[0]), ['asset_hash_mismatch', 'asset_type_or_size_invalid']);
  assert.equal(fixture.calls.length, 0);
});

test('asset count, identity and total-byte limits reject the complete submitted set', async () => {
  const bytes = await png(), fixture = processes();
  const sample = { assetId: 'one', bytes, mimeType: 'image/png' };
  const cases = [
    Array.from({ length: 9 }, (_, index) => ({ ...sample, assetId: String(index) })),
    [sample, sample],
    [{ ...sample, bytes: Buffer.alloc(MEDIA_LIMITS.bytes + 1) }],
  ];
  for (const assets of cases) {
    const result = await processMediaAssets(assets, { run: fixture.run });
    assert.equal(result.complete, false);
    assert.equal(result.units.length, assets.length);
    assert.ok(result.units.every(unit => unit.status === 'blocked'));
  }
  assert.equal(fixture.calls.length, 0);
});

test('decoded image dimensions are bounded independently of compressed upload size', async () => {
  const image = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.ok(image.byteLength < MEDIA_LIMITS.bytes);
  const fixture = processes();
  const result = await processMediaAssets([{ assetId: 'pixel-bomb', mimeType: 'image/png', bytes: image }], { run: fixture.run });
  assert.equal(result.complete, false);
  assert.equal(result.units[0].status, 'blocked');
  assert.match(result.units[0].issues[0], /pixel_limit|image_decode/);
  assert.equal(fixture.calls.length, 0);
});

test('source names cannot become shell commands, paths or inherited service credentials', async () => {
  const bytes = await png(), fixture = processes();
  process.env.OPPTRACK_SYNTHETIC_PRIVATE_CREDENTIAL = 'not-a-real-key';
  try {
    const result = await processMediaAssets([{ assetId: 'https://example.invalid/$(touch nope); ../private', mimeType: 'image/png', bytes }], { run: fixture.run });
    assert.equal(result.complete, true);
    for (const call of fixture.calls) {
      assert.ok(call.args.every(value => !value.includes('example.invalid') && !value.includes('touch nope')));
      assert.deepEqual(Object.keys(call.env).sort(), ['LANG', 'LC_ALL', 'OMP_THREAD_LIMIT', 'PATH']);
      assert.equal('OPPTRACK_SYNTHETIC_PRIVATE_CREDENTIAL' in call.env, false);
      assert.ok(call.timeout > 0 && call.timeout <= MEDIA_LIMITS.commandMs);
    }
  } finally { delete process.env.OPPTRACK_SYNTHETIC_PRIVATE_CREDENTIAL; }
});

test('total deadline leaves all remaining known pages explicitly blocked', async () => {
  let current = 0;
  const fixture = processes({ pages: 3 });
  const run: NativeRunner = async (command, args, options) => {
    const result = await fixture.run(command, args, options);
    if (command === 'tesseract') current = MEDIA_LIMITS.deadlineMs + 1;
    return result;
  };
  const result = await processMediaAssets([{ assetId: 'deadline', mimeType: 'application/pdf', bytes: pdf }], { run, now: () => current });
  assert.equal(result.complete, false);
  assert.deepEqual(result.units.map(unit => [unit.page, unit.status]), [[1, 'blocked'], [2, 'blocked'], [3, 'blocked']]);
  assert.ok(result.units.every(unit => unit.issues.includes('media_job_deadline_exceeded')));
  assert.deepEqual(result.units.map(unit => unit.attempted), [true, false, false]);
});

test('blocked outcomes after OCR deadline still charge visual work while untouched assets do not', async () => {
  let current = 0;
  const bytes = await png(), fixture = processes();
  const run: NativeRunner = async (command, args, options) => {
    const result = await fixture.run(command, args, options);
    current = MEDIA_LIMITS.deadlineMs + 1;
    return result;
  };
  const result = await processMediaAssets(['one', 'two'].map(assetId => ({ assetId, mimeType: 'image/png', bytes })), { run, now: () => current });
  assert.equal(result.complete, false);
  assert.deepEqual(result.units.map(unit => [unit.status, unit.attempted]), [['blocked', true], ['blocked', false]]);
  assert.equal(fixture.calls.filter(call => call.command === 'tesseract').length, 1);
  const preflight = await processMediaAssets([{ assetId: 'bad-hash', mimeType: 'image/png', bytes, expectedSha256: '0'.repeat(64) }], { run: fixture.run });
  assert.equal(preflight.units[0].attempted, false);
});

test('OCR output is bounded and validates actual word coordinates', () => {
  assert.deepEqual(parseOcrTsv(`${header}\n`, 100, 100), { text: '', words: [] });
  assert.throws(() => parseOcrTsv('not TSV', 100, 100), /ocr_invalid_response/);
  assert.throws(() => parseOcrTsv(`${header}\nthis-is-not-a-valid-data-row`, 100, 100), /ocr_invalid_response/);
  assert.throws(() => parseOcrTsv(tsv(), 10, 10), /ocr_invalid_word_bounds/);
  assert.throws(() => parseOcrTsv(tsv('x'.repeat(301)), 100, 100), /ocr_word_text_limit_exceeded/);
  assert.throws(() => parseOcrTsv('x'.repeat(MEDIA_LIMITS.processBytes + 1), 100, 100), /ocr_output_limit_exceeded/);
});

test('a successful blank OCR result stays distinct from a missing native process', async () => {
  const bytes = await png();
  const blank = await processMediaAssets([{ assetId: 'blank', mimeType: 'image/png', bytes }], { run: async () => ({ stdout: `${header}\n`, stderr: '' }) });
  assert.equal(blank.complete, true);
  assert.deepEqual(blank.units[0].issues, ['no_text_detected']);
  assert.equal(blank.units[0].text, '');
  const failed = await processMediaAssets([{ assetId: 'missing-ocr', mimeType: 'image/png', bytes }], { run: async () => { throw new Error('Synthetic missing executable'); } });
  assert.equal(failed.complete, false);
  assert.equal(failed.units[0].status, 'failed');
});

test('native readiness reports missing tools without exposing native error content', async () => {
  const result = await nativeMediaReadiness({ run: async (command) => {
    if (command === 'pdfinfo') throw new Error('Synthetic error with local filesystem details');
    return { stdout: `${command} version SYNTHETIC`, stderr: '' };
  } });
  assert.equal(result.ready, false);
  assert.deepEqual(result.tools.pdfinfo, { available: false, version: null });
  assert.equal(JSON.stringify(result).includes('filesystem details'), false);
});
