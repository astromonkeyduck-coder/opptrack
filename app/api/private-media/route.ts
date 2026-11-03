import { trackerSession } from '../../../lib/auth/session';
import { privateMediaResponse } from '../../../lib/intake/private-media';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const session = await trackerSession();
  if (session.state !== 'ready') return privateMediaResponse(request,null,null);
  return privateMediaResponse(request,session.user.id,path=>session.supabase.storage.from('captures').download(path));
}
