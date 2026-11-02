import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { trackerSession } from '../auth/session';
import { requireSameOrigin } from '../intake/validation';
import { CalendarError, calendarConfig } from './google';
import { approveCalendarCommand, executeCalendarCommand } from './writes';

const responseHeaders = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) throw new Error('Invalid request');
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error('large'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function calendarWritePost(request: Request, retry: boolean) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: responseHeaders });
  try { requireSameOrigin(request, process.env.APP_URL); }
  catch { return reply({ state: 'failed', notice: 'Approve additions from the tracker itself.' }, 403); }
  const session = await trackerSession();
  if (session.state !== 'ready') return reply({ state: 'failed', notice: 'Sign in to approve a calendar addition.' }, 401);
  const config = calendarConfig();
  if (!config?.writeEnabled) return reply({ state: 'disabled', notice: 'Calendar additions are disabled or unconfigured.' }, 403);
  try {
    const input = await jsonBody(request);
    const result = retry
      ? await executeCalendarCommand(session.supabase, z.object({ commandId: z.uuid() }).strict().parse(input).commandId, config, session.user.id)
      : await approveCalendarCommand(session.supabase, input, config, session.user.id);
    return reply(result);
  } catch (error) {
    if (error instanceof CalendarError) return reply({ state: error.state === 'reconnect_required' ? 'reconnect_required' : 'failed', notice: error.message });
    if (error instanceof ZodError || error instanceof SyntaxError) return reply({ state: 'failed', notice: 'Choose one item and review valid calendar details.' }, 400);
    return reply({ state: 'uncertain', notice: 'Completion could not be confirmed. Refresh your approval before trying again.' }, 503);
  }
}
