/** Exact SQL preparation replay; a single PGlite backend is NOT concurrency proof. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const db = new PGlite();
const filenames = ['scripts/hosted-core-contention-a.sql', 'scripts/hosted-core-contention-b.sql', 'scripts/hosted-core-contention-fingerprint.sql'];
const [a, b, fingerprint] = await Promise.all(filenames.map(file => readFile(file, 'utf8')));
const sha = text => createHash('sha256').update(text).digest('hex');
const q = async (text, args = []) => (await db.query(text, args)).rows;
const scalar = async (text, args = []) => Object.values((await q(text, args))[0])[0];
const readFingerprint = async () => (await db.exec(fingerprint)).flatMap(result => result.rows ?? []).find(row => row.core_contention_fingerprint)?.core_contention_fingerprint;
const stable = fp => ({ sources: fp.sources, sourceRuns: fp.sourceRuns, decisions: fp.decisions, calendarCommands: fp.calendarCommands, committedLeases: fp.committedLeases });
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
  for (const migration of migrations) await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111';
  await q('insert into auth.users(id) values($1)', [owner]);
  await q('select public.configure_tracker_owner($1)', [owner]);
  const before = await readFingerprint();
  assert.ok(before.dueCoreSources.length);
  const result = await db.exec(a);
  const observedA = result.flatMap(result => result.rows ?? []).find(row => row.core_contention_a)?.core_contention_a;
  assert.equal(observedA.heldSourceIds.length, 1);
  assert.equal(observedA.otherSourceRowsPreserved, true);
  assert.equal(observedA.runsDecisionsCalendarPreserved, true);
  assert.deepEqual(stable(await readFingerprint()), stable(before));
  await assert.rejects(db.exec(b), /independent A backend is not actively sleeping/);
  await db.exec('rollback');
  assert.deepEqual(stable(await readFingerprint()), stable(before));
  // Privileged setup changes only this local synthetic fixture. Neither hosted
  // SQL file updates due times, clears real leases, or creates a source/user.
  await db.exec("update public.sources set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes' where id='fsu-calendar-api'");
  const leasedBefore = await readFingerprint();
  for (const sql of [a, b]) {
    await assert.rejects(db.exec(sql), /committed lease exists/); await db.exec('rollback');
    assert.deepEqual(stable(await readFingerprint()), stable(leasedBefore));
  }
  await db.exec("update public.sources set lease_token=null,lease_until=null,next_poll_at=clock_timestamp()+interval '1 day',retry_not_before=null where enabled");
  const idleBefore = await readFingerprint();
  assert.equal(idleBefore.dueCoreSources.length, 0);
  await assert.rejects(db.exec(a), /requires one to three currently due/); await db.exec('rollback');
  assert.deepEqual(stable(await readFingerprint()), stable(idleBefore));
  const report = { recordedAt: new Date().toISOString(), command: 'node scripts/test-core-contention-preflight.mjs', evidenceClass: 'Single-backend local PGlite replay: exact A executes/rolls back; B safely rejects absent independent A; active-lease and no-due guards preserve local fixtures. This does NOT demonstrate concurrent sessions.', sqlFiles: filenames.map((file, index) => ({ file, sha256: sha([a,b,fingerprint][index]) })), localChecksPassed: 5, localChecks: ['A claims one existing local due source, sleeps, verifies protected rows and rolls back', 'B rejects absent independently sleeping A without mutation', 'A rejects committed active lease unchanged', 'B rejects committed active lease unchanged', 'A rejects no-due window unchanged'], localAObservation: observedA, fullBeforeAfterFingerprintsPreserved: true, hostedExecution: false, independentSessionContentionDemonstrated: false, hostedAuthUsersCreated: 0, hostedSourceRowsCreated: 0, collectionCalls: 0, calendarCalls: 0 };
  await writeFile('reports/core-contention-preflight-replay.json', JSON.stringify(report, null, 2) + '\n');
  console.log('5/5 core-contention preparation/rollback safeguards passed locally; independent-session overlap still requires hosted A/B execution.');
} finally { await db.close(); }
