import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE, calendarConfig, createCalendarAuthorization, encryptCredentials, exchangeCalendarCode, validateCalendarCallback } from '../lib/calendar/google';
import { approvalInputSchema, approveCalendarCommand, calendarEventMatches, executeCalendarCommand, parseCalendarCommand } from '../lib/calendar/writes';
import { reminderLocalInstant } from '../lib/calendar/time';

// Synthetic credentials, SQL RPC results and Google HTTP only. Real SQL is tested separately.
const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const target = '33333333-3333-4333-8333-333333333333';
const lease = '44444444-4444-4444-8444-444444444444';
const config = calendarConfig({ APP_URL: 'https://tracker.example.test', GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'), CALENDAR_WRITES_ENABLED: 'true' })!;
const command = { id, connectionGeneration: lease, kind: 'occurrence', targetId: target, state: 'pending', providerEventId: `opptrack${'a'.repeat(64)}`, approvedAt: '2026-11-01T15:00:00Z',
  payload: { summary: 'Explicitly approved synthetic event', description: 'Source: https://example.test/event', location: 'Campus', start: { dateTime: '2026-11-05T20:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-05T21:00:00Z', timeZone: 'America/New_York' }, reminders: { useDefault: false }, extendedProperties: { private: { opptrackCommandId: id, opptrackFingerprint: 'b'.repeat(64) } } } };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const event = () => ({ id: command.providerEventId, status: 'confirmed', ...structuredClone(command.payload) });
const mockFetch = (fn: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch => (async (url, init) => fn(new URL(String(url)), init || {})) as typeof fetch;
function fakeClient(options: { sourceChanged?: boolean; generationChanged?: boolean; generationRace?: boolean; scope?: typeof GOOGLE_CALENDAR_SCOPE | typeof GOOGLE_CALENDAR_WRITE_SCOPE; active?: boolean; state?: string; finishFailure?: boolean; approveFailure?: string } = {}) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []; let connectionReads=0;
  const envelope = encryptCredentials({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000, scope: options.scope ?? GOOGLE_CALENDAR_WRITE_SCOPE }, config.encryptionKey, owner);
  const client = { rpc: async (name: string, params: Record<string, unknown> = {}) => {
    calls.push({ name, params });
    if (name === 'calendar_connection_get') return { data: { encrypted_credentials: envelope, authorization_generation: options.generationChanged || options.generationRace && ++connectionReads === 2 ? target : lease, revision: lease, connected_at: '', updated_at: '' }, error: null };
    if (name === 'calendar_write_preview') return { data: { canApprove: !options.sourceChanged, fingerprint: 'b'.repeat(64) }, error: null };
    if (name === 'calendar_write_approve' && options.approveFailure) return { data: null, error: { code: options.approveFailure } };
    if (name === 'calendar_write_get' || name === 'calendar_write_approve') return { data: { ...structuredClone(command), state: options.state ?? 'pending' }, error: null };
    if (name === 'calendar_write_claim') return { data: options.active ? null : { ...structuredClone(command), state: 'processing', leaseToken: lease }, error: null };
    if (name === 'calendar_write_finish') return { data: true, error: options.finishFailure ? { code: '40001' } : null };
    throw new Error('Unexpected RPC');
  } } as unknown as SupabaseClient;
  return { client, calls };
}

test('write consent is explicit, owner/state bound and requests owned events only; readonly mode stays readonly', () => {
  const time = Date.now();
  const authorization = createCalendarAuthorization(config, owner, time, 'write');
  const url = new URL(authorization.url);
  assert.equal(url.searchParams.get('scope'), GOOGLE_CALENDAR_WRITE_SCOPE);
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(validateCalendarCallback(authorization.cookie, url.searchParams.get('state')!, owner, config, time).scope, GOOGLE_CALENDAR_WRITE_SCOPE);
  assert.equal(new URL(createCalendarAuthorization(config, owner, time).url).searchParams.get('scope'), GOOGLE_CALENDAR_SCOPE);
  assert.throws(() => createCalendarAuthorization({ ...config, writeEnabled: false }, owner, time, 'write'));
  assert.throws(() => validateCalendarCallback(authorization.cookie, url.searchParams.get('state')!, owner, { ...config, writeEnabled: false }, time));
});

test('write code exchange rejects broader grants and a read token cannot become a write token', async () => {
  const payload = { access_token: 'synthetic-new', refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_CALENDAR_WRITE_SCOPE };
  const grant = await exchangeCalendarCode('synthetic-code', 'verifier', config, mockFetch(() => json(payload)), Date.now(), GOOGLE_CALENDAR_WRITE_SCOPE);
  assert.equal(grant.scope, GOOGLE_CALENDAR_WRITE_SCOPE);
  for (const scope of [GOOGLE_CALENDAR_SCOPE, 'https://www.googleapis.com/auth/calendar', `${GOOGLE_CALENDAR_WRITE_SCOPE} https://www.googleapis.com/auth/calendar.events`]) await assert.rejects(() => exchangeCalendarCode('synthetic-code', 'verifier', config, mockFetch(() => json({ ...payload, scope })), Date.now(), GOOGLE_CALENDAR_WRITE_SCOPE));
});

test('reminder conversion honors Eastern DST and rejects invalid, skipped and repeated local times', () => {
  assert.equal(reminderLocalInstant('2026-11-02T09:30'), '2026-11-02T14:30:00.000Z');
  assert.equal(reminderLocalInstant('2026-07-01T09:30'), '2026-07-01T13:30:00.000Z');
  for (const value of ['2026-11-01T01:30', '2026-03-08T02:30', '2026-02-30T12:00', '2026-11-02', 'not-a-date']) assert.throws(() => reminderLocalInstant(value));
});

test('approval input permits one target and requires user times only for a separate milestone reminder', () => {
  assert.ok(approvalInputSchema.safeParse({ kind: 'occurrence', targetId: target, fingerprint: 'b'.repeat(64) }).success);
  assert.equal(approvalInputSchema.safeParse({ kind: 'occurrence', targetId: target, fingerprint: 'b'.repeat(64), startAt: '2026-11-05T20:00:00Z' }).success, false);
  assert.equal(approvalInputSchema.safeParse({ kind: 'milestone', targetId: target, fingerprint: 'b'.repeat(64) }).success, false);
  assert.equal(approvalInputSchema.safeParse({ kind: 'occurrence', targetId: target, fingerprint: 'b'.repeat(64), attendees: ['x'] }).success, false);
});

test('disabled writing or readonly credentials produce zero Google writes and no approval/claim', async () => {
  const disabled = fakeClient(); let requests = 0;
  assert.equal((await executeCalendarCommand(disabled.client, id, { ...config, writeEnabled: false }, owner, mockFetch(() => { requests++; return json({}); }))).state, 'disabled');
  assert.equal(disabled.calls.length, 0);
  const readonly = fakeClient({ scope: GOOGLE_CALENDAR_SCOPE });
  await assert.rejects(() => approveCalendarCommand(readonly.client, { kind: 'occurrence', targetId: target, fingerprint: 'b'.repeat(64) }, config, owner, mockFetch(() => { requests++; return json({}); })));
  assert.equal(requests, 0); assert.ok(!readonly.calls.some(call => ['calendar_write_approve', 'calendar_write_claim'].includes(call.name)));
});

test('stale approval returns visible failure without claiming or contacting Google', async () => {
  const { client, calls } = fakeClient({ approveFailure: '40001' }); let requests = 0;
  const result = await approveCalendarCommand(client, { kind: 'occurrence', targetId: target, fingerprint: 'b'.repeat(64) }, config, owner, mockFetch(() => { requests++; return json({}); }));
  assert.equal(result.state, 'failed'); assert.match(result.notice, /changed/); assert.equal(requests, 0); assert.ok(!calls.some(call => call.name === 'calendar_write_claim'));
});

test('single approved insert uses fixed primary endpoint, persisted ID, no attendees/default reminders and fenced success', async () => {
  const { client, calls } = fakeClient(); let reads = 0, writes = 0;
  const result = await executeCalendarCommand(client, id, config, owner, mockFetch((url, init) => {
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(url.searchParams.has('access_token'), false);
    if (init.method === 'GET') { reads++; assert.equal(url.pathname, `/calendar/v3/calendars/primary/events/${command.providerEventId}`); return json({}, 404); }
    assert.equal(init.method, 'POST'); writes++; assert.equal(url.pathname, '/calendar/v3/calendars/primary/events'); assert.equal(url.searchParams.get('sendUpdates'), 'none');
    const body = JSON.parse(String(init.body)); assert.equal(body.id, command.providerEventId); assert.equal(body.attendees, undefined); assert.equal(body.recurrence, undefined); assert.deepEqual(body.reminders, { useDefault: false });
    return json(event());
  }));
  assert.equal(result.state, 'succeeded'); assert.equal(reads, 1); assert.equal(writes, 1);
  assert.deepEqual(calls.at(-1), { name: 'calendar_write_finish', params: { p_id: id, p_lease_token: lease, p_state: 'succeeded', p_error_code: null, p_retry_after_seconds: 0 } });
});

test('already-succeeded and active lease retries cannot create a second event', async () => {
  for (const options of [{ state: 'succeeded' }, { active: true }]) {
    const { client } = fakeClient(options); let requests = 0;
    const result = await executeCalendarCommand(client, id, config, owner, mockFetch(() => { requests++; return json({}); }));
    assert.equal(result.state, options.state ? 'succeeded' : 'processing'); assert.equal(requests, 0);
  }
});

test('lost insertion response reconciles the same event ID instead of issuing another insert', async () => {
  const { client } = fakeClient(); let reads = 0, writes = 0;
  const result = await executeCalendarCommand(client, id, config, owner, mockFetch((_url, init) => {
    if (init.method === 'GET') return ++reads === 1 ? json({}, 404) : json(event());
    writes++; throw new Error('Simulated timeout after Google committed');
  }));
  assert.equal(result.state, 'succeeded'); assert.equal(reads, 2); assert.equal(writes, 1);
});

test('unconfirmed insertion stays uncertain and persists only a sanitized error', async () => {
  const { client, calls } = fakeClient();
  const result = await executeCalendarCommand(client, id, config, owner, mockFetch((_url, init) => { if (init.method === 'GET') return json({}, 404); throw new Error('secret-provider-message'); }));
  assert.equal(result.state, 'uncertain'); assert.equal(calls.at(-1)?.params.p_state, 'uncertain'); assert.equal(calls.at(-1)?.params.p_error_code, 'provider_transport'); assert.ok(!JSON.stringify(result).includes('secret-provider'));
});

test('409 retry reconciles only matching approved facts and never overwrites conflicts', async () => {
  for (const changed of [false, true]) {
    const { client } = fakeClient(); let reads = 0, writes = 0;
    const result = await executeCalendarCommand(client, id, config, owner, mockFetch((_url, init) => {
      if (init.method === 'GET') return ++reads === 1 ? json({}, 404) : json({ ...event(), ...(changed ? { summary: 'Edited in Google by the user' } : {}) });
      assert.equal(init.method, 'POST'); writes++; return json({}, 409);
    }));
    assert.equal(result.state, changed ? 'failed' : 'succeeded'); assert.equal(writes, 1);
  }
});

test('rate-limited insert records Retry-After rather than retrying immediately', async () => {
  const { client, calls } = fakeClient(); let writes = 0;
  const result = await executeCalendarCommand(client, id, config, owner, mockFetch((_url, init) => {
    if (init.method === 'GET') return json({}, 404);
    writes++; return json({}, 429, { 'Retry-After': '120' });
  }));
  assert.equal(result.state, 'failed'); assert.equal(writes, 1); assert.equal(calls.at(-1)?.params.p_retry_after_seconds, 120);
});

test('approved event reconciliation checks metadata, exact times, content and reminder behavior', () => {
  const parsed = parseCalendarCommand(command); assert.ok(calendarEventMatches(parsed, event()));
  for (const mutation of [{ status: 'cancelled' }, { summary: 'Different' }, { location: 'Different' }, { extendedProperties: {} }, { reminders: { useDefault: true } }, { reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 10 }] } }, { start: { dateTime: '2026-11-05T21:00:00Z' } }]) assert.equal(calendarEventMatches(parsed, { ...event(), ...mutation }), false);
  assert.throws(() => parseCalendarCommand({ ...command, payload: { ...command.payload, attendees: [] } }));
});

 test('malformed successful insert response is reconciled instead of reported as a known failure', async () => {
  const { client } = fakeClient(); let reads=0;
  const result=await executeCalendarCommand(client,id,config,owner,mockFetch((_url,init)=>init.method==='GET' ? ++reads===1 ? json({},404) : json(event()) : new Response('<html>response interrupted</html>',{status:200,headers:{'Content-Type':'text/html'}})));
  assert.equal(result.state,'succeeded'); assert.equal(reads,2);
});
test('reconnecting a Google destination prevents retrying an old approval against a different connection', async () => {
  const {client,calls}=fakeClient({generationChanged:true});let requests=0;
  const result=await executeCalendarCommand(client,id,config,owner,mockFetch(()=>{requests++;return json({});}));
  assert.equal(result.state,'failed');assert.match(result.notice,/connection changed/);assert.equal(requests,0);assert.ok(!calls.some(c=>c.name==='calendar_write_claim'));
});
test('source cancellation or changed facts allow reconciliation but cannot insert a new event', async () => {
  const {client,calls}=fakeClient({sourceChanged:true});let requests=0;
  const result=await executeCalendarCommand(client,id,config,owner,mockFetch((_url,init)=>{requests++;assert.equal(init.method,'GET');return json({},404);}));
  assert.equal(result.state,'failed');assert.match(result.notice,/No new event was inserted/);assert.equal(requests,1);assert.equal(calls.at(-1)?.params.p_error_code,'source_changed');
});

test('a reconnect during token validation cannot substitute another destination before claiming', async () => {
  const {client,calls}=fakeClient({generationRace:true});let requests=0;
  await assert.rejects(()=>executeCalendarCommand(client,id,config,owner,mockFetch(()=>{requests++;return json({});})), /connection changed/);
  assert.equal(requests,0); assert.ok(!calls.some(call=>call.name==='calendar_write_claim'));
});

test('changed source facts can confirm an already committed matching event without another insert', async () => {
  const {client}=fakeClient({sourceChanged:true});let requests=0;
  const result=await executeCalendarCommand(client,id,config,owner,mockFetch((_url,init)=>{requests++;assert.equal(init.method,'GET');return json(event());}));
  assert.equal(result.state,'succeeded');assert.equal(requests,1);
});
