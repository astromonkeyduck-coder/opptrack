import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventArtFromPayload, fetchEventArt, isCentralEventId, safeEventArtUrl } from '../lib/review/event-art';

// Synthetic metadata fixtures use the CDN/path shape proven against FSU's
// public API. These tests do not download or inspect an image.
const nativeId = '52675367464418';
const image = 'https://localist-images.azureedge.net/photos/52675367440864/huge/f16ccb87785d7a109da87131caa52bf8dc95483c.jpg';
const payload = { event: { id: Number(nativeId), photo_url: image } };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('only numeric database-native IDs may select a fixed Central API path', async () => {
  for (const value of ['', '0', '-1', '1.2', '../events', '1?url=https://evil.test', 'https://127.0.0.1', '1/../../', ' 12', '12 ', '123456789012345678901', null, 123]) assert.equal(isCentralEventId(value), false);
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return json(payload); };
  assert.deepEqual(await fetchEventArt('https://127.0.0.1/private', fetcher), { state: 'unavailable' });
  assert.equal(calls, 0);
});

test('photo URLs require the observed HTTPS CDN and exact public image path without credentials or tokens', () => {
  assert.equal(safeEventArtUrl(image), image);
  for (const value of [null, '', ` ${image}`, image.replace('https:', 'http:'), image.replace('localist-images.azureedge.net', 'localist-images.azureedge.net.evil.test'), image.replace('localist-images.azureedge.net', '127.0.0.1'), image.replace('https://', 'https://user:pass@'), image.replace('/huge/', '/original/'), image.replace('.jpg', '.svg'), image + '?access_token=secret', image + '#secret', image.replace('.net/', '.net:444/'), 'javascript:alert(1)', image.replace('/photos/', '/private/')]) assert.equal(safeEventArtUrl(value), null, String(value));
});

test('matching source metadata returns only its photo URL and a factual source label', () => {
  assert.deepEqual(eventArtFromPayload(payload, nativeId), { state: 'available', url: image, alt: 'Image supplied with this FSU calendar listing' });
  assert.equal(eventArtFromPayload({ event: { ...payload.event, id: nativeId } }, nativeId).state, 'available');
});

test('a missing photo differs from failed, mismatched or unsafe metadata', () => {
  for (const photo_url of [undefined, null, '']) assert.deepEqual(eventArtFromPayload({ event: { id: Number(nativeId), photo_url } }, nativeId), { state: 'not_provided' });
  for (const value of [null, [], {}, { event: null }, { event: [] }, { event: { id: 'other', photo_url: image } }, { event: { id: Number(nativeId) + 1, photo_url: image } }, { event: { id: Number(nativeId), photo_url: 'https://evil.test/pic.jpg' } }, { event: { id: Number.MAX_SAFE_INTEGER + 1, photo_url: image } }]) assert.deepEqual(eventArtFromPayload(value, nativeId), { state: 'unavailable' });
});

test('metadata lookup has a fixed host, no-follow redirects, bounded timeout and public one-hour cache', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), `https://calendar.fsu.edu/api/2/events/${nativeId}`);
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'manual');
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(options?.cache, 'force-cache');
    assert.equal((options as RequestInit & { next: { revalidate: number } }).next.revalidate, 3600);
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    return json(payload);
  };
  assert.equal((await fetchEventArt(nativeId, fetcher)).state, 'available');
  assert.equal(calls, 1);
});

test('redirects and HTTP errors cannot become a photo or trigger a second request', async () => {
  for (const status of [301, 302, 307, 308, 401, 404, 429, 503]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response('', { status, headers: { location: 'http://127.0.0.1/private', 'content-type': 'application/json' } }); };
    assert.deepEqual(await fetchEventArt(nativeId, fetcher), { state: 'unavailable' });
    assert.equal(calls, 1);
  }
});

test('HTML, malformed JSON, invalid UTF-8 and oversized declarations fail instead of inventing an image', async () => {
  const responses = [
    new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{"event":', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', 'content-length': String(256 * 1024 + 1) } }),
  ];
  for (const response of responses) assert.deepEqual(await fetchEventArt(nativeId, async () => response), { state: 'unavailable' });
});

test('streaming byte cap cancels oversized metadata even when Content-Length is absent', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); }, cancel() { cancelled = true; } });
  assert.deepEqual(await fetchEventArt(nativeId, async () => new Response(body, { headers: { 'content-type': 'application/json' } })), { state: 'unavailable' });
  assert.equal(cancelled, true);
});

test('transport failures and interrupted responses remain unavailable', async () => {
  assert.deepEqual(await fetchEventArt(nativeId, async () => { throw new Error('transport'); }), { state: 'unavailable' });
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('interrupted')); } });
  assert.deepEqual(await fetchEventArt(nativeId, async () => new Response(body, { headers: { 'content-type': 'application/json' } })), { state: 'unavailable' });
});
