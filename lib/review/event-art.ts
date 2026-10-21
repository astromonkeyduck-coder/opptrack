export type EventArtResult =
  | { state: 'available'; url: string; alt: string }
  | { state: 'unavailable' | 'not_provided' };

const METADATA_LIMIT = 256 * 1024;
const TIMEOUT_MS = 5000;
const IMAGE_HOST = 'localist-images.azureedge.net';
const NATIVE_ID = /^[1-9][0-9]{0,19}$/;

export function isCentralEventId(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_ID.test(value);
}

/** This exact CDN and photo path were observed in fresh FSU calendar metadata.
 * Only public image URLs are returned; image bodies are never fetched here. */
export function safeEventArtUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST || url.username || url.password
      || url.port || url.search || url.hash
      || !/^\/photos\/[1-9][0-9]{0,19}\/huge\/[a-f0-9]{16,128}\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function eventId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return isCentralEventId(value) ? value : null;
}

export function eventArtFromPayload(payload: unknown, nativeId: string): EventArtResult {
  if (!isCentralEventId(nativeId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { state: 'unavailable' };
  const event = (payload as { event?: unknown }).event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { state: 'unavailable' };
  const metadata = event as { id?: unknown; photo_url?: unknown };
  if (eventId(metadata.id) !== nativeId) return { state: 'unavailable' };
  if (metadata.photo_url === null || metadata.photo_url === undefined || metadata.photo_url === '') return { state: 'not_provided' };
  const url = safeEventArtUrl(metadata.photo_url);
  return url ? { state: 'available', url, alt: 'Image supplied with this FSU calendar listing' } : { state: 'unavailable' };
}

/** The database-native ID selects a fixed public API path, never a caller URL. */
export async function fetchEventArt(nativeId: string, fetcher: typeof fetch = globalThis.fetch): Promise<EventArtResult> {
  if (!isCentralEventId(nativeId)) return { state: 'unavailable' };
  try {
    const options: RequestInit & { next: { revalidate: number } } = {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' }, cache: 'force-cache', next: { revalidate: 3600 },
    };
    const response = await fetcher(`https://calendar.fsu.edu/api/2/events/${nativeId}`, options);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const declaredLength = response.headers.get('content-length');
    if (!response.ok || response.redirected || contentType !== 'application/json'
      || (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > METADATA_LIMIT))) {
      await response.body?.cancel();
      return { state: 'unavailable' };
    }
    const reader = response.body?.getReader();
    if (!reader) return { state: 'unavailable' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > METADATA_LIMIT) { await reader.cancel(); return { state: 'unavailable' }; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return eventArtFromPayload(payload, nativeId);
  } catch { return { state: 'unavailable' }; }
}
