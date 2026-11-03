import { IntakeValidationError, validateUploadSet } from './validation';

export class IntakeSubmissionError extends Error {}

/** Files only: ordinary text paste must keep the browser's default behavior. */
export function clipboardIntakeFiles(clipboard: { files: ArrayLike<File> }): File[] {
  return Array.from(clipboard.files);
}

/** Picker selections and pasted images share one ordered, bounded upload set. */
export function appendIntakeFiles(current: readonly File[], added: readonly File[]): File[] {
  const files = [...current, ...added];
  validateUploadSet(files);
  return files;
}

/** Native input fields must not duplicate the controlled selection in multipart. */
export function setIntakeFiles(data: FormData, files: readonly File[]): void {
  validateUploadSet([...files]);
  data.delete('files');
  files.forEach((file, index) => data.append('files', file, file.name || `pasted-file-${index + 1}`));
}

/** A retry checks the same durable submission; deliberate edits start a new one. */
export class IntakeSubmissionIdentity {
  private key: string | undefined;
  forSubmission(createKey: () => string = () => crypto.randomUUID()): string {
    return this.key ??= createKey();
  }
  edited(): void { this.key = undefined; }
}

const retryMessage = 'The save could not be confirmed. Retry this form to check or finish the same submission.';

/** A platform rejection may be HTML or plain text rather than the app's JSON. */
export async function readIntakeResponse(response: Response): Promise<{ id: string; extractionJobId?:string; extractionUnavailable?:boolean }> {
  if (response.status === 413) {
    throw new IntakeSubmissionError('This upload is too large. Keep each file and the combined files at or below 4 MiB.');
  }
  let body: unknown;
  try { body = await response.json(); } catch { /* Do not show platform HTML or JSON parser errors. */ }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  if (!response.ok) {
    if (typeof record?.error === 'string' && record.error.trim()) throw new IntakeSubmissionError(record.error.slice(0, 400));
    if (response.status === 401) throw new IntakeSubmissionError('Sign in again before saving your submission.');
    throw new IntakeSubmissionError(retryMessage);
  }
  if (typeof record?.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.id)) {
    throw new IntakeSubmissionError(retryMessage);
  }
  const job=typeof record.extractionJobId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.extractionJobId)?record.extractionJobId:null;
  return { id: record.id,...(job?{extractionJobId:job}:{}),...(record.extractionState==='unavailable'?{extractionUnavailable:true}:{}) };
}

export function intakeFailureMessage(error: unknown): string {
  return error instanceof IntakeSubmissionError || error instanceof IntakeValidationError
    ? error.message
    : 'The tracker could not be reached. Retry this form to check or finish the same submission.';
}
