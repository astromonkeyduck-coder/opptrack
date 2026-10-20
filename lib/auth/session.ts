import { redirect } from 'next/navigation';
import { userSupabase } from '../supabase/server';

export async function trackerSession() {
  const supabase = await userSupabase();
  if (!supabase) return { state: 'unconfigured' as const, supabase: null, user: null };
  let result;
  try { result = await supabase.auth.getUser(); }
  catch { return { state: 'auth_unavailable' as const, supabase, user: null }; }
  const { data, error } = result;
  if (error && error.name !== 'AuthSessionMissingError' && (!error.status || error.status >= 500)) {
    return { state: 'auth_unavailable' as const, supabase, user: null };
  }
  if (error || !data.user) return { state: 'anonymous' as const, supabase, user: null };
  const membership = await supabase.rpc('is_tracker_member');
  if (membership.error) return { state: 'database_unavailable' as const, supabase, user: data.user };
  if (!membership.data) return { state: 'not_allowed' as const, supabase, user: data.user };
  return { state: 'ready' as const, supabase, user: data.user };
}

export async function requireTrackerSession() {
  const session = await trackerSession();
  if (session.state !== 'ready') redirect(`/?state=${session.state}`);
  return session;
}
