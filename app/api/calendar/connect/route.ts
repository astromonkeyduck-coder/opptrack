import { NextResponse } from 'next/server';
import { trackerSession } from '../../../../lib/auth/session';
import { requireSameOrigin } from '../../../../lib/intake/validation';
import { calendarConfig, calendarCookieName, createCalendarAuthorization } from '../../../../lib/calendar/google';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { requireSameOrigin(request, process.env.APP_URL); }
  catch { return NextResponse.json({ error: 'Connect Google Calendar from the tracker.' }, { status: 403 }); }
  const session = await trackerSession();
  if (session.state !== 'ready') return NextResponse.json({ error: 'Sign in to connect Google Calendar.' }, { status: 401 });
  const config = calendarConfig();
  if (!config) return NextResponse.redirect(new URL('/inbox?calendar=unconfigured', process.env.APP_URL || new URL(request.url).origin), 303);
  const authorization = createCalendarAuthorization(config, session.user.id);
  const response = NextResponse.redirect(authorization.url, 303);
  response.cookies.set(calendarCookieName(config), authorization.cookie, { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/', maxAge: authorization.maxAge });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
