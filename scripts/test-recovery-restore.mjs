/**
 * Local-only Stage 1 recovery drill. No env files, credentials, HTTP clients,
 * production connections or calendar executor are loaded. Auth/Storage use the
 * existing explicit SQL compatibility shell; object bodies are local files.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportPath = join(root, 'reports/stage-1-local-recovery.json');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const submissionKey = '33333333-3333-4333-8333-333333333333';
const sourceId = 'fsu-calendar-api';
const runAt = new Date().toISOString();
const checks = [];
const timings = {};
const sha = value => createHash('sha256').update(value).digest('hex');
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
const query = async (db, sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (db, sql, args = []) => Object.values((await query(db, sql, args))[0])[0];
async function role(db, name, id, fn) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(name));
  await db.exec('set role ' + name);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  try { return await fn(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
const own = (db, fn) => role(db, 'authenticated', owner, fn);
const worker = (db, fn) => role(db, 'service_role', null, fn);

// Small valid PNGs, generated locally; these contain no user media.
function png(red, green, blue) {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, body) => {
    const data = Buffer.concat([Buffer.from(name), body]);
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));
    return Buffer.concat([length, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const raw = Buffer.from(JSON.stringify({
  fixture: 'synthetic-local-recovery-only',
  event: { id: 'recovery-event', title: 'Synthetic recovery seminar', starts_at: '2099-11-05T15:00:00Z', ends_at: '2099-11-05T16:00:00Z' },
}) + '\n');
const objects = [
  { name: owner + '/sources/recovery.json', mime: 'application/json', bytes: raw },
  { name: owner + '/intake/recovery-slide-1.png', mime: 'image/png', bytes: png(120, 30, 40) },
  { name: owner + '/intake/recovery-slide-2.png', mime: 'image/png', bytes: png(20, 90, 160) },
];
const media = objects.slice(1).map(item => ({ storage_path: item.name, mime_type: item.mime, byte_count: item.bytes.length }));
function batch() {
  const capture = { native_id: 'recovery-page:1', source_url: 'https://calendar.fsu.edu/api/2/events', content_sha256: sha(raw), storage_path: objects[0].name, content_type: 'application/json', byte_count: raw.length, fetched_at: runAt };
  const opportunity = { native_id: 'recovery-event', title: 'Synthetic recovery seminar', description: 'Synthetic private recovery fixture; not live source evidence.', source_url: 'https://calendar.fsu.edu/event/synthetic-recovery', categories: ['Arts'], uncertainties: ['Synthetic fixture'], capture_native_id: capture.native_id, content_sha256: sha('synthetic-recovery-op-v1'), claims: [{ field: 'title', value: 'Synthetic recovery seminar', evidence_pointer: '/event/title' }] };
  const occurrence = { native_id: 'recovery-occurrence', opportunity_native_id: opportunity.native_id, starts_at: '2099-11-05T15:00:00Z', ends_at: '2099-11-05T16:00:00Z', timezone: 'America/New_York', date_precision: 'instant', location: null, status: 'scheduled', capture_native_id: capture.native_id, content_sha256: sha('synthetic-recovery-occ-v1'), claims: [{ field: 'starts_at', value: '2099-11-05T15:00:00Z', evidence_pointer: '/event/starts_at' }] };
  const milestone = { native_id: 'recovery-milestone', opportunity_native_id: opportunity.native_id, occurrence_native_id: occurrence.native_id, kind: 'application_deadline', occurs_on: '2099-11-01', action_url: 'https://calendar.fsu.edu/event/synthetic-recovery', availability: 'unverified', uncertainty: 'Synthetic date-only deadline; time and timezone unknown', capture_native_id: capture.native_id, content_sha256: sha('synthetic-recovery-milestone-v1'), claims: [{ field: 'occurs_on', value: '2099-11-01', evidence_pointer: '/synthetic/deadline' }] };
  return { outcome: 'success', pagination_complete: true, started_at: runAt, finished_at: runAt, http_status: 200, request_count: 0, byte_count: raw.length, parser_version: 'synthetic-recovery-v1', cursor_after: { synthetic: true, page: 1, complete: true }, window: { from: '2099-11-01', to: '2099-11-08' }, invocation_kind: 'local', captures: [capture], opportunities: [opportunity], occurrences: [occurrence], milestones: [milestone] };
}
async function ingest(db) {
  await db.query("update public.sources set next_due_at=now()-interval '1 hour',next_poll_at=now()-interval '1 hour',retry_not_before=null where id=$1", [sourceId]);
  const lease = await worker(db, async () => (await query(db, 'select * from public.lease_due_sources(1,300)'))[0]);
  assert.equal(lease.id, sourceId);
  return worker(db, () => scalar(db, 'select public.complete_source_run($1,$2,$3::jsonb)', [sourceId, lease.lease_token, JSON.stringify(batch())]));
}

async function rowsDigest(db) {
  const tables = await query(db, "select table_schema,table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','tracker_private','auth','storage') order by table_schema,table_name");
  const result = [];
  for (const table of tables) {
    // Identifiers originate only from PostgreSQL's catalog and are quoted.
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    const rows = await scalar(db, `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${quote(table.table_schema)}.${quote(table.table_name)} t`);
    result.push({ table: table.table_schema + '.' + table.table_name, rows: rows.length, sha256: sha(JSON.stringify(rows)) });
  }
  return result;
}
async function policyDigest(db) {
  return {
    policies: await query(db, "select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','tracker_private','storage') order by schemaname,tablename,policyname"),
    tables: await query(db, "select n.nspname schema,c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,c.relacl::text acl,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tracker_private','storage') and c.relkind in ('r','v') order by n.nspname,c.relname"),
    functions: await query(db, "select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,p.prosecdef security_definer,p.proacl::text acl,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tracker_private') order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)"),
  };
}

function safeObjectPath(base, name) {
  if (!name.startsWith(owner + '/') || name.split('/').some(part => !part || part === '.' || part === '..') || name.includes('\\') || name.includes('\0')) throw new Error('Invalid backup object path');
  const result = resolve(base, name);
  if (!result.startsWith(resolve(base) + sep)) throw new Error('Invalid backup object path');
  return result;
}
async function writePrivate(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
}
async function verifyPackage(base, manifest) {
  const dump = await readFile(join(base, 'database.tgz'));
  if (dump.length !== manifest.database.bytes || sha(dump) !== manifest.database.sha256) throw new Error('Database backup integrity mismatch');
  for (const object of manifest.objects) {
    const bytes = await readFile(safeObjectPath(join(base, 'objects'), object.name));
    if (bytes.length !== object.bytes || sha(bytes) !== object.sha256) throw new Error('Object backup integrity mismatch');
  }
  return dump;
}

let source, restored, reopen;
await mkdir(join(root, 'private'), { recursive: true, mode: 0o700 });
const work = await mkdtemp(join(root, 'private/recovery-drill-'));
await chmod(work, 0o700);
const originalObjects = join(work, 'original-objects');
const backup = join(work, 'backup');
const tamperedBackup = join(work, 'tampered-backup');
const restoredObjects = join(work, 'restored-objects');
const targetDbPath = join(work, 'restored-pgdata');
const start = performance.now();
try {
  source = new PGlite();
  await source.exec(await readFile(join(root, 'supabase/tests/bootstrap.sql'), 'utf8'));
  const migrations = (await readdir(join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  for (const migration of migrations) await source.exec(await readFile(join(root, 'supabase/migrations', migration), 'utf8'));
  await check('all current migrations execute in a credential-free local PostgreSQL instance', async () => assert.ok(migrations.length >= 9));
  await source.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await worker(source, () => scalar(source, 'select public.configure_tracker_owner($1)', [owner]));
  await source.query('update public.sources set enabled=(id=$1)', [sourceId]);
  for (const object of objects) {
    await writePrivate(safeObjectPath(originalObjects, object.name), object.bytes);
    await source.query("insert into storage.objects(bucket_id,name,metadata) values('captures',$1,$2::jsonb)", [object.name, JSON.stringify({ mimetype: object.mime, size: object.bytes.length, recovery_sha256: sha(object.bytes) })]);
  }
  await ingest(source);
  const occurrenceId = await scalar(source, 'select id from public.occurrences');
  const decision = await own(source, () => scalar(source, 'select public.record_review_decision($1,$2,$3)', [occurrenceId, 'save', 1]));
  const intakeId = await own(source, () => scalar(source, 'select public.submit_manual_intake($1,$2,$3::jsonb,$4)', ['https://fsu.edu/synthetic-recovery', 'Synthetic two-slide local recovery intake', JSON.stringify(media), submissionKey]));
  await check('worker SQL persists capture, program, occurrence, milestone, field evidence and source health', async () => {
    for (const table of ['captures', 'opportunities', 'occurrences', 'milestones', 'source_runs', 'run_captures']) assert.equal(await scalar(source, `select count(*)::int from public.${table}`), 1, table);
    assert.equal(await scalar(source, 'select count(*)::int from public.entity_versions'), 3);
    assert.equal(await scalar(source, 'select count(*)::int from public.field_claims'), 3);
    assert.equal(await scalar(source, 'select health_status from public.sources where id=$1', [sourceId]), 'success');
  });
  await check('synthetic private object bodies and ordered two-slide intake match SQL metadata', async () => {
    assert.equal(await scalar(source, 'select count(*)::int from storage.objects'), 3);
    assert.deepEqual(await scalar(source, 'select media from public.manual_intakes where id=$1', [intakeId]), media);
    assert.notEqual(sha(objects[1].bytes), sha(objects[2].bytes));
    assert.equal(await scalar(source, 'select content_sha256 from public.captures'), sha(raw));
    for (const object of objects) assert.equal(sha(await readFile(safeObjectPath(originalObjects, object.name))), sha(object.bytes));
  });
  const expectedRows = await rowsDigest(source);
  const expectedPolicy = await policyDigest(source);
  const expectedInbox = await own(source, () => query(source, 'select * from public.review_inbox order by id'));
  const backupStart = performance.now();
  const dump = Buffer.from(await (await source.dumpDataDir('gzip')).arrayBuffer());
  await writePrivate(join(backup, 'database.tgz'), dump);
  for (const object of objects) await writePrivate(safeObjectPath(join(backup, 'objects'), object.name), await readFile(safeObjectPath(originalObjects, object.name)));
  const manifest = {
    format: 'pglite-local-recovery-v1', engine: '@electric-sql/pglite 0.5.10', fixture: 'synthetic-only', createdAt: new Date().toISOString(),
    migrations, database: { file: 'database.tgz', bytes: dump.length, sha256: sha(dump) },
    objects: objects.map(object => ({ name: object.name, mime: object.mime, bytes: object.bytes.length, sha256: sha(object.bytes) })),
    tables: expectedRows, policySha256: sha(JSON.stringify(expectedPolicy)),
  };
  await writePrivate(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  timings.exportMs = Math.round(performance.now() - backupStart);
  await check('database snapshot and three separate object backups pass byte counts and SHA-256 verification', () => verifyPackage(backup, manifest));
  await check('all backup artifacts use private filesystem modes', async () => {
    assert.equal((await stat(work)).mode & 0o777, 0o700);
    for (const name of ['database.tgz', 'manifest.json', ...objects.map(object => join('objects', object.name))]) assert.equal((await stat(join(backup, name))).mode & 0o777, 0o600);
  });
  await check('restore verification rejects corrupt database bytes before opening PostgreSQL', async () => {
    const corruptDump = Buffer.from(dump); corruptDump[Math.floor(corruptDump.length / 2)] ^= 1;
    await writePrivate(join(tamperedBackup, 'database.tgz'), corruptDump);
    await assert.rejects(() => verifyPackage(tamperedBackup, manifest), /Database backup integrity mismatch/);
    await writeFile(join(tamperedBackup, 'database.tgz'), dump);
    for (const object of objects) await writePrivate(safeObjectPath(join(tamperedBackup, 'objects'), object.name), object.bytes);
  });
  await check('restore verification rejects corrupt or missing object bodies instead of declaring a complete backup', async () => {
    const target = safeObjectPath(join(tamperedBackup, 'objects'), objects[1].name);
    const corruptObject = Buffer.from(objects[1].bytes); corruptObject[0] ^= 1;
    await writeFile(target, corruptObject);
    await assert.rejects(() => verifyPackage(tamperedBackup, manifest), /Object backup integrity mismatch/);
    await rm(target);
    await assert.rejects(() => verifyPackage(tamperedBackup, manifest), /ENOENT/);
  });
  await check('restore paths reject traversal and another owner prefix', async () => {
    for (const name of [owner + '/../escape', other + '/intake/fake.png', owner + '/intake/../../escape', owner + '/intake\\escape']) assert.throws(() => safeObjectPath(restoredObjects, name), /Invalid backup object path/);
  });
  // Deliberate loss affects only this script's newly-created synthetic state.
  await source.query("update public.opportunities set title='CORRUPTED AFTER BACKUP'");
  await source.query('delete from public.user_decisions');
  await rm(originalObjects, { recursive: true });
  await check('source loss is demonstrable before restore and cannot be hidden by querying the original', async () => {
    assert.equal(await scalar(source, 'select count(*)::int from public.user_decisions'), 0);
    assert.equal(await scalar(source, 'select title from public.opportunities'), 'CORRUPTED AFTER BACKUP');
    await assert.rejects(() => readFile(safeObjectPath(originalObjects, objects[0].name)), /ENOENT/);
  });
  await source.close(); source = null;
  const verifiedDump = await verifyPackage(backup, manifest);
  const restoreStart = performance.now();
  restored = new PGlite({ dataDir: targetDbPath, loadDataDir: new Blob([verifiedDump]) });
  await restored.waitReady;
  for (const object of manifest.objects) await writePrivate(safeObjectPath(restoredObjects, object.name), await readFile(safeObjectPath(join(backup, 'objects'), object.name)));
  timings.restoreMs = Math.round(performance.now() - restoreStart);
  await check('separate restored database matches every application, private, Auth-shell and Storage-shell row hash', async () => assert.deepEqual(await rowsDigest(restored), expectedRows));
  await check('restored policies, RLS flags, invoker views, function ACLs and definer settings match the backup', async () => assert.deepEqual(await policyDigest(restored), expectedPolicy));
  await check('restored private files retain original paths, all bytes and hashes independently of database metadata', async () => {
    for (const object of manifest.objects) {
      const bytes = await readFile(safeObjectPath(restoredObjects, object.name));
      assert.equal(bytes.length, object.bytes); assert.equal(sha(bytes), object.sha256);
    }
    assert.equal(await scalar(restored, "select public from storage.buckets where id='captures'"), false);
    assert.deepEqual(await scalar(restored, 'select media from public.manual_intakes where id=$1', [intakeId]), media);
  });
  await check('owner reads exactly the saved inbox and the same native identities after restore', async () => {
    assert.deepEqual(await own(restored, () => query(restored, 'select * from public.review_inbox order by id')), expectedInbox);
    assert.equal(await own(restored, () => scalar(restored, 'select decision from public.review_inbox')), 'save');
    assert.equal(await scalar(restored, 'select id from public.user_decisions'), decision.decision_id);
  });
  await check('another authenticated user cannot read restored catalog, decisions, intake or known-object metadata', async () => role(restored, 'authenticated', other, async () => {
    for (const table of ['public.review_inbox', 'public.captures', 'public.user_decisions', 'public.manual_intakes', 'storage.objects']) assert.equal(await scalar(restored, `select count(*)::int from ${table}`), 0, table);
    await assert.rejects(() => scalar(restored, 'select public.record_review_decision($1,$2,$3)', [occurrenceId, 'save', 1]), /Not authorized/);
  }));
  await check('anonymous access to restored private facts and review mutations remains denied', async () => role(restored, 'anon', null, async () => {
    await assert.rejects(() => query(restored, 'select * from public.review_inbox'), /permission denied/);
    await assert.rejects(() => scalar(restored, 'select public.record_review_decision($1,$2,$3)', [occurrenceId, 'save', 1]), /permission denied/);
    assert.equal(await scalar(restored, 'select count(*)::int from storage.objects'), 0);
  }));
  await check('owner can read restored object metadata but cannot forge source facts or another storage prefix', async () => own(restored, async () => {
    assert.equal(await scalar(restored, 'select count(*)::int from storage.objects'), 3);
    await assert.rejects(() => query(restored, "update public.opportunities set title='forged'"), /permission denied/);
    await assert.rejects(() => query(restored, "insert into storage.objects(bucket_id,name) values('captures',$1)", [other + '/intake/forged.png']), /row-level security/);
  }));
  await ingest(restored);
  await check('post-restore recollection deduplicates native entities and versions while preserving the saved decision', async () => {
    for (const table of ['captures', 'opportunities', 'occurrences', 'milestones']) assert.equal(await scalar(restored, `select count(*)::int from public.${table}`), 1, table);
    assert.equal(await scalar(restored, 'select count(*)::int from public.entity_versions'), 3);
    assert.equal(await scalar(restored, 'select count(*)::int from public.field_claims'), 3);
    assert.equal(await scalar(restored, 'select count(*)::int from public.source_runs'), 2);
    assert.equal(await own(restored, () => scalar(restored, 'select decision from public.review_inbox')), 'save');
    assert.equal(await scalar(restored, 'select id from public.occurrences'), occurrenceId);
  });
  await check('restored intake submission key remains idempotent and decision identity sequence continues safely', async () => {
    const replayed = await own(restored, () => scalar(restored, 'select public.submit_manual_intake($1,$2,$3::jsonb,$4)', ['https://fsu.edu/synthetic-recovery', 'Synthetic two-slide local recovery intake', JSON.stringify(media), submissionKey]));
    assert.equal(replayed, intakeId);
    const before = await scalar(restored, 'select max(decision_index)::int from public.user_decisions');
    await own(restored, () => scalar(restored, 'select public.record_review_decision($1,$2,$3)', [occurrenceId, 'reject', 1]));
    assert.ok(await scalar(restored, 'select max(decision_index)::int from public.user_decisions') > before);
    assert.equal(await scalar(restored, 'select count(*)::int from public.manual_intakes'), 1);
  });
  await check('recovery drill creates no calendar connections or commands and performs no provider calls', async () => {
    assert.equal(await scalar(restored, 'select count(*)::int from tracker_private.google_calendar_connections'), 0);
    assert.equal(await scalar(restored, 'select count(*)::int from tracker_private.calendar_write_commands'), 0);
    assert.equal(await scalar(restored, 'select sum(request_count)::int from public.source_runs'), 0);
  });
  await restored.close(); restored = null;
  reopen = new PGlite(targetDbPath);
  await check('restored database survives closing and reopening its separate local data directory', async () => {
    assert.equal(await own(reopen, () => scalar(reopen, 'select decision from public.review_inbox')), 'reject');
    assert.equal(await scalar(reopen, 'select count(*)::int from public.manual_intakes'), 1);
    assert.equal(await scalar(reopen, 'select count(*)::int from storage.objects'), 3);
  });
  timings.totalMs = Math.round(performance.now() - start);
  const report = {
    runAt, completedAt: new Date().toISOString(), status: 'local_synthetic_restore_verified_hosted_restore_unverified', command: 'node scripts/test-recovery-restore.mjs',
    engine: '@electric-sql/pglite 0.5.10 (actual PostgreSQL WASM)', migrations, passed: checks.length, checks, timings,
    fixtureClass: 'Synthetic source facts, two generated one-pixel PNGs and one JSON capture. Actual migrated PostgreSQL/RLS/RPCs; Auth and Storage SQL compatibility shells and local filesystem bodies. No hosted Supabase/Auth/Storage service is emulated.',
    backup: { scope: 'Entire fresh local PGlite data directory plus separate three-object local backup', databaseBytes: dump.length, databaseSha256: sha(dump), objectCount: objects.length, objectBytes: objects.reduce((total, object) => total + object.bytes.length, 0), policySha256: manifest.policySha256, tables: expectedRows, privateArtifacts: work.slice(root.length), modes: { directory: '0700', backupAndObjectFiles: '0600' }, originalSourceClosed: true, originalObjectBodiesDeleted: true, restoredDatabaseReopened: true },
    production: { reads: 0, writes: 0, credentialFilesRead: 0, calendarCalls: 0, newServices: 0, costUsd: 0 },
    documentation: [
      { url: 'https://pglite.dev/docs/api#dumpdatadir', claim: 'PGlite dumpDataDir snapshots can initialize a separate database through loadDataDir; also verified against installed 0.5.10 declarations.' },
      { url: 'https://supabase.com/docs/guides/platform/backups', claim: 'Hosted database backups do not include Storage object bodies; local object export/restore is tested separately.' },
      { url: 'https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore', claim: 'Hosted restoration includes database roles/schema/data, migration history and separate Storage-object handling; it has not been performed here.' },
    ],
    documentationNotes: ['Supabase changelog.md fetch returned HTTP400 unsupported text/markdown in the web tool; current backup documentation and MCP search_docs were read instead. No Supabase feature/schema change is implemented by this drill.'],
    remainingAcceptance: [
      'Export actual production database through an authorized backup route without exposing credentials; inspect backup recency/retention.',
      'Restore a real hosted backup into an isolated destination with no live writers or schedulers, preserve auth/roles/grants/migrations, and verify original identities and decisions.',
      'Independently export and restore actual private Storage bodies and metadata through the Storage service, with a complete hash manifest and missing-body detection.',
      'Verify owner, other-user and anonymous signed-JWT/HTTP access plus downloaded-body hashes after hosted restoration; local SQL role claims do not establish these.',
      'Verify production encryption-key availability/reconnection and restore handling for calendar credentials and immutable commands without resending any approved action; this fixture deliberately has zero credentials/commands.',
      'Measure hosted recovery point/object completeness and recovery duration; local timings are not a production RPO/RTO guarantee.',
      'Safe production retention/race handling and orphan cleanup remain disabled until separately verified.',
    ],
    limitations: ['No production facts or captures were exported.', 'No managed Supabase backup was restored.', 'No Storage HTTP transfer, Auth/JWT verification, offsite/encrypted backup or cross-version restore was tested.', 'No destructive operation touched production.'],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${checks.length} local recovery checks passed; hosted backup and Storage restoration remain unverified. No production access or paid usage.`);
} finally {
  for (const db of [source, restored, reopen]) if (db && !db.closed) await db.close();
}
