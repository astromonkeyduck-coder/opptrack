/** Actual local PostgreSQL v5 forward-rollout and legacy compatibility checks. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
const migration = '20261104014240_stage2_extractor_v5.sql';
const versions = ['stage2-rules-v1', 'stage2-rules-v2', 'stage2-rules-v3', 'stage2-rules-v4', 'stage2-rules-v5'];
const checks = [], sha = text => createHash('sha256').update(text).digest('hex');
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function role(name, fn) {
  await db.exec('set role ' + name); await q("select set_config('request.jwt.claim.sub',$1,false)", [name === 'authenticated' ? owner : '']);
  try { return await fn(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
const input = note => scalar("insert into public.manual_intakes(owner_id,note,media,submission_key) values($1,$2,'[]'::jsonb,$3) returning id", [owner, note, randomUUID()]);
const enqueue = (target, version) => role('authenticated', async () => (await q(version === undefined ? "select * from public.extraction_enqueue('manual',$1)" : "select * from public.extraction_enqueue('manual',$1,$2)", version === undefined ? [target] : [target, version]))[0]);
const claim = limit => role('service_role', () => q('select * from public.extraction_claim($1,180)', [limit]));
const functionState = () => q("select oid::text,oid::regprocedure::text as name,proacl::text,prosecdef,proconfig from pg_proc where oid in('public.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_enqueue(text,uuid,text)'::regprocedure,'public.extraction_claim(integer,integer)'::regprocedure,'tracker_private.extraction_claim(integer,integer)'::regprocedure,'public.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'tracker_private.extraction_finish(uuid,uuid,text,jsonb,text,integer)'::regprocedure,'public.extraction_retry(uuid)'::regprocedure,'tracker_private.extraction_retry(uuid)'::regprocedure) order by oid");
async function finish(job) {
  const text = job.input_snapshot.note;
  const result = { version: 'stage2-result-v1', units: [{ assetId: 'text', page: null, status: 'processed', text, method: 'provided-text', sha256: sha(text), issues: [] }], candidates: [], issues: [], complete: true, stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'synthetic-sql/' + job.extractor_version, elapsedMs: 1 } };
  await role('service_role', () => scalar('select public.extraction_finish($1,$2,$3,$4::jsonb,null,0)', [job.id, job.lease_token, 'succeeded', JSON.stringify(result)]));
}
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql') && file <= migration).sort();
  assert.equal(migrations.at(-1), migration);
  for (const file of migrations.filter(file => file !== migration)) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  await q('insert into auth.users(id) values($1)', [owner]); await role('service_role', () => scalar('select public.configure_tracker_owner($1)', [owner]));
  const oldTarget = await input('SYNTHETIC unchanged legacy source input'), completed = [];
  for (const version of versions.slice(0, 4)) {
    const job = await enqueue(oldTarget, version); completed.push(job);
    // Privileged local pre-upgrade history fixture, not execution/reset of a
    // hosted quota. No real worker/source/calendar state is accessed.
    await q("update public.extraction_jobs set state='succeeded',attempts=1,first_started_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day',last_attempt_at=clock_timestamp()-interval '1 day',finished_at=clock_timestamp()-interval '1 day',result=jsonb_build_object('historicalFixture',extractor_version) where id=$1", [job.id]);
    await q("insert into public.extraction_attempts(owner_id,job_id,attempt_number,lease_token,state,reserved_visual_pages,visual_pages,started_at,finished_at) values($1,$2,1,$3,'succeeded',0,0,date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day',clock_timestamp()-interval '1 day')", [owner, job.id, randomUUID()]);
  }
  const queued = await enqueue(await input('SYNTHETIC queued old-v4 source'));
  assert.equal(queued.extractor_version, 'stage2-rules-v4');
  const jobsBefore = await q('select * from public.extraction_jobs order by id'), attemptsBefore = await q('select * from public.extraction_attempts order by id'), functionsBefore = await functionState();
  await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  await check('forward migration preserves all completed v1/v2/v3/v4 and queued v4 rows and attempts exactly', async () => {
    assert.deepEqual(await q('select * from public.extraction_jobs order by id'), jobsBefore); assert.deepEqual(await q('select * from public.extraction_attempts order by id'), attemptsBefore);
  });
  await check('all eight function OIDs, ACLs, definer/invoker modes and security configuration survive rollout', async () => { assert.equal(functionsBefore.length,8); assert.deepEqual(await functionState(), functionsBefore); });
  let current;
  await check('default v5 is a separate immutable identity; explicit old requests remain idempotent without reprocessing', async () => {
    current = await enqueue(oldTarget); assert.equal(current.extractor_version, 'stage2-rules-v5'); assert.equal((await enqueue(oldTarget, 'stage2-rules-v5')).id, current.id);
    for (const legacy of completed) {
      assert.equal((await enqueue(oldTarget, legacy.extractor_version)).id, legacy.id); assert.notEqual(current.id, legacy.id); assert.notEqual(current.input_hash, legacy.input_hash); assert.deepEqual(current.input_snapshot, legacy.input_snapshot);
      assert.equal(await scalar('select state from public.extraction_jobs where id=$1', [legacy.id]), 'succeeded'); assert.equal(await scalar('select count(*)::int from public.extraction_attempts where job_id=$1', [legacy.id]), 1);
    }
  });
  await check('unknown, empty and null versions fail before a queued row is added', async () => {
    const before = await scalar('select count(*)::int from public.extraction_jobs');
    for (const version of ['unsupported-v99', '', null]) await assert.rejects(enqueue(oldTarget, version), /unsupported extractor version/);
    assert.equal(await scalar('select count(*)::int from public.extraction_jobs'), before);
  });
  const unknown = await scalar("insert into public.extraction_jobs(owner_id,manual_intake_id,input_hash,extractor_version,input_snapshot,created_at) values($1,$2,$3,'unsupported-v99',$4::jsonb,'1999-01-01') returning id", [owner, oldTarget, sha(randomUUID()), JSON.stringify(current.input_snapshot)]);
  let claimed;
  await check('worker leases old queued v4 and current v5 while skipping unsupported privileged corruption', async () => {
    claimed = await claim(2); assert.deepEqual(new Set(claimed.map(job => job.id)), new Set([queued.id, current.id]));
    assert.deepEqual(new Set(claimed.map(job => job.extractor_version)), new Set(['stage2-rules-v4', 'stage2-rules-v5']));
    assert.deepEqual((await q('select state,attempts,lease_token from public.extraction_jobs where id=$1', [unknown]))[0], { state: 'queued', attempts: 0, lease_token: null });
  });
  await check('all five versions share the unchanged two-new-jobs UTC budget', async () => {
    for (const job of claimed) await finish(job);
    const blocked = await enqueue(await input('SYNTHETIC later legacy source'), 'stage2-rules-v1');
    assert.equal((await claim(2)).length, 0); assert.equal(await scalar('select attempts from public.extraction_jobs where id=$1', [blocked.id]), 0);
    assert.equal(await scalar("select count(*)::int from public.extraction_jobs where first_started_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'"), 2);
  });
  await check('old source versions cannot be rewritten; RLS/owner/worker/anonymous/calendar boundaries remain intact', async () => {
    await assert.rejects(q("update public.extraction_jobs set extractor_version='stage2-rules-v5' where id=$1", [queued.id]), /immutable/);
    for (const schema of ['public', 'tracker_private']) {
      for (const who of ['anon', 'service_role']) assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [who, schema + '.extraction_enqueue(text,uuid,text)']), false);
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [schema + '.extraction_enqueue(text,uuid,text)']), true);
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [schema + '.extraction_claim(integer,integer)']), false);
    }
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.extraction_jobs'::regclass"), true); assert.equal(await scalar('select count(*)::int from tracker_private.calendar_write_commands'), 0);
  });
  await check('authenticated nonmember cannot see old or new jobs or enqueue and anonymous cannot read jobs', async () => {
    await db.exec('set role authenticated'); await q("select set_config('request.jwt.claim.sub',$1,false)",['22222222-2222-4222-8222-222222222222']);
    try { assert.equal(await scalar('select count(*)::int from public.extraction_jobs'),0); await assert.rejects(q("select * from public.extraction_enqueue('manual',$1)",[oldTarget]),/Not authorized/); }
    finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
    await role('anon',()=>assert.rejects(q('select * from public.extraction_jobs'),/permission denied/));
  });
  await writeFile('reports/stage-2-v5-versioning-database-tests.json', JSON.stringify({ recordedAt: new Date().toISOString(), command: 'node scripts/test-stage2-v5-versioning.mjs', engine: 'PGlite0.5.10 actual PostgreSQL WASM', migration, migrationSha256: sha(await readFile('supabase/migrations/' + migration, 'utf8')), migrations, passed: checks.length, checks, fixtureClass: 'Local synthetic sole owner, completed v1/v2/v3/v4 history, queued v4/current v5, deliberately unsupported privileged row. No hosted state or provider calls.', immutableLegacyHistoryPreserved: true, supportedVersions: versions, latestDefault: 'stage2-rules-v5', newJobsUtcDayBudgetShared: 2, providerCalls: 0, credentialReads: 0, hostedWrites: 0, notTested: ['Hosted migration/deployment', 'Independent connection contention', 'Signed-JWT/Storage HTTP', 'Extraction accuracy/holdout acceptance'] }, null, 2) + '\n');
  console.log(`${checks.length} v5 version-rollout SQL checks passed; no hosted/provider calls.`);
} finally { await db.close(); }
