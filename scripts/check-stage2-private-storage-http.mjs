/**
 * Read-only known-object HTTPS audit. Never creates a session, user, object,
 * signed URL or database row. Tokens, cookies, paths and response bodies are
 * never printed or saved. Optional user JWTs must already exist independently.
 *
 * node scripts/check-stage2-private-storage-http.mjs [--self-test]
 * Existing ignored files: .env.local, .env.netlify.production.local,
 * .env.hosted-check.local, private/stage2-storage-http.env.
 * Optional JWT names: HOSTED_CHECK_OWNER_ACCESS_TOKEN,
 * HOSTED_CHECK_OTHER_ACCESS_TOKEN. No password/refresh-token flow is used.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const APP = 'https://luxury-longma-01d2fa.netlify.app';
const STORAGE = 'https://nuywbvlcwetqjalqvxzb.supabase.co';
const MAX_BYTES = 4 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const isSuccess = observation => observation.status === 200 && !observation.transportFailure && !observation.oversized;
const exactBody = (observation, expected) => isSuccess(observation) && observation.bytes === expected.bytes && observation.bodySha256 === expected.sha256;
// Storage can conceal private objects as 400/404. A gateway rejection alone is
// never accepted as authenticated RLS proof; identities are validated first.
const isDenied = observation => [400, 401, 403, 404].includes(observation.status) && !observation.transportFailure && !observation.oversized;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateKnownUrl(raw) {
  const url = new URL(raw);
  if (url.origin !== APP || url.pathname !== '/api/private-media' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'path') || url.searchParams.getAll('path').length !== 1) throw new Error('invalid_known_object_url');
  const path = url.searchParams.get('path');
  if (!path || !uuid.test(path.split('/')[0]) || !/^[a-zA-Z0-9/._-]+$/.test(path) || path.includes('..') || path.includes('\\')) throw new Error('invalid_known_object_path');
  return { url: url.href, path, ownerId: path.split('/')[0], urlSha256: hash(url.href), pathSha256: hash(path) };
}
function safeDestination(raw) {
  const url = new URL(raw);
  if (![APP, STORAGE].includes(url.origin) || url.username || url.password || url.hash) throw new Error('unapproved_destination');
  return url;
}
function jwtRole(value) {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role; }
  catch { return null; }
}
function publicKeyAllowed(value) { return Boolean(value && (value.startsWith('sb_publishable_') || jwtRole(value) === 'anon')); }

if (process.argv.includes('--self-test')) {
  assert.equal(exactBody({ status: 200, bytes: 3, bodySha256: hash('png') }, { bytes: 3, sha256: hash('png') }), true);
  assert.equal(exactBody({ status: 200, bytes: 3, bodySha256: hash('bad') }, { bytes: 3, sha256: hash('png') }), false);
  assert.equal(exactBody({ status: 401, bytes: 3, bodySha256: hash('png') }, { bytes: 3, sha256: hash('png') }), false);
  assert.equal(isDenied({ status: 200 }), false);
  assert.equal(isDenied({ status: null, transportFailure: true }), false);
  assert.equal(isDenied({ status: 302 }), false);
  assert.throws(() => safeDestination('https://evil.example/storage/v1/object'), /unapproved_destination/);
  assert.throws(() => validateKnownUrl(`${APP}/api/private-media?path=../private`), /invalid_known_object_path/);
  assert.equal(publicKeyAllowed('sb_secret_do_not_send_as_public'), false);
  assert.equal(publicKeyAllowed('sb_publishable_project_key'), true);
  console.log('Private Storage audit guard controls: 10 passed; no network requests.');
  process.exit(0);
}
if (process.argv.length !== 2) throw new Error('Use no arguments or --self-test.');

const readEnv = name => existsSync(name) ? parseEnv(readFileSync(name, 'utf8')) : {};
const local = readEnv('.env.local');
const web = readEnv('.env.netlify.production.local');
const audit = readEnv('.env.hosted-check.local');
const probe = readEnv('private/stage2-storage-http.env');
const suppliedOrigin = web.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL;
if (suppliedOrigin && suppliedOrigin.replace(/\/$/, '') !== STORAGE) throw new Error('unapproved_configured_supabase_origin');
const publicKey = probe.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || web.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const ownerToken = audit.HOSTED_CHECK_OWNER_ACCESS_TOKEN;
const otherToken = audit.HOSTED_CHECK_OTHER_ACCESS_TOKEN;
if (publicKey && !publicKeyAllowed(publicKey)) throw new Error('invalid_public_key_type');

const known = JSON.parse(readFileSync('private/stage2-upload-original-urls.json', 'utf8')).map(validateKnownUrl);
const prior = JSON.parse(readFileSync('reports/stage-2-hosted-two-slide-upload.json', 'utf8'));
const originalFiles = ['private/stage2-native-media/slide-1.png', 'private/stage2-native-media/slide-2.png'];
assert.equal(known.length, 2, 'exactly_two_known_originals_required');
assert.equal(new Set(known.map(item => item.pathSha256)).size, 2, 'distinct_known_objects_required');
assert.equal(new Set(known.map(item => item.ownerId)).size, 1, 'one_known_owner_required');
const expected = prior.databaseQueued.media_manifest;
assert.equal(expected.length, 2, 'expected_manifest_required');
for (let i = 0; i < 2; i++) {
  const bytes = readFileSync(originalFiles[i]);
  assert.equal(hash(bytes), expected[i].sha256, 'local_original_hash_mismatch');
  assert.equal(bytes.length, Number(expected[i].bytes), 'local_original_byte_mismatch');
  known[i].expected = { bytes: Number(expected[i].bytes), sha256: expected[i].sha256 };
}
let requests = 0;
let receivedBytes = 0;
const checks = [];
async function get(raw, headers = {}, readJson = false) {
  const url = safeDestination(raw);
  // No credential is ever sent to Netlify. App checks are anonymous only.
  if (url.origin !== STORAGE && Object.keys(headers).length) throw new Error('credentials_for_wrong_destination');
  requests++;
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(15000) });
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body?.cancel(); return { checkedAt, status: response.status, oversized: true }; }
    const parts = []; let total = 0;
    const reader = response.body?.getReader();
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); return { checkedAt, status: response.status, oversized: true }; }
      parts.push(part.value);
    }
    const body = Buffer.concat(parts); receivedBytes += total;
    let json;
    if (readJson || response.status >= 400) { try { json = JSON.parse(body.toString()); } catch { /* Invalid JSON cannot validate an identity. */ } }
    const errorCode = ['BucketNotFound', 'NoSuchBucket', 'NoSuchKey', 'ObjectNotFound', 'AccessDenied', 'InvalidJWT', 'InvalidSignature', 'Unauthorized', 'AuthorizationError', 'NotFound', 'InvalidRequest'].find(code => [json?.code, json?.error].includes(code)) || null;
    return { checkedAt, status: response.status, bytes: total, bodySha256: hash(body), contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'), ...(response.status >= 400 ? { errorCode, bodyStatusCode: /^\d{3}$/.test(String(json?.statusCode)) ? Number(json.statusCode) : null } : {}), ...(readJson ? { json } : {}) };
  } catch { return { checkedAt, status: null, transportFailure: true }; }
}
const record = (name, state, detail = {}) => checks.push({ name, state, ...detail });
const storageUrl = (kind, item) => `${STORAGE}/storage/v1/object/${kind}/captures/${item.path.split('/').map(encodeURIComponent).join('/')}`;
const existenceControls = new Map();

for (let i = 0; i < known.length; i++) {
  const app = await get(known[i].url);
  record(`app_anonymous_original_${i + 1}`, app.status === 401 ? 'passed' : 'failed', app);
  const publicResult = await get(storageUrl('public', known[i]));
  record(`storage_public_url_original_${i + 1}`, isDenied(publicResult) ? 'denied_observed' : 'failed', { ...publicResult, existenceFreshlyConfirmed: existenceControls.get(i) === true, boundary: 'Public-URL denial; not authenticated ownership isolation.' });
  const anon = await get(storageUrl('authenticated', known[i]), publicKey ? { apikey: publicKey } : {});
  record(`storage_anonymous_original_${i + 1}`, !isDenied(anon) ? 'failed' : publicKey && existenceControls.get(i) ? 'passed' : 'denied_observed', { ...anon, publishableKeyUsed: Boolean(publicKey), existenceFreshlyConfirmed: existenceControls.get(i) === true, boundary: publicKey ? 'Anonymous publishable-key request; not another signed user.' : 'No API key: gateway denial is not RLS isolation proof.' });
}

for (const [role, token] of [['owner', ownerToken], ['other_user', otherToken]]) {
  if (!publicKey || !token) { record(`${role}_signed_jwt_storage`, 'setup_needed', { reason: 'Requires independently supplied existing user access token and public project key; no session or user created.' }); continue; }
  const headers = { apikey: publicKey, Authorization: `Bearer ${token}` };
  const auth = await get(`${STORAGE}/auth/v1/user`, headers, true);
  const valid = isSuccess(auth) && uuid.test(auth.json?.id || '') && (role === 'owner' ? auth.json.id === known[0].ownerId : auth.json.id !== known[0].ownerId);
  record(`${role}_signed_identity_verified`, valid ? 'passed' : 'failed', { checkedAt: auth.checkedAt, status: auth.status, serverVerifiedUser: valid });
  if (!valid) continue;
  for (let i = 0; i < known.length; i++) {
    const result = await get(storageUrl('authenticated', known[i]), headers);
    const passed = role === 'owner' ? exactBody(result, known[i].expected) : isDenied(result) && existenceControls.get(i) === true;
    if (role === 'owner' && passed) existenceControls.set(i, true);
    record(`${role}_storage_original_${i + 1}`, passed ? 'passed' : role !== 'owner' && isDenied(result) ? 'denied_observed' : 'failed', { ...result, expectedBytes: known[i].expected.bytes, expectedSha256: known[i].expected.sha256, existenceFreshlyConfirmed: existenceControls.get(i) === true });
  }
}
record('owner_app_route_body_integrity', 'not_demonstrated', { reason: 'App route uses a real SSR cookie session. This script neither extracts browser credentials nor impersonates it with a bearer token.' });
const report = {
  checkedAt: new Date().toISOString(),
  evidenceClass: 'Fresh read-only HTTPS checks of two previously uploaded synthetic originals; optional independently supplied JWTs are verified by Supabase Auth before testing Storage.',
  sourceSha256: hash(readFileSync(import.meta.filename)),
  command: 'node scripts/check-stage2-private-storage-http.mjs',
  priorUploadReport: 'reports/stage-2-hosted-two-slide-upload.json',
  knownObjectReferences: known.map(item => ({ appUrlSha256: item.urlSha256, pathSha256: item.pathSha256, expected: item.expected })),
  credentialPresence: { publicKey: Boolean(publicKey), ownerAccessToken: Boolean(ownerToken), otherUserAccessToken: Boolean(otherToken) },
  requests, receivedBytes, checks,
  allPrivateHttpCriteriaPassed: ['owner_storage_original_1', 'owner_storage_original_2', 'other_user_storage_original_1', 'other_user_storage_original_2', 'owner_app_route_body_integrity'].every(name => checks.some(check => check.name === name && check.state === 'passed')),
  boundaries: { browserCredentialExtraction: false, serverKeysUsed: 0, authMutations: 0, createdUsers: 0, storageWrites: 0, databaseWrites: 0, signedUrlsCreated: 0, googleCalls: 0, modelCalls: 0, upgrades: 0 },
  costs: { newPaidServices: 0, meteredProviderCostMeasured: false, note: 'GET request/body counts recorded; provider egress/log costs not independently billed or queried.' },
  references: ['https://supabase.com/docs/guides/storage/serving/downloads', 'https://supabase.com/docs/guides/storage/security/access-control'],
};
writeFileSync('reports/stage-2-private-storage-http.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ requests, receivedBytes, checks: checks.map(({ name, state, status }) => ({ name, state, status })), allPrivateHttpCriteriaPassed: report.allPrivateHttpCriteriaPassed }));
process.exitCode = checks.some(check => check.state === 'failed') ? 1 : report.allPrivateHttpCriteriaPassed ? 0 : 2;
