/** Synthetic mocked HTTP controls only: no real credentials, users or network. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedRequest, isPublishableKey, PROJECT_ORIGIN, runSignedUserAudit, sha256, configurationPresence } from '../scripts/check-stage2-signed-user-http.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const manualId = '33333333-3333-4333-8333-333333333333';
const extractionId = '44444444-4444-4444-8444-444444444444';
const bodies = [Buffer.from('SYNTHETIC_PNG_ONE'), Buffer.from('SYNTHETIC_PNG_TWO')];
const targets = { ownerId, manualId, extractionId, objects: bodies.map((body, i) => ({ path: `${ownerId}/synthetic/slide-${i + 1}.png`, bytes: body.length, sha256: sha256(body) })) };
const config = { publishableKey: 'sb_publishable_synthetic_test_only', owner: { email: 'owner@example.invalid', password: 'SYNTHETIC_OWNER_PASSWORD' }, other: { email: 'other@example.invalid', password: 'SYNTHETIC_OTHER_PASSWORD' } };
type Variant = { wrongOwner?: boolean; sameOther?: boolean; otherMember?: boolean; badHash?: boolean; badSize?: boolean; missingOwnerRow?: boolean; rowLeak?: boolean; storageLeak?: boolean; storageStatus?: number; storageCode?: string; redirect?: boolean; logoutFailure?: boolean; otherLoginFailure?: boolean; otherLoginTransport?: boolean; malformedLogin?: boolean; oversize?: boolean; invalidIdentity?: boolean };
type Call = { url: URL; method: string; token: string; body: string | undefined; redirect: string; credentials: string };
function harness(variant: Variant = {}) {
  const calls: Call[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl: typeof fetch = async (raw, options = {}) => {
    const url = new URL(typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url);
    const headers = options.headers as Record<string, string>;
    const token = headers.Authorization || '';
    calls.push({ url, method: options.method!, token, body: options.body as string | undefined, redirect: options.redirect!, credentials: options.credentials! });
    assert.equal(url.origin, PROJECT_ORIGIN);
    assert.equal(headers.apikey, config.publishableKey);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal);
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.search, '?grant_type=password');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body as string);
      assert.deepEqual(Object.keys(body).sort(), ['email', 'password']);
      const kind = body.email === config.owner.email ? 'owner' : 'other';
      assert.deepEqual(body, config[kind]);
      assert.equal(token, '');
      if (kind === 'other' && variant.otherLoginTransport) throw new Error('MOCK_NETWORK_FAILURE');
      if (kind === 'other' && variant.otherLoginFailure) return json({ error: 'MOCK_INVALID_CREDENTIALS' }, 400);
      if (kind === 'other' && variant.malformedLogin) return json({ token_type: 'bearer' });
      return json({ access_token: `SYNTHETIC.${kind}.token`, refresh_token: 'SYNTHETIC_REFRESH_NOT_USED', token_type: 'bearer', user: { id: 'DO_NOT_TRUST_LOGIN_USER_FIELD' } });
    }
    if (url.pathname === '/auth/v1/logout') {
      assert.equal(url.search, '?scope=local');
      assert.equal(options.method, 'POST');
      assert.equal(options.body, undefined);
      assert.match(token, /^Bearer SYNTHETIC\.(owner|other)\.token$/);
      return variant.logoutFailure ? json({ error: 'MOCK_FAILURE' }, 500) : new Response(null, { status: 204 });
    }
    assert.equal(options.method, 'GET');
    const owner = token === 'Bearer SYNTHETIC.owner.token';
    assert.ok(owner || token === 'Bearer SYNTHETIC.other.token');
    if (url.pathname === '/auth/v1/user') {
      if (owner && variant.redirect) return new Response(null, { status: 302, headers: { Location: 'https://outside.example.invalid/' } });
      return json({ id: variant.invalidIdentity ? 'not-a-uuid' : owner ? variant.wrongOwner ? otherId : ownerId : variant.sameOther ? ownerId : otherId });
    }
    if (url.pathname === '/rest/v1/rpc/is_tracker_member') return json(owner || Boolean(variant.otherMember));
    if (url.pathname === '/rest/v1/manual_intakes' || url.pathname === '/rest/v1/extraction_jobs') {
      const manual = url.pathname.endsWith('/manual_intakes');
      assert.equal(url.searchParams.get('id'), `eq.${manual ? manualId : extractionId}`);
      assert.equal(url.searchParams.get('limit'), '1');
      if ((!owner && !variant.rowLeak) || (owner && variant.missingOwnerRow)) return json([]);
      return json([{ id: manual ? manualId : extractionId, owner_id: ownerId, ...(!manual ? { manual_intake_id: manualId } : {}) }]);
    }
    const index = targets.objects.findIndex(item => url.pathname.endsWith(item.path));
    assert.ok(index >= 0, 'Only known storage objects may be read.');
    if (!owner && !variant.storageLeak) return json({ code: variant.storageCode || 'NoSuchKey', statusCode: '404' }, variant.storageStatus || 400);
    const bytes = variant.badHash && owner ? Buffer.from('X' + bodies[index].toString().slice(1)) : variant.badSize && owner ? Buffer.concat([bodies[index], Buffer.from('X')]) : bodies[index];
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png', ...(variant.oversize ? { 'Content-Length': String(4 * 1024 * 1024 + 1) } : {}) } });
  };
  return { calls, run: () => runSignedUserAudit(config, targets, { fetchImpl, evidenceClass: 'synthetic_mock_only' }) };
}
const logoutCount = (calls: Call[]) => calls.filter(call => call.url.pathname === '/auth/v1/logout').length;
const assertSafeReport = (report: unknown) => {
  const serialized = JSON.stringify(report);
  for (const secret of [config.owner.email, config.other.email, config.owner.password, config.other.password, 'SYNTHETIC.owner.token', 'SYNTHETIC.other.token', 'SYNTHETIC_REFRESH_NOT_USED', ownerId, otherId]) assert.equal(serialized.includes(secret), false, 'Sanitized output must not contain identities or credentials.');
};

test('MOCK: exact owner bytes + known REST rows precede verified nonmember isolation and local logout', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.success, true); assert.equal(result.evidenceClass, 'synthetic_mock_only');
  assert.equal(result.requests, 16); assert.equal(result.checks.length, 16);
  assert.equal(result.sessions.localLogoutConfirmed, true); assert.equal(result.sessions.uncertainCreation, false);
  assert.equal(logoutCount(h.calls), 2);
  assert.ok(h.calls.findIndex(call => call.url.pathname.endsWith('slide-2.png')) < h.calls.findIndex(call => call.body?.includes(config.other.email)));
  assertSafeReport(result);
});

for (const [name, variant, expected, sessions] of [
  ['wrong server-verified owner', { wrongOwner: true }, 'owner_server_verified_identity', 1],
  ['same account for both roles', { sameOther: true }, 'other_server_verified_identity', 2],
  ['another tracker member is not a nonmember', { otherMember: true }, 'other_membership', 2],
  ['invalid UUID from Auth', { invalidIdentity: true }, 'owner_server_verified_identity', 1],
  ['changed owner bytes', { badHash: true }, 'owner_storage_original_1', 1],
  ['changed owner size', { badSize: true }, 'owner_storage_original_1', 1],
  ['owner row missing', { missingOwnerRow: true }, 'owner_manual_intakes_known_row', 1],
  ['REST private row leak', { rowLeak: true }, 'other_manual_intakes_rls_filtered', 2],
  ['Storage private body leak', { storageLeak: true }, 'other_storage_original_1_denied', 2],
  ['HTTP redirect', { redirect: true }, 'redirect_refused', 1],
  ['oversized storage reply', { oversize: true }, 'response_body_limit', 1],
  ['other password rejection', { otherLoginFailure: true }, 'other_normal_password_login', 1],
] as const) {
  test(`MOCK: ${name} fails closed and cleans all returned sessions`, async () => {
    const h = harness(variant); const result = await h.run();
    assert.equal(result.success, false); assert.equal(result.errorCode, expected);
    assert.equal(logoutCount(h.calls), sessions); assert.equal(result.sessions.localLogoutConfirmed, true);
    assertSafeReport(result);
  });
}

for (const [status, code] of [[401, 'NoSuchKey'], [400, 'InvalidJWT'], [403, 'Unauthorized'], [500, 'AccessDenied'], [400, 'Unrecognized']] as const) {
  test(`MOCK: Storage ${status}/${code} is not isolation evidence`, async () => {
    const h = harness({ storageStatus: status, storageCode: code }); const result = await h.run();
    assert.equal(result.success, false); assert.equal(result.errorCode, 'other_storage_original_1_denied');
    assert.equal(logoutCount(h.calls), 2); assertSafeReport(result);
  });
}

test('MOCK: local logout failure is visible, with no global fallback', async () => {
  const h = harness({ logoutFailure: true }); const result = await h.run();
  assert.equal(result.success, false); assert.equal(result.errorCode, 'created_session_logout_unconfirmed');
  assert.equal(result.sessions.localLogoutConfirmed, false); assert.equal(logoutCount(h.calls), 2);
  assert.ok(h.calls.filter(call => call.url.pathname === '/auth/v1/logout').every(call => call.url.search === '?scope=local'));
});

for (const variant of [{ otherLoginTransport: true }, { malformedLogin: true }]) {
  test('MOCK: uncertain login response remains unconfirmed and known owner session is cleaned', async () => {
    const h = harness(variant); const result = await h.run();
    assert.equal(result.success, false); assert.equal(result.sessions.uncertainCreation, true);
    assert.equal(logoutCount(h.calls), 1); assertSafeReport(result);
  });
}

test('MOCK: empty credentials and server keys make zero HTTP requests', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('MOCK_MUST_NOT_FETCH'); };
  for (const candidate of [{ ...config, owner: { email: '', password: '' } }, { ...config, publishableKey: 'sb_secret_synthetic_test_only' }]) {
    const result = await runSignedUserAudit(candidate, targets, { fetchImpl, evidenceClass: 'synthetic_mock_only' });
    assert.equal(result.success, false); assert.equal(result.requests, 0); assert.equal(calls, 0);
  }
  assert.deepEqual(configurationPresence({ ...config, owner: { email: '', password: '' }, other: { email: '', password: '' } }), { publishableKey: true, ownerEmail: false, ownerPassword: false, otherEmail: false, otherPassword: false, readyForExplicitLiveRun: false });
  assert.equal(isPublishableKey('sb_secret_synthetic_test_only'), false);
  assert.equal(isPublishableKey('eyJ.fake.anon'), false);
});

test('MOCK: request allowlist blocks arbitrary destinations, writes and global logout', () => {
  for (const [url, method] of [[`${PROJECT_ORIGIN}/auth/v1/logout?scope=global`, 'POST'], [`${PROJECT_ORIGIN}/auth/v1/admin/users`, 'POST'], [`${PROJECT_ORIGIN}/rest/v1/manual_intakes`, 'POST'], [`${PROJECT_ORIGIN}/auth/v1/token?grant_type=refresh_token`, 'POST'], ['https://outside.example.invalid/auth/v1/user', 'GET'], [`${PROJECT_ORIGIN}/auth/v1/user?extra=1`, 'GET'], [`${PROJECT_ORIGIN}/auth/v1/user#secret`, 'GET']] as const) assert.equal(allowedRequest(url, method, targets), false);
  assert.equal(allowedRequest(`${PROJECT_ORIGIN}/auth/v1/logout?scope=local`, 'POST', targets), true);
});
