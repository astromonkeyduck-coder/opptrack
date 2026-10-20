'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { userSupabase } from '../lib/supabase/server';
import { requireTrackerSession } from '../lib/auth/session';

export async function signIn(form: FormData) {
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const supabase = await userSupabase();
  if (!supabase) redirect('/?state=unconfigured');
  if (!email || email.length > 254 || !password || password.length > 1024) redirect('/?state=invalid_login');
  let result;
  try { result = await supabase.auth.signInWithPassword({ email, password }); }
  catch { redirect('/?state=auth_unavailable'); }
  if (result.error && (!result.error.status || result.error.status >= 500)) redirect('/?state=auth_unavailable');
  if (result.error) redirect('/?state=invalid_login');
  redirect('/inbox');
}
export async function signOut() {
  const supabase = await userSupabase();
  if (supabase) await supabase.auth.signOut();
  redirect('/');
}
export async function decide(form: FormData) {
  const { supabase } = await requireTrackerSession();
  const id = String(form.get('occurrence_id') || '');
  const action = String(form.get('action') || '');
  const revision = Number(form.get('revision'));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['save', 'reject'].includes(action) || !Number.isInteger(revision) || revision < 1) redirect('/inbox?message=decision_failed');
  const { error } = await supabase.rpc('record_decision', { p_occurrence_id: id, p_action: action, p_expected_revision: revision });
  revalidatePath('/inbox');
  if (error) redirect('/inbox?message=decision_failed');
  redirect('/inbox?message=decision_saved');
}
