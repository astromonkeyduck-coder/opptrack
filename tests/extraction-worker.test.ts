import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXTRACTOR_VERSION, validateExtractionResult, type ExtractionResult } from '../lib/extraction/contracts';
import { extractLeasedJob, extractionWorkerClient, runExtractionDispatcher } from '../lib/extraction/worker';
import type { ExtractionUnit, MediaAsset, processMediaAssets } from '../lib/extraction/media';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const lease = '44444444-4444-4444-8444-444444444444';
const target = '55555555-5555-4555-8555-555555555555';
const bytes = Buffer.from('SYNTHETIC private file fixture bytes; not native image input');
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const note = 'Synthetic Campus Film Night\nNovember 12, 2026\n7:00 PM - 9:00 PM Eastern\nLocation: Student Union Cinema';
const environment = { CALENDAR_WRITES_ENABLED: 'false', STAGE2_EXTRACTION_ENABLED: 'true' };
function asset(assetId = '1', extra: Record<string, unknown> = {}) {
  return { assetId, storagePath: `${owner}/manual/${target}/${assetId.padStart(2, '0')}-${hash(bytes)}.png`, mimeType: 'image/png', byteCount: bytes.length, sha256: hash(bytes), ...extra };
}
function job(media: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return { id: jobId, owner_id: owner, lease_token: lease, extractor_version: EXTRACTOR_VERSION, visual_page_budget: 12,
    input_snapshot: { kind: 'manual', targetId: target, note, media, ...overrides } };
}
const processed = (input: MediaAsset, text = note): ExtractionUnit => ({ assetId: input.assetId, page: null, status: 'processed', text, method: 'ocr', sha256: hash(input.bytes), issues: [] });
const mediaSuccess: typeof processMediaAssets = async inputs => ({ engine: 'injected-test-media-v1', units: inputs.map(input => processed(input)), complete: true });

function fixture(leased: unknown[] = [], options: { storage?: (path: string) => Promise<{ data: Blob | null; error: unknown }>; finishError?: boolean; claimError?: boolean } = {}) {
  const downloads: string[] = [], rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [], completions: Array<Record<string, unknown>> = [];
  const client = {
    from: () => { throw new Error('The extractor cannot mutate normalized fact tables'); },
    storage: { from: (bucket: string) => { assert.equal(bucket, 'captures'); return { download: async (path: string) => {
      downloads.push(path); return options.storage ? options.storage(path) : { data: new Blob([bytes]), error: null };
    } }; } },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'extraction_claim') return { data: leased, error: options.claimError ? { code: 'SYNTHETIC' } : null };
      if (name === 'extraction_finish') { completions.push(args); return { data: null, error: options.finishError ? { code: 'SYNTHETIC' } : null }; }
      throw new Error('The extractor cannot execute calendar, delivery or unrelated RPCs');
    },
  } as unknown as SupabaseClient;
  return { client, downloads, rpcCalls, completions };
}

test('disabled extraction and enabled calendar-writing flags stop before any RPC or storage work', async () => {
  const f = fixture([job([asset()])]); let mediaCalls = 0;
  const media: typeof processMediaAssets = async () => { mediaCalls++; throw new Error('Must not execute'); };
  assert.deepEqual(await runExtractionDispatcher(f.client, { enabled: false, environment, media }), { status: 'disabled', jobs: [] });
  await assert.rejects(runExtractionDispatcher(f.client, { enabled: true, environment: { CALENDAR_WRITES_ENABLED: 'true' }, media }), /cannot enable calendar writes/);
  assert.equal(f.rpcCalls.length, 0); assert.equal(f.downloads.length, 0); assert.equal(mediaCalls, 0);
});

test('saved source URLs are retained context and never fetched by an extraction worker', async () => {
  const f = fixture(); const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('No network request is permitted in this test'); };
  try {
    for (const sourceUrl of ['https://calendar.fsu.edu/event/synthetic', 'http://169.254.169.254/latest/meta-data', 'https://example.invalid/?next=http://localhost']) {
      const result = await extractLeasedJob(job([], { note: '', sourceUrl }), f.client, { media: mediaSuccess });
      assert.equal(result.complete, false); assert.ok(result.issues.includes('saved_link_content_not_fetched'));
    }
  } finally { globalThis.fetch = original; }
  assert.equal(requests, 0); assert.equal(f.downloads.length, 0);
});

test('another owner prefix, path traversal and unsupported MIME cannot reach Storage', async () => {
  const f = fixture();
  const result = await extractLeasedJob(job([
    asset('1', { storagePath: `${other}/manual/${target}/01-${hash(bytes)}.png` }),
    asset('2', { storagePath: `${owner}/manual/../../other/file.png` }),
    asset('3', { mimeType: 'text/html' }),
  ]), f.client, { media: mediaSuccess });
  assert.equal(result.complete, false); assert.equal(f.downloads.length, 0);
  assert.deepEqual(result.units.filter(unit => unit.assetId !== 'text').map(unit => [unit.assetId, unit.status, unit.issues[0]]), [['1', 'blocked', 'invalid_private_asset_reference'], ['2', 'blocked', 'invalid_private_asset_reference'], ['3', 'blocked', 'invalid_private_asset_reference']]);
});

test('unavailable, wrong-size and wrong-hash objects retain one explicit blocked manifest entry each', async () => {
  let index = 0;
  const f = fixture([], { storage: async () => {
    index++;
    if (index === 1) return { data: null, error: { code: 'not_found' } };
    if (index === 2) return { data: new Blob(['short']), error: null };
    return { data: new Blob([Buffer.alloc(bytes.length, 120)]), error: null };
  } });
  const result = await extractLeasedJob(job([asset('1'), asset('2'), asset('3')]), f.client, { media: mediaSuccess });
  assert.equal(result.complete, false); assert.equal(result.stats.expectedAssets, 3); assert.equal(result.stats.processedAssets, 0);
  assert.deepEqual(result.units.filter(unit => unit.assetId !== 'text').map(unit => [unit.assetId, unit.issues[0]]), [['1', 'private_asset_unavailable'], ['2', 'private_asset_size_mismatch'], ['3', 'private_asset_hash_mismatch']]);
});

test('valid ordered private files reach the processor with exact hashes and granted page budget', async () => {
  const f = fixture(); let seen = 0;
  const media: typeof processMediaAssets = async (inputs, options) => {
    seen++; assert.deepEqual(inputs.map(input => input.assetId), ['1', '2']);
    assert.ok(inputs.every(input => input.expectedSha256 === hash(bytes) && Buffer.from(input.bytes).equals(bytes)));
    assert.equal(options?.maxVisualPages, 3); return mediaSuccess(inputs, options);
  };
  const value = { ...job([asset('1'), asset('2')]), visual_page_budget: 3 };
  const result = await extractLeasedJob(value, f.client, { media });
  assert.equal(result.complete, true); assert.equal(seen, 1); assert.equal(result.stats.processedPages, 2);
  assert.deepEqual(result.units.map(unit => unit.assetId), ['text', '1', '2']);
  assert.ok(result.candidates.length > 0); assert.deepEqual(validateExtractionResult(result), result);
});

test('zero daily visual budget leaves all expected files blocked without downloading them', async () => {
  const f = fixture(); const value = { ...job([asset('1'), asset('2')]), visual_page_budget: 0 };
  const result = await extractLeasedJob(value, f.client, { media: mediaSuccess });
  assert.equal(f.downloads.length, 0); assert.equal(result.complete, false);
  assert.ok(result.units.filter(unit => unit.assetId !== 'text').every(unit => unit.issues.includes('daily_visual_budget_exhausted')));
});

test('retained Instagram captions remain partial and missing carousel slides never trigger Graph or Storage', async () => {
  const f = fixture(); const original = globalThis.fetch; let network = 0;
  globalThis.fetch = async () => { network++; throw new Error('No Graph request permitted'); };
  try {
    const result = await extractLeasedJob(job([{ assetId: '1', available: false }, { assetId: '2', available: false }], { kind: 'instagram', note: null, caption: note, publishedAt: '2026-11-01T18:00:00Z', childrenComplete: false }), f.client, { media: mediaSuccess });
    assert.equal(result.complete, false); assert.equal(result.units.length, 3); assert.ok(result.candidates.length > 0);
    assert.ok(result.issues.includes('retained_caption_only_media_and_stories_unavailable')); assert.ok(result.issues.includes('source_carousel_manifest_incomplete'));
    assert.ok(result.units.filter(unit => unit.assetId !== 'text').every(unit => unit.status === 'blocked' && unit.issues[0] === 'instagram_media_not_collected'));
  } finally { globalThis.fetch = original; }
  assert.equal(network, 0); assert.equal(f.downloads.length, 0);
});

test('returned native failures preserve attempted asset units for SQL visual-budget charging', async () => {
  const f = fixture([job([asset('1'), asset('2')])]);
  const media: typeof processMediaAssets = async inputs => ({ engine: 'injected-failed-media', complete: false, units: inputs.map(input => ({ ...processed(input, ''), status: 'failed', issues: ['native_process_timed_out'] })) });
  const result = await runExtractionDispatcher(f.client, { environment, media });
  assert.equal(result.jobs[0].state, 'partial'); assert.equal(result.jobs[0].processedPages, 0);
  const stored = f.completions[0].p_result as ExtractionResult;
  assert.equal(stored.units.filter(unit => unit.assetId !== 'text' && unit.status !== 'blocked').length, 2);
  assert.deepEqual(f.rpcCalls.map(call => call.name), ['extraction_claim', 'extraction_finish']);
});

test('a thrown media adapter marks visual work uncertain for full reservation charging', async () => {
  const f = fixture([job([asset('1'), asset('2')])]);
  const result = await runExtractionDispatcher(f.client, { environment, media: async () => { throw new Error('Synthetic crash after native work began'); } });
  assert.equal(result.jobs[0].state, 'failed');
  const stored = f.completions[0].p_result as ExtractionResult;
  assert.equal(stored.units.filter(unit => unit.assetId !== 'text' && unit.status === 'blocked').length, 2);
  assert.equal(stored.stats.visualWorkUncertain, true);
  assert.equal(stored.complete, false);
});

test('a blocked unit after visual processing retains its attempted-work flag for SQL charging', async () => {
  const f = fixture([job([asset()])]);
  const media: typeof processMediaAssets = async inputs => ({ engine: 'injected-deadline-media', complete: false, units: inputs.map(input => ({ ...processed(input, ''), status: 'blocked', attempted: true, issues: ['media_job_deadline_exceeded'] })) });
  const result = await runExtractionDispatcher(f.client, { environment, media });
  assert.equal(result.jobs[0].state, 'partial');
  const stored = f.completions[0].p_result as ExtractionResult;
  assert.equal(stored.units.find(unit => unit.assetId === '1')?.attempted, true);
  assert.equal(stored.stats.processedPages, 0);
});

test('invalid result shapes are quarantined with charged failed units and no unsupported candidates', async () => {
  const f = fixture([job([asset()])]);
  const media: typeof processMediaAssets = async inputs => ({ engine: 'injected-invalid-result', complete: true, units: inputs.map(input => processed(input, `${note}\nEligibility: ${'x'.repeat(4000)}`)) });
  const result = await runExtractionDispatcher(f.client, { environment, media });
  assert.equal(result.jobs[0].state, 'failed');
  const stored = f.completions[0].p_result as ExtractionResult;
  assert.equal(stored.complete, false); assert.equal(stored.candidates.length, 0);
  assert.equal(stored.units.filter(unit => unit.assetId !== 'text' && unit.status === 'failed').length, 1);
  assert.ok(stored.issues.includes('extraction_result_invalid'));
});

test('all candidate claims use exact retained spans and altered quotes fail the result boundary', async () => {
  const f = fixture(); const result = await extractLeasedJob(job([], { note: `Synthetic Film Night 🎬\nNovember 12, 2026\n7:00 PM - 9:00 PM Eastern` }), f.client, { media: mediaSuccess });
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) for (const claim of candidate.claims) for (const span of claim.evidence) {
    const unit = result.units.find(unit => `${unit.assetId}:${unit.page ?? 0}` === span.unitId)!;
    assert.equal(unit.text.slice(span.start, span.end), span.quote);
  }
  const changed = structuredClone(result); changed.candidates[0].claims[0].evidence[0].quote = 'Invented source text';
  assert.throws(() => validateExtractionResult(changed), /not an exact retained text span/);
});

test('claim and completion failures remain infrastructure errors rather than successful empty work', async () => {
  const claimFailed = fixture([], { claimError: true });
  await assert.rejects(runExtractionDispatcher(claimFailed.client, { environment, media: mediaSuccess }), /could not be leased/);
  const finishFailed = fixture([job()], { finishError: true });
  await assert.rejects(runExtractionDispatcher(finishFailed.client, { environment, media: mediaSuccess }), /completion is unconfirmed/);
  assert.deepEqual(await runExtractionDispatcher(fixture().client, { environment, media: mediaSuccess }), { status: 'idle', jobs: [] });
});

test('worker database client pins HTTPS Supabase origin, timeout and non-following redirects', async () => {
  for (const SUPABASE_URL of ['http://project.supabase.co', 'https://127.0.0.1', 'https://user:pass@project.supabase.co', 'https://project.supabase.co/path', 'https://project.supabase.co/?a=b', 'https://project.supabase.co.evil.invalid']) {
    assert.throws(() => extractionWorkerClient({ SUPABASE_URL, SUPABASE_SECRET_KEY: 'synthetic-only-not-a-real-key' }), /origin/);
  }
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++; assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, 'https://project.supabase.co');
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal instanceof AbortSignal); return Response.json([]);
  };
  try {
    const client = extractionWorkerClient({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'synthetic-only-not-a-real-key' });
    const result = await client.rpc('synthetic_local_fetch_intercept'); assert.equal(result.error, null);
  } finally { globalThis.fetch = original; }
  assert.equal(requests, 1);
});
