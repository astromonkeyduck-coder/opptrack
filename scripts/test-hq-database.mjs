/** Actual PostgreSQL plus production HQ ingestion with synthetic HTTP and in-memory Storage. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { collectHq } from '../lib/collection/hq.ts';
import { ingestCollectedBatch, runLeasedCollection } from '../lib/ingestion/index.ts';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const sourceId = 'fsu-hq-public-export';
const migration = '20261021193109_hq_public_collector.sql';
const sql = async (query, parameters = []) => (await db.query(query, parameters)).rows;
const scalar = async (query, parameters = []) => Object.values((await sql(query, parameters))[0])[0];
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function role(name, uid, fn) {
  await db.exec(`set role ${name}`);
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
  try { return await fn(); } finally { await db.exec('reset role'); await db.exec('reset request.jwt.claim.sub'); }
}
const source = async () => (await sql('select * from public.sources where id=$1', [sourceId]))[0];
const iso = value => new Date(value).toISOString();
const objects = new Map(); let uploads = 0, reuses = 0, downloads = 0;
const client = {
  from: table => {
    assert.equal(table, 'opportunities');
    return { select: columns => {
      assert.equal(columns, 'id,native_id');
      return { eq: (column, id) => {
        assert.equal(column, 'source_id'); assert.equal(id, sourceId);
        return { eq: (ownerColumn, ownerId) => {
          assert.equal(ownerColumn, 'owner_id'); assert.equal(ownerId, owner);
          return { order: (orderColumn, options) => {
            assert.equal(orderColumn, 'id'); assert.equal(options.ascending, true);
            return { range: async (from, to) => ({ data: await role('service_role', null, () => sql('select id,native_id from public.opportunities where source_id=$1 and owner_id=$2 order by id limit $3 offset $4', [id, ownerId, to - from + 1, from])), error: null }) };
          } };
        } };
      } };
    } };
  },
  storage: { from: bucket => {
    assert.equal(bucket, 'captures');
    return {
      upload: async (path, bytes, options) => {
        assert.equal(options.upsert, false);
        if (objects.has(path)) { reuses++; return { error: { status: 409, code: 'ResourceAlreadyExists' } }; }
        objects.set(path, Buffer.from(bytes)); uploads++; return { error: null };
      },
      download: async path => { downloads++; const bytes = objects.get(path); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { code: 'not_found' } }; },
    };
  } },
  rpc: async (name, args) => {
    assert.equal(name, 'complete_source_run');
    try {
      return { data: await role('service_role', null, () => scalar('select public.complete_source_run($1,$2,$3::jsonb)', [args.p_source_id, args.p_lease_token, JSON.stringify(args.p_batch)])), error: null };
    } catch (error) { return { data: null, error: { code: error.code || 'test_sql_error' } }; }
  },
};
const provenance = { invocationKind: 'replay', triggerRunId: 'run_synthetic_hq_replay' };
const fixtureNow = new Date();
const compact = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function fixtureBody(startOffset = 0, status = 'CONFIRMED') {
  const start = new Date(fixtureNow.getTime() + 86_400_000 + startOffset);
  const end = new Date(start.getTime() + 3_600_000);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic HQ SQL test//EN', 'BEGIN:VEVENT', 'UID:synthetic-hq-sql-event', 'DTSTAMP:' + compact(fixtureNow), 'DTSTART:' + compact(start), 'DTEND:' + compact(end), 'STATUS:' + status, 'SUMMARY:Synthetic HQ SQL fixture', 'DESCRIPTION:Synthetic fixture only', 'URL:https://hq.fsu.edu/example/rsvp', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
async function fixture(startOffset = 0, blocked = false) {
  return collectHq({ now: () => fixtureNow, fetch: async (_url, options) => {
    assert.equal(options.method, 'GET');
    return new Response(blocked ? '<h1>Please sign in to continue</h1>' : fixtureBody(startOffset), { headers: { 'content-type': blocked ? 'text/html' : 'text/calendar' } });
  } });
}
async function leaseHq(slot) {
  await sql("update public.sources set next_poll_at=$2,next_due_at=$2,retry_not_before=null,lease_token=null,lease_until=null where id=$1", [sourceId, slot || new Date(0).toISOString()]);
  const rows = await role('service_role', null, () => sql('select * from public.lease_due_sources(3,600)'));
  const lease = rows.find(row => row.id === sourceId); assert.ok(lease); return lease;
}
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const file of migrations.filter(name => name !== migration)) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  await sql('insert into auth.users(id) values($1),($2)', [owner, other]);
  await role('service_role', null, () => sql('select public.configure_tracker_owner($1)', [owner]));
  for (let index = 0; index < 27; index++) await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,coverage_note) values($1,$2,$1,'instagram-business-discovery-v1','https://www.instagram.com/fixture/',true,3600,clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour','Synthetic social lease fixture')", ['instagram-hq-fixture-' + index, owner]);
  const before = await sql('select * from public.sources order by id');
  await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  await check('HQ migration preserves all existing sources/cursors/health/leases and enables nothing', async () => assert.deepEqual(await sql('select * from public.sources order by id'), before));
  const activation = await readFile('scripts/activate-hq-source.sql', 'utf8');
  await db.exec(activation);
  await check('targeted activation changes only HQ and retains its exact public route/six-hour cadence', async () => {
    const after = await sql('select * from public.sources order by id');
    assert.deepEqual(after.filter(row => row.id !== sourceId), before.filter(row => row.id !== sourceId));
    const hq = await source(); assert.equal(hq.enabled, true); assert.equal(hq.adapter, 'hq-ics-v1'); assert.equal(hq.cadence_seconds, 21600); assert.equal(hq.health_status, 'setup_needed');
  });
  await check('repeated activation preserves an existing cursor, active lease, health and nominal due state', async () => {
    await sql("update public.sources set cursor='{}',health_status='success',lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' where id=$1", [sourceId, randomUUID()]);
    const current = await source(); await db.exec(activation); assert.deepEqual(await source(), current);
  });
  await db.exec("update public.sources set next_poll_at=clock_timestamp()-interval '1 day',next_due_at=clock_timestamp()-interval '1 day',retry_not_before=null,lease_token=null,lease_until=null");
  let core;
  await check('Central, Music and HQ all lease in the same dispatch independently of 27 overdue social routes', async () => {
    core = await role('service_role', null, () => sql('select * from public.lease_due_sources()'));
    assert.deepEqual(core.map(row => row.id).sort(), ['fsu-calendar-api', 'fsu-hq-public-export', 'fsu-music-events']);
    assert.equal((await role('service_role', null, () => sql('select * from public.lease_due_sources(3,600)'))).length, 0);
    const social = await role('service_role', null, () => sql('select * from public.lease_due_instagram_sources(27,600)'));
    assert.equal(social.length, 27); assert.ok(social.every(row => row.adapter === 'instagram-business-discovery-v1'));
  });
  await check('core maximum is three, social maximum remains 27 and browser roles cannot lease or call private internals', async () => {
    await assert.rejects(() => role('service_role', null, () => sql('select * from public.lease_due_sources(4,600)')), /Invalid lease limits/);
    await assert.rejects(() => role('service_role', null, () => sql('select * from public.lease_due_instagram_sources(28,600)')), /Invalid lease limits/);
    for (const name of ['anon', 'authenticated']) await assert.rejects(() => role(name, owner, () => sql('select * from public.lease_due_sources(3,600)')), /permission denied/);
    for (const name of ['anon', 'authenticated', 'service_role']) await assert.rejects(() => role(name, owner, () => sql("select * from tracker_private.lease_due_source_group('core',3,600)")), /permission denied/);
  });
  const batch = await fixture(); assert.equal(batch.status, 'success');
  await check('real HQ collector and ingestion modules persist captured UID facts through actual SQL', async () => {
    await ingestCollectedBatch(core.find(row => row.id === sourceId), batch, client, provenance);
    assert.equal(await scalar('select count(*)::integer from public.opportunities'), 1); assert.equal(await scalar('select count(*)::integer from public.occurrences'), 1);
    assert.equal(await scalar('select native_id from public.opportunities'), 'synthetic-hq-sql-event');
    assert.ok(await scalar("select count(*)>0 from public.field_claims where evidence_pointer='ics-vevent:0'"));
    assert.equal(uploads, 1); assert.equal(objects.size, 1);
  });
  const occurrenceId = await scalar('select id from public.occurrences');
  await role('authenticated', owner, () => sql("select public.record_decision($1,'save',1)", [occurrenceId]));
  await check('unchanged HQ replay verifies immutable duplicate bytes and preserves saved occurrence identity/decision', async () => {
    const versions = await scalar('select count(*)::integer from public.entity_versions');
    await ingestCollectedBatch(await leaseHq(), await fixture(), client, provenance);
    assert.equal(await scalar('select id from public.occurrences'), occurrenceId); assert.equal(await scalar('select count(*)::integer from public.entity_versions'), versions);
    assert.equal(await role('authenticated', owner, () => scalar('select decision from public.review_inbox')), 'save'); assert.equal(uploads, 1); assert.equal(reuses, 1); assert.equal(downloads, 1);
  });
  await check('moved HQ time appends factual version while stable UID and saved decision survive', async () => {
    const versions = await scalar('select count(*)::integer from public.entity_versions');
    await ingestCollectedBatch(await leaseHq(), await fixture(3_600_000), client, provenance);
    assert.equal(await scalar('select id from public.occurrences'), occurrenceId); assert.ok(await scalar('select count(*)::integer from public.entity_versions') > versions);
    assert.equal(await role('authenticated', owner, () => scalar('select decision from public.review_inbox')), 'save');
  });
  await check('worker database identities reconcile retained HQ moves beyond90days, into the past and cancellation without losing saved decisions', async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const [days, status] of [[180, 'CONFIRMED'], [-30, 'CONFIRMED'], [200, 'CANCELLED']]) {
        const body = fixtureBody(days * 86_400_000, status);
        globalThis.fetch = async (_url, options) => { assert.equal(options.method, 'GET'); return new Response(body, { headers: { 'content-type': 'text/calendar' } }); };
        const result = await runLeasedCollection(await leaseHq(), client, provenance);
        assert.equal(result.outcome, 'success'); assert.equal(result.occurrences, 1);
        assert.equal(await scalar('select id from public.occurrences'), occurrenceId);
        assert.equal(iso(await scalar('select starts_at from public.occurrences')), new Date(Math.floor((fixtureNow.getTime() + (days + 1) * 86_400_000) / 1000) * 1000).toISOString());
        assert.equal(await scalar('select status from public.occurrences'), status === 'CANCELLED' ? 'cancelled' : 'scheduled');
        assert.equal(await role('authenticated', owner, () => scalar('select decision from public.review_inbox')), 'save');
        assert.equal((await source()).cursor.retainedOutsideWindow, 1);
      }
    } finally { globalThis.fetch = originalFetch; }
  });
  await check('six-hour HQ completion crossing a nominal boundary does not skip the next poll', async () => {
    const lease = await leaseHq(); const slot = new Date(lease.leased_poll_at); const next = new Date(slot.getTime() + 21_600_000);
    const delayed = await fixture(3_600_000); delayed.startedAt = new Date(next.getTime() - 60_000).toISOString(); delayed.finishedAt = new Date(next.getTime() + 60_000).toISOString();
    await ingestCollectedBatch(lease, delayed, client, provenance);
    assert.equal(iso((await source()).next_poll_at), next.toISOString()); assert.equal(iso((await source()).next_due_at), next.toISOString());
  });
  await check('HQ access failure retains prior facts/last success/cursor and reports blocked rather than nothing new', async () => {
    const previous = await source(); await ingestCollectedBatch(await leaseHq(), await fixture(0, true), client, provenance);
    const current = await source(); assert.equal(current.health_status, 'blocked'); assert.deepEqual(current.last_success_at, previous.last_success_at); assert.deepEqual(current.cursor, previous.cursor);
    assert.equal(await scalar('select count(*)::integer from public.occurrences'), 1); assert.ok(current.retry_not_before);
  });
  await check('HQ facts and private capture metadata are owner-only; source state cannot be forged', async () => {
    for (const table of ['sources', 'opportunities', 'occurrences', 'captures', 'source_runs', 'field_claims', 'review_inbox']) {
      assert.ok(await role('authenticated', owner, () => scalar(`select count(*)::integer from public.${table}`)) > 0);
      assert.equal(await role('authenticated', other, () => scalar(`select count(*)::integer from public.${table}`)), 0);
      await assert.rejects(() => role('anon', null, () => sql(`select * from public.${table}`)), /permission denied/);
    }
    await assert.rejects(() => role('authenticated', owner, () => sql("update public.sources set enabled=false where id='fsu-hq-public-export'")), /permission denied/);
  });
  const report = { runAt: new Date().toISOString(), migrations, passed: checks.length, checks, fixtureClass: 'Synthetic HQ HTTP; production collector/ingestion; actual PGlite PostgreSQL; in-memory immutable Storage substitute', uploads, reuses, verifiedDownloads: downloads, calendarWrites: 0, paidServicesEnabled: 0, notTested: ['Hosted migration/activation', 'Real Trigger HQ schedule', 'Hosted JWT/Storage HTTP', 'Distributed lock contention', 'Actual Google editor save'] };
  await writeFile('reports/hq-database-tests.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`${checks.length} HQ database/worker replay checks passed.`);
} finally { await db.close(); }
