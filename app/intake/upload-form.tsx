'use client';
import { useState } from 'react';
import type { ClipboardEvent, FormEvent } from 'react';
import { appendIntakeFiles, clipboardIntakeFiles, IntakeSubmissionIdentity, intakeFailureMessage, readIntakeResponse, setIntakeFiles } from '../../lib/intake/client';

export default function IntakeForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [identity] = useState(() => new IntakeSubmissionIdentity());
  function edited() {
    identity.edited();
    setError('');
  }
  function addFiles(added: File[]) {
    if (pending || !added.length) return;
    try {
      const next = appendIntakeFiles(files, added);
      setFiles(next);
      edited();
    } catch (failure) { setError(intakeFailureMessage(failure)); }
  }
  function paste(event: ClipboardEvent<HTMLFormElement>) {
    if (pending) return;
    const added = clipboardIntakeFiles(event.clipboardData);
    if (!added.length) return;
    event.preventDefault();
    addFiles(added);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    try {
      const data = new FormData(form);
      setIntakeFiles(data, files);
      data.set('submission_key', identity.forSubmission());
      setPending(true); setError('');
      const response = await fetch('/api/intake', { method: 'POST', body: data });
      const saved=await readIntakeResponse(response);
      location.assign(saved.extractionJobId?`/extractions?job=${encodeURIComponent(saved.extractionJobId)}&message=opened`:`/inbox?message=${saved.extractionUnavailable?'intake_saved_extraction_pending':'intake_saved'}`);
    } catch (failure) { setError(intakeFailureMessage(failure)); setPending(false); }
  }
  return <form className="stack intake-form" onSubmit={submit} onPaste={paste} onChange={event => {
    if (!pending && (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement && event.target.type !== 'file')) edited();
  }}>
    <fieldset className="stack" disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <label className="form-field">Link <span className="field-optional">optional</span><input name="source_url" type="url" maxLength={2048} placeholder="https://…" /></label>
    <label className="form-field">Notes <span className="field-optional">optional</span><textarea name="note" maxLength={5000} rows={5} placeholder="What caught your eye? Any details to check?" /></label>
    <div className="upload-zone"><label className="form-field" htmlFor="intake-files">Flyers & files <span className="field-optional">optional</span></label><p className="form-help" id="intake-file-help">Include every slide. Choose files or paste screenshots anywhere in this form.<br />PNG, JPEG, WebP or PDF. Up to 8 files, 4 MiB each and 4 MiB total.</p><input id="intake-files" aria-describedby="intake-file-help" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={event => {
      const added = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      addFiles(added);
    }} />
      <div aria-live="polite"><p className="form-help">{files.length ? `${files.length} selected · ${(files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(2)} MiB total. Reading follows this order.` : 'No files selected.'}</p>
        {files.length > 0 && <ol>{files.map((file, index) => <li key={index}><span>{file.name || `Pasted file ${index + 1}`} · {(file.size / 1024).toFixed(1)} KiB</span>{' '}<button type="button" onClick={() => {
          if (pending) return;
          setFiles(files.filter((_, position) => position !== index));
          edited();
        }} aria-label={`Remove file ${index + 1}: ${file.name || 'pasted file'}`}>Remove</button></li>)}</ol>}
      </div>
    </div>
    <p className="form-help">Add a link, notes or at least one file. Reading is queued after saving; results stay unverified. PDFs are kept together with all their pages. Linked webpages are not fetched.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <button className="button-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save to inbox'}<span aria-hidden="true">↗</span></button>
    </fieldset>
  </form>;
}
