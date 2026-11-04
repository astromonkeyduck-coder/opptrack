import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { processMediaAssets, type NativeRunner, MEDIA_LIMITS } from '../lib/extraction/media-v2';
const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const tsv = (text: string) => `${header}\n5\t1\t1\t1\t1\t1\t10\t10\t90\t30\t95\t${text}\n`;
const image = () => sharp({ create: { width: 250, height: 200, channels: 3, background: '#fff' } }).png().toBuffer();
test('complementary passes retain distinct evidence, common bounded coordinates, original identity and a stripped environment', async () => {
  const bytes = await image(), paths: string[] = [];
  const run: NativeRunner = async (command, args, options) => {
    assert.equal(command, 'tesseract'); paths.push(args[0]);
    assert.deepEqual(Object.keys(options.env).sort(), ['LANG','LC_ALL','OMP_THREAD_LIMIT','PATH']);
    const metadata = await sharp(await readFile(args[0])).metadata();
    assert.equal(metadata.width, 1500); assert.equal(metadata.height, 1200);
    assert.ok(options.timeoutMs <= MEDIA_LIMITS.commandMs);
    const adaptive = args.includes('thresholding_method=2');
    assert.equal(args[args.indexOf('--psm') + 1], adaptive ? '3' : '11');
    return { stdout: tsv(adaptive ? 'Recovered heading' : 'June 18'), stderr: '' };
  };
  const result = await processMediaAssets([{ assetId: 'slide', mimeType: 'image/png', bytes }], { run });
  assert.equal(result.complete, true); assert.equal(paths.length, 2);
  assert.equal(result.units[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(result.units[0].text, /\[Visual OCR sparse\]\nJune 18[\s\S]*\[Visual OCR adaptive\]\nRecovered heading/);
  assert.deepEqual(result.units[0].issues, ['ocr_passes_differ']);
  assert.equal(result.units[0].words?.length, 2); assert.match(result.engine, /^native-media-v2\//);
  await assert.rejects(access(dirname(paths[0])));
});
test('a failed complementary pass never presents the page as complete', async () => {
  let calls = 0;
  const run: NativeRunner = async () => { if (++calls === 2) throw new Error('test decoder failure'); return { stdout: tsv('Visible words'), stderr: '' }; };
  const result = await processMediaAssets([{ assetId: 'slide', mimeType: 'image/png', bytes: await image() }], { run });
  assert.equal(result.complete, false); assert.equal(result.units[0].status, 'failed'); assert.equal(result.units[0].attempted, true);
});
test('PDF pages retain text plus both visual passes and attempt only the SQL-granted page count', async () => {
  let calls = 0;
  const run: NativeRunner = async (command, args) => {
    if (command === 'pdfinfo') return { stdout: 'Pages: 2\nEncrypted: no\n', stderr: '' };
    if (command === 'pdftotext') return { stdout: `Text layer ${args[1]}`, stderr: '' };
    if (command === 'pdftoppm') { await writeFile(`${args.at(-1)}.png`, await image()); return { stdout: '', stderr: '' }; }
    calls++; return { stdout: tsv('Visible text'), stderr: '' };
  };
  const assets = [{ assetId: 'pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4\nTEST ONLY') }];
  const blocked = await processMediaAssets(assets, { run, maxVisualPages: 1 });
  assert.equal(calls, 0); assert.ok(blocked.units.every(u => u.status === 'blocked'));
  const result = await processMediaAssets(assets, { run, maxVisualPages: 2 });
  assert.equal(calls, 4); assert.equal(result.complete, true); assert.deepEqual(result.units.map(u => u.page), [1,2]);
  assert.ok(result.units.every(u => u.expectedPages === 2 && u.text.includes('[PDF text layer]') && u.text.includes('[Visual OCR adaptive]')));
});
test('hash and unsupported content failures prevent any new native work', async () => {
  let calls = 0; const run: NativeRunner = async () => { calls++; throw new Error('must not execute'); };
  const result = await processMediaAssets([{ assetId: 'slide', mimeType: 'image/png', bytes: await image(), expectedSha256: '0'.repeat(64) }], { run });
  assert.equal(calls, 0); assert.equal(result.complete, false); assert.equal(result.units[0].issues[0], 'asset_hash_mismatch');
});
