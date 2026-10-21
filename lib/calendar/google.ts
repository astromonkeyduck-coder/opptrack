// Server-only: Node crypto and Google credentials must never enter a client bundle.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const OAUTH_LIFETIME_MS = 10 * 60 * 1000;
const MAX_PAGES = 4;
const PAGE_SIZE = 50;
const MAX_RESPONSE_BYTES = 262144;

export type CalendarConfig = { origin: string; clientId: string; clientSecret: string; encryptionKey: Buffer; redirectUri: string; secure: boolean };
export type CalendarCredentials = { accessToken: string; refreshToken: string; expiresAt: number; scope: typeof GOOGLE_CALENDAR_SCOPE };
export type CalendarConnection = { encryptedCredentials: string; revision: string; connectedAt: string; updatedAt: string };
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay: boolean };
export type CalendarWindow = { from: string; to: string; timeMin: string; timeMax: string; timeZone: 'America/New_York' };
export type CalendarState = 'connected' | 'partial' | 'unconfigured' | 'disconnected' | 'reconnect_required' | 'unavailable' | 'unauthenticated' | 'invalid_request';
export type CalendarEventsResponse = {
  state: CalendarState; connected: boolean; readOnly: true; calendar: 'primary';
  events: CalendarEvent[]; complete: boolean; notice?: string; truncated?: boolean;
  window?: CalendarWindow; updatedAt?: string;
};
type OAuthState = { state: string; userId: string; verifier: string; expiresAt: number };

export class CalendarError extends Error {
  constructor(public state: CalendarState, message: string) { super(message); this.name = 'CalendarError'; }
}

export function calendarConfig(environment: Record<string, string | undefined> = process.env): CalendarConfig | null {
  const { APP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALENDAR_TOKEN_ENCRYPTION_KEY } = environment;
  if (environment.CALENDAR_WRITES_ENABLED && environment.CALENDAR_WRITES_ENABLED !== 'false') return null;
  if (!APP_URL || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !CALENDAR_TOKEN_ENCRYPTION_KEY) return null;
  try {
    const origin = new URL(APP_URL);
    const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
    if ((!local && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return null;
    if (GOOGLE_CLIENT_ID.length > 512 || /\s/.test(GOOGLE_CLIENT_ID) || GOOGLE_CLIENT_SECRET.length > 2048 || /[\r\n]/.test(GOOGLE_CLIENT_SECRET)) return null;
    if (!/^[A-Za-z0-9+/]{43}=$/.test(CALENDAR_TOKEN_ENCRYPTION_KEY)) return null;
    const encryptionKey = Buffer.from(CALENDAR_TOKEN_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== CALENDAR_TOKEN_ENCRYPTION_KEY) return null;
    return { origin: origin.origin, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, encryptionKey, redirectUri: `${origin.origin}/api/calendar/callback`, secure: !local };
  } catch { return null; }
}

export function calendarCookieName(config: CalendarConfig) { return config.secure ? '__Host-opptrack-calendar-oauth' : 'opptrack-calendar-oauth'; }

function seal(value: unknown, key: Buffer, context: string) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > 20000) throw new CalendarError('unavailable', 'Calendar credential data is invalid.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`opptrack/calendar/v1/${context}`));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function unseal(value: string, key: Buffer, context: string): unknown {
  try {
    if (value.length > 30000 || !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid');
    const [, iv, tag, body] = value.split('.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`opptrack/calendar/v1/${context}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
  } catch { throw new CalendarError('reconnect_required', 'The private calendar connection could not be verified. Reconnect Google Calendar.'); }
}

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function token(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\s\r\n]/.test(value); }

export function encryptCredentials(credentials: CalendarCredentials, key: Buffer, ownerId: string) {
  return seal(credentials, key, `credentials/${ownerId}`);
}

export function decryptCredentials(encrypted: string, key: Buffer, ownerId: string): CalendarCredentials {
  const value = record(unseal(encrypted, key, `credentials/${ownerId}`));
  if (!value || !token(value.accessToken) || !token(value.refreshToken) || value.scope !== GOOGLE_CALENDAR_SCOPE || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) throw new CalendarError('reconnect_required', 'Reconnect Google Calendar to verify this read-only connection.');
  return value as CalendarCredentials;
}

export function createCalendarAuthorization(config: CalendarConfig, userId: string, now = Date.now()) {
  const state: OAuthState = { state: randomBytes(32).toString('base64url'), userId, verifier: randomBytes(32).toString('base64url'), expiresAt: now + OAUTH_LIFETIME_MS };
  const url = new URL(AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: GOOGLE_CALENDAR_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state: state.state,
    code_challenge: createHash('sha256').update(state.verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return { url: url.href, cookie: seal(state, config.encryptionKey, 'oauth-state'), maxAge: OAUTH_LIFETIME_MS / 1000 };
}

export function validateCalendarCallback(cookie: string, state: string, userId: string, config: CalendarConfig, now = Date.now()) {
  let value: Record<string, unknown> | null;
  try { value = record(unseal(cookie, config.encryptionKey, 'oauth-state')); }
  catch { throw new CalendarError('invalid_request', 'The calendar connection request expired or could not be verified. Try connecting again.'); }
  if (!value || value.userId !== userId || typeof value.expiresAt !== 'number' || value.expiresAt <= now || value.expiresAt > now + OAUTH_LIFETIME_MS || typeof value.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.state) || !/^[A-Za-z0-9_-]{43}$/.test(state) || typeof value.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier)) throw new CalendarError('invalid_request', 'The calendar connection request expired or could not be verified. Try connecting again.');
  if (!timingSafeEqual(Buffer.from(value.state), Buffer.from(state))) throw new CalendarError('invalid_request', 'The calendar connection request could not be verified. Try connecting again.');
  return { verifier: value.verifier };
}

async function googleJson(url: string, init: RequestInit, fetcher: typeof fetch) {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
  catch { throw new CalendarError('unavailable', 'Google Calendar could not be reached. Try again.'); }
  if (response.status === 401) throw new CalendarError('reconnect_required', 'Google Calendar access expired or was revoked. Reconnect your calendar.');
  if (!response.ok) throw new CalendarError(response.status === 400 && url === TOKEN_URL ? 'reconnect_required' : 'unavailable', response.status === 429 ? 'Google Calendar is rate limiting requests. Try again later.' : 'Google Calendar could not complete this read. Try again or reconnect.');
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new CalendarError('unavailable', 'Google Calendar returned an unexpected response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new CalendarError('unavailable', 'Google Calendar returned more data than this view can safely read.'); }
      chunks.push(value);
    }
    const payload = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!payload || payload.error) throw new CalendarError('unavailable', 'Google Calendar returned an error or invalid response.');
    return payload;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('unavailable', 'Google Calendar returned an invalid or incomplete response.');
  } finally { reader.releaseLock(); }
}

function credentialsFromResponse(payload: Record<string, unknown>, previous?: CalendarCredentials, now = Date.now()): CalendarCredentials {
  const scopes = typeof payload.scope === 'string' ? payload.scope.trim().split(/\s+/) : previous ? [previous.scope] : [];
  const refreshToken = payload.refresh_token ?? previous?.refreshToken;
  if (scopes.length !== 1 || scopes[0] !== GOOGLE_CALENDAR_SCOPE || !token(payload.access_token) || !token(refreshToken) || typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer' || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in < 60 || payload.expires_in > 86400) throw new CalendarError('reconnect_required', 'Google did not return the required read-only calendar grant. Reconnect and approve calendar read access only.');
  return { accessToken: payload.access_token, refreshToken, expiresAt: now + payload.expires_in * 1000, scope: GOOGLE_CALENDAR_SCOPE };
}

export async function exchangeCalendarCode(code: string, verifier: string, config: CalendarConfig, fetcher: typeof fetch = fetch, now = Date.now()) {
  if (!code || code.length > 2048 || /[\r\n]/.test(code)) throw new CalendarError('invalid_request', 'The Google authorization response is invalid. Try connecting again.');
  const body = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
  return credentialsFromResponse(await googleJson(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, fetcher), undefined, now);
}

export async function getCalendarConnection(client: SupabaseClient): Promise<CalendarConnection | null> {
  const { data, error } = await client.rpc('calendar_connection_get');
  if (error) throw new CalendarError('unavailable', 'Private calendar connection storage could not be read.');
  if (data === null) return null;
  const value = record(data);
  if (!value || typeof value.encrypted_credentials !== 'string' || typeof value.revision !== 'string' || typeof value.connected_at !== 'string' || typeof value.updated_at !== 'string') throw new CalendarError('unavailable', 'Private calendar connection storage returned an invalid record.');
  return { encryptedCredentials: value.encrypted_credentials, revision: value.revision, connectedAt: value.connected_at, updatedAt: value.updated_at };
}

export async function saveCalendarConnection(client: SupabaseClient, credentials: CalendarCredentials, config: CalendarConfig, userId: string, expectedRevision: string | null) {
  const { data, error } = await client.rpc('calendar_connection_put', { p_encrypted_credentials: encryptCredentials(credentials, config.encryptionKey, userId), p_expected_revision: expectedRevision });
  if (error || typeof data !== 'string') throw new CalendarError('unavailable', error?.code === '40001' ? 'The calendar connection changed during this request. Try again.' : 'The private calendar connection could not be saved.');
  return data;
}

export async function calendarAccessToken(client: SupabaseClient, connection: CalendarConnection, config: CalendarConfig, userId: string, fetcher: typeof fetch = fetch, now = Date.now()) {
  const credentials = decryptCredentials(connection.encryptedCredentials, config.encryptionKey, userId);
  if (credentials.expiresAt > now + 60000) return credentials.accessToken;
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' });
  const refreshed = credentialsFromResponse(await googleJson(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, fetcher), credentials, now);
  try { await saveCalendarConnection(client, refreshed, config, userId, connection.revision); }
  catch (error) {
    // A parallel refresh/reconnect must never be overwritten by this older result.
    const latest = await getCalendarConnection(client);
    if (!latest || latest.revision === connection.revision) throw error;
    const current = decryptCredentials(latest.encryptedCredentials, config.encryptionKey, userId);
    if (current.expiresAt <= now + 60000) throw error;
    return current.accessToken;
  }
  return refreshed.accessToken;
}

function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function easternMidnight(value: string) {
  const midnight = new Date(`${value}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(midnight).find(part => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
  return new Date(`${value}T00:00:00${offset}`).toISOString();
}

export function calendarWindow(from?: string | null, now = new Date()): CalendarWindow {
  const date = from ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!validDate(date)) throw new CalendarError('invalid_request', 'Choose a valid calendar date.');
  const end = new Date(`${date}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
  const to = end.toISOString().slice(0, 10);
  return { from: date, to, timeMin: easternMidnight(date), timeMax: easternMidnight(to), timeZone: 'America/New_York' };
}

export function normalizeCalendarEvent(value: unknown): CalendarEvent | null {
  const row = record(value); if (!row) throw new CalendarError('unavailable', 'Google Calendar returned an invalid event.');
  if (row.status === 'cancelled') return null;
  const start = record(row.start), end = record(row.end);
  if (typeof row.id !== 'string' || !row.id || row.id.length > 1024 || !start || !end) throw new CalendarError('unavailable', 'Google Calendar returned an incomplete event.');
  const allDay = typeof start.date === 'string';
  const begin = allDay ? start.date : start.dateTime, finish = allDay ? end.date : end.dateTime;
  const instant = (entry: unknown): entry is string => typeof entry === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(entry) && Number.isFinite(Date.parse(entry));
  if (typeof begin !== 'string' || typeof finish !== 'string' || (allDay ? !validDate(begin) || !validDate(finish) : !instant(begin) || !instant(finish)) || Date.parse(finish) <= Date.parse(begin)) throw new CalendarError('unavailable', 'Google Calendar returned an invalid event time.');
  if (row.summary !== undefined && typeof row.summary !== 'string') throw new CalendarError('unavailable', 'Google Calendar returned an invalid event title.');
  return { id: row.id, title: typeof row.summary === 'string' && row.summary.trim() ? row.summary.slice(0, 1000) : 'Busy', start: begin, end: finish, allDay };
}

export async function listCalendarEvents(accessToken: string, window: CalendarWindow, fetcher: typeof fetch = fetch, now = new Date()): Promise<CalendarEventsResponse> {
  if (!token(accessToken)) throw new CalendarError('reconnect_required', 'Reconnect Google Calendar.');
  const events: CalendarEvent[] = []; const seen = new Set<string>(); const pageTokens = new Set<string>(); let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(EVENTS_URL);
    url.search = new URLSearchParams({ timeMin: window.timeMin, timeMax: window.timeMax, timeZone: window.timeZone, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: String(PAGE_SIZE), fields: 'items(id,summary,status,start(date,dateTime),end(date,dateTime)),nextPageToken', ...(pageToken ? { pageToken } : {}) }).toString();
    let payload: Record<string, unknown>;
    try { payload = await googleJson(url.href, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, fetcher); }
    catch (error) {
      if (!events.length || error instanceof CalendarError && error.state === 'reconnect_required') throw error;
      return { state: 'partial', connected: true, readOnly: true, calendar: 'primary', events, complete: false, notice: 'Only part of your calendar could be loaded. Some events may be missing; retry this view.', window, updatedAt: now.toISOString() };
    }
    if (!Array.isArray(payload.items) || payload.items.length > PAGE_SIZE || payload.nextPageToken !== undefined && (typeof payload.nextPageToken !== 'string' || payload.nextPageToken.length > 4096 || !payload.nextPageToken)) throw new CalendarError('unavailable', 'Google Calendar returned an invalid or incomplete event page.');
    for (const item of payload.items) {
      const event = normalizeCalendarEvent(item); if (!event) continue;
      if (seen.has(event.id)) throw new CalendarError('unavailable', 'Google Calendar repeated an event while paging. Retry this view.');
      seen.add(event.id); events.push(event);
    }
    if (!payload.nextPageToken) return { state: 'connected', connected: true, readOnly: true, calendar: 'primary', events, complete: true, window, updatedAt: now.toISOString() };
    pageToken = payload.nextPageToken as string;
    if (pageTokens.has(pageToken)) throw new CalendarError('unavailable', 'Google Calendar repeated a page. Retry this view.');
    pageTokens.add(pageToken);
  }
  return { state: 'partial', connected: true, readOnly: true, calendar: 'primary', events, complete: false, truncated: true, notice: 'This seven-day view reached its 200-event limit. Some events are not shown.', window, updatedAt: now.toISOString() };
}

export async function disconnectCalendar(client: SupabaseClient, connection: CalendarConnection, config: CalendarConfig, userId: string, fetcher: typeof fetch = fetch) {
  const { error } = await client.rpc('calendar_connection_delete', { p_expected_revision: connection.revision });
  if (error) throw new CalendarError('unavailable', 'The private calendar connection could not be removed. Try again.');
  let credentials: CalendarCredentials;
  try { credentials = decryptCredentials(connection.encryptedCredentials, config.encryptionKey, userId); }
  catch { return { state: 'disconnected' as const, revoked: false }; }
  try {
    const response = await fetcher(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credentials.refreshToken }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    return { state: 'disconnected' as const, revoked: response.ok };
  } catch { return { state: 'disconnected' as const, revoked: false }; }
}
