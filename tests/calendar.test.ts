import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GOOGLE_CALENDAR_SCOPE, CalendarError, calendarAccessToken, calendarConfig, calendarCookieName,
  calendarWindow, createCalendarAuthorization, decryptCredentials, disconnectCalendar,
  encryptCredentials, exchangeCalendarCode, listCalendarEvents, normalizeCalendarEvent,
  validateCalendarCallback, type CalendarCredentials, type CalendarConnection,
} from '../lib/calendar/google';

// Synthetic credentials/provider responses only. No live Google account is used.
const environment = {
  APP_URL: 'https://tracker.example.test', GOOGLE_CLIENT_ID: 'synthetic-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'synthetic-client-secret', CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CALENDAR_WRITES_ENABLED: 'false',
};
const config = calendarConfig(environment)!;
const now = Date.parse('2026-10-21T14:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const credentials: CalendarCredentials = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: now + 3600000, scope: GOOGLE_CALENDAR_SCOPE };
const fixture = { id: 'synthetic-event', summary: 'Private synthetic plan', start: { dateTime: '2026-10-21T15:00:00-04:00' }, end: { dateTime: '2026-10-21T16:00:00-04:00' }, attendees: [{ email: 'never-return@example.test' }], description: 'Not returned' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const mockFetch = (fn: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch => (async (url, init) => fn(String(url), init || {})) as typeof fetch;
const isCalendarError = (state: string) => (error: unknown) => error instanceof CalendarError && error.state === state;

test('calendar config requires server credentials, a canonical 256-bit key and disabled writes', () => {
  assert.ok(config);
  assert.equal(config.redirectUri, 'https://tracker.example.test/api/calendar/callback');
  assert.equal(calendarCookieName(config), '__Host-opptrack-calendar-oauth');
  assert.equal(calendarConfig({}), null);
  for (const replacement of [{ CALENDAR_WRITES_ENABLED: 'true' }, { CALENDAR_TOKEN_ENCRYPTION_KEY: 'invalid' }, { GOOGLE_CLIENT_SECRET: '' }, { APP_URL: 'http://tracker.example.test' }, { APP_URL: 'https://attacker:password@tracker.example.test/' }, { APP_URL: 'https://tracker.example.test/path' }]) assert.equal(calendarConfig({ ...environment, ...replacement }), null);
  const local = calendarConfig({ ...environment, APP_URL: 'http://localhost:3000' })!;
  assert.equal(local.secure, false); assert.equal(calendarCookieName(local), 'opptrack-calendar-oauth');
});

test('OAuth requests exactly read-only event access with PKCE and a ten-minute owner-bound state', () => {
  const authorization = createCalendarAuthorization(config, owner, now);
  const url = new URL(authorization.url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPE);
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(authorization.maxAge, 600);
  assert.equal(url.searchParams.get('state')!.length, 43);
  const result = validateCalendarCallback(authorization.cookie, url.searchParams.get('state')!, owner, config, now + 1000);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(result.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!authorization.cookie.includes(owner));
});

test('OAuth rejects wrong state, other-owner callbacks, expired state and modified encrypted state', () => {
  const authorization = createCalendarAuthorization(config, owner, now);
  const state = new URL(authorization.url).searchParams.get('state')!;
  for (const [cookie, returned, user, time] of [
    [authorization.cookie, 'a'.repeat(43), owner, now], [authorization.cookie, state, other, now],
    [authorization.cookie, state, owner, now + 600000], [authorization.cookie + 'tamper', state, owner, now],
    [authorization.cookie, '', owner, now],
  ] as const) assert.throws(() => validateCalendarCallback(cookie, returned, user, config, time), isCalendarError('invalid_request'));
});

test('AES-GCM credential envelope hides tokens, is randomized and rejects tampering or another owner/key', () => {
  const encrypted = encryptCredentials(credentials, config.encryptionKey, owner);
  assert.ok(!encrypted.includes(credentials.accessToken)); assert.ok(!encrypted.includes(credentials.refreshToken));
  assert.notEqual(encrypted, encryptCredentials(credentials, config.encryptionKey, owner));
  assert.deepEqual(decryptCredentials(encrypted, config.encryptionKey, owner), credentials);
  for (const open of [() => decryptCredentials(encrypted, config.encryptionKey, other), () => decryptCredentials(encrypted, Buffer.alloc(32, 8), owner), () => decryptCredentials(encrypted.replace(/^v1\./, 'v2.'), config.encryptionKey, owner), () => decryptCredentials(encrypted + 'modified', config.encryptionKey, owner)]) assert.throws(open, isCalendarError('reconnect_required'));
});

test('authorization code exchange uses the fixed POST body with verifier and never puts secrets in a URL', async () => {
  const exchanged = await exchangeCalendarCode('synthetic-code', 'synthetic-verifier', config, mockFetch((url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get('client_secret'), environment.GOOGLE_CLIENT_SECRET); assert.equal(body.get('code_verifier'), 'synthetic-verifier');
    assert.equal(body.get('redirect_uri'), config.redirectUri); assert.equal(body.get('grant_type'), 'authorization_code');
    return json({ access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPE });
  }), now);
  assert.equal(exchanged.scope, GOOGLE_CALENDAR_SCOPE); assert.equal(exchanged.expiresAt, now + 3600000);
});

test('code exchange rejects missing refresh tokens, extra write scopes and provider failure without echoing secrets', async () => {
  const base = { access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPE };
  for (const payload of [{ ...base, refresh_token: undefined }, { ...base, scope: `${GOOGLE_CALENDAR_SCOPE} https://www.googleapis.com/auth/calendar.events` }, { ...base, token_type: 'DPoP' }, { ...base, expires_in: -1 }]) await assert.rejects(() => exchangeCalendarCode('synthetic-code', 'verifier', config, mockFetch(() => json(payload)), now), isCalendarError('reconnect_required'));
  await assert.rejects(() => exchangeCalendarCode('synthetic-code', 'verifier', config, mockFetch(() => json({ error: 'invalid_grant', error_description: 'synthetic-secret-must-not-escape' }, 400)), now), error => error instanceof CalendarError && !error.message.includes('synthetic-secret'));
});

test('refresh preserves refresh token when omitted and writes encrypted bytes with expected revision', async () => {
  const old = { ...credentials, expiresAt: now - 1 };
  const connection: CalendarConnection = { encryptedCredentials: encryptCredentials(old, config.encryptionKey, owner), revision: 'old-revision', connectedAt: '', updatedAt: '' };
  let saved = false;
  const client = { rpc: async (name: string, params: Record<string, string>) => {
    assert.equal(name, 'calendar_connection_put'); assert.equal(params.p_expected_revision, connection.revision);
    const decrypted = decryptCredentials(params.p_encrypted_credentials, config.encryptionKey, owner);
    assert.equal(decrypted.refreshToken, credentials.refreshToken); assert.equal(decrypted.accessToken, 'synthetic-refreshed'); saved = true;
    return { data: 'new-revision', error: null };
  } } as unknown as SupabaseClient;
  const value = await calendarAccessToken(client, connection, config, owner, mockFetch((url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(init.method, 'POST');
    assert.equal(new URLSearchParams(String(init.body)).get('grant_type'), 'refresh_token');
    return json({ access_token: 'synthetic-refreshed', expires_in: 3600, token_type: 'Bearer' });
  }), now);
  assert.equal(value, 'synthetic-refreshed'); assert.equal(saved, true);
});

test('a parallel refresh cannot overwrite a newer connection and uses its verified fresh token', async () => {
  const connection: CalendarConnection = { encryptedCredentials: encryptCredentials({ ...credentials, expiresAt: now - 1 }, config.encryptionKey, owner), revision: 'old-revision', connectedAt: '', updatedAt: '' };
  const newer = encryptCredentials({ ...credentials, accessToken: 'newer-owner-token' }, config.encryptionKey, owner);
  const client = { rpc: async (name: string) => name === 'calendar_connection_put' ? { data: null, error: { code: '40001' } } : { data: { encrypted_credentials: newer, revision: 'new-revision', connected_at: '', updated_at: '' }, error: null } } as unknown as SupabaseClient;
  const value = await calendarAccessToken(client, connection, config, owner, mockFetch(() => json({ access_token: 'stale-refresh-result', expires_in: 3600, token_type: 'Bearer' })), now);
  assert.equal(value, 'newer-owner-token');
});

test('seven Eastern calendar days preserve DST transitions and reject malformed dates', () => {
  const ordinary = calendarWindow('2026-10-21');
  assert.equal(ordinary.timeMin, '2026-10-21T04:00:00.000Z'); assert.equal(ordinary.to, '2026-10-28');
  const spring = calendarWindow('2026-03-07'), fall = calendarWindow('2026-10-31');
  assert.equal((Date.parse(spring.timeMax) - Date.parse(spring.timeMin)) / 3600000, 167);
  assert.equal((Date.parse(fall.timeMax) - Date.parse(fall.timeMin)) / 3600000, 169);
  for (const date of ['', '2026-02-30', '2026-1-01', 'not-a-date', '2026-10-21T00:00:00Z']) assert.throws(() => calendarWindow(date), isCalendarError('invalid_request'));
});

test('event projection excludes attendees, descriptions and provider metadata; all-day end stays exclusive', () => {
  assert.deepEqual(normalizeCalendarEvent(fixture), { id: fixture.id, title: fixture.summary, start: fixture.start.dateTime, end: fixture.end.dateTime, allDay: false });
  assert.deepEqual(normalizeCalendarEvent({ id: 'all-day', start: { date: '2026-10-21' }, end: { date: '2026-10-23' } }), { id: 'all-day', title: 'Busy', start: '2026-10-21', end: '2026-10-23', allDay: true });
  assert.equal(normalizeCalendarEvent({ status: 'cancelled' }), null);
  assert.throws(() => normalizeCalendarEvent({ ...fixture, end: { dateTime: 'invalid' } }), isCalendarError('unavailable'));
});

test('calendar reads use only primary GET events with bounded pagination and no event-write capability', async () => {
  let requests = 0;
  const response = await listCalendarEvents(credentials.accessToken, calendarWindow('2026-10-21'), mockFetch((url, init) => {
    const parsed = new URL(url); requests++;
    assert.equal(parsed.origin, 'https://www.googleapis.com'); assert.equal(parsed.pathname, '/calendar/v3/calendars/primary/events');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-access');
    assert.equal(parsed.searchParams.get('singleEvents'), 'true'); assert.equal(parsed.searchParams.get('orderBy'), 'startTime'); assert.equal(parsed.searchParams.get('maxResults'), '50');
    assert.ok(!parsed.search.includes(credentials.accessToken)); assert.ok(!parsed.searchParams.get('fields')!.includes('attendee'));
    return requests === 1 ? json({ items: [fixture], nextPageToken: 'second-page' }) : json({ items: [{ ...fixture, id: 'second-event' }] });
  }));
  assert.equal(response.state, 'connected'); assert.equal(response.complete, true); assert.equal(response.events.length, 2); assert.equal(requests, 2);
});

test('valid empty collection is distinct from revoked, HTML, malformed, duplicate and oversized responses', async () => {
  const window = calendarWindow('2026-10-21');
  const empty = await listCalendarEvents(credentials.accessToken, window, mockFetch(() => json({ items: [] })));
  assert.equal(empty.state, 'connected'); assert.equal(empty.complete, true); assert.deepEqual(empty.events, []);
  await assert.rejects(() => listCalendarEvents(credentials.accessToken, window, mockFetch(() => json({}, 401))), isCalendarError('reconnect_required'));
  for (const response of [new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }), json({}), json({ items: [fixture, fixture] }), json({ items: [], nextPageToken: '' }), json({ items: [], padding: 'x'.repeat(262144) })]) await assert.rejects(() => listCalendarEvents(credentials.accessToken, window, mockFetch(() => response)), isCalendarError('unavailable'));
});

test('page limits and later-page transport errors retain explicit partial results, never empty success', async () => {
  let page = 0;
  const limited = await listCalendarEvents(credentials.accessToken, calendarWindow('2026-10-21'), mockFetch(() => { page++; return json({ items: Array.from({ length: 50 }, (_, index) => ({ ...fixture, id: `event-${page}-${index}` })), nextPageToken: `page-${page}` }); }));
  assert.equal(page, 4); assert.equal(limited.state, 'partial'); assert.equal(limited.complete, false); assert.equal(limited.truncated, true); assert.equal(limited.events.length, 200);
  page = 0;
  const failed = await listCalendarEvents(credentials.accessToken, calendarWindow('2026-10-21'), mockFetch(() => { page++; return page === 1 ? json({ items: [fixture], nextPageToken: 'second' }) : json({}, 503); }));
  assert.equal(failed.state, 'partial'); assert.equal(failed.complete, false); assert.equal(failed.events.length, 1);
});

test('disconnect removes encrypted storage before fixed-body revocation and reports unconfirmed revocation', async () => {
  const connection: CalendarConnection = { encryptedCredentials: encryptCredentials(credentials, config.encryptionKey, owner), revision: 'revision', connectedAt: '', updatedAt: '' };
  let deleted = false;
  const client = { rpc: async (name: string, params: Record<string, string>) => { assert.equal(name, 'calendar_connection_delete'); assert.equal(params.p_expected_revision, connection.revision); deleted = true; return { data: true, error: null }; } } as unknown as SupabaseClient;
  const result = await disconnectCalendar(client, connection, config, owner, mockFetch((url, init) => { assert.equal(deleted, true); assert.equal(url, 'https://oauth2.googleapis.com/revoke'); assert.equal(init.method, 'POST'); assert.equal(new URLSearchParams(String(init.body)).get('token'), credentials.refreshToken); return new Response('', { status: 200 }); }));
  assert.equal(result.revoked, true);
  const failed = await disconnectCalendar(client, connection, config, owner, mockFetch(() => { throw new Error('synthetic-network-error'); }));
  assert.equal(failed.state, 'disconnected'); assert.equal(failed.revoked, false);
});

test('real PostgreSQL calendar migration enforces owner-only encrypted RPC, RLS and revision guards', async t => {
  const db = new PGlite();
  const sql = async (query: string, params: unknown[] = []) => (await db.query(query, params)).rows as Array<Record<string, unknown>>;
  const scalar = async (query: string, params: unknown[] = []) => Object.values((await sql(query, params))[0] || {})[0];
  const role = async <T>(name: string, user: string | null, fn: () => Promise<T>) => { await db.exec(`set role ${name}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']); try { return await fn(); } finally { await db.exec('reset role'); await db.exec('reset request.jwt.claim.sub'); } };
  const encrypted = encryptCredentials(credentials, config.encryptionKey, owner);
  try {
    await db.exec(await readFile('supabase/tests/bootstrap.sql', 'utf8'));
    for (const migration of ['202610200001_stage1.sql', '202610200002_hourly_cadence.sql', '202610200006_google_calendar_readonly.sql']) await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
    await sql('insert into auth.users(id) values($1),($2)', [owner, other]);
    await role('service_role', null, () => sql('select public.configure_tracker_owner($1)', [owner]));
    let firstRevision: unknown, secondRevision: unknown;
    await t.test('owner can store and retrieve only authenticated encrypted credentials', async () => {
      assert.equal(await role('authenticated', owner, () => scalar('select public.calendar_connection_get()')), null);
      firstRevision = await role('authenticated', owner, () => scalar('select public.calendar_connection_put($1,null)', [encrypted]));
      const data = await role('authenticated', owner, () => scalar('select public.calendar_connection_get()')) as Record<string, unknown>;
      assert.equal(data.encrypted_credentials, encrypted); assert.equal(data.revision, firstRevision);
      assert.ok(!JSON.stringify(data).includes(credentials.accessToken));
    });
    await t.test('anonymous, nonowner and service role cannot use owner connection RPCs', async () => {
      for (const [name, user] of [['anon', null], ['authenticated', other], ['service_role', null]] as const) {
        for (const query of ['select public.calendar_connection_get()', 'select public.calendar_connection_put($1,null)', 'select public.calendar_connection_delete($1)']) await assert.rejects(() => role(name, user, () => sql(query, query.includes('put') ? [encrypted] : query.includes('delete') ? [firstRevision] : [])), /permission denied|Not authorized/);
      }
    });
    await t.test('private table has no browser grants and RLS remains effective after accidental read grants', async () => {
      await assert.rejects(() => role('authenticated', owner, () => sql('select * from tracker_private.google_calendar_connections')), /permission denied/);
      await db.exec('grant usage on schema tracker_private to anon,authenticated; grant select on tracker_private.google_calendar_connections to anon,authenticated');
      assert.equal(await role('authenticated', owner, () => scalar('select count(*)::integer from tracker_private.google_calendar_connections')), 1);
      assert.equal(await role('authenticated', other, () => scalar('select count(*)::integer from tracker_private.google_calendar_connections')), 0);
      assert.equal(await role('anon', null, () => scalar('select count(*)::integer from tracker_private.google_calendar_connections')), 0);
      await db.exec('revoke all on tracker_private.google_calendar_connections from anon,authenticated; revoke usage on schema tracker_private from anon,authenticated');
    });
    await t.test('stale create/update/delete cannot overwrite or remove a newer connection', async () => {
      secondRevision = await role('authenticated', owner, () => scalar('select public.calendar_connection_put($1,$2)', [encrypted, firstRevision]));
      assert.notEqual(firstRevision, secondRevision);
      for (const query of ['select public.calendar_connection_put($1,null)', 'select public.calendar_connection_put($1,$2)', 'select public.calendar_connection_delete($1)']) await assert.rejects(() => role('authenticated', owner, () => sql(query, query.includes('put') ? query.includes('$2') ? [encrypted, firstRevision] : [encrypted] : [firstRevision])), /Calendar connection changed/);
    });
    await t.test('plaintext credentials violate storage constraints and the owner can disconnect', async () => {
      await assert.rejects(() => role('authenticated', owner, () => sql('select public.calendar_connection_put($1,$2)', ['plaintext-must-not-persist', secondRevision])), /check constraint/);
      assert.equal(await role('authenticated', owner, () => scalar('select public.calendar_connection_delete($1)', [secondRevision])), true);
      assert.equal(await role('authenticated', owner, () => scalar('select public.calendar_connection_get()')), null);
      assert.equal(await scalar('select count(*)::integer from tracker_private.google_calendar_connections'), 0);
    });
  } finally { await db.close(); }
});
