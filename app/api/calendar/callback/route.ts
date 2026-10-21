import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { trackerSession } from '../../../../lib/auth/session';
import { calendarConfig, calendarCookieName, exchangeCalendarCode, getCalendarConnection, saveCalendarConnection, validateCalendarCallback } from '../../../../lib/calendar/google';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const config = calendarConfig();
  const finish = (state: 'connected' | 'cancelled' | 'failed' | 'unconfigured') => {
    const response = NextResponse.redirect(new URL(`/inbox?calendar=${state}`, config?.origin || process.env.APP_URL || new URL(request.url).origin), 303);
    if (config) response.cookies.set(calendarCookieName(config), '', { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/', maxAge: 0 });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  if (!config) return finish('unconfigured');
  const session = await trackerSession();
  if (session.state !== 'ready') return finish('failed');
  try {
    const url = new URL(request.url);
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length > 1 || url.searchParams.getAll('error').length > 1) return finish('failed');
    const cookie = (await cookies()).get(calendarCookieName(config))?.value || '';
    const { verifier } = validateCalendarCallback(cookie, url.searchParams.get('state') || '', session.user.id, config);
    if (url.searchParams.has('error')) return finish('cancelled');
    const credentials = await exchangeCalendarCode(url.searchParams.get('code') || '', verifier, config);
    const prior = await getCalendarConnection(session.supabase);
    await saveCalendarConnection(session.supabase, credentials, config, session.user.id, prior?.revision || null);
    return finish('connected');
  } catch { return finish('failed'); }
}
