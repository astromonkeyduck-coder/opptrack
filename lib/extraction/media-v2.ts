// Versioned worker-only native OCR v2. Two bounded complementary passes; v1 remains frozen.
// Worker-only native OCR. Inputs are private bytes, never URLs or executable source instructions.
import { createHash } from 'node:crypto';
import { execFile, type ExecFileException } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateUpload } from '../intake/validation';
import type { ExtractionUnit, ExtractionWord, MediaAsset } from './media-types';

export type { ExtractionUnit, ExtractionWord, MediaAsset } from './media-types';
export const MEDIA_LIMITS = Object.freeze({ assets: 8, bytes: 4 * 1024 * 1024, units: 12, pixels: 12_000_000, longEdge: 1500, deadlineMs: 120_000, commandMs: 20_000, textBytes: 65_536, processBytes: 1_048_576, manifestPages: 128 });
const ENGINE = 'native-media-v2/tesseract-eng-dual+poppler/sharp-0.35.5';
type NativeCommand = 'tesseract' | 'pdfinfo' | 'pdftotext' | 'pdftoppm';
export type NativeRunOptions = { timeoutMs: number; maxBufferBytes: number; env: Record<string, string> };
export type NativeRunner = (command: NativeCommand, args: string[], options: NativeRunOptions) => Promise<{ stdout: string; stderr: string }>;
/** Dependencies are server/test injection only. Never construct these options from submitted data. */
export type MediaProcessOptions = { run?: NativeRunner; now?: () => number; maxVisualPages?: number };

class MediaFailure extends Error {
  constructor(public issue: string, public blocked = false) { super(issue); }
}

const nativeRunner: NativeRunner = (command, args, options) => new Promise((resolve, reject) => {
  // Next augments ProcessEnv with mandatory NODE_ENV, but these CLI children intentionally receive only the narrow environment below.
  execFile(command, args, { encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: options.maxBufferBytes, killSignal: 'SIGKILL', windowsHide: true, env: options.env as NodeJS.ProcessEnv }, (error: ExecFileException | null, stdout: string, stderr: string) => {
    if (error) {
      const code = (error as NodeJS.ErrnoException).code;
      reject(new MediaFailure(code === 'ENOENT' ? `native_tool_unavailable:${command}` : error.killed ? 'native_process_timed_out' : `native_process_failed:${command}`, code === 'ENOENT'));
    } else resolve({ stdout, stderr });
  });
});

function nativeEnvironment(): Record<string, string> {
  // Native decoders need no Supabase, Google, social, model or delivery credential.
  return { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', OMP_THREAD_LIMIT: '1' };
}
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function cleanText(value: string) { return value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n').trim(); }
function boundedText(value: string) {
  if (Buffer.byteLength(value, 'utf8') > MEDIA_LIMITS.textBytes) throw new MediaFailure('extracted_text_limit_exceeded');
  return cleanText(value);
}

export function parseOcrTsv(value: string, width: number, height: number): { text: string; words: ExtractionWord[] } {
  if (Buffer.byteLength(value) > MEDIA_LIMITS.processBytes) throw new MediaFailure('ocr_output_limit_exceeded');
  const rows = value.replace(/\r\n?/g, '\n').split('\n');
  if (rows.shift()?.trim() !== 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext') throw new MediaFailure('ocr_invalid_response');
  const words: ExtractionWord[] = [], lines: string[] = [];
  let previousLine = '', line: string[] = [];
  for (const row of rows) {
    if (!row.trim()) continue;
    const cells = row.split('\t');
    if (cells.length < 12 || !/^[1-5]$/.test(cells[0]) || cells.slice(1, 6).some(value => !/^\d+$/.test(value))) throw new MediaFailure('ocr_invalid_response');
    if (cells[0] !== '5') continue;
    const text = cleanText(cells.slice(11).join('\t'));
    if (!text) continue;
    if (text.length > 300) throw new MediaFailure('ocr_word_text_limit_exceeded');
    const box = cells.slice(6, 10).map(Number);
    if (box.length !== 4 || box.some(v => !Number.isSafeInteger(v) || v < 0) || box[0] + box[2] > width || box[1] + box[3] > height || !box[2] || !box[3]) throw new MediaFailure('ocr_invalid_word_bounds');
    if (words.length >= 10_000) throw new MediaFailure('ocr_word_limit_exceeded');
    words.push({ text, x: box[0], y: box[1], width: box[2], height: box[3] });
    const key = cells.slice(1, 5).join('/');
    if (previousLine && previousLine !== key) { lines.push(line.join(' ')); line = []; }
    previousLine = key; line.push(text);
  }
  if (line.length) lines.push(line.join(' '));
  return { text: boundedText(lines.join('\n')), words };
}

function normalizeFailure(error: unknown): MediaFailure { return error instanceof MediaFailure ? error : new MediaFailure('media_processing_failed'); }
function failedUnit(asset: MediaAsset, page: number | null, sha256: string, error: unknown, expectedPages?: number, attempted = false): ExtractionUnit {
  const failure = normalizeFailure(error);
  return { assetId: asset.assetId, page, ...(expectedPages === undefined ? {} : { expectedPages }), attempted, sha256, status: failure.blocked ? 'blocked' : 'failed', text: '', method: asset.mimeType === 'application/pdf' ? 'pdf-text-and-ocr' : 'ocr', issues: [failure.issue] };
}

/** All supplied assets/pages have an outcome. complete measures processing, not factual correctness. */
export async function processMediaAssets(assets: MediaAsset[], options: MediaProcessOptions = {}): Promise<{ units: ExtractionUnit[]; complete: boolean; engine: string }> {
  const units: ExtractionUnit[] = [];
  const rejectAll = (issue: string) => ({ units: assets.map(asset => failedUnit(asset, null, digest(asset.bytes), new MediaFailure(issue, true))), complete: false, engine: ENGINE });
  if (assets.length > MEDIA_LIMITS.assets) return rejectAll('asset_limit_exceeded');
  if (assets.reduce((n, asset) => n + asset.bytes.byteLength, 0) > MEDIA_LIMITS.bytes) return rejectAll('combined_asset_bytes_exceeded');
  if (new Set(assets.map(asset => asset.assetId)).size !== assets.length || assets.some(asset => !asset.assetId || asset.assetId.length > 80)) return rejectAll('asset_identity_invalid');
  if (!assets.length) return { units, complete: true, engine: ENGINE };
  const visualBudget = options.maxVisualPages ?? MEDIA_LIMITS.units;
  if (!Number.isSafeInteger(visualBudget) || visualBudget < 0 || visualBudget > MEDIA_LIMITS.units) return rejectAll('media_visual_budget_invalid');
  if (!visualBudget) return rejectAll('media_visual_budget_exhausted');

  const now = options.now || Date.now, endAt = now() + MEDIA_LIMITS.deadlineMs;
  const remaining = () => { const ms = endAt - now(); if (ms <= 0) throw new MediaFailure('media_job_deadline_exceeded', true); return ms; };
  const run = async (command: NativeCommand, args: string[]) => {
    const timeoutMs = Math.max(1, Math.min(MEDIA_LIMITS.commandMs, remaining()));
    try {
      const result = await (options.run || nativeRunner)(command, args, { timeoutMs, maxBufferBytes: MEDIA_LIMITS.processBytes, env: nativeEnvironment() });
      remaining();
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MEDIA_LIMITS.processBytes) throw new MediaFailure('native_output_limit_exceeded');
      return result;
    } catch (error) { throw normalizeFailure(error); }
  };
  const directory = await mkdtemp(join(tmpdir(), 'opptrack-media-'));
  await chmod(directory, 0o700);
  let usedUnits = 0;
  const normalizeImage = async (bytes: Uint8Array) => {
    remaining();
    try {
      const image = sharp(Buffer.from(bytes), { limitInputPixels: MEDIA_LIMITS.pixels, failOn: 'warning', pages: 1 });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MEDIA_LIMITS.pixels) throw new MediaFailure('decoded_pixel_limit_exceeded', true);
      if ((metadata.pages || 1) !== 1) throw new MediaFailure('animated_media_unsupported', true);
      const normalized = await image.rotate().resize({ width: MEDIA_LIMITS.longEdge, height: MEDIA_LIMITS.longEdge, fit: 'inside', withoutEnlargement: false }).png().timeout({ seconds: Math.max(1, Math.min(10, Math.floor(remaining() / 1000))) }).toBuffer({ resolveWithObject: true });
      remaining();
      return normalized;
    } catch (error) {
      if (error instanceof MediaFailure) throw error;
      throw new MediaFailure(error instanceof Error && error.message.includes('pixel limit') ? 'decoded_pixel_limit_exceeded' : 'image_decode_failed', true);
    }
  };
  const ocrImage = async (bytes: Uint8Array, stem: string) => {
    const normalized = await normalizeImage(bytes);
    const imagePath = join(directory, `${stem}.png`);
    const adaptivePath = join(directory, `${stem}-adaptive.png`);
    await writeFile(imagePath, normalized.data, { mode: 0o600 });
    try {
      // Sparse color OCR retains white-on-dark headings and local clocks.
      const sparseOutput = await run('tesseract', [imagePath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', '11', 'tsv']);
      const sparse = parseOcrTsv(sparseOutput.stdout, normalized.info.width, normalized.info.height);
      // Complementary automatic layout + Sauvola finds text on mixed flyer backgrounds.
      // Both images have identical dimensions, so all retained word boxes share coordinates.
      const adaptiveBytes = await sharp(normalized.data).grayscale().normalise().png().toBuffer();
      remaining();
      await writeFile(adaptivePath, adaptiveBytes, { mode: 0o600 });
      const adaptiveOutput = await run('tesseract', [adaptivePath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', '3', '-c', 'thresholding_method=2', 'tsv']);
      const adaptive = parseOcrTsv(adaptiveOutput.stdout, normalized.info.width, normalized.info.height);
      const text = boundedText(`[Visual OCR sparse]\n${sparse.text}\n\n[Visual OCR adaptive]\n${adaptive.text}`);
      const words = [...sparse.words, ...adaptive.words];
      if (words.length > 10_000) throw new MediaFailure('ocr_word_limit_exceeded');
      return { text: sparse.text || adaptive.text ? text : '', words, issues: sparse.text !== adaptive.text ? ['ocr_passes_differ'] : [] };
    } finally {
      await rm(imagePath, { force: true });
      await rm(adaptivePath, { force: true });
    }
  };

  try {
    for (const [index, asset] of assets.entries()) {
      const sha256 = digest(asset.bytes);
      let attempted = false;
      try {
        remaining();
        if (asset.expectedSha256 && (!/^[a-f0-9]{64}$/.test(asset.expectedSha256) || sha256 !== asset.expectedSha256)) throw new MediaFailure('asset_hash_mismatch', true);
        try { validateUpload(asset.bytes, asset.mimeType); } catch { throw new MediaFailure('asset_type_or_size_invalid', true); }
        if (asset.mimeType !== 'application/pdf') {
          if (usedUnits >= visualBudget) throw new MediaFailure('media_unit_limit_exceeded', true);
          usedUnits++;
          attempted = true;
          const result = await ocrImage(asset.bytes, `asset-${index}`);
          units.push({ assetId: asset.assetId, page: null, attempted, sha256, status: 'processed', method: 'ocr', ...result, issues: result.text ? result.issues : ['no_text_detected'] });
          continue;
        }

        const sourcePath = join(directory, `asset-${index}.pdf`);
        await writeFile(sourcePath, asset.bytes, { mode: 0o600 });
        const info = (await run('pdfinfo', [sourcePath])).stdout;
        const pageMatch = /^Pages:\s*(\d+)\s*$/m.exec(info);
        if (!pageMatch || !Number.isSafeInteger(Number(pageMatch[1])) || Number(pageMatch[1]) < 1) throw new MediaFailure('pdf_metadata_invalid');
        const pages = Number(pageMatch[1]);
        // Huge malicious page counts are recorded as a blocked whole asset without allocating unbounded manifests.
        if (pages > MEDIA_LIMITS.manifestPages) throw new MediaFailure(`pdf_page_manifest_limit_exceeded:${pages}`, true);
        const encrypted = /^Encrypted:\s*yes\b/im.test(info), extractionDenied = /copy\s*:\s*no\b/i.test(info);
        if (encrypted || extractionDenied || pages > visualBudget - usedUnits) {
          const issue = encrypted || extractionDenied ? 'pdf_encrypted_or_restricted' : 'media_unit_limit_exceeded';
          for (let page = 1; page <= pages; page++) units.push(failedUnit(asset, page, sha256, new MediaFailure(issue, true), pages));
          continue;
        }
        usedUnits += pages;
        for (let page = 1; page <= pages; page++) {
          let textLayer = '';
          let pageAttempted = false;
          const stem = join(directory, `asset-${index}-page-${page}`);
          try {
            remaining();
            pageAttempted = true;
            textLayer = boundedText((await run('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '-enc', 'UTF-8', sourcePath, '-'])).stdout);
            // Even a PDF with a text layer can contain additional image-only flyer details.
            await writeFile(`${stem}.png`, new Uint8Array(), { mode: 0o600 });
            await run('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', String(MEDIA_LIMITS.longEdge), '-png', sourcePath, stem]);
            const rendered = await stat(`${stem}.png`);
            if (rendered.size > MEDIA_LIMITS.pixels * 4) throw new MediaFailure('rendered_image_bytes_exceeded', true);
            await chmod(`${stem}.png`, 0o600);
            const visual = await ocrImage(await readFile(`${stem}.png`), `asset-${index}-page-${page}-ocr`);
            const issues: string[] = [...visual.issues];
            if (!textLayer) issues.push('pdf_text_layer_empty');
            if (!visual.text) issues.push('no_text_detected');
            if (textLayer && visual.text && textLayer.replace(/\s+/g, ' ') !== visual.text.replace(/\s+/g, ' ')) issues.push('pdf_text_and_visual_differ');
            const text = boundedText(textLayer && visual.text ? `[PDF text layer]\n${textLayer}\n\n[Visual OCR]\n${visual.text}` : textLayer || visual.text);
            units.push({ assetId: asset.assetId, page, expectedPages: pages, attempted: pageAttempted, sha256, status: 'processed', method: 'pdf-text-and-ocr', text, words: visual.words, issues });
          } catch (error) {
            const unit = failedUnit(asset, page, sha256, error, pages, pageAttempted);
            // Keep bounded text evidence if the visual pass failed, but never call the page complete.
            unit.text = textLayer; units.push(unit);
          } finally { await rm(`${stem}.png`, { force: true }); }
        }
      } catch (error) { units.push(failedUnit(asset, null, sha256, error, undefined, attempted)); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  return { units, complete: units.length > 0 && units.every(unit => unit.status === 'processed'), engine: ENGINE };
}

/** Read-only executable-version probe. No input content, tokens or environment values are returned. */
export async function nativeMediaReadiness(options: Pick<MediaProcessOptions, 'run'> = {}) {
  const tools = {} as Record<NativeCommand, { available: boolean; version: string | null }>;
  for (const command of ['tesseract', 'pdfinfo', 'pdftotext', 'pdftoppm'] as const) {
    try {
      const result = await (options.run || nativeRunner)(command, [command === 'tesseract' ? '--version' : '-v'], { timeoutMs: 2000, maxBufferBytes: 8192, env: nativeEnvironment() });
      const version = `${result.stdout}\n${result.stderr}`.split('\n').find(line => line.toLowerCase().includes(command))?.trim().slice(0, 160) || null;
      tools[command] = { available: true, version };
    } catch { tools[command] = { available: false, version: null }; }
  }
  return { engine: ENGINE, tools, ready: Object.values(tools).every(tool => tool.available) };
}
