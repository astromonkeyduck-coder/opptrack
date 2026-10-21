import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const checks = [];
const query = async (sql, parameters = []) => (await db.query(sql, parameters)).rows;
const scalar = async (sql, parameters = []) => Object.values((await query(sql, parameters))[0])[0];
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
async function role(name, id, fn) {
  await db.exec(`set role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  try { return await fn(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
const asOwner = fn => role('authenticated', owner, fn);
const record = (id, action = 'save', revision = 1) => scalar('select public.record_review_decision($1,$2,$3)', [id, action, revision]);
const restore = (id, decisionId, expected = 'save', previous = null, revision = 1) => scalar('select public.restore_review_decision($1,$2,$3,$4,$5)', [id, revision, expected, previous, decisionId]);
const current = id => scalar('select decision from public.review_inbox where id=$1', [id]);
const count = id => scalar('select count(*)::integer from public.user_decisions where occurrence_id=$1', [id]);

try {
  await db.exec(await readFile(new URL('../supabase/tests/bootstrap.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  for (const file of migrations) await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  await check('all migrations including review undo execute on PostgreSQL', async () => assert.ok(migrations.includes('202610200005_review_undo.sql')));
  await query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await role('service_role', null, () => scalar('select public.configure_tracker_owner($1)', [owner]));
  const capture = await scalar("insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until) values($1,'fsu-calendar-api','review-fixture','https://calendar.fsu.edu',repeat('a',64),'application/json',10,'synthetic-review-v1',now(),now(),now()+interval '1 day') returning id", [owner]);
  const opportunity = await scalar("insert into public.opportunities(owner_id,source_id,native_id,title,source_url,capture_id,content_sha256) values($1,'fsu-calendar-api','review-fixture','Synthetic review event','https://calendar.fsu.edu',$2,repeat('b',64)) returning id", [owner, capture]);
  const occurrences = [];
  for (const native of ['one', 'two']) occurrences.push(await scalar("insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,date_precision,capture_id,content_sha256) values($1,'fsu-calendar-api',$2,$3,'unknown',$4,repeat('c',64)) returning id", [owner, opportunity, native, capture]));
  const [one, two] = occurrences;

  await check('anonymous cannot invoke review or undo RPCs', async () => {
    await role('anon', null, async () => {
      await assert.rejects(() => record(one), /permission denied/);
      await assert.rejects(() => restore(one, one), /permission denied/);
    });
  });
  await check('another authenticated user cannot review or undo owner items', async () => {
    await role('authenticated', other, async () => {
      await assert.rejects(() => record(one), /Not authorized/);
      await assert.rejects(() => restore(one, one), /Not authorized/);
      assert.equal(await scalar('select count(*)::integer from public.review_inbox'), 0);
    });
  });
  await check('authenticated role without a user cannot invoke privileged review', async () => {
    await role('authenticated', null, async () => {
      await assert.rejects(() => record(one), /Not authorized/);
      await assert.rejects(() => restore(one, one), /Not authorized/);
    });
  });
  let first;
  await check('review returns the committed decision identity and actual prior undecided state', async () => {
    first = await asOwner(() => record(one));
    assert.match(first.decision_id, /^[0-9a-f-]{36}$/);
    assert.equal(first.previous_decision, null);
    assert.equal(await asOwner(() => current(one)), 'save');
  });
  await check('undo restores undecided using an audit marker without deleting history', async () => {
    const restored = await asOwner(() => restore(one, first.decision_id));
    assert.notEqual(restored, first.decision_id);
    assert.equal(await asOwner(() => current(one)), null);
    assert.equal(await count(one), 2);
    assert.deepEqual((await query('select action from public.user_decisions where occurrence_id=$1 order by decision_index', [one])).map(row => row.action), ['save', 'clear']);
  });
  await check('repeated undo cannot replay or add another audit entry', async () => {
    await assert.rejects(() => asOwner(() => restore(one, first.decision_id)), /Review changed/);
    assert.equal(await count(one), 2);
  });
  await check('a later review after clear returns null as its actual previous decision', async () => {
    const next = await asOwner(() => record(one, 'reject'));
    assert.equal(next.previous_decision, null);
    await asOwner(() => restore(one, next.decision_id, 'reject'));
    assert.equal(await asOwner(() => current(one)), null);
  });
  let saved;
  let rejected;
  await check('undo of a changed review restores the actual previous saved state', async () => {
    saved = await asOwner(() => record(one, 'save'));
    rejected = await asOwner(() => record(one, 'reject'));
    assert.equal(saved.previous_decision, null);
    assert.equal(rejected.previous_decision, 'save');
    await asOwner(() => restore(one, rejected.decision_id, 'reject', 'save'));
    assert.equal(await asOwner(() => current(one)), 'save');
  });
  await check('forged previous state is rejected atomically', async () => {
    const decision = await asOwner(() => record(one, 'reject'));
    const before = await count(one);
    await assert.rejects(() => asOwner(() => restore(one, decision.decision_id, 'reject', null)), /Previous review changed/);
    assert.equal(await count(one), before);
    assert.equal(await asOwner(() => current(one)), 'reject');
  });
  await check('immutable decision guard rejects stale undo even after an identical newer review', async () => {
    const older = await asOwner(() => record(one, 'save'));
    const newer = await asOwner(() => record(one, 'save'));
    assert.notEqual(older.decision_id, newer.decision_id);
    const before = await count(one);
    await assert.rejects(() => asOwner(() => restore(one, older.decision_id, 'save', 'reject')), /Review changed/);
    assert.equal(await count(one), before);
    assert.equal(await asOwner(() => current(one)), 'save');
  });
  await check('undo cannot use a decision identity from another occurrence', async () => {
    const decision = await asOwner(() => record(two, 'reject'));
    await assert.rejects(() => asOwner(() => restore(one, decision.decision_id, 'save', 'save')), /Review changed/);
    assert.equal(await asOwner(() => current(two)), 'reject');
  });
  await check('source revision changes reject save and undo without changing the decision', async () => {
    const decision = await asOwner(() => record(two, 'save'));
    await query('update public.occurrences set revision=2 where id=$1', [two]);
    await assert.rejects(() => asOwner(() => record(two, 'reject')), /Occurrence changed/);
    await assert.rejects(() => asOwner(() => restore(two, decision.decision_id, 'save', 'reject')), /Occurrence changed/);
    assert.equal(await asOwner(() => current(two)), 'save');
  });
  await check('only save and reject are accepted as direct user review actions', async () => {
    for (const action of ['clear', 'approve', 'calendar', null]) await assert.rejects(() => asOwner(() => record(one, action)), /Only save\/reject/);
    await assert.rejects(() => asOwner(() => scalar('select public.record_decision($1,$2,1)', [one, 'clear'])), /Only save\/reject/);
    for (const revision of [null, 0, -1]) await assert.rejects(() => asOwner(() => record(one, 'save', revision)), /Invalid revision/);
  });
  await check('invalid undo arguments are denied before any mutation', async () => {
    const decision = await asOwner(() => record(one, 'reject'));
    const before = await count(one);
    for (const [expected, previous, id, revision] of [['clear', null, decision.decision_id, 1], ['reject', 'clear', decision.decision_id, 1], ['reject', null, null, 1], ['reject', null, decision.decision_id, null]]) {
      await assert.rejects(() => asOwner(() => restore(one, id, expected, previous, revision)), /Invalid review state/);
    }
    assert.equal(await count(one), before);
  });
  await check('owner cannot directly insert clear markers or mutate/delete audit rows', async () => {
    await asOwner(async () => {
      await assert.rejects(() => query('insert into public.user_decisions(owner_id,occurrence_id,action,target_revision) values($1,$2,$3,1)', [owner, one, 'clear']), /permission denied/);
      await assert.rejects(() => query("update public.user_decisions set action='clear' where occurrence_id=$1", [one]), /permission denied/);
      await assert.rejects(() => query('delete from public.user_decisions where occurrence_id=$1', [one]), /permission denied/);
    });
  });
  await check('inbox view retains invoker security and functions pin an empty search path', async () => {
    assert.ok((await scalar("select reloptions from pg_class where oid='public.review_inbox'::regclass")).includes('security_invoker=true'));
    for (const name of ['record_review_decision', 'restore_review_decision']) {
      const fn = (await query('select prosecdef,proconfig from pg_proc where proname=$1', [name]))[0];
      assert.equal(fn.prosecdef, true);
      assert.ok(fn.proconfig.some(value => value === 'search_path=""'));
    }
  });
  await check('review/undo adds no calendar or delivery execution table', async () => {
    assert.equal(await scalar("select count(*)::integer from information_schema.tables where table_schema='public' and table_name in ('outbox','calendar_links','integration_connections')"), 0);
  });
  await writeFile(new URL('../reports/review-undo-database-tests.json', import.meta.url), JSON.stringify({
    run_at: new Date().toISOString(), engine: 'PGlite 0.5.10 (PostgreSQL WASM)', migrations,
    passed: checks.length, checks, fixture_data: 'Synthetic records only; not live event ingestion evidence',
    not_tested: ['Hosted Auth HTTP/JWT verification', 'Independent concurrent PostgreSQL connections', 'Hosted browser gestures'],
  }, null, 2) + '\n');
  console.log(`${checks.length} review database checks passed.`);
} finally { await db.close(); }
