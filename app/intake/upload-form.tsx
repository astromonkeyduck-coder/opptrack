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
  return <form className="stack" onSubmit={submit}>
    <label>Source link (optional)<input name="source_url" type="url" maxLength={2048} placeholder="https://…" /></label>
    <label>Your notes (optional)<textarea name="note" maxLength={5000} rows={5} placeholder="What is this? Which details need checking?" /></label>
    <label>All flyer slides or files (optional)<input name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
    <p className="small">Up to 8 files; 5 MiB per file, 20 MiB combined. PNG, JPEG, WebP and PDF. Include every slide; PDF pages remain retained together and await extraction. Provide a link, notes, or at least one file.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <button type="submit" disabled={pending}>{pending ? 'Saving privately…' : 'Save private intake'}</button>
  </form>;
}
