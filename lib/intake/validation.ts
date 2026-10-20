export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 8;
export const MAX_BODY_BYTES = MAX_TOTAL_BYTES + 1024 * 1024;

export class IntakeValidationError extends Error {}

export function validateManualUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > 2048) throw new IntakeValidationError('The link is too long.');
  let url: URL;
  try { url = new URL(text); } catch { throw new IntakeValidationError('Enter a complete https link.'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new IntakeValidationError('Use an https link without embedded credentials.');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
    throw new IntakeValidationError('Use a public website link.');
  }
  // This route only retains the link. It performs no fetch, DNS lookup or redirect.
  return url.toString();
}

export function validateNote(value: string): string {
  const note = value.trim();
  if (note.length > 5000) throw new IntakeValidationError('Notes may contain up to 5,000 characters.');
  return note;
}

export function validateUpload(bytes: Uint8Array, declaredType: string): { mime: string; extension: string } {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new IntakeValidationError('Each file must be nonempty and at most 5 MiB.');
  const prefix = (values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  let format: { mime: string; extension: string } | undefined;
  if (prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) format = { mime: 'image/png', extension: 'png' };
  else if (prefix([0xff, 0xd8, 0xff])) format = { mime: 'image/jpeg', extension: 'jpg' };
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') format = { mime: 'image/webp', extension: 'webp' };
  else if (ascii(0, 5) === '%PDF-') format = { mime: 'application/pdf', extension: 'pdf' };
  if (!format || declaredType !== format.mime) throw new IntakeValidationError('Supported files are PNG, JPEG, WebP or PDF with matching file contents.');
  return format;
}

export function validateUploadSet(files: Array<{ size: number }>) {
  if (files.length > MAX_FILES) throw new IntakeValidationError('Upload at most 8 files at a time.');
  if (files.some(file => !file.size || file.size > MAX_FILE_BYTES)) throw new IntakeValidationError('Each file must be nonempty and at most 5 MiB.');
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new IntakeValidationError('Keep the combined files at or below 20 MiB.');
}

export function ownsStoragePath(ownerId: string, path: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId) &&
    path.startsWith(`${ownerId}/`) && !path.includes('..') && !path.includes('\\') &&
    /^[a-zA-Z0-9/._-]+$/.test(path);
}

export function requireSameOrigin(request: Request, configuredUrl?: string) {
  const expected = new URL(configuredUrl || request.url).origin;
  const actual = request.headers.get('origin');
  if (!actual || actual !== expected) throw new IntakeValidationError('Submit this form from the tracker.');
}

export async function boundedFormData(request: Request): Promise<FormData> {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new IntakeValidationError('Use the intake form to submit files.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new IntakeValidationError('The submission is too large.');
  if (!request.body) throw new IntakeValidationError('The submission is empty.');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new IntakeValidationError('The submission is too large.'); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return await new Request(request.url, { method: 'POST', headers: request.headers, body: bytes }).formData(); }
  catch { throw new IntakeValidationError('The upload could not be read.'); }
}
