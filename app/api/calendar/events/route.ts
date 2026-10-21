import { NextResponse } from 'next/server';
import { trackerSession } from '../../../../lib/auth/session';
import { CalendarError, calendarAccessToken, calendarConfig, calendarWindow, getCalendarConnection, listCalendarEvents, type CalendarEventsResponse, type CalendarState } from '../../../../lib/calendar/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  const fail = (state: CalendarState, notice: string, status = 200) => NextResponse.json({ state, connected: false, readOnly: true, calendar: 'primary', events: [], complete: false, notice } satisfies CalendarEventsResponse, { status, headers });
  const session = await trackerSession();
  if (session.state !== 'ready') return fail('unauthenticated', 'Sign in to view your private calendar.', 401);
  const config = calendarConfig();
  if (!config) return fail('unconfigured', 'Google Calendar read access has not been configured.');
  try {
    const url = new URL(request.url);
    if (url.searchParams.getAll('from').length > 1) return fail('invalid_request', 'Choose one calendar start date.', 400);
    const window = calendarWindow(url.searchParams.get('from'));
    const connection = await getCalendarConnection(session.supabase);
    if (!connection) return fail('disconnected', 'Connect Google Calendar to see your plans here.');
    const accessToken = await calendarAccessToken(session.supabase, connection, config, session.user.id);
    return NextResponse.json(await listCalendarEvents(accessToken, window), { headers });
  } catch (error) {
    if (error instanceof CalendarError) return fail(error.state, error.message, error.state === 'invalid_request' ? 400 : error.state === 'reconnect_required' ? 200 : 503);
    return fail('unavailable', 'Your calendar could not be loaded. This does not mean your calendar is empty.', 503);
  }
}
