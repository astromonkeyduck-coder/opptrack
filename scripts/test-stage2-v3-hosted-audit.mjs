/** Replay exact current-schema rollback audit at used UTC job budgets 0,1,2. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const sql = await readFile('scripts/hosted-stage2-v3-policy-check.sql', 'utf8');
const q = async (text, args = []) => (await db.query(text, args)).rows;
const scalar = async (text, args = []) => Object.values((await q(text, args))[0])[0];
const sha = value => createHash('sha256').update(value).digest('hex');
const snap = () => scalar("select jsonb_build_object('jobs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.extraction_jobs t),'attempts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.extraction_attempts t),'intakes',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.manual_intakes t),'commands',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tracker_private.calendar_write_commands t),'decisions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.user_decisions t),'sources',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.sources t))");
async function completed(version, currentDay) {
  const id = await scalar("insert into public.manual_intakes(owner_id,note,media,submission_key) values($1,'SYNTHETIC preexisting budget fixture','[]',$2) returning id", [owner, randomUUID()]);
  const job = await scalar("insert into public.extraction_jobs(owner_id,manual_intake_id,input_hash,extractor_version,input_snapshot,state,attempts,first_started_at,last_attempt_at,finished_at,result) values($1,$2,$3,$4,jsonb_build_object('kind','manual','targetId',$2::uuid,'note','SYNTHETIC preexisting budget fixture','publishedAt',null,'media','[]'::jsonb),'succeeded',1,case when $5 then clock_timestamp() else date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day' end,clock_timestamp(),clock_timestamp(),'{}') returning id", [owner, id, sha(randomUUID()), version, currentDay]);
  await q("insert into public.extraction_attempts(owner_id,job_id,attempt_number,lease_token,state,reserved_visual_pages,visual_pages,started_at,finished_at) values($1,$2,1,$3,'succeeded',2,2,case when $4 then clock_timestamp() else date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day' end,clock_timestamp())", [owner, job, randomUUID(), currentDay]);
  return { id, job };
}
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql') && file <= '20261103011203_stage2_extractor_v3.sql').sort();
  for (const migration of migrations) await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  await q('insert into auth.users(id) values($1)', [owner]);
  await q('select public.configure_tracker_owner($1)', [owner]);
  const old = await completed('stage2-rules-v1', false);
  const cases = [];
  for (let used = 0; used <= 2; used++) {
    if (used) await completed(used === 1 ? 'stage2-rules-v2' : 'stage2-rules-v3', true);
    for (let repetition = 1; repetition <= 10; repetition++) {
    const before = await snap();
    const result = await db.exec(sql);
    const audit = result.flatMap(result => result.rows ?? []).find(row => row.stage2_v3_audit)?.stage2_v3_audit;
    assert.equal(audit.passed, 8);
    assert.ok(audit.checks.every(check => check.passed));
    assert.equal(audit.baselineUsedUtcJobs, used);
    assert.equal(audit.remainingUtcJobSlots, 2 - used);
    assert.equal(audit.fixtureClaims, 2 - used);
    assert.equal(audit.v3FinishActuallyTested, used < 2);
    assert.equal(audit.v3ClaimedBeforeLegacyEnqueue, used < 2);
    assert.equal(audit.firstClaimedVersion, used < 2 ? 'stage2-rules-v3' : null);
    assert.equal(audit.claimedVersions[0] ?? null, used < 2 ? 'stage2-rules-v3' : null);
    assert.equal(audit.baselineUtcAttempts, used);
    assert.equal(audit.baselineUtcVisualPages, used * 2);
    assert.deepEqual(await snap(), before);
    cases.push({ baselineUsedUtcJobs: used, repetition, audit, beforeAndAfterSnapshotSha256: sha(JSON.stringify(before)), rollbackRowsPreserved: true });
    }
    console.log(`PASS exact v3 audit: ${used} real UTC slots used, 10 independent random-ID fixture repetitions, ${2 - used} fixture claims, 8 checks each; rollback preserved baseline.`);
  }
  const queueId = await scalar("insert into public.extraction_jobs(owner_id,manual_intake_id,input_hash,extractor_version,input_snapshot) values($1,$2,$3,'stage2-rules-v3',jsonb_build_object('kind','manual','targetId',$2::uuid,'note','SYNTHETIC queued guard','publishedAt',null,'media','[]'::jsonb)) returning id", [owner, old.id, sha(randomUUID())]);
  const beforeGuard = await snap();
  await assert.rejects(db.exec(sql), /real queued\/processing jobs exist/);
  await db.exec('rollback');
  assert.deepEqual(await snap(), beforeGuard);
  assert.equal(await scalar('select state from public.extraction_jobs where id=$1', [queueId]), 'queued');
  const report = { checkedAt: new Date().toISOString(), command: 'node scripts/test-stage2-v3-hosted-audit.mjs', sqlSha256: sha(sql), evidenceClass: 'Actual installed-function SQL-role audit replay in local PGlite using only synthetic fixtures; not hosted execution, signed JWTs, native OCR or independent-session contention.', historicalSql: 'scripts/hosted-stage2-v3-policy-check-20261103-034349.sql', historicalSqlSha256: '99cd3ccafc8dd260a1ff083a0284fe426b4ad7ce12a4812c6db4928f7e62583f', correction: 'Current v3 is leased while it is the sole queued fixture. Legacy fixtures are added afterward and actual returned legacy jobs are finished; no enqueue timestamp ordering assumption or timestamp/quota edits.', migrations, cases, checksPerBudgetCase: 8, budgetCases: 3, repetitionsPerBudgetCase: 10, casesPassed: cases.length, queuedWorkFailSafePassed: true, quotaResetsOrDeletesInAudit: 0, noFixtureChangesPersisted: true, hostedCalls: 0, authUsersCreatedHosted: 0, storageCalls: 0, modelCalls: 0, calendarCalls: 0 };
  await writeFile('reports/stage-2-v3-hosted-audit-replay.json', JSON.stringify(report, null, 2) + '\n');
  console.log('30/30 v3 used-budget repetitions (10 each at budgets 0/1/2) and queued-work fail-safe passed; no hosted service called.');
} finally { await db.close(); }
