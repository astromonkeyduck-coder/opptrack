/** Actual native OCR + actual migrated PostgreSQL + production worker; local Storage bodies are a labeled substitute. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { EXTRACTOR_VERSION, validateExtractionResult, type ExtractionResult } from '../lib/extraction/contracts';
import { nativeMediaReadiness } from '../lib/extraction/media';
import { extractLeasedJob, runExtractionDispatcher } from '../lib/extraction/worker';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
const startedAt = new Date().toISOString(), startedMs = Date.now();
const objects = new Map<string, Buffer>(), downloads: string[] = [];
const rpcCalls: string[] = [], checks: string[] = [], jobEvidence: Array<Record<string, unknown>> = [];
const failureBudgetProof: Array<Record<string, unknown>> = [];
const environment = { STAGE2_EXTRACTION_ENABLED: 'true', CALENDAR_WRITES_ENABLED: 'false' };
const q = async (sql: string, parameters: unknown[] = []) => (await db.query(sql, parameters)).rows as Record<string, unknown>[];
const scalar = async (sql: string, parameters: unknown[] = []) => Object.values((await q(sql, parameters))[0])[0];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function role<T>(name: 'authenticated' | 'service_role', id: string | null, action: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${name}`); await q("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  try { return await action(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
const own = <T>(action: () => Promise<T>) => role('authenticated', owner, action);
const service = <T>(action: () => Promise<T>) => role('service_role', null, action);
async function check(name: string, action: () => Promise<void>) { await action(); checks.push(name); console.log('PASS ' + name); }

const client = {
  from: () => { throw new Error('This proof forbids worker access to normalized fact tables'); },
  storage: { from: (bucket: string) => {
    assert.equal(bucket, 'captures');
    return { download: async (path: string) => { downloads.push(path); const bytes = objects.get(path); return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { code: 'fixture_not_found' } }; } };
  } },
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push(name);
    try {
      if (name === 'extraction_claim') return { data: await service(() => q('select * from public.extraction_claim($1,$2)', [args.p_limit, args.p_lease_seconds])), error: null };
      if (name === 'extraction_finish') return { data: await service(() => scalar('select public.extraction_finish($1,$2,$3,$4::jsonb,$5,$6)', [args.p_job_id, args.p_lease_token, args.p_state, JSON.stringify(args.p_result), args.p_error_code, args.p_retry_after_seconds])), error: null };
      throw new Error('Unexpected RPC in bounded local worker proof');
    } catch (error) { return { data: null, error: { code: (error as { code?: string }).code || 'local_sql_failure' } }; }
  },
} as unknown as SupabaseClient;

const textLines = [
  ['Synthetic Campus Film Night', 'November 12, 2026', '7:00 PM - 9:00 PM Eastern', 'Location: Student Union Cinema', 'SYNTHETIC TEST FIXTURE - NOT A REAL EVENT'],
  ['Synthetic Campus Film Night', 'Applications close November 10, 2026', 'Deadline time not announced', 'Eligibility: FSU students', 'SYNTHETIC TEST FIXTURE - NOT A REAL EVENT'],
];
const bodies: Buffer[] = [];
const folder = 'private/stage2-worker-proof';
await mkdir(folder, { recursive: true, mode: 0o700 });
for (const [index, lines] of textLines.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="950"><rect width="1600" height="950" fill="white"/>${lines.map((line, i) => `<text x="60" y="${120 + i * 155}" font-size="44" font-family="sans-serif" fill="black">${line}</text>`).join('')}</svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer(); bodies.push(bytes);
  await writeFile(`${folder}/slide-${index + 1}.png`, bytes, { mode: 0o600 });
}

async function enqueue(phase: string) {
  const submission = randomUUID();
  const media = bodies.map((body, index) => {
    const path = `${owner}/manual/${submission}/${String(index + 1).padStart(2, '0')}-${sha(body)}.png`;
    objects.set(path, Buffer.from(body)); return { storage_path: path, mime_type: 'image/png', byte_count: body.byteLength };
  });
  for (const item of media) await own(() => scalar("insert into storage.objects(bucket_id,name,metadata) values('captures',$1,$2::jsonb) returning id", [item.storage_path, JSON.stringify({ size: item.byte_count, mimetype: item.mime_type })]));
  const targetId = await own(() => scalar('select public.submit_manual_intake($1,$2,$3::jsonb,$4)', [null, `Synthetic worker proof ${phase}; generated files only.`, JSON.stringify(media), submission]));
  const queued = (await own(() => q('select * from public.extraction_enqueue($1,$2,$3)', ['manual', targetId, EXTRACTOR_VERSION])))[0];
  assert.deepEqual((queued.input_snapshot as { media: Array<{ assetId: string }> }).media.map(item => item.assetId), ['1', '2']);
  assert.equal(await scalar("select input_hash=encode(sha256(convert_to(input_snapshot::text||'|'||extractor_version,'UTF8')),'hex') from public.extraction_jobs where id=$1", [queued.id]), true);
  return { targetId, queued };
}

async function recordJob(id: unknown, phase: string) {
  const stored = (await q('select id,state,input_hash,input_snapshot,result,attempts from public.extraction_jobs where id=$1', [id]))[0];
  assert.equal(stored.state, 'succeeded');
  const result = validateExtractionResult(stored.result);
  assert.equal(result.complete, true); assert.equal(result.stats.processedAssets, 2); assert.equal(result.stats.processedPages, 2);
  const input = stored.input_snapshot as { media: Array<{ assetId: string; sha256: string }> };
  for (const item of input.media) {
    const unit = result.units.find(unit => unit.assetId === item.assetId)!;
    assert.equal(unit.sha256, item.sha256); assert.equal(unit.attempted, true); assert.equal(unit.status, 'processed'); assert.ok((unit.words?.length || 0) > 0);
  }
  assert.ok(result.candidates.some(candidate => candidate.kind === 'event'));
  assert.ok(result.candidates.some(candidate => candidate.kind === 'action'));
  let spans = 0;
  for (const candidate of result.candidates) for (const claim of candidate.claims) for (const span of claim.evidence) {
    spans++; const unit = result.units.find(unit => `${unit.assetId}:${unit.page ?? 0}` === span.unitId)!; assert.equal(unit.text.slice(span.start, span.end), span.quote);
  }
  assert.ok(spans > 0);
  const rawPath = `${folder}/result-${String(stored.id)}.json`;
  await writeFile(rawPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  jobEvidence.push({ phase, jobId: stored.id, state: stored.state, inputHash: stored.input_hash, attempts: stored.attempts, units: result.units.length, nativeVisualUnits: result.stats.processedPages, candidateCount: result.candidates.length, exactEvidenceSpans: spans, quarantined: true, privateResult: rawPath });
  return result;
}

const originalFetch = globalThis.fetch; let networkCalls = 0;
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const filename of migrations) await db.exec(await readFile(`supabase/migrations/${filename}`, 'utf8'));
  await q('insert into auth.users(id) values($1)', [owner]); await service(() => scalar('select public.configure_tracker_owner($1)', [owner]));
  const readiness = await nativeMediaReadiness(); assert.equal(readiness.ready, true, 'Native Tesseract/Poppler installation is required for this actual-processing probe');
  const enabledBefore = await scalar('select count(*)::integer from public.sources where enabled');
  globalThis.fetch = async () => { networkCalls++; throw new Error('No external request permitted in local worker proof'); };
  let directId: unknown, directTarget: unknown;
  await check('private ordered real PNG bytes enter immutable owner-enqueued SQL snapshots with exact content hashes', async () => {
    const first = await enqueue('direct'); directId = first.queued.id; directTarget = first.targetId;
    assert.equal(objects.size, 2); assert.equal(await scalar('select count(*)::integer from public.extraction_jobs'), 1);
  });
  await check('production extractLeasedJob performs actual native OCR and real service SQL completion', async () => {
    const claimed = await client.rpc('extraction_claim', { p_limit: 1, p_lease_seconds: 300 }); assert.equal(claimed.error, null);
    assert.equal(claimed.data.length, 1); const leased = claimed.data[0]; assert.equal(leased.id, directId);
    const result = await extractLeasedJob(leased, client);
    const completion = await client.rpc('extraction_finish', { p_job_id: leased.id, p_lease_token: leased.lease_token, p_state: 'succeeded', p_result: result, p_error_code: null, p_retry_after_seconds: 0 });
    assert.equal(completion.error, null); await recordJob(directId, 'direct-extractLeasedJob');
  });
  await check('production dispatcher leases another real SQL job, OCRs every slide, validates spans and stores its result', async () => {
    const second = await enqueue('dispatcher');
    const run = await runExtractionDispatcher(client, { environment }); assert.equal(run.status, 'completed'); assert.equal(run.jobs.length, 1); assert.equal(run.jobs[0].jobId, second.queued.id); assert.equal(run.jobs[0].state, 'succeeded');
    await recordJob(second.queued.id, 'runExtractionDispatcher');
  });
  await check('re-enqueue preserves the durable input identity and completed work does not run again', async () => {
    const again = (await own(() => q('select * from public.extraction_enqueue($1,$2,$3)', ['manual', directTarget, EXTRACTOR_VERSION])))[0];
    assert.equal(again.id, directId); assert.equal(again.state, 'succeeded');
    assert.deepEqual(await runExtractionDispatcher(client, { environment }), { status: 'idle', jobs: [] });
    assert.equal(await scalar('select count(*)::integer from public.extraction_jobs'), 2); assert.equal(downloads.length, 4);
  });
  await check('actual SQL records four attempted visual pages and releases all reservations', async () => {
    assert.equal(await scalar('select sum(visual_pages)::integer from public.extraction_attempts'), 4);
    assert.equal(await scalar("select count(*)::integer from public.extraction_attempts where state='processing'"), 0);
  });
  await check('extraction remains quarantined without normalized events, decisions or calendar commands', async () => {
    for (const table of ['opportunities', 'occurrences', 'milestones', 'user_decisions']) assert.equal(await scalar(`select count(*)::integer from public.${table}`), 0);
    assert.equal(await scalar('select count(*)::integer from tracker_private.calendar_write_commands'), 0);
    assert.equal(await scalar('select count(*)::integer from tracker_private.google_calendar_connections'), 0);
    assert.equal(await scalar('select count(*)::integer from public.sources where enabled'), enabledBefore); assert.equal(networkCalls, 0);
    assert.ok(rpcCalls.every(name => ['extraction_claim', 'extraction_finish'].includes(name)));
  });
  // Start a separate synthetic fixture phase. These are local in-memory test rows,
  // not production deletion or a reset of a real owner's usage budget.
  await q('delete from public.extraction_attempts'); await q('delete from public.extraction_jobs');
  const nativeDownloads = downloads.length;
  await check('blocked-after-work outcomes charge actual SQL visual pages even when processed-page count is zero', async () => {
    const first = await enqueue('injected-deadline');
    const run = await runExtractionDispatcher(client, { environment, media: async assets => ({ engine: 'injected-deadline-fixture', complete: false, units: assets.map(asset => ({ assetId: asset.assetId, page: null, method: 'ocr', sha256: sha(asset.bytes), status: 'blocked', attempted: true, text: '', issues: ['media_job_deadline_exceeded'] })) }) });
    assert.equal(run.jobs[0].state, 'partial'); assert.equal(run.jobs[0].processedPages, 0);
    const charged = await scalar('select visual_pages from public.extraction_attempts where job_id=$1', [first.queued.id]); assert.equal(charged, 2);
    failureBudgetProof.push({ fixture: 'injected blocked-after-work deadline', jobId: first.queued.id, state: run.jobs[0].state, successfulPages: 0, chargedPages: charged, realNativeCalls: 0 });
  });
  await check('thrown media work charges the entire remaining SQL reservation without inventing page evidence', async () => {
    const second = await enqueue('injected-exception');
    const run = await runExtractionDispatcher(client, { environment, media: async () => { throw new Error('Synthetic exception after work may have started'); } });
    assert.equal(run.jobs[0].state, 'failed');
    const stored = (await q('select result,visual_page_budget from public.extraction_jobs where id=$1', [second.queued.id]))[0];
    const result = validateExtractionResult(stored.result); assert.equal(result.stats.visualWorkUncertain, true);
    assert.ok(result.units.filter(unit => unit.assetId !== 'text').every(unit => unit.status === 'blocked' && unit.page === null));
    const charged = await scalar('select visual_pages from public.extraction_attempts where job_id=$1', [second.queued.id]); assert.equal(charged, stored.visual_page_budget); assert.equal(charged, 10);
    assert.equal(await scalar('select sum(visual_pages)::integer from public.extraction_attempts'), 12);
    failureBudgetProof.push({ fixture: 'injected thrown media exception', jobId: second.queued.id, state: run.jobs[0].state, successfulPages: 0, chargedPages: charged, visualWorkUncertain: true, realNativeCalls: 0 });
  });
  const report = {
    startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs, command: 'node --import tsx scripts/prove-stage2-worker.ts', passed: checks.length, checks,
    evidenceClass: 'Actual local native OCR and migrated PGlite PostgreSQL/RLS/RPCs with generated synthetic image bytes; in-memory Storage body substitute',
    engine: readiness, migrations, jobs: jobEvidence, inputImages: bodies.map((body, index) => ({ assetId: String(index + 1), bytes: body.byteLength, sha256: sha(body), fixtureClass: 'generated synthetic PNG' })),
    nativeVisualUnits: 4, privateStorageDownloads: downloads.length, nativePhaseStorageDownloads: nativeDownloads, sqlCompletedJobs: 2, sqlChargedVisualPages: 4, rpcNames: [...new Set(rpcCalls)],
    failureBudgetProof, failureFixturePhase: 'After retaining native positive outputs, only local synthetic job/attempt tables were reset to test failure accounting independently. No hosted data or real budget was changed.',
    credentialFilesRead: 0, externalHttpRequests: networkCalls, modelCalls: 0, calendarCalls: 0, hostedWrites: 0, paidServices: 0,
    limitations: ['Auth and Storage use local SQL compatibility shells; object bodies are an in-memory substitute, not hosted HTTP.', 'No Trigger Cloud run, Netlify upload or hosted Supabase job is demonstrated.', 'Candidate counts show functional evidence production, not human-labeled field accuracy or campus coverage.', 'No normalization, recommendation, merge, calendar approval or external action is performed.'],
  };
  await writeFile('reports/stage-2-local-worker-proof.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, jobs: jobEvidence.length, nativeVisualUnits: 4, storageDownloads: downloads.length, externalRequests: networkCalls, calendarCalls: 0 }, null, 2));
} finally { globalThis.fetch = originalFetch; await db.close(); }
