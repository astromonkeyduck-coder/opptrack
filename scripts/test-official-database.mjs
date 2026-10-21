/** Real PostgreSQL migrations/RLS plus production collectors/ingestion. HTTP is synthetic; Storage bodies are in memory. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { collectOfficialDeadlines } from '../lib/collection/official-deadlines.ts';
import { collectOfficialTickets } from '../lib/collection/official-tickets.ts';
import { ingestCollectedBatch, runLeasedCollection, dispatchDueSources, toDatabaseBatch } from '../lib/ingestion/index.ts';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const officialIds = ['fsu-onf-dates', 'fsu-cre-applications', 'fsu-career-deadlines', 'fsu-opening-nights'];
const migration = '20261021233742_official_milestone_monitoring.sql';
const sql = async (query, args = []) => (await db.query(query, args)).rows;
const scalar = async (query, args = []) => Object.values((await sql(query, args))[0])[0];
const iso = value => new Date(value).toISOString();
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function role(name, uid, fn) {
  await db.exec(`set role ${name}`); await sql("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
  try { return await fn(); } finally { await db.exec('reset role'); await db.exec('reset request.jwt.claim.sub'); }
}
const source = async id => (await sql('select * from public.sources where id=$1', [id]))[0];
const objects = new Map(); let uploads = 0, reuses = 0, verifiedDownloads = 0, failUploads = false;
const rpcCalls = [];
const client = {
  from: table => {
    assert.equal(table, 'tracker_members');
    return { select: columns => { assert.equal(columns, 'user_id'); return { limit: async count => ({ data: await role('service_role', null, () => sql('select user_id from public.tracker_members limit $1', [count])), error: null }) }; } };
  },
  storage: { from: bucket => {
    assert.equal(bucket, 'captures');
    return {
      upload: async (path, bytes, options) => {
        assert.equal(options.upsert, false); assert.ok(path.startsWith(owner + '/sources/'));
        if (failUploads) return { error: { code: 'synthetic_storage_failure' } };
        if (objects.has(path)) { reuses++; return { error: { status: 409, code: 'ResourceAlreadyExists' } }; }
        objects.set(path, Buffer.from(bytes)); uploads++;
        await role('service_role', null, () => sql("insert into storage.objects(bucket_id,name,metadata) values('captures',$1,$2::jsonb)", [path, JSON.stringify({ size: Buffer.byteLength(bytes), mimetype: options.contentType })]));
        return { error: null };
      },
      download: async path => { verifiedDownloads++; const bytes = objects.get(path); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { code: 'not_found' } }; },
    };
  } },
  rpc: async (name, args) => {
    rpcCalls.push(name);
    try {
      if (name === 'complete_source_run') return { data: await role('service_role', null, () => scalar('select public.complete_source_run($1,$2,$3::jsonb)', [args.p_source_id, args.p_lease_token, JSON.stringify(args.p_batch)])), error: null };
      const names = ['lease_due_sources', 'lease_due_official_sources', 'lease_due_instagram_sources']; assert.ok(names.includes(name));
      return { data: await role('service_role', null, () => sql(`select * from public.${name}($1,$2)`, [args.p_limit, args.p_lease_seconds])), error: null };
    } catch (error) { return { data: null, error: { code: error.code || 'test_sql_error' } }; }
  },
};
const fixtureNow = new Date('2026-10-21T23:40:00Z');
const provenance = { invocationKind: 'replay', triggerRunId: 'run_synthetic_official_database_replay' };
const document = inside => `<!DOCTYPE html><html><body>${inside}</body></html>`;
const onfHtml = document('<div><h4>2026-2027 FELLOWSHIP DEADLINES</h4><p>All materials due.</p><ul><li data-list-item-id="synthetic-fellowship">November 1st (11:59PM EST): <strong>Synthetic fellowship</strong></li></ul></div>');
const careerHtml = document('<h4>Spring 2027 Hiring Timeline</h4><div><table><tr><td>Step</td><td>Deadline</td></tr><tr><td>Intern FSU experiences posted in NoleNetwork</td><td>October 15</td></tr><tr><td>Student application deadline</td><td>November 9 at 11:59 PM</td></tr></table></div>');
const ticketUrl = id => `https://tickets.openingnights.fsu.edu/main/seats/${id}`;
const showUrl = 'https://www.openingnights.fsu.edu/show-details/synthetic-show';
function ticketBodies(action = 'Buy Tickets', id = 111) {
  const listing = document(`<main><article class="highlight-card"><a class="highlight-card-link" href="${showUrl}"><span class="highlight-title-line">Synthetic Show</span><span class="highlight-date-line">November 6, 2026</span><span class="highlight-tag">Music</span></a><div class="highlight-card-actions"><a href="${ticketUrl(id)}">Buy Tickets</a></div></article></main>`);
  const detail = document(`<main><div class="dr-show-hero-copy"><h1>Synthetic Show</h1></div><div class="dr-show-hero-actions"><a class="dr-show-action" href="${ticketUrl(id)}">${action}</a></div></main>`);
  return { listing, detail };
}
function creBody({ deadline = 'Feb 1 2027 11:59 PM (EST)', listing = '/prog/synthetic_idea/', count = 1, page = 1, pages = 1, results } = {}) {
  return JSON.stringify({ has_next: page < pages, has_previous: page > 1, num_pages: pages, page, program_count: count, results: results ?? [{ id: 873, name: 'Synthetic IDEA program', tag_line: 'SQL fixture only', listing_url: listing, startdate: 'Sep 1 2026 12:00 AM (EDT)', deadline, timeline: 'Synthetic explicit program window' }] });
}
const response = body => new Response(body, { headers: { 'content-type': body.startsWith('{') ? 'application/json' : 'text/html' } });
async function creBatch(overrides = {}, time = fixtureNow) {
  return collectOfficialDeadlines('fsu-cre-applications', { now: () => time, fetch: async () => response(creBody(overrides)) });
}
async function fixtureLease(id, slot = '2026-10-21T18:00:00Z', cadence) {
  const token = randomUUID();
  await sql('update public.sources set enabled=true,cadence_seconds=coalesce($4,cadence_seconds),next_poll_at=$2,next_due_at=$2,retry_not_before=null,leased_poll_at=$2,lease_token=$3,lease_until=clock_timestamp()+interval \'10 minutes\',last_attempt_at=clock_timestamp() where id=$1', [id, slot, token, cadence ?? null]);
  return source(id);
}
async function complete(id, batch, slot) { return ingestCollectedBatch(await fixtureLease(id, slot), batch, client, provenance); }
const milestone = async native => (await sql('select * from public.milestones where source_id=\'fsu-cre-applications\' and native_id=$1', [native]))[0];
let milestonesCreated = 0;
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const file of migrations.filter(name => name !== migration)) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  await sql('insert into auth.users(id) values($1),($2)', [owner, other]);
  await role('service_role', null, () => sql('select public.configure_tracker_owner($1)', [owner]));
  for (const id of officialIds) await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,coverage_note) values($1,$2,$1,$3,$4,false,$5,null,null,'Synthetic local official source fixture')", [id, owner, id === 'fsu-opening-nights' ? 'official-tickets-v1' : 'official-deadlines-v1', id === 'fsu-opening-nights' ? 'https://www.openingnights.fsu.edu/events' : id === 'fsu-onf-dates' ? 'https://onf.fsu.edu/important-dates' : id === 'fsu-career-deadlines' ? 'https://career.fsu.edu/programs-services/internfsu' : 'https://fsu-cre.smapply.us/prog/ds/?page=1&base_query=all', id === 'fsu-opening-nights' ? 3600 : 21600]);
  const beforeMigration = await sql('select * from public.sources order by id');
  await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  await check('new migration preserves all source state and activates no sources', async () => assert.deepEqual(await sql('select * from public.sources order by id'), beforeMigration));
  await check('exact-source activation is idempotent and preserves unrelated rows plus an existing active source cursor/lease', async () => {
    const activation = await readFile('scripts/activate-official-sources.sql', 'utf8');
    const unrelatedBefore = await sql('select * from public.sources where not (id=any($1::text[])) order by id', [officialIds]);
    await db.exec(activation);
    assert.deepEqual(await sql('select * from public.sources where not (id=any($1::text[])) order by id', [officialIds]), unrelatedBefore);
    const token = randomUUID();
    await sql("update public.sources set cursor='{\"kept\":true}',health_status='success',lease_token=$1,lease_until=clock_timestamp()+interval '1 minute' where id='fsu-onf-dates'", [token]);
    const before = await sql('select * from public.sources order by id'); await db.exec(activation);
    assert.deepEqual(await sql('select * from public.sources order by id'), before);
    await db.exec("update public.sources set lease_token=null,lease_until=null where id='fsu-onf-dates'");
  });
  await check('only exact authorized official source IDs and adapters qualify for four-source leases', async () => {
    await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,coverage_note) values('not-authorized-official',$1,'Synthetic wrong ID','official-deadlines-v1','https://onf.fsu.edu/important-dates',true,21600,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day','Synthetic disallowed route')", [owner]);
    await db.exec("update public.sources set enabled=true,next_due_at=clock_timestamp()-interval '1 day',next_poll_at=clock_timestamp()-interval '1 day' where id in ('fsu-onf-dates','fsu-cre-applications','fsu-career-deadlines','fsu-opening-nights')");
    const leases = await role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,600)'));
    assert.deepEqual(leases.map(row => row.id).sort(), [...officialIds].sort());
    assert.equal((await source('not-authorized-official')).lease_token, null);
    await db.exec("update public.sources set lease_token=null,lease_until=null,adapter='unconfigured' where id='fsu-onf-dates'");
    assert.equal((await role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,600)'))).length, 0);
    await db.exec("update public.sources set adapter='official-deadlines-v1' where id='fsu-onf-dates'");
  });
  await check('four official leases remain separate from three core leases and all27 social leases', async () => {
    await db.exec("update public.sources set adapter='hq-ics-v1',cadence_seconds=21600 where id='fsu-hq-public-export'");
    for (let i = 0; i < 27; i++) await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,coverage_note) values($1,$2,$1,'instagram-business-discovery-v1','https://www.instagram.com/synthetic/',true,3600,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day','Synthetic social budget')", ['instagram-official-fixture-' + i, owner]);
    await db.exec("update public.sources set enabled=true,next_poll_at=clock_timestamp()-interval '1 day',next_due_at=clock_timestamp()-interval '1 day',lease_token=null,lease_until=null,retry_not_before=null where cadence_seconds is not null and id<>'not-authorized-official'");
    const core = await role('service_role', null, () => sql('select * from public.lease_due_sources(3,600)'));
    const official = await role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,600)'));
    const social = await role('service_role', null, () => sql('select * from public.lease_due_instagram_sources(27,600)'));
    assert.equal(core.length, 3); assert.deepEqual(core.map(row => row.id).sort(), ['fsu-calendar-api', 'fsu-hq-public-export', 'fsu-music-events']);
    assert.equal(official.length, 4); assert.equal(social.length, 27); assert.equal(new Set([...core, ...official, ...social].map(row => row.id)).size, 34);
  });
  await check('official lease limits and worker-only privileges reject browsers and private-function calls', async () => {
    await assert.rejects(() => role('service_role', null, () => sql('select * from public.lease_due_official_sources(5,600)')), /Invalid lease limits/);
    await assert.rejects(() => role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,20)')), /Invalid lease limits/);
    for (const name of ['anon', 'authenticated']) await assert.rejects(() => role(name, owner, () => sql('select * from public.lease_due_official_sources(4,600)')), /permission denied/);
    for (const name of ['anon', 'authenticated', 'service_role']) await assert.rejects(() => role(name, owner, () => sql('select * from tracker_private.lease_due_official_sources(4,600)')), /permission denied/);
  });
  await db.exec('update public.sources set enabled=false,lease_token=null,lease_until=null');
  const initial = await creBatch(); assert.equal(initial.status, 'success');
  await check('production deadline collector and ingestion persist real SQL milestones without attendance occurrences', async () => {
    await complete('fsu-cre-applications', initial);
    assert.equal(await scalar('select count(*)::integer from public.opportunities'), 1); assert.equal(await scalar('select count(*)::integer from public.milestones'), 2); assert.equal(await scalar('select count(*)::integer from public.occurrences'), 0);
    const deadline = await milestone('873:application_deadline'); assert.equal(iso(deadline.occurs_at), '2027-02-02T04:59:00.000Z'); assert.equal(deadline.availability, 'within_published_window'); assert.equal(deadline.revision, 1);
    assert.equal(await scalar("select facts->>'kind' from public.entity_versions where opportunity_id is not null"), 'program');
    assert.equal(await scalar('select public from storage.buckets where id=\'captures\''), false);
  });
  const originalMilestoneId = (await milestone('873:application_deadline')).id;
  await check('immutable private captures, native evidence claims and current-version local text survive SQL normalization', async () => {
    assert.equal(objects.size, 1); assert.equal(uploads, 1);
    assert.equal(await scalar("select count(*)::integer from public.field_claims where milestone_id is not null and evidence_pointer='official-deadline:cre:873:application_deadline'"), 3);
    const row = await role('authenticated', owner, () => scalar("select source_local_text from public.milestone_inbox where native_id='873:application_deadline'")); assert.equal(row, 'Feb 1 2027 11:59 PM (EST)');
    assert.ok(await scalar("select bool_and(storage_path like $1) from public.captures", [owner + '/sources/%']));
  });
  await check('unchanged replay preserves milestone identity/revision/versions and verifies duplicate Storage bytes', async () => {
    const versions = await scalar('select count(*)::integer from public.entity_versions'); const claims = await scalar('select count(*)::integer from public.field_claims');
    await complete('fsu-cre-applications', await creBatch());
    assert.equal((await milestone('873:application_deadline')).id, originalMilestoneId); assert.equal((await milestone('873:application_deadline')).revision, 1);
    assert.equal(await scalar('select count(*)::integer from public.entity_versions'), versions); assert.equal(await scalar('select count(*)::integer from public.field_claims'), claims);
    assert.equal(uploads, 1); assert.equal(reuses, 1); assert.equal(verifiedDownloads, 1); assert.equal(await scalar('select count(*)::integer from public.source_runs'), 2);
  });
  await check('changed application date appends a revision/version while preserving stable native milestone identity', async () => {
    await complete('fsu-cre-applications', await creBatch({ deadline: 'Feb 2 2027 11:59 PM (EST)' }));
    const row = await milestone('873:application_deadline'); assert.equal(row.id, originalMilestoneId); assert.equal(row.revision, 2); assert.equal(iso(row.occurs_at), '2027-02-03T04:59:00.000Z');
    assert.equal(await scalar('select count(*)::integer from public.entity_versions where milestone_id=$1', [row.id]), 2);
    assert.equal(await scalar("select source_local_text from public.milestone_inbox where id=$1", [row.id]), 'Feb 2 2027 11:59 PM (EST)');
  });
  await check('published-window availability transition appends a version without creating a new milestone', async () => {
    await complete('fsu-cre-applications', await creBatch({ deadline: 'Feb 2 2027 11:59 PM (EST)' }, new Date('2027-02-03T05:00:00Z')));
    const row = await milestone('873:application_deadline'); assert.equal(row.id, originalMilestoneId); assert.equal(row.revision, 3); assert.equal(row.availability, 'closed_by_published_window');
  });
  await check('changed official application link updates the same milestone and retains older action claims', async () => {
    await complete('fsu-cre-applications', await creBatch({ deadline: 'Feb 2 2027 11:59 PM (EST)', listing: '/prog/synthetic_idea_updated/' }, new Date('2027-02-03T05:00:00Z')));
    const row = await milestone('873:application_deadline'); assert.equal(row.id, originalMilestoneId); assert.equal(row.revision, 4); assert.equal(row.action_url, 'https://fsu-cre.smapply.us/prog/synthetic_idea_updated/');
    assert.equal(await scalar("select count(distinct value)::integer from public.field_claims where milestone_id=$1 and field='action_url'", [row.id]), 2);
    assert.equal(await scalar('select count(*)::integer from public.entity_versions where milestone_id=$1', [row.id]), 4);
  });
  await check('unknown-year fellowship and career milestones remain visible in the invoker view with no invented instant', async () => {
    for (const [id, body] of [['fsu-onf-dates', onfHtml], ['fsu-career-deadlines', careerHtml]]) await complete(id, await collectOfficialDeadlines(id, { now: () => fixtureNow, fetch: async () => response(body) }));
    assert.equal(await role('authenticated', owner, () => scalar("select count(*)::integer from public.milestone_inbox where source_id in ('fsu-onf-dates','fsu-career-deadlines') and occurs_at is null and occurs_on is null and source_local_text is not null")), 3);
    assert.equal(await scalar('select count(*)::integer from public.occurrences'), 0);
  });
  await check('explicit ticket release is a separate milestone; changed links preserve show/occurrence/release identities', async () => {
    const fixture = async id => { const bodies = ticketBodies('Tickets go on sale October 30, 2026 at 10:00 AM', id); return collectOfficialTickets({ now: () => fixtureNow, fetch: async url => response(String(url).endsWith('/events') ? bodies.listing : bodies.detail) }); };
    const first = await fixture(111); assert.equal(first.status, 'success'); await complete('fsu-opening-nights', first);
    const before = await sql("select id,native_id from public.milestones where source_id='fsu-opening-nights' order by native_id"); const occurrenceId = await scalar("select id from public.occurrences where source_id='fsu-opening-nights'");
    await complete('fsu-opening-nights', await fixture(222));
    assert.deepEqual(await sql("select id,native_id from public.milestones where source_id='fsu-opening-nights' order by native_id"), before); assert.equal(await scalar("select id from public.occurrences where source_id='fsu-opening-nights'"), occurrenceId);
    const release = (await sql("select * from public.milestone_inbox where source_id='fsu-opening-nights' and kind='ticket_release'"))[0];
    assert.equal(iso(release.occurs_on).slice(0, 10), '2026-10-30'); assert.equal(release.occurs_at, null); assert.equal(release.timezone, null); assert.match(release.source_local_text, /10:00 AM/); assert.equal(release.action_url, ticketUrl(222)); assert.equal(release.revision, 2);
  });
  await check('an organizer removing an explicit release notice clears the current deadline without losing its historical version', async () => {
    const before = (await sql("select * from public.milestones where source_id='fsu-opening-nights' and kind='ticket_release'"))[0];
    const bodies = ticketBodies('Buy Tickets', 222);
    const batch = await collectOfficialTickets({ now: () => fixtureNow, fetch: async url => response(String(url).endsWith('/events') ? bodies.listing : bodies.detail) });
    assert.equal(batch.status, 'success'); await complete('fsu-opening-nights', batch);
    const after = (await sql("select * from public.milestones where source_id='fsu-opening-nights'"))[0];
    assert.equal(after.id, before.id); assert.equal(after.kind, 'ticket_link'); assert.equal(after.occurs_on, null); assert.equal(after.occurs_at, null); assert.equal(after.revision, before.revision + 1);
    assert.equal(await scalar("select count(*)::integer from public.milestones where source_id='fsu-opening-nights'"), 1);
    assert.ok(await scalar("select count(*)::integer from public.entity_versions where milestone_id=$1 and facts->>'kind'='ticket_release'", [after.id]) > 0);
  });
  await check('partial/truncated collection records failure and preserves last success, cursor and prior milestones', async () => {
    const before = await source('fsu-cre-applications'); const count = await scalar('select count(*)::integer from public.milestones');
    const partial = await collectOfficialDeadlines('fsu-cre-applications', { now: () => fixtureNow, maxPages: 1, fetch: async () => response(creBody({ count: 2, pages: 2 })) }); assert.equal(partial.status, 'partial');
    await complete('fsu-cre-applications', partial);
    const after = await source('fsu-cre-applications'); assert.equal(after.health_status, 'partial'); assert.deepEqual(after.cursor, before.cursor); assert.deepEqual(after.last_success_at, before.last_success_at); assert.ok(after.retry_not_before);
    assert.equal(await scalar('select count(*)::integer from public.milestones'), count); assert.equal(await scalar("select cursor_after is null from public.source_runs where source_id='fsu-cre-applications' order by created_at desc limit 1"), true);
  });
  await check('a captured genuinely empty complete directory succeeds without deleting retained programs or milestones', async () => {
    const count = await scalar('select count(*)::integer from public.milestones'); const empty = await collectOfficialDeadlines('fsu-cre-applications', { now: () => fixtureNow, fetch: async () => response(creBody({ count: 0, results: [] })) }); assert.equal(empty.status, 'success');
    await complete('fsu-cre-applications', empty); const row = await source('fsu-cre-applications'); assert.equal(row.health_status, 'success'); assert.equal(row.cursor.programs, 0); assert.equal(row.cursor.milestones, 0); assert.equal(await scalar('select count(*)::integer from public.milestones'), count);
  });
  await check('rate limit preserves nominal source slot and enforces Retry-After before official leasing', async () => {
    await db.exec('update public.sources set enabled=false'); const lease = await fixtureLease('fsu-onf-dates'); const before = await source('fsu-onf-dates');
    const blocked = await collectOfficialDeadlines('fsu-onf-dates', { now: () => fixtureNow, fetch: async () => new Response('synthetic rate limit', { status: 429, headers: { 'retry-after': '7200' } }) });
    await ingestCollectedBatch(lease, blocked, client, provenance); const after = await source('fsu-onf-dates');
    assert.equal(after.health_status, 'rate_limited'); assert.deepEqual(after.cursor, before.cursor); assert.deepEqual(after.last_success_at, before.last_success_at); assert.equal(iso(after.next_poll_at), iso(lease.next_poll_at)); assert.ok(new Date(after.retry_not_before).getTime() > Date.now() + 7_190_000);
    assert.equal((await role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,600)'))).length, 0);
  });
  await check('hourly ticket and six-hour deadline processing across UTC boundaries cannot skip the next nominal poll', async () => {
    for (const [id, slot, next, cadence] of [['fsu-onf-dates', '2026-10-21T18:00:00Z', '2026-10-22T00:00:00Z', 21600], ['fsu-opening-nights', '2026-10-21T23:00:00Z', '2026-10-22T00:00:00Z', 3600]]) {
      const batch = id === 'fsu-onf-dates' ? await collectOfficialDeadlines(id, { now: () => fixtureNow, fetch: async () => response(onfHtml) }) : await collectOfficialTickets({ now: () => fixtureNow, fetch: async url => { const body = ticketBodies(); return response(String(url).endsWith('/events') ? body.listing : body.detail); } });
      batch.startedAt = new Date(Date.parse(next) - 60_000).toISOString(); batch.finishedAt = new Date(Date.parse(next) + 60_000).toISOString();
      await ingestCollectedBatch(await fixtureLease(id, slot, cadence), batch, client, provenance);
      assert.equal(iso((await source(id)).next_poll_at), iso(next)); assert.equal(iso((await source(id)).next_due_at), iso(next));
    }
  });
  await check('missed official slots coalesce once and expired leases retain their failed-run slot evidence', async () => {
    await db.exec('update public.sources set enabled=false');
    await db.exec("update public.sources set enabled=true,next_poll_at=clock_timestamp()-interval '2 days',next_due_at=clock_timestamp()-interval '2 days',retry_not_before=null,lease_token=null,lease_until=null where id='fsu-onf-dates'");
    const [lease] = await role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,600)'));
    assert.equal(iso(lease.leased_poll_at), iso(await scalar("select date_bin(interval '6 hours',$1::timestamptz,timestamptz '2000-01-01Z')", [lease.last_attempt_at])));
    await db.exec("update public.sources set lease_until=clock_timestamp()-interval '1 second' where id='fsu-onf-dates'");
    const [recovered] = await role('service_role', null, () => sql('select * from public.lease_due_official_sources(4,600)'));
    assert.notEqual(recovered.lease_token, lease.lease_token); assert.equal(recovered.health_status, 'failed');
    const failed = (await sql("select * from public.source_runs where source_id='fsu-onf-dates' and parser_version='lease-recovery-v3' order by created_at desc limit 1"))[0]; assert.equal(failed.outcome, 'failed'); assert.equal(iso(failed.scheduled_poll_at), iso(lease.leased_poll_at));
  });
  await check('production dispatcher actually invokes the separate official RPC and ingests all four fixtures', async () => {
    await db.exec('update public.sources set enabled=false,lease_token=null,lease_until=null');
    await db.exec("update public.sources set enabled=true,next_due_at=clock_timestamp()-interval '1 day',next_poll_at=clock_timestamp()-interval '1 day',retry_not_before=null where id in ('fsu-onf-dates','fsu-cre-applications','fsu-career-deadlines','fsu-opening-nights')");
    const oldFetch = globalThis.fetch; const bodies = ticketBodies();
    try {
      globalThis.fetch = async url => {
        const value = String(url);
        if (value.startsWith('https://fsu-cre.smapply.us/prog/ds/')) return response(creBody());
        if (value === 'https://onf.fsu.edu/important-dates') return response(onfHtml);
        if (value === 'https://career.fsu.edu/programs-services/internfsu') return response(careerHtml);
        if (value === 'https://www.openingnights.fsu.edu/events') return response(bodies.listing);
        if (value === showUrl) return response(bodies.detail);
        throw new Error('Unexpected network access in synthetic replay');
      };
      const start = rpcCalls.length; const results = await dispatchDueSources(3, client, provenance, { SOCIAL_COLLECTION_ENABLED: 'false' });
      assert.equal(results.length, 4); assert.ok(results.every(result => result.outcome === 'success')); assert.deepEqual(results.map(result => result.sourceId).sort(), [...officialIds].sort());
      assert.ok(rpcCalls.slice(start).includes('lease_due_official_sources')); assert.ok(!rpcCalls.slice(start).includes('lease_due_instagram_sources'));
    } finally { globalThis.fetch = oldFetch; }
  });
  await check('owner-only milestones, versions, claims, captures and invoker view deny other-user/anonymous reads and browser writes', async () => {
    for (const table of ['milestones', 'entity_versions', 'field_claims', 'captures', 'source_runs', 'milestone_inbox']) {
      assert.ok(await role('authenticated', owner, () => scalar(`select count(*)::integer from public.${table}`)) > 0);
      assert.equal(await role('authenticated', other, () => scalar(`select count(*)::integer from public.${table}`)), 0);
      await assert.rejects(() => role('anon', null, () => sql(`select * from public.${table}`)), /permission denied/);
    }
    assert.ok(await role('authenticated', owner, () => scalar('select count(*)::integer from storage.objects')) > 0); assert.equal(await role('authenticated', other, () => scalar('select count(*)::integer from storage.objects')), 0); assert.equal(await role('anon', null, () => scalar('select count(*)::integer from storage.objects')), 0);
    await assert.rejects(() => role('authenticated', owner, () => sql("update public.milestones set action_url='https://example.com'")), /permission denied/);
    await assert.rejects(() => role('authenticated', owner, () => sql("update public.sources set enabled=false")), /permission denied/);
    assert.ok((await scalar("select reloptions from pg_class where oid='public.milestone_inbox'::regclass")).includes('security_invoker=true'));
  });
  await check('forged native timing is rejected before upload or SQL and Storage failure leaves cursor and lease recoverable', async () => {
    const forged = await creBatch(); forged.milestones[0].occursAt = '2030-01-01T00:00:00Z'; const lease = await fixtureLease('fsu-cre-applications'); const before = await source(lease.id); const beforeUploads = uploads;
    assert.throws(() => toDatabaseBatch(lease, forged, provenance)); assert.equal(uploads, beforeUploads);
    failUploads = true;
    try { await assert.rejects(() => ingestCollectedBatch(lease, initial, client, provenance), /Private capture upload failed/); } finally { failUploads = false; }
    const after = await source(lease.id); assert.deepEqual(after.cursor, before.cursor); assert.deepEqual(after.last_success_at, before.last_success_at); assert.equal(after.lease_token, lease.lease_token);
  });
  await check('composite ownership foreign keys reject cross-owner milestone references even under a worker role', async () => {
    const row = await milestone('873:application_deadline');
    await assert.rejects(() => role('service_role', null, () => sql('update public.milestones set owner_id=$1 where id=$2', [other, row.id])), /foreign key constraint/);
    assert.equal((await milestone('873:application_deadline')).owner_id, owner);
  });
  milestonesCreated = await scalar('select count(*)::integer from public.milestones');
  const report = { runAt: new Date().toISOString(), database: 'PGlite 0.5.10 actual PostgreSQL WASM', migrations, passed: checks.length, checks, fixtureClass: 'Synthetic official program/ticket HTML and JSON, source times and Trigger IDs; production collector/dispatcher/ingestion modules; actual PostgreSQL migrations, FK, roles and RLS; in-memory immutable Storage body substitute with actual SQL object metadata', counts: { opportunities: await scalar('select count(*)::integer from public.opportunities'), milestones: milestonesCreated, occurrences: await scalar('select count(*)::integer from public.occurrences'), sourceRuns: await scalar('select count(*)::integer from public.source_runs'), versions: await scalar('select count(*)::integer from public.entity_versions'), fieldClaims: await scalar('select count(*)::integer from public.field_claims') }, storageSubstitute: { uploads, duplicateReuses: reuses, verifiedDownloads, objects: objects.size }, calendarWrites: 0, paidServicesEnabled: 0, hostedNetworkRequests: 0, actualCloudCostUsd: 0, notTested: ['Hosted migration or source activation', 'Real Trigger scheduled ingestion', 'Hosted signed-JWT and Storage HTTP', 'Distributed simultaneous lock contention', 'Actual Google writes', 'Automated email notifications', 'Backup/restore and production retention'] };
  await writeFile('reports/official-database-tests.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`${checks.length} official database/worker regression checks passed.`);
} finally { await db.close(); }
