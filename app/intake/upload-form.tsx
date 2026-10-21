'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';

export default function IntakeForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    let key = form.dataset.submissionKey;
    if (!key) { key = crypto.randomUUID(); form.dataset.submissionKey = key; }
    data.set('submission_key', key);
    try {
      const response = await fetch('/api/intake', { method: 'POST', body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The submission could not be saved.');
      location.assign('/inbox?message=intake_saved');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The submission could not be saved.'); setPending(false); }
  }
  return <form className="stack intake-form" onSubmit={submit}>
    <label className="form-field">Link <span className="field-optional">optional</span><input name="source_url" type="url" maxLength={2048} placeholder="https://…" /></label>
    <label className="form-field">Notes <span className="field-optional">optional</span><textarea name="note" maxLength={5000} rows={5} placeholder="What caught your eye? Any details to check?" /></label>
    <div className="upload-zone"><label className="form-field" htmlFor="intake-files">Flyers & files <span className="field-optional">optional</span></label><p className="form-help" id="intake-file-help">Include every slide. PNG, JPEG, WebP or PDF.<br />Up to 8 files, 5 MiB each and 20 MiB total.</p><input id="intake-files" aria-describedby="intake-file-help" name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></div>
    <p className="form-help">Add a link, notes or at least one file. PDFs are kept together with all their pages.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <button className="button-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save to inbox'}<span aria-hidden="true">↗</span></button>
  </form>;
}
