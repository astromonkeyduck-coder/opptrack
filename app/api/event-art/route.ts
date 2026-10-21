import { NextResponse } from 'next/server';
import { trackerSession } from '../../../lib/auth/session';
import { fetchEventArt, isCentralEventId, type EventArtResult } from '../../../lib/review/event-art';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function result(body: EventArtResult, status = 200) {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  } });
}

export async function GET(request: Request) {
  let session;
  try { session = await trackerSession(); }
  catch { return result({ state: 'unavailable' }, 503); }
  if (session.state !== 'ready') return result({ state: 'unavailable' }, 401);
  const id = new URL(request.url).searchParams.get('opportunity') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return result({ state: 'unavailable' }, 400);
  try {
    // The authenticated client and the opportunities RLS policy establish owner
    // access before any public metadata lookup or image URL is returned.
    const { data, error } = await session.supabase.from('opportunities').select('id,native_id,source_id').eq('id', id).maybeSingle();
    if (error) return result({ state: 'unavailable' }, 503);
    if (!data) return result({ state: 'unavailable' }, 404);
    if (data.source_id !== 'fsu-calendar-api') return result({ state: 'not_provided' });
    if (!isCentralEventId(data.native_id)) return result({ state: 'unavailable' });
    return result(await fetchEventArt(data.native_id));
  } catch { return result({ state: 'unavailable' }, 503); }
}
