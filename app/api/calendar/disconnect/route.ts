import { NextResponse } from 'next/server';
import { trackerSession } from '../../../../lib/auth/session';
import { requireSameOrigin } from '../../../../lib/intake/validation';
import { CalendarError, calendarConfig, disconnectCalendar, getCalendarConnection } from '../../../../lib/calendar/google';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' };
  try { requireSameOrigin(request, process.env.APP_URL); }
  catch { return NextResponse.json({ state: 'invalid_request', notice: 'Disconnect Google Calendar from the tracker.' }, { status: 403, headers }); }
  const session = await trackerSession();
  if (session.state !== 'ready') return NextResponse.json({ state: 'unauthenticated', notice: 'Sign in to disconnect your private calendar.' }, { status: 401, headers });
  try {
    const connection = await getCalendarConnection(session.supabase);
    if (!connection) return NextResponse.json({ state: 'disconnected', revoked: false }, { headers });
    const config = calendarConfig();
    if (!config) {
      // Removal still works after configuration or encryption-key loss.
      const { error } = await session.supabase.rpc('calendar_connection_delete', { p_expected_revision: connection.revision });
      if (error) throw new Error('calendar_storage');
      return NextResponse.json({ state: 'disconnected', revoked: false, notice: 'The stored connection was removed. Review Google Account permissions to revoke the provider grant.' }, { headers });
    }
    const result = await disconnectCalendar(session.supabase, connection, config, session.user.id);
    return NextResponse.json({ ...result, ...(!result.revoked ? { notice: 'The stored connection was removed. Google revocation could not be confirmed; review your Google Account permissions.' } : {}) }, { headers });
  } catch (error) {
    return NextResponse.json({ state: 'unavailable', notice: error instanceof CalendarError ? error.message : 'The calendar connection could not be removed. Try again.' }, { status: 503, headers });
  }
}
