import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { trackerSession } from '../../../lib/auth/session';
import { boundedFormData, IntakeValidationError, requireSameOrigin, validateManualUrl, validateNote, validateUpload, validateUploadSet } from '../../../lib/intake/validation';
import { isDuplicateObject, verifyStoredObject } from '../../../lib/storage/integrity';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { requireSameOrigin(request, process.env.APP_URL); }
  catch { return NextResponse.json({ error: 'Submit this form from the tracker.' }, { status: 403 }); }
  const session = await trackerSession();
  if (session.state !== 'ready') return NextResponse.json({ error: 'Sign in with the registered tracker owner before submitting.' }, { status: 401 });
  const { supabase, user } = session;
  const uploaded: string[] = [];
  try {
    const form = await boundedFormData(request);
    const url = validateManualUrl(String(form.get('source_url') || ''));
    const note = validateNote(String(form.get('note') || ''));
    const submissionKey = String(form.get('submission_key') || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionKey)) throw new IntakeValidationError('Reload the intake form before submitting.');
    // A retried browser submission returns its original intake before uploading again.
    const prior = await supabase.from('manual_intakes').select('id').eq('submission_key', submissionKey).maybeSingle();
    if (prior.error) throw new Error('database_access');
    if (prior.data) return NextResponse.json({ id: prior.data.id });
    const files = form.getAll('files').filter((item): item is File => item instanceof File && Boolean(item.name));
    validateUploadSet(files);
    if (!url && !note && !files.length) throw new IntakeValidationError('Provide a link, notes, or at least one file.');
    const media: Array<{ storage_path: string; mime_type: string; byte_count: number }> = [];
    for (const [index, file] of files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = validateUpload(bytes, file.type);
      const digest = createHash('sha256').update(bytes).digest('hex');
      const path = `${user.id}/manual/${submissionKey}/${String(index + 1).padStart(2, '0')}-${digest}.${format.extension}`;
      const result = await supabase.storage.from('captures').upload(path, bytes, { contentType: format.mime, upsert: false, cacheControl: '0' });
      if (result.error) {
        if (!isDuplicateObject(result.error)) throw new Error('storage_access');
        await verifyStoredObject(supabase, path, digest, bytes.byteLength);
      }
      if (!result.error) uploaded.push(path);
      media.push({ storage_path: path, mime_type: format.mime, byte_count: bytes.byteLength });
    }
    const result = await supabase.rpc('submit_manual_intake', { p_source_url: url, p_note: note || null, p_media: media, p_submission_key: submissionKey });
    if (result.error) throw new Error('database_access');
    // Concurrent retries can race the first lookup. Retain only the files
    // referenced by the one durable intake, without deleting an uncertain save.
    const saved = await supabase.from('manual_intakes').select('media').eq('id', result.data).maybeSingle();
    if (!saved.error && saved.data) {
      const kept = new Set((saved.data.media as Array<{ storage_path: string }>).map(item => item.storage_path));
      const unused = uploaded.filter(path => !kept.has(path));
      if (unused.length) await supabase.storage.from('captures').remove(unused);
    }
    return NextResponse.json({ id: result.data }, { status: 201 });
  } catch (error) {
    // A timeout or concurrent retry may already reference these immutable files.
    // Keep them for submission reconciliation and the bounded orphan-retention job.
    const invalid = error instanceof IntakeValidationError;
    return NextResponse.json({ error: invalid ? error.message : 'The private submission could not be saved. Check database and private storage access, then retry.' }, { status: invalid ? 400 : 503 });
  }
}
