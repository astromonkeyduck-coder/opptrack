/** Local replay of the exact bounded hosted SQL-role audit; no service calls. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111';
const auditSql = await readFile('scripts/hosted-stage2-versioning-check.sql', 'utf8');
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot() {
  return scalar("select jsonb_build_object('jobs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.extraction_jobs t),'attempts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.extraction_attempts t),'intakes',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.manual_intakes t),'commands',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tracker_private.calendar_write_commands t))");
}
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  // Preserve replay of the exact v2-era hosted audit and its default-version contract.
  const migrations = (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql') && file <= '20261103003949_stage2_extractor_versions.sql').sort();
  for (const file of migrations) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  await q('insert into auth.users(id) values($1)', [owner]);
  await q('select public.configure_tracker_owner($1)', [owner]);
  const target = await scalar("insert into public.manual_intakes(owner_id,note,media,submission_key) values($1,'SYNTHETIC existing completed v1 fixture','[]',$2) returning id", [owner, randomUUID()]);
  const oldJob = await scalar("insert into public.extraction_jobs(owner_id,manual_intake_id,input_hash,extractor_version,input_snapshot,state,attempts,first_started_at,last_attempt_at,finished_at,result) values($1,$2,repeat('a',64),'stage2-rules-v1',jsonb_build_object('kind','manual','targetId',$2::uuid,'note','SYNTHETIC existing completed v1 fixture','publishedAt',null,'media','[]'::jsonb),'succeeded',1,date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day','{}') returning id", [owner, target]);
  await q("insert into public.extraction_attempts(owner_id,job_id,attempt_number,lease_token,state,reserved_visual_pages,visual_pages,started_at,finished_at) values($1,$2,1,$3,'succeeded',0,0,date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day',clock_timestamp()-interval '1 day')", [owner, oldJob, randomUUID()]);
  const before = await snapshot();
  const result = await db.exec(auditSql);
  const audit = result.flatMap(item => item.rows ?? []).find(row => row.stage2_versioning_audit)?.stage2_versioning_audit;
  assert.equal(audit.passed, 8); assert.ok(audit.checks.every(check => check.passed));
  assert.deepEqual(await snapshot(), before);
  const queued = await scalar("insert into public.extraction_jobs(owner_id,manual_intake_id,input_hash,extractor_version,input_snapshot) values($1,$2,repeat('b',64),'stage2-rules-v2',jsonb_build_object('kind','manual','targetId',$2::uuid,'note','SYNTHETIC guard fixture','publishedAt',null,'media','[]'::jsonb)) returning id", [owner, target]);
  let guardBefore = await snapshot();
  await assert.rejects(db.exec(auditSql), /real queued\/processing jobs exist/); await db.exec('rollback');
  assert.deepEqual(await snapshot(), guardBefore);
  // This is privileged setup of a separate local fault fixture, never a reset
  // or change to hosted state: it deliberately marks today's budget as used.
  await q("update public.extraction_jobs set state='blocked',first_started_at=clock_timestamp() where id=$1", [queued]);
  guardBefore = await snapshot();
  await assert.rejects(db.exec(auditSql), /current UTC extraction budget has already been used/); await db.exec('rollback');
  assert.deepEqual(await snapshot(), guardBefore);
  const report = { recordedAt: new Date().toISOString(), command: 'node scripts/test-stage2-versioning-hosted-audit.mjs', sqlSha256: createHash('sha256').update(auditSql).digest('hex'), evidenceClass: 'Exact hosted SQL-role audit replayed in local PGlite with a synthetic owner and preexisting completed-v1 fixture. No hosted Auth user or service was touched.', migrations, audit,
    rollbackRowsAndFullHashesPreserved: true, localGuardChecks: ['Existing queued work stops the audit and stays untouched', 'Already-used UTC budget stops the audit and stays untouched'], localGuardChecksPassed: 2,
    localFixtureSnapshotSha256BeforeAndAfter: hash(before), hostedExecution: false, credentialFilesRead: 0, modelCalls: 0, storageCalls: 0, calendarCalls: 0, independentConnectionsTested: false };
  await writeFile('reports/stage-2-versioning-hosted-audit-replay.json', JSON.stringify(report, null, 2) + '\n');
  console.log('8/8 exact versioning SQL-role audit checks and 2/2 fail-safe guards passed locally; all fixture changes rolled back.');
} finally { await db.close(); }
