// Server-only executor. No scheduler, attendee, update or delete capability.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CalendarError, GOOGLE_CALENDAR_WRITE_SCOPE, calendarAccessToken, decryptCredentials, getCalendarConnection, type CalendarConfig } from './google';

const uuid = z.uuid();
const instant = z.string().max(64).refine(value => /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)));
const stamp = z.object({ dateTime: instant, timeZone: z.literal('America/New_York') }).strict();
const metadata = z.object({ opptrackCommandId: uuid, opptrackFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const calendarPayloadSchema = z.object({
  summary: z.string().min(1).refine(value => [...value].length <= 1010), description: z.string().refine(value => [...value].length <= 10000), location: z.string().refine(value => [...value].length <= 2000).optional(),
  start: stamp, end: stamp, reminders: z.object({ useDefault: z.literal(false) }).strict(),
  extendedProperties: z.object({ private: metadata }).strict(),
}).strict().refine(value => Date.parse(value.end.dateTime) > Date.parse(value.start.dateTime));
const commandSchema = z.object({
  id: uuid, connectionGeneration: uuid, kind: z.enum(['occurrence', 'milestone']), targetId: uuid,
  state: z.enum(['pending', 'processing', 'succeeded', 'uncertain', 'failed']),
  providerEventId: z.string().regex(/^[a-v0-9]{5,1024}$/), payload: calendarPayloadSchema,
  leaseToken: uuid.nullish(), approvedAt: z.string(), lastError: z.string().nullish(), retryNotBefore: z.string().nullish(),
}).passthrough().refine(value => value.payload.extendedProperties.private.opptrackCommandId === value.id);
export type CalendarCommand = z.infer<typeof commandSchema>;
export type CalendarWriteResult = { state: 'succeeded' | 'processing' | 'uncertain' | 'failed' | 'reconnect_required' | 'disabled'; commandId?: string; notice: string; htmlLink?: string };
export const approvalInputSchema = z.object({
  kind: z.enum(['occurrence', 'milestone']), targetId: uuid, fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  startAt: instant.optional(), endAt: instant.optional(),
}).strict().refine(value => value.kind === 'milestone' ? !!value.startAt && !!value.endAt : !value.startAt && !value.endAt);

export function calendarWritingEnabled(environment: Record<string, string | undefined> = process.env) { return environment.CALENDAR_WRITES_ENABLED === 'true'; }
export function parseCalendarCommand(value: unknown): CalendarCommand { return commandSchema.parse(value); }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
class ProviderFailure extends Error {
  constructor(public code: string, public status: number | null, public retrySeconds = 0) { super(code); }
}
function retrySeconds(value: string | null, now = Date.now()) {
  if (!value) return 60;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(86400, Math.ceil(seconds))) : 60;
}
const EVENT_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const projection = 'id,status,summary,description,location,start(dateTime,timeZone),end(dateTime,timeZone),reminders,extendedProperties,htmlLink';
async function providerRequest(eventId: string, accessToken: string, payload: CalendarCommand['payload'] | null, fetcher: typeof fetch) {
  const url = new URL(payload ? EVENT_URL : `${EVENT_URL}/${eventId}`);
  url.searchParams.set('fields', projection);
  if (payload) url.searchParams.set('sendUpdates', 'none');
  let response: Response;
  try {
    response = await fetcher(url.href, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${accessToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify({ id: eventId, ...payload }) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  } catch { throw new ProviderFailure('provider_transport', null); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderFailure(response.status === 401 ? 'provider_auth' : response.status === 429 ? 'provider_rate_limited' : `provider_http_${response.status}`, response.status, response.status === 429 ? retrySeconds(response.headers.get('Retry-After')) : 0);
  }
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new ProviderFailure('provider_invalid_response', null);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > 65536) { await reader.cancel(); throw new Error('large'); }
      chunks.push(chunk.value);
    }
    const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!body || body.error) throw new Error('invalid');
    return body;
  } catch { throw new ProviderFailure('provider_invalid_response', null); }
  finally { reader.releaseLock(); }
}

/** Compare every approved writable field before treating an insert/retry as successful. */
export function calendarEventMatches(command: CalendarCommand, value: unknown): boolean {
  const event = record(value), start = record(event?.start), end = record(event?.end);
  const extensions = record(event?.extendedProperties), privateValues = record(extensions?.private), reminders = record(event?.reminders);
  return !!event && event.id === command.providerEventId && event.status !== 'cancelled'
    && event.summary === command.payload.summary && (event.description || '') === command.payload.description
    && (event.location || '') === (command.payload.location || '')
    && typeof start?.dateTime === 'string' && typeof end?.dateTime === 'string'
    && Date.parse(start.dateTime) === Date.parse(command.payload.start.dateTime) && Date.parse(end.dateTime) === Date.parse(command.payload.end.dateTime)
    && privateValues?.opptrackCommandId === command.id && privateValues?.opptrackFingerprint === command.payload.extendedProperties.private.opptrackFingerprint
    && reminders?.useDefault === false && (!Array.isArray(reminders.overrides) || reminders.overrides.length === 0);
}
function confirmed(command: CalendarCommand): CalendarWriteResult {
  return { state: 'succeeded', commandId: command.id, notice: 'Added to the primary Google Calendar under the connection used for this approval. This applies only to this item.', htmlLink: 'https://calendar.google.com/calendar/u/0/r' };
}
async function finish(client: SupabaseClient, command: CalendarCommand, state: 'succeeded' | 'uncertain' | 'failed', code: string | null, delay = 0) {
  const { error } = await client.rpc('calendar_write_finish', { p_id: command.id, p_lease_token: command.leaseToken, p_state: state, p_error_code: code, p_retry_after_seconds: delay });
  if (error) throw new Error('Calendar result storage unconfirmed');
}

export async function requireCalendarWriteGrant(client: SupabaseClient, config: CalendarConfig, ownerId: string, fetcher: typeof fetch = fetch) {
  if (!config.writeEnabled) throw new CalendarError('invalid_request', 'Calendar additions are disabled.');
  const connection = await getCalendarConnection(client);
  if (!connection || decryptCredentials(connection.encryptedCredentials, config.encryptionKey, ownerId).scope !== GOOGLE_CALENDAR_WRITE_SCOPE) throw new CalendarError('reconnect_required', 'Reconnect Google Calendar and approve writing before adding an item.');
  if (!connection.authorizationGeneration || !z.uuid().safeParse(connection.authorizationGeneration).success) throw new CalendarError('reconnect_required', 'Reconnect Google Calendar to bind this approval to its destination.');
  const accessToken = await calendarAccessToken(client, connection, config, ownerId, fetcher);
  const latest = await getCalendarConnection(client);
  if (!latest || latest.authorizationGeneration !== connection.authorizationGeneration || decryptCredentials(latest.encryptedCredentials, config.encryptionKey, ownerId).scope !== GOOGLE_CALENDAR_WRITE_SCOPE) throw new CalendarError('reconnect_required', 'The Google connection changed during this request. Review the destination and reconnect before retrying.');
  return { accessToken, authorizationGeneration: connection.authorizationGeneration };
}

export async function executeCalendarCommand(client: SupabaseClient, commandId: string, config: CalendarConfig, ownerId: string, fetcher: typeof fetch = fetch): Promise<CalendarWriteResult> {
  if (!config.writeEnabled) return { state: 'disabled', notice: 'Calendar additions are disabled.' };
  uuid.parse(commandId);
  const existing = await client.rpc('calendar_write_get', { p_id: commandId });
  if (existing.error || !existing.data) return { state: 'failed', notice: 'This calendar approval could not be loaded.' };
  const initial = parseCalendarCommand(existing.data);
  if (initial.state === 'succeeded') return confirmed(initial);
  // Grant validation happens before claiming; denied OAuth cannot strand a lease.
  const grant = await requireCalendarWriteGrant(client, config, ownerId, fetcher);
  if (initial.connectionGeneration !== grant.authorizationGeneration) return { state: 'failed', commandId, notice: 'The Google connection changed after this approval. This command is locked to the original connection; check that calendar before any recovery.' };
  const accessToken = grant.accessToken;
  const claimed = await client.rpc('calendar_write_claim', { p_id: commandId });
  if (claimed.error) return { state: 'failed', commandId, notice: 'The approved addition could not be started. Try again later.' };
  if (!claimed.data) return { state: 'processing', commandId, notice: 'This addition is already processing or waiting for its retry window. Refresh later; a second event will not be created.' };
  const command = parseCalendarCommand(claimed.data);
  if (command.state === 'succeeded') return confirmed(command);
  if (!command.leaseToken) return { state: 'processing', commandId, notice: 'This addition is already processing or waiting for its retry window. Refresh later; a second event will not be created.' };
  let insertAttempted = false;
  try {
    const preview = await client.rpc('calendar_write_preview', { p_kind: command.kind, p_target_id: command.targetId });
    const current = record(preview.data);
    const canInsert = !preview.error && current?.canApprove === true && current.fingerprint === command.payload.extendedProperties.private.opptrackFingerprint;
    try {
      const existingEvent = await providerRequest(command.providerEventId, accessToken, null, fetcher);
      if (!calendarEventMatches(command, existingEvent)) throw new ProviderFailure('provider_conflict', 409);
      await finish(client, command, 'succeeded', null); return confirmed(command);
    } catch (error) { if (!(error instanceof ProviderFailure) || error.status !== 404) throw error; }
    if (!canInsert) throw new ProviderFailure('source_changed', 412);
    insertAttempted = true;
    const event = await providerRequest(command.providerEventId, accessToken, command.payload, fetcher);
    if (!calendarEventMatches(command, event)) throw new ProviderFailure('provider_response_mismatch', null);
    await finish(client, command, 'succeeded', null); return confirmed(command);
  } catch (error) {
    // A timeout/409 after insertion may mean Google committed. Reconcile the persisted ID once.
    if (insertAttempted && (!(error instanceof ProviderFailure) || error.status === null || error.status === 409 || error.status >= 500)) {
      try {
        const event = await providerRequest(command.providerEventId, accessToken, null, fetcher);
        if (calendarEventMatches(command, event)) { await finish(client, command, 'succeeded', null); return confirmed(command); }
        await finish(client, command, 'failed', 'provider_conflict');
        return { state: 'failed', commandId, notice: 'The Google event differs from this approval. Nothing was overwritten. Review it in Google before retrying.' };
      } catch { /* Preserve uncertainty, including a lost result-storage acknowledgement. */ }
    }
    const uncertain = insertAttempted && (!(error instanceof ProviderFailure) || error.status === null || error.status === 409 || error.status >= 500);
    const code = error instanceof ProviderFailure ? error.code : 'result_storage_unconfirmed';
    try { await finish(client, command, uncertain ? 'uncertain' : 'failed', code, error instanceof ProviderFailure ? error.retrySeconds : 0); }
    catch { return { state: 'uncertain', commandId, notice: 'Google or result storage did not confirm completion. Refresh and retry this same approval; it keeps the same event ID.' }; }
    return { state: error instanceof ProviderFailure && error.status === 401 ? 'reconnect_required' : uncertain ? 'uncertain' : 'failed', commandId,
      notice: error instanceof ProviderFailure && error.code === 'source_changed' ? 'The current source differs from this approval or is no longer eligible. No new event was inserted. Check the source and your calendar before recovery.' : uncertain ? 'Google did not confirm completion. Retry this same approval to check its existing event ID before another insert.' : error instanceof ProviderFailure && error.status === 401 ? 'Reconnect Google Calendar, then retry this existing approval.' : error instanceof ProviderFailure && error.status === 429 ? 'Google limited requests. Wait for the retry window, then retry this approval.' : 'This approved addition could not be completed. Its details are retained for an explicit retry.' };
  }
}

export async function approveCalendarCommand(client: SupabaseClient, value: unknown, config: CalendarConfig, ownerId: string, fetcher: typeof fetch = fetch) {
  const input = approvalInputSchema.parse(value);
  await requireCalendarWriteGrant(client, config, ownerId, fetcher);
  const { data, error } = await client.rpc('calendar_write_approve', { p_kind: input.kind, p_target_id: input.targetId, p_expected_fingerprint: input.fingerprint, p_start_at: input.startAt ?? null, p_end_at: input.endAt ?? null });
  if (error) return { state: 'failed', notice: error.code === '40001' ? 'This source item changed. Refresh and review the new details before approving.' : 'This item cannot be approved. Check its date, duration and source status, then refresh.' } satisfies CalendarWriteResult;
  const command = parseCalendarCommand(data);
  return executeCalendarCommand(client, command.id, config, ownerId, fetcher);
}
