/** Read-only hosted smoke/audit. No login, signup, SQL execution, writes or secret output. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';

const args = new Map(process.argv.slice(2).map(argument => {
  const index = argument.indexOf('=');
  return index < 0 ? [argument, true] : [argument.slice(0, index), argument.slice(index + 1)];
}));
if (args.has('--help')) {
  console.log('Usage: node scripts/check-hosted-access.mjs [--app-url=https://SITE] [--netlify-site-id=ID] [--trigger-run-id=run_ID] [--expected-commit=SHA] [--output=private/REPORT.json]');
  console.log('Reads ignored local/target dotenv files and optional .env.hosted-check.local. GET only; no secret values printed.');
  process.exit(0);
}
for (const [name, value] of args) {
  if (!['--app-url', '--netlify-site-id', '--trigger-run-id', '--expected-commit', '--output'].includes(name) || typeof value !== 'string' || !value) throw new Error('Use documented --name=value arguments.');
}
const load = filename => existsSync(filename) ? parseEnv(readFileSync(filename, 'utf8')) : {};
const local = load('.env.local');
const web = load('.env.netlify.production.local');
const worker = load('.env.trigger.production.local');
const audit = load('.env.hosted-check.local');
const config = JSON.parse(readFileSync('config/production-environments.json', 'utf8'));
const values = {
  appUrl: args.get('--app-url') || web.APP_URL || worker.APP_URL || null,
  supabaseUrl: web.NEXT_PUBLIC_SUPABASE_URL || worker.SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL || null,
  publicKey: web.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || null,
  serviceKey: worker.SUPABASE_SECRET_KEY || local.SUPABASE_SECRET_KEY || null,
  ownerToken: audit.HOSTED_CHECK_OWNER_ACCESS_TOKEN || null,
  otherToken: audit.HOSTED_CHECK_OTHER_ACCESS_TOKEN || null,
  netlifyToken: audit.NETLIFY_AUTH_TOKEN || null,
  netlifySiteId: args.get('--netlify-site-id') || config.hosted_targets.netlify_site_id || null,
  triggerKey: audit.TRIGGER_PRODUCTION_READ_KEY || web.TRIGGER_SECRET_KEY || null,
  triggerRunId: args.get('--trigger-run-id') || null,
  expectedCommit: args.get('--expected-commit') || null,
};
const output = path.resolve(String(args.get('--output') || 'private/stage-1-hosted-check.json'));
const privateRoot = path.resolve('private') + path.sep;
if (!output.startsWith(privateRoot)) throw new Error('Audit reports must remain inside private/.');
const checks = [];
let requests = 0;
const record = (name, state, detail = {}) => checks.push({ name, state, ...detail });
const presence = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Boolean(value)]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const origin = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid_https_origin');
  return url.origin;
};

async function read(url, headers = {}, maxBytes = 3 * 1024 * 1024) {
  requests++;
  try {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (Number(response.headers.get('content-length') || 0) > maxBytes) { await response.body?.cancel(); return { status: response.status, oversized: true }; }
    const reader = response.body?.getReader();
    const parts = []; let size = 0;
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return { status: response.status, oversized: true }; }
      parts.push(part.value);
    }
    const bytes = Buffer.concat(parts);
    let json = null;
    try { json = JSON.parse(bytes.toString('utf8')); } catch { /* HTML/binary is expected for some read checks. */ }
    return { status: response.status, json, bytes, count: Number(response.headers.get('content-range')?.split('/').at(-1)), location: response.headers.get('location') };
  } catch { return { status: null, transportFailure: true }; }
}
const ok = result => result.status >= 200 && result.status < 300 && !result.oversized;
const denied = result => [401, 403, 404].includes(result.status);
const missing = name => record(name, 'setup_needed');

let base, ownerId, capture, serviceInboxCount = 0;
if (!values.supabaseUrl || !values.publicKey) missing('supabase_public_access');
else {
  try {
    base = origin(values.supabaseUrl);
    if (base !== `https://${config.hosted_targets.supabase_project_ref}.supabase.co`) throw new Error('unverified_project_origin');
  } catch { record('supabase_origin', 'failed'); base = null; }
  if (!values.publicKey.startsWith('sb_publishable_')) { record('supabase_public_key_type', 'failed'); base = null; }
}
if (base) {
  const publicHeaders = { apikey: values.publicKey };
  const anonMembership = await read(`${base}/rest/v1/rpc/is_tracker_member`, publicHeaders);
  record('anonymous_membership_denied', ok(anonMembership) && anonMembership.json === false ? 'passed' : 'failed', { httpStatus: anonMembership.status });
  const authSettings = await read(`${base}/auth/v1/settings`, publicHeaders);
  record('public_signup_disabled', ok(authSettings) && authSettings.json?.disable_signup === true ? 'passed' : 'failed', { httpStatus: authSettings.status });
  const tables = ['sources', 'source_runs', 'captures', 'run_captures', 'opportunities', 'occurrences', 'milestones', 'entity_versions', 'field_claims', 'user_decisions', 'manual_intakes', 'review_inbox'];
  const serviceHeaders = values.serviceKey?.startsWith('sb_secret_') ? { apikey: values.serviceKey, Prefer: 'count=exact' } : null;
  if (!serviceHeaders) missing('service_schema_and_provenance');
  for (const table of tables) {
    const selector = table === 'run_captures' ? 'capture_id' : 'id';
    const endpoint = `${base}/rest/v1/${table}?select=${selector}&limit=1`;
    const results = await Promise.all([read(endpoint, publicHeaders), serviceHeaders ? read(endpoint, serviceHeaders) : null]);
    const [anon, service] = results;
    const exists = service && ok(service) && Array.isArray(service.json);
    if (table === 'review_inbox' && exists) serviceInboxCount = service.count;
    if (service) record(`service_schema_${table}`, exists ? 'passed' : 'failed', { httpStatus: service.status, rows: Number.isFinite(service.count) ? service.count : null, boundary: 'service-key read; not an owner/RLS proof' });
    const anonRows = Array.isArray(anon.json) ? anon.json.length : null;
    const state = denied(anon) ? 'passed' : ok(anon) && anonRows === 0 && service?.count > 0 ? 'passed' : ok(anon) && anonRows === 0 ? 'not_demonstrated_empty' : 'failed';
    record(`anonymous_rows_${table}`, state, { httpStatus: anon.status, returnedRows: anonRows });
  }
  if (serviceHeaders) {
    const member = await read(`${base}/rest/v1/tracker_members?select=user_id&limit=2`, serviceHeaders);
    if (ok(member) && member.json?.length === 1) { ownerId = member.json[0].user_id; record('single_owner_registered', 'passed'); }
    else record('single_owner_registered', 'failed', { httpStatus: member.status });
    const bucket = await read(`${base}/storage/v1/bucket/captures`, serviceHeaders);
    record('captures_bucket_private', ok(bucket) && bucket.json?.public === false ? 'passed' : 'failed', { httpStatus: bucket.status });
    const sources = await read(`${base}/rest/v1/sources?select=id,enabled,cadence_seconds,health_status,last_attempt_at,last_success_at,next_due_at&order=id&limit=100`, serviceHeaders);
    if (ok(sources) && Array.isArray(sources.json)) {
      const active = sources.json.filter(source => source.enabled);
      record('only_two_free_adapters_enabled', active.length === 2 && active.every(source => ['fsu-calendar-api', 'fsu-music-events'].includes(source.id)) ? 'passed' : 'failed', { sources: sources.json });
    } else record('source_health_available', 'failed', { httpStatus: sources.status });
    const runs = await read(`${base}/rest/v1/source_runs?select=id,source_id,outcome,pagination_complete,started_at,finished_at,request_count,opportunity_count,occurrence_count,parser_version&order=finished_at.desc&limit=20`, serviceHeaders);
    record('recent_source_runs', ok(runs) && Array.isArray(runs.json) && runs.json.length ? 'passed' : 'not_demonstrated', { httpStatus: runs.status, runs: Array.isArray(runs.json) ? runs.json : [], boundary: 'Database timestamps/counts do not alone identify a Trigger Cloud run or prove a laptop-off window' });
    if (Array.isArray(runs.json)) for (const sourceId of ['fsu-calendar-api', 'fsu-music-events']) {
      const run = runs.json.find(item => item.source_id === sourceId);
      if (!run) { missing(`durable_run_captures_${sourceId}`); continue; }
      const links = await read(`${base}/rest/v1/run_captures?select=capture_id&run_id=eq.${encodeURIComponent(run.id)}&limit=100`, serviceHeaders);
      record(`durable_run_captures_${sourceId}`, ok(links) && links.json?.length > 0 && run.outcome === 'success' && run.pagination_complete === true && run.request_count > 0 ? 'passed' : 'failed', { sourceRunId: run.id, outcome: run.outcome, captureCount: Array.isArray(links.json) ? links.json.length : null, httpStatus: links.status });
    }
    const captured = await read(`${base}/rest/v1/captures?select=id,source_id,storage_path,content_sha256,byte_count&storage_path=not.is.null&purged_at=is.null&order=fetched_at.desc&limit=1`, serviceHeaders);
    capture = ok(captured) && Array.isArray(captured.json) ? captured.json[0] : null;
    if (capture?.storage_path) {
      const objectPath = capture.storage_path.split('/').map(encodeURIComponent).join('/');
      const object = await read(`${base}/storage/v1/object/authenticated/captures/${objectPath}`, serviceHeaders);
      const confirmed = ok(object) && object.bytes && hash(object.bytes) === capture.content_sha256 && object.bytes.length === Number(capture.byte_count);
      record('service_capture_object_hash', confirmed ? 'passed' : 'failed', { httpStatus: object.status, captureId: capture.id, boundary: 'Service read verifies object integrity; not owner download policy' });
      const publicObject = await read(`${base}/storage/v1/object/public/captures/${objectPath}`, publicHeaders);
      record('known_object_public_download_denied', confirmed && denied(publicObject) ? 'passed' : 'failed', { httpStatus: publicObject.status });
      const anonObject = await read(`${base}/storage/v1/object/authenticated/captures/${objectPath}`, publicHeaders);
      record('known_object_anonymous_download_denied', confirmed && denied(anonObject) ? 'passed' : 'failed', { httpStatus: anonObject.status });
    } else missing('known_capture_object_access');
  }
  for (const [label, token] of [['owner', values.ownerToken], ['other_user', values.otherToken]]) {
    if (!token) { missing(`${label}_authenticated_http`); continue; }
    const headers = { ...publicHeaders, Authorization: `Bearer ${token}`, Prefer: 'count=exact' };
    const user = await read(`${base}/auth/v1/user`, headers);
    const validIdentity = ok(user) && user.json?.id && ownerId && (label === 'owner' ? user.json.id === ownerId : user.json.id !== ownerId);
    record(`${label}_verified_auth_identity`, validIdentity ? 'passed' : 'failed', { httpStatus: user.status });
    if (!validIdentity) continue;
    const membership = await read(`${base}/rest/v1/rpc/is_tracker_member`, headers);
    record(`${label}_membership`, ok(membership) && membership.json === (label === 'owner') ? 'passed' : 'failed', { httpStatus: membership.status });
    const inbox = await read(`${base}/rest/v1/review_inbox?select=id&limit=1`, headers);
    const inboxState = label === 'owner' ? ok(inbox) && inbox.json?.length > 0 ? 'passed' : 'failed' : denied(inbox) ? 'passed' : ok(inbox) && inbox.json?.length === 0 ? serviceInboxCount > 0 ? 'passed' : 'not_demonstrated_empty' : 'failed';
    record(`${label}_inbox_rows`, inboxState, { httpStatus: inbox.status, rows: Number.isFinite(inbox.count) ? inbox.count : null });
    if (capture?.storage_path) {
      const objectPath = capture.storage_path.split('/').map(encodeURIComponent).join('/');
      const object = await read(`${base}/storage/v1/object/authenticated/captures/${objectPath}`, headers);
      record(`${label}_private_object_read`, label === 'owner' ? ok(object) && object.bytes && hash(object.bytes) === capture.content_sha256 ? 'passed' : 'failed' : denied(object) ? 'passed' : 'failed', { httpStatus: object.status });
    }
  }
}

if (!values.appUrl) missing('netlify_public_routes');
else {
  try {
    const app = origin(values.appUrl);
    const home = await read(app);
    record('hosted_signin_page', ok(home) && home.bytes?.toString('utf8').includes('Sign in to your review inbox') ? 'passed' : 'failed', { httpStatus: home.status, boundary: 'Anonymous HTTP smoke only; owner browser login remains required' });
    const inbox = await read(`${app}/inbox`);
    let safeRedirect = false;
    try { const target = new URL(inbox.location, app); safeRedirect = target.origin === app && target.pathname === '/'; } catch { /* Missing/invalid redirect fails. */ }
    record('hosted_inbox_anonymous_redirect', [302, 303, 307, 308].includes(inbox.status) && safeRedirect ? 'passed' : 'failed', { httpStatus: inbox.status });
    const file = await read(`${app}/api/private-media?path=not-an-owned-file`);
    record('hosted_private_media_anonymous_denial', file.status === 401 ? 'passed' : 'failed', { httpStatus: file.status });
  } catch { record('netlify_app_origin', 'failed'); }
}
if (!values.netlifyToken || !values.netlifySiteId) missing('netlify_deployed_commit');
else if (!/^[a-zA-Z0-9-]+$/.test(values.netlifySiteId)) record('netlify_site_id_format', 'failed');
else {
  const site = await read(`https://api.netlify.com/api/v1/sites/${values.netlifySiteId}`, { Authorization: `Bearer ${values.netlifyToken}` });
  const deploy = site.json?.published_deploy;
  record('netlify_published_deploy', ok(site) && deploy?.state === 'ready' ? 'passed' : 'failed', { httpStatus: site.status, deploy: deploy ? { id: deploy.id, state: deploy.state, context: deploy.context, commit_ref: deploy.commit_ref, published_at: deploy.published_at } : null });
  record('netlify_expected_commit', !values.expectedCommit ? 'setup_needed' : deploy?.commit_ref === values.expectedCommit ? 'passed' : 'failed');
}
if (!values.triggerKey || !values.triggerRunId) missing('trigger_production_run');
else if (!values.triggerKey.startsWith('tr_prod_') || !/^run_[a-zA-Z0-9]+$/.test(values.triggerRunId)) record('trigger_production_key_or_run_id', 'failed');
else {
  const result = await read(`https://api.trigger.dev/api/v3/runs/${values.triggerRunId}`, { Authorization: `Bearer ${values.triggerKey}` });
  const run = result.json;
  record('trigger_production_run', ok(result) && run?.status === 'COMPLETED' && run.taskIdentifier === 'opportunity-source-dispatcher' && run.isTest === false ? 'passed' : 'failed', { httpStatus: result.status, run: run ? { id: run.id, status: run.status, taskIdentifier: run.taskIdentifier, isTest: run.isTest, version: run.version, startedAt: run.startedAt, finishedAt: run.finishedAt, scheduled: Boolean(run.schedule?.id), costInCents: run.costInCents, baseCostInCents: run.baseCostInCents } : null, boundary: 'Production provider run is not proof the laptop was off; retain exact source-run correlation separately' });
}
record('migration_catalog_and_policy_definitions', 'not_demonstrated', { reason: 'REST/service reads cannot prove SQL migration fingerprint, RLS flags, view security_invoker or policy definitions. Use a separate read-only SQL audit.' });
record('hosted_owner_browser_login_and_manual_intake', 'not_demonstrated', { reason: 'Complete browser login and private upload/download acceptance with the existing owner. This checker creates no accounts or objects.' });
record('laptop_off_window', 'not_demonstrated', { reason: 'Requires a user-confirmed offline window plus provider run and exact committed SQL run IDs inside it.' });
const report = { checkedAt: new Date().toISOString(), mode: 'read-only-hosted-access-audit', credentialValuesPrinted: false, presence, requests, checks, allStage1HostedCriteriaAccepted: false };
mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
for (const check of checks) console.log(`${check.name}: ${check.state}`);
console.log(`Read-only requests: ${requests}; detailed report saved privately. Hosted acceptance remains a separate gate.`);
process.exitCode = checks.some(check => check.state === 'failed') ? 1 : checks.some(check => check.state !== 'passed') ? 2 : 0;
