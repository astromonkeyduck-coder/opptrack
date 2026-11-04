/**
 * Bounded signed-user HTTPS policy check. Default/help/config/self-test modes
 * never sign in. --run-live is an explicit separate action, for credentials
 * entered directly in the ignored local file by the owner.
 *
 * Creates only normal password-login sessions, then signs out those sessions
 * with scope=local. Does not create users, change passwords, refresh tokens,
 * impersonate users, extract browser credentials or write tracker/Storage data.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

export const PROJECT_ORIGIN = 'https://nuywbvlcwetqjalqvxzb.supabase.co';
const APP_ORIGIN = 'https://luxury-longma-01d2fa.netlify.app';
export const CREDENTIAL_FILE = '.env.stage2-access-check.local';
export const CREDENTIAL_NAMES = ['STAGE2_ACCESS_OWNER_EMAIL', 'STAGE2_ACCESS_OWNER_PASSWORD', 'STAGE2_ACCESS_OTHER_EMAIL', 'STAGE2_ACCESS_OTHER_PASSWORD'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OBJECT_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_REQUESTS = 20;
const DENIAL_CODES = new Set(['NoSuchKey', 'NoSuchBucket', 'BucketNotFound', 'ObjectNotFound', 'NotFound', 'AccessDenied']);
const KNOWN_URL_HASHES = ['81a83252389b80ccccd1237d35c1428127a26e5f413bc99b58baecfeb7a4618c', '6803da5c15cf2166fa03e15ec9b3d6a98b0c92748aec0543dea8a10f44de1b53'];
const KNOWN_BODIES = [{ bytes: 46580, sha256: '9f73107408095c5b30d5597b4b580a6636d993c0d5dc2f36f986dad191a9bbfa' }, { bytes: 57965, sha256: '4769b6f83b9276a2d2aa29bb66fe5ffa516eca4112540be7ef107e685e099fb6' }];
const MANUAL_ID = '8e3027ab-2447-4abb-bef1-a38392252cb7';
const EXTRACTION_ID = '97818d6c-5368-4413-aa2a-86d6fb7b014f';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { auditCode: code }); };
const requireThat = (condition, code) => { if (!condition) fail(code); };
export const isPublishableKey = value => typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]{8,256}$/.test(value);

export function validateConfiguration(config) {
  requireThat(isPublishableKey(config.publishableKey), 'publishable_key_required');
  for (const kind of ['owner', 'other']) {
    const identity = config[kind];
    requireThat(identity && typeof identity.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email) && identity.email.length <= 320, `${kind}_email_required`);
    requireThat(typeof identity.password === 'string' && identity.password.length > 0 && identity.password.length <= 4096, `${kind}_password_required`);
  }
  requireThat(config.owner.email.toLowerCase() !== config.other.email.toLowerCase(), 'distinct_signin_emails_required');
}

export function validateTargets(targets) {
  requireThat(targets && UUID.test(targets.ownerId) && UUID.test(targets.manualId) && UUID.test(targets.extractionId), 'invalid_known_target_ids');
  requireThat(Array.isArray(targets.objects) && targets.objects.length === 2, 'two_known_objects_required');
  for (const item of targets.objects) {
    requireThat(typeof item.path === 'string' && item.path.startsWith(`${targets.ownerId}/`) && /^[a-zA-Z0-9/._-]+$/.test(item.path) && !item.path.includes('..') && !item.path.includes('//'), 'invalid_known_object_path');
    requireThat(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= MAX_OBJECT_BYTES && /^[a-f0-9]{64}$/.test(item.sha256), 'invalid_known_object_integrity');
  }
  requireThat(new Set(targets.objects.map(item => item.path)).size === 2, 'distinct_known_objects_required');
}

function storagePath(item) { return `/storage/v1/object/authenticated/captures/${item.path.split('/').map(encodeURIComponent).join('/')}`; }
function restPath(table, id) { return `/rest/v1/${table}?id=eq.${id}&select=${table === 'manual_intakes' ? 'id,owner_id' : 'id,owner_id,manual_intake_id'}&limit=1`; }
export function allowedRequest(raw, method, targets) {
  const url = new URL(raw);
  if (url.origin !== PROJECT_ORIGIN || url.username || url.password || url.hash) return false;
  const exact = `${url.pathname}${url.search}`;
  return (method === 'POST' && ['/auth/v1/token?grant_type=password', '/auth/v1/logout?scope=local'].includes(exact)) ||
    (method === 'GET' && ['/auth/v1/user', '/rest/v1/rpc/is_tracker_member', restPath('manual_intakes', targets.manualId), restPath('extraction_jobs', targets.extractionId), ...targets.objects.map(storagePath)].includes(exact));
}

async function readBounded(response, maximum) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maximum) { await response.body?.cancel(); fail('response_body_limit'); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return Buffer.concat(parts);
      size += result.value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('response_body_limit'); }
      parts.push(result.value);
    }
  } finally { reader.releaseLock(); }
}

/** Injectable transport exists solely for clearly labeled offline tests. */
export async function runSignedUserAudit(config, targets, { fetchImpl = globalThis.fetch, evidenceClass = 'live_signed_user_https', now = () => Date.now() } = {}) {
  const checks = []; const created = []; let requests = 0; let receivedBytes = 0;
  let errorCode = null; let uncertainSessionCreation = false;
  const started = now();
  const record = (name, passed, details = {}) => { checks.push({ name, state: passed ? 'passed' : 'failed', ...details }); requireThat(passed, name); };
  async function request(relative, { method = 'GET', token, loginBody, cleanup = false, object = false } = {}) {
    const raw = `${PROJECT_ORIGIN}${relative}`;
    requireThat(allowedRequest(raw, method, targets), 'unapproved_http_request');
    requireThat(requests < MAX_REQUESTS, 'request_budget_exceeded');
    if (!cleanup) requireThat(now() - started < 120000, 'audit_deadline_exceeded');
    requests++;
    const headers = { apikey: config.publishableKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (loginBody) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(raw, { method, headers, ...(loginBody ? { body: JSON.stringify(loginBody) } : {}), redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(cleanup ? 10000 : Math.max(1, Math.min(15000, 120000 - (now() - started)))) });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); fail('redirect_refused'); }
      const body = await readBounded(response, object ? MAX_OBJECT_BYTES : MAX_JSON_BYTES);
      receivedBytes += body.length;
      let json = null;
      if (!object || response.status !== 200) { try { json = JSON.parse(body.toString('utf8')); } catch { /* Invalid JSON is never an authorization result. */ } }
      return { status: response.status, body, json };
    } catch (error) { if (error?.auditCode) throw error; fail('http_transport_failure'); }
  }
  async function login(kind) {
    let result;
    try { result = await request('/auth/v1/token?grant_type=password', { method: 'POST', loginBody: config[kind] }); }
    catch (error) { uncertainSessionCreation = true; throw error; }
    // Capture a returned token before validating all other fields, so every
    // usable session created here is cleaned up even if identity checks fail.
    const token = result.json?.access_token;
    if (typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/[\r\n]/.test(token)) created.push({ kind, token });
    if (result.status === 200 && !created.some(item => item.kind === kind)) uncertainSessionCreation = true;
    record(`${kind}_normal_password_login`, result.status === 200 && created.some(item => item.kind === kind) && result.json?.token_type?.toLowerCase() === 'bearer', { status: result.status });
    const identity = await request('/auth/v1/user', { token });
    const id = identity.json?.id;
    record(`${kind}_server_verified_identity`, identity.status === 200 && UUID.test(id || '') && (kind === 'owner' ? id === targets.ownerId : id !== targets.ownerId), { status: identity.status, exactKnownOwner: kind === 'owner', distinctFromKnownOwner: kind === 'other' });
    const membership = await request('/rest/v1/rpc/is_tracker_member', { token });
    record(`${kind}_membership`, membership.status === 200 && membership.json === (kind === 'owner'), { status: membership.status, expectedTrackerMember: kind === 'owner' });
    return token;
  }
  try {
    validateConfiguration(config);
    validateTargets(targets);
    const owner = await login('owner');
    for (const [table, id] of [['manual_intakes', targets.manualId], ['extraction_jobs', targets.extractionId]]) {
      const result = await request(restPath(table, id), { token: owner });
      const rows = result.json;
      record(`owner_${table}_known_row`, result.status === 200 && Array.isArray(rows) && rows.length === 1 && rows[0].id === id && rows[0].owner_id === targets.ownerId && (table !== 'extraction_jobs' || rows[0].manual_intake_id === targets.manualId), { status: result.status });
    }
    for (let i = 0; i < targets.objects.length; i++) {
      const expected = targets.objects[i];
      const result = await request(storagePath(expected), { token: owner, object: true });
      const actualSha256 = sha256(result.body);
      record(`owner_storage_original_${i + 1}`, result.status === 200 && result.body.length === expected.bytes && actualSha256 === expected.sha256, { status: result.status, bytes: result.body.length, bodySha256: actualSha256, expectedBytes: expected.bytes, expectedSha256: expected.sha256 });
    }
    const other = await login('other');
    for (const [table, id] of [['manual_intakes', targets.manualId], ['extraction_jobs', targets.extractionId]]) {
      const result = await request(restPath(table, id), { token: other });
      // Require the actual authenticated row-filter result, not a gateway,
      // expired JWT, missing table/grant or generic 403 failure.
      record(`other_${table}_rls_filtered`, result.status === 200 && Array.isArray(result.json) && result.json.length === 0, { status: result.status, ownerExistenceFreshlyConfirmed: true });
    }
    for (let i = 0; i < targets.objects.length; i++) {
      const result = await request(storagePath(targets.objects[i]), { token: other, object: true });
      const code = result.json?.code || result.json?.error;
      const recognized = typeof code === 'string' && DENIAL_CODES.has(code);
      record(`other_storage_original_${i + 1}_denied`, [400, 403, 404].includes(result.status) && recognized, { status: result.status, denialCode: recognized ? code : null, ownerExistenceFreshlyConfirmed: true });
    }
  } catch (error) { errorCode = /^[a-z0-9_]+$/.test(error?.auditCode || '') ? error.auditCode : 'audit_guard_or_runtime_failure'; }
  finally {
    for (const session of created) {
      let status = null; let passed = false;
      try { const result = await request('/auth/v1/logout?scope=local', { method: 'POST', token: session.token, cleanup: true }); status = result.status; passed = [200, 204].includes(status); } catch { /* Sanitized cleanup result only. */ }
      checks.push({ name: `${session.kind}_created_session_local_logout`, state: passed ? 'passed' : 'failed', status });
      if (!passed && !errorCode) errorCode = 'created_session_logout_unconfirmed';
      session.token = '';
    }
  }
  return {
    checkedAt: new Date(now()).toISOString(), evidenceClass, success: errorCode === null, errorCode,
    requests, receivedBytes, checks,
    sessions: { createdWithReturnedToken: created.length, uncertainCreation: uncertainSessionCreation, localLogoutConfirmed: created.length > 0 && created.every(session => checks.some(check => check.name === `${session.kind}_created_session_local_logout` && check.state === 'passed')) },
    boundaries: { allowedOrigin: PROJECT_ORIGIN, publishableKeyOnly: true, redirectsFollowed: 0, browserCredentialExtraction: false, adminApiCalls: 0, createdUsers: 0, passwordChanges: 0, refreshCalls: 0, trackerWrites: 0, storageWrites: 0, googleCalls: 0, modelCalls: 0, paidUpgrades: 0 },
    limitations: ['SQL-role audits and mock tests are separate evidence classes.', 'Local logout revokes the created refresh session; an issued access JWT can remain valid until its own expiry. Tokens are discarded and never persisted.', 'Checks concern exactly two retained synthetic original objects and two known rows, not all private data.', 'Storage denial after positive owner-body checks proves isolation for these requests; this does not test application cookie-session routes, uploads or backup restore.'],
  };
}

function privateFile(name) {
  requireThat(existsSync(name), 'local_configuration_file_missing');
  const stat = lstatSync(name);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'local_configuration_file_not_private');
  requireThat(stat.size <= 16384, 'local_configuration_file_too_large');
  return parseEnv(readFileSync(name, 'utf8'));
}
export function readLocalConfiguration() {
  const values = privateFile(CREDENTIAL_FILE);
  requireThat(Object.keys(values).every(name => CREDENTIAL_NAMES.includes(name)), 'unexpected_credential_file_variable');
  const probe = privateFile('private/stage2-storage-http.env');
  const config = { publishableKey: probe.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '', owner: { email: values.STAGE2_ACCESS_OWNER_EMAIL || '', password: values.STAGE2_ACCESS_OWNER_PASSWORD || '' }, other: { email: values.STAGE2_ACCESS_OTHER_EMAIL || '', password: values.STAGE2_ACCESS_OTHER_PASSWORD || '' } };
  return config;
}
export function configurationPresence(config) {
  return { publishableKey: isPublishableKey(config.publishableKey), ownerEmail: Boolean(config.owner.email), ownerPassword: Boolean(config.owner.password), otherEmail: Boolean(config.other.email), otherPassword: Boolean(config.other.password), readyForExplicitLiveRun: (() => { try { validateConfiguration(config); return true; } catch { return false; } })() };
}
function loadKnownTargets() {
  const urls = JSON.parse(readFileSync('private/stage2-upload-original-urls.json', 'utf8'));
  requireThat(Array.isArray(urls) && urls.length === 2, 'two_pinned_object_references_required');
  const objects = urls.map((raw, i) => {
    requireThat(typeof raw === 'string' && sha256(raw) === KNOWN_URL_HASHES[i], 'known_url_artifact_hash_mismatch');
    const url = new URL(raw);
    requireThat(url.origin === APP_ORIGIN && url.pathname === '/api/private-media' && !url.username && !url.password && !url.hash && [...url.searchParams.keys()].length === 1 && url.searchParams.getAll('path').length === 1, 'invalid_pinned_object_reference');
    return { path: url.searchParams.get('path'), ...KNOWN_BODIES[i] };
  });
  const targets = { ownerId: objects[0].path?.split('/')[0], manualId: MANUAL_ID, extractionId: EXTRACTION_ID, objects };
  validateTargets(targets);
  return targets;
}

async function main() {
  const mode = process.argv[2] || '--help';
  requireThat(process.argv.length <= 3, 'unexpected_cli_arguments');
  if (mode === '--help') {
    console.log('Signed-user HTTP preparation: --check-config reads private presence flags only; --self-test runs synthetic mocks without credentials/network; --run-live explicitly signs in the two existing users from .env.stage2-access-check.local, checks known data, then logs out only its own sessions. No live sign-in is the default.');
    return;
  }
  if (mode === '--self-test') {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/stage2-signed-user-http.test.ts'], { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    process.exitCode = result.status ?? 1;
    return;
  }
  requireThat(['--check-config', '--run-live'].includes(mode), 'unknown_cli_mode');
  const config = readLocalConfiguration();
  if (mode === '--check-config') {
    loadKnownTargets();
    const report = { evidenceClass: 'local_configuration_presence_only', credentialFile: CREDENTIAL_FILE, ...configurationPresence(config), pinnedTargetsVerified: true, requests: 0, liveAuthExecuted: false };
    console.log(JSON.stringify(report)); process.exitCode = report.readyForExplicitLiveRun ? 0 : 2; return;
  }
  // Validate before reading private targets and before any network request.
  validateConfiguration(config);
  const targets = loadKnownTargets();
  const report = await runSignedUserAudit(config, targets);
  report.command = 'node scripts/check-stage2-signed-user-http.mjs --run-live';
  report.sourceSha256 = sha256(readFileSync(import.meta.filename));
  // A historical run is immutable; never replace earlier evidence.
  const filename = `reports/stage-2-signed-user-http-${report.checkedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ report: filename, success: report.success, requests: report.requests, errorCode: report.errorCode, checks: report.checks.map(({ name, state, status }) => ({ name, state, status })), sessions: report.sessions }));
  process.exitCode = report.success ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(JSON.stringify({ success: false, errorCode: /^[a-z0-9_]+$/.test(error?.auditCode || '') ? error.auditCode : 'local_preparation_failure', liveSuccessClaimed: false })); process.exitCode = 1; });
}
