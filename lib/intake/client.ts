import { IntakeValidationError } from './validation';

export class IntakeSubmissionError extends Error {}

const retryMessage = 'The save could not be confirmed. Retry this form to check or finish the same submission.';

/** A platform rejection may be HTML or plain text rather than the app's JSON. */
export async function readIntakeResponse(response: Response): Promise<{ id: string }> {
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
  return { id: record.id };
}

export function intakeFailureMessage(error: unknown): string {
  return error instanceof IntakeSubmissionError || error instanceof IntakeValidationError
    ? error.message
    : 'The tracker could not be reached. Retry this form to check or finish the same submission.';
}
