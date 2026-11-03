/** Actual PostgreSQL version-rollout checks; local synthetic fixtures only. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
const migration = '20261103003949_stage2_extractor_versions.sql';
const checks = [], q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
const sha = text => createHash('sha256').update(text).digest('hex');
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function role(name, id, fn) {
  await db.exec('set role ' + name);
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
  try { return await fn(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
const own = fn => role('authenticated', owner, fn), worker = fn => role('service_role', null, fn);
const input = note => scalar("insert into public.manual_intakes(owner_id,note,media,submission_key) values($1,$2,'[]'::jsonb,$3) returning id", [owner, note, randomUUID()]);
const enqueue = (target, version) => own(async () => (await q(version === undefined ? "select * from public.extraction_enqueue('manual',$1)" : "select * from public.extraction_enqueue('manual',$1,$2)", version === undefined ? [target] : [target, version]))[0]);
const claim = limit => worker(() => q('select * from public.extraction_claim($1,180)', [limit]));
async function finish(job) {
  const text = job.input_snapshot.note;
  const result = { version: 'stage2-result-v1', units: [{ assetId: 'text', page: null, status: 'processed', text, method: 'provided-text', sha256: sha(text), issues: [] }], candidates: [], issues: [], complete: true,
    stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'synthetic-sql/' + job.extractor_version, elapsedMs: 1 } };
  await worker(() => scalar('select public.extraction_finish($1,$2,$3,$4::jsonb,null,0)', [job.id, job.lease_token, 'succeeded', JSON.stringify(result)]));
}
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  // This historical rollout fixture intentionally freezes the schema at v2.
  const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql') && name <= migration).sort();
  assert.equal(migrations.at(-1), migration);
  for (const file of migrations.filter(name => name !== migration)) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  await q('insert into auth.users(id) values($1)', [owner]);
  await worker(() => scalar('select public.configure_tracker_owner($1)', [owner]));
  const oldTarget = await input('SYNTHETIC completed pre-upgrade v1 input');
  const completedV1 = await enqueue(oldTarget); assert.equal(completedV1.extractor_version, 'stage2-rules-v1');
  await finish((await claim(1))[0]);
  // Setup only: move the synthetic completed attempt to the previous UTC day so
  // today's shared quota can test one queued v1 and one newly requested v2.
  await q("update public.extraction_jobs set first_started_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day' where id=$1", [completedV1.id]);
  await q("update public.extraction_attempts set started_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day' where job_id=$1", [completedV1.id]);
  const queuedTarget = await input('SYNTHETIC queued pre-upgrade v1 input');
  const queuedV1 = await enqueue(queuedTarget);
  const jobsBefore = await q('select * from public.extraction_jobs order by id');
  const attemptsBefore = await q('select * from public.extraction_attempts order by id');
  const functionIdsBefore = await q("select oid::text,proname,proacl::text,prosecdef,proconfig from pg_proc where oid in ('public.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_claim(integer,integer)'::regprocedure) order by oid");
  await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  await check('forward rollout preserves every existing completed/queued v1 job and attempt byte-for-byte as row values', async () => {
    assert.deepEqual(await q('select * from public.extraction_jobs order by id'), jobsBefore);
    assert.deepEqual(await q('select * from public.extraction_attempts order by id'), attemptsBefore);
  });
  await check('replaced functions preserve OIDs, narrow ACLs, security mode and search paths', async () => {
    assert.deepEqual(await q("select oid::text,proname,proacl::text,prosecdef,proconfig from pg_proc where oid in ('public.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_enqueue(text,uuid,text)'::regprocedure,'tracker_private.extraction_claim(integer,integer)'::regprocedure) order by oid"), functionIdsBefore);
  });
  let current;
  await check('latest default is v2 while an explicit v1 request remains idempotent and cannot rewrite history', async () => {
    current = await enqueue(oldTarget); assert.equal(current.extractor_version, 'stage2-rules-v2'); assert.notEqual(current.id, completedV1.id);
    assert.notEqual(current.input_hash, completedV1.input_hash); assert.deepEqual(current.input_snapshot, completedV1.input_snapshot);
    assert.equal((await enqueue(oldTarget)).id, current.id); assert.equal((await enqueue(oldTarget, 'stage2-rules-v1')).id, completedV1.id);
    assert.equal(await scalar('select state from public.extraction_jobs where id=$1', [completedV1.id]), 'succeeded');
    assert.equal(await scalar('select count(*)::int from public.extraction_attempts where job_id=$1', [completedV1.id]), 1);
  });
  await check('unknown, empty and null versions are rejected before creating a queued row', async () => {
    const before = await scalar('select count(*)::int from public.extraction_jobs');
    for (const version of ['unsupported-v99', '', null]) await assert.rejects(enqueue(oldTarget, version), /unsupported extractor version/);
    assert.equal(await scalar('select count(*)::int from public.extraction_jobs'), before);
  });
  // Privileged local corruption fixture, not a supported enqueue route. It must
  // not consume a worker lease ahead of valid known-version work.
  const unknownId = await scalar("insert into public.extraction_jobs(owner_id,manual_intake_id,input_hash,extractor_version,input_snapshot,created_at) values($1,$2,repeat('e',64),'unsupported-v99',$3::jsonb,'2000-01-01') returning id", [owner, oldTarget, JSON.stringify(completedV1.input_snapshot)]);
  let claimed;
  await check('claim leases old queued v1 and new v2 but skips an unsupported queued version', async () => {
    claimed = await claim(2); assert.deepEqual(new Set(claimed.map(job => job.id)), new Set([queuedV1.id, current.id]));
    assert.deepEqual(new Set(claimed.map(job => job.extractor_version)), new Set(['stage2-rules-v1', 'stage2-rules-v2']));
    const unknown = (await q('select state,attempts,lease_token from public.extraction_jobs where id=$1', [unknownId]))[0];
    assert.deepEqual(unknown, { state: 'queued', attempts: 0, lease_token: null });
  });
  await check('both versions share the same two-new-jobs UTC budget and do not reset each other', async () => {
    for (const job of claimed) await finish(job);
    const later = await enqueue(await input('SYNTHETIC later v2 work')); assert.equal(later.extractor_version, 'stage2-rules-v2');
    assert.equal((await claim(2)).length, 0);
    assert.equal(await scalar('select count(*)::int from public.extraction_attempts where job_id=$1', [later.id]), 0);
    for (const job of claimed) assert.equal(await scalar('select extractor_version from public.extraction_jobs where id=$1', [job.id]), job.extractor_version);
  });
  await check('all versioned input identities remain immutable and owner/worker/anonymous capabilities stay separate', async () => {
    await assert.rejects(q("update public.extraction_jobs set extractor_version='stage2-rules-v2' where id=$1", [queuedV1.id]), /immutable/);
    for (const schema of ['public', 'tracker_private']) {
      for (const who of ['anon', 'service_role']) assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [who, schema + '.extraction_enqueue(text,uuid,text)']), false);
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [schema + '.extraction_enqueue(text,uuid,text)']), true);
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [schema + '.extraction_claim(integer,integer)']), false);
    }
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.extraction_jobs'::regclass"), true);
    assert.equal(await scalar('select count(*)::int from tracker_private.calendar_write_commands'), 0);
  });
  await writeFile('reports/stage-2-versioning-database-tests.json', JSON.stringify({ recordedAt: new Date().toISOString(), command: 'node scripts/test-stage2-versioning.mjs', engine: 'PGlite 0.5.10 actual PostgreSQL WASM', migration, migrations, passed: checks.length, checks,
    fixtureClass: 'Local synthetic owner, inputs, completed/queued v1 rows, a new v2 request and deliberately unsupported privileged row; no hosted state or provider calls.', immutableV1HistoryPreserved: true, supportedVersions: ['stage2-rules-v1', 'stage2-rules-v2'], latestDefault: 'stage2-rules-v2', newJobsUtcDayBudgetShared: 2, providerCalls: 0, credentialReads: 0, hostedWrites: 0, notTested: ['Hosted migration deployment', 'Independent PostgreSQL contention', 'Signed-JWT/Storage HTTP', 'Extraction factual accuracy'] }, null, 2) + '\n');
  console.log(`${checks.length} Stage 2 version-rollout SQL checks passed; zero hosted/provider calls.`);
} finally { await db.close(); }
