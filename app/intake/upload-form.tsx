'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { validateUploadSet } from '../../lib/intake/validation';
import { intakeFailureMessage, readIntakeResponse } from '../../lib/intake/client';

export default function IntakeForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    const form = event.currentTarget;
    try {
      const data = new FormData(form);
      const files = data.getAll('files').filter((item): item is File => item instanceof File && Boolean(item.name));
      validateUploadSet(files);
      let key = form.dataset.submissionKey;
      if (!key) { key = crypto.randomUUID(); form.dataset.submissionKey = key; }
      data.set('submission_key', key);
      const response = await fetch('/api/intake', { method: 'POST', body: data });
      const saved=await readIntakeResponse(response);
      location.assign(saved.extractionJobId?`/extractions?job=${encodeURIComponent(saved.extractionJobId)}&message=opened`:`/inbox?message=${saved.extractionUnavailable?'intake_saved_extraction_pending':'intake_saved'}`);
    } catch (failure) { setError(intakeFailureMessage(failure)); setPending(false); }
  }
  return <form className="stack intake-form" onSubmit={submit}>
    <label className="form-field">Link <span className="field-optional">optional</span><input name="source_url" type="url" maxLength={2048} placeholder="https://…" /></label>
    <label className="form-field">Notes <span className="field-optional">optional</span><textarea name="note" maxLength={5000} rows={5} placeholder="What caught your eye? Any details to check?" /></label>
    <div className="upload-zone"><label className="form-field" htmlFor="intake-files">Flyers & files <span className="field-optional">optional</span></label><p className="form-help" id="intake-file-help">Include every slide. PNG, JPEG, WebP or PDF.<br />Up to 8 files, 4 MiB each and 4 MiB total.</p><input id="intake-files" aria-describedby="intake-file-help" name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></div>
    <p className="form-help">Add a link, notes or at least one file. Reading is queued after saving; results stay unverified. PDFs are kept together with all their pages. Linked webpages are not fetched.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <button className="button-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save to inbox'}<span aria-hidden="true">↗</span></button>
  </form>;
}
