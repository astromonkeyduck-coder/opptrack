'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireTrackerSession } from '../../lib/auth/session';
import { EXTRACTOR_VERSION } from '../../lib/extraction/contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enqueueExtraction(form: FormData) {
  const { supabase } = await requireTrackerSession();
  const kind = form.get('kind'), target = form.get('target_id');
  if (form.getAll('kind').length !== 1 || form.getAll('target_id').length !== 1 || typeof kind !== 'string' || !['manual', 'instagram'].includes(kind) || typeof target !== 'string' || !uuid.test(target)) redirect('/extractions?message=invalid');
  const { data, error } = await supabase.rpc('extraction_enqueue', { p_kind: kind, p_target_id: target, p_extractor_version: EXTRACTOR_VERSION });
  const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
  if (error || !row || typeof row.id !== 'string' || !uuid.test(row.id)) redirect('/extractions?message=enqueue_failed');
  revalidatePath('/extractions');
  redirect(`/extractions?job=${encodeURIComponent(row.id)}&message=queued`);
}

export async function retryExtraction(form: FormData) {
  const { supabase } = await requireTrackerSession();
  const id = form.get('job_id');
  if (form.getAll('job_id').length !== 1 || typeof id !== 'string' || !uuid.test(id)) redirect('/extractions?message=invalid');
  const { data, error } = await supabase.rpc('extraction_retry', { p_job_id: id });
  const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
  if (error || !row || typeof row.id !== 'string' || !uuid.test(row.id)) redirect(`/extractions?job=${encodeURIComponent(id)}&message=retry_failed`);
  revalidatePath('/extractions');
  redirect(`/extractions?job=${encodeURIComponent(row.id)}&message=retry_queued`);
}
