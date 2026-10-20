import { NextResponse } from 'next/server';
import { trackerSession } from '../../../lib/auth/session';
import { ownsStoragePath } from '../../../lib/intake/validation';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const session = await trackerSession();
  if (session.state !== 'ready') return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!ownsStoragePath(session.user.id, path)) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  const result = await session.supabase.storage.from('captures').download(path);
  if (result.error || !result.data) return NextResponse.json({ error: 'Private file unavailable.' }, { status: 404 });
  return new Response(result.data, { headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="private-intake-file"',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}
