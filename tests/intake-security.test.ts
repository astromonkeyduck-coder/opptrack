import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boundedFormData, MAX_BODY_BYTES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, ownsStoragePath,
  requireSameOrigin, validateManualUrl, validateNote, validateUpload, validateUploadSet,
} from '../lib/intake/validation';
import { cleanSearch, pageNumber, safeExternalUrl, sourceIsStale } from '../lib/intake/presentation';
import { publicSupabaseConfig } from '../lib/supabase/config';

test('manual URLs are retained only and reject active schemes, credentials, local and IP hosts', () => {
  assert.equal(validateManualUrl(' https://calendar.fsu.edu/event/a '), 'https://calendar.fsu.edu/event/a');
  assert.equal(validateManualUrl(''), null);
  for (const input of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://fsu.edu', 'https://u:p@fsu.edu', 'https://localhost', 'https://foo.local', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://internal']) {
    assert.throws(() => validateManualUrl(input));
  }
  assert.throws(() => validateManualUrl(`https://example.com/${'a'.repeat(2050)}`));
});

test('file content signature must match the declared allowed MIME type', () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.deepEqual(validateUpload(png, 'image/png'), { mime: 'image/png', extension: 'png' });
  assert.equal(validateUpload(Uint8Array.of(0xff, 0xd8, 0xff, 0), 'image/jpeg').extension, 'jpg');
  assert.equal(validateUpload(new TextEncoder().encode('RIFF0000WEBPdata'), 'image/webp').extension, 'webp');
  assert.equal(validateUpload(new TextEncoder().encode('%PDF-1.7'), 'application/pdf').extension, 'pdf');
  assert.throws(() => validateUpload(png, 'image/jpeg'));
  assert.throws(() => validateUpload(new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml'));
  assert.throws(() => validateUpload(new Uint8Array(), 'image/png'));
  assert.throws(() => validateUpload(new Uint8Array(MAX_FILE_BYTES + 1), 'image/png'));
});

test('every supplied slide counts toward file and combined byte limits', () => {
  assert.doesNotThrow(() => validateUploadSet(Array.from({ length: 8 }, () => ({ size: 1024 }))));
  assert.throws(() => validateUploadSet(Array.from({ length: 9 }, () => ({ size: 1024 }))));
  assert.throws(() => validateUploadSet([{ size: 0 }]));
  assert.throws(() => validateUploadSet([{ size: MAX_FILE_BYTES + 1 }]));
  assert.throws(() => validateUploadSet(Array.from({ length: 5 }, () => ({ size: MAX_TOTAL_BYTES / 4 }))));
});

test('private paths cannot escape owner prefix, including encoded traversal', () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  assert.ok(ownsStoragePath(owner, `${owner}/submission/01-file.png`));
  for (const path of ['other/file.png', `${owner}/../other/a`, `${owner}/%2e%2e/a`, `${owner}/a\\b`, `${owner}/a?x`]) assert.equal(ownsStoragePath(owner, path), false);
});

test('intake POST requires a matching browser origin', () => {
  assert.doesNotThrow(() => requireSameOrigin(new Request('https://app.example/api/intake', { headers: { origin: 'https://app.example' } })));
  assert.throws(() => requireSameOrigin(new Request('https://app.example/api/intake', { headers: { origin: 'https://evil.example' } })));
  assert.throws(() => requireSameOrigin(new Request('https://app.example/api/intake')));
  assert.throws(() => requireSameOrigin(new Request('http://localhost:3000/api/intake', { headers: { origin: 'http://localhost:3000' } }), 'https://app.example'));
});

test('bounded multipart reader parses valid notes and rejects oversized chunked bodies', async () => {
  const form = new FormData(); form.set('note', 'A real note');
  const read = await boundedFormData(new Request('https://app.example/api/intake', { method: 'POST', body: form }));
  assert.equal(read.get('note'), 'A real note');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1)); controller.close(); } });
  const request = new Request('https://app.example/api/intake', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: stream, duplex: 'half' } as RequestInit);
  await assert.rejects(boundedFormData(request), /too large/);
  await assert.rejects(boundedFormData(new Request('https://app.example/api/intake', { method: 'POST', body: '{}' })), /intake form/);
});

test('notes and list parameters are bounded and cannot inject PostgREST filters', () => {
  assert.equal(validateNote('  check date  '), 'check date');
  assert.throws(() => validateNote('x'.repeat(5001)));
  assert.equal(cleanSearch('concert),owner_id.eq.*'), 'concert owner id eq');
  assert.equal(pageNumber('NaN'), 1);
  assert.equal(pageNumber('-1'), 1);
  assert.equal(pageNumber('2'), 2);
  assert.equal(pageNumber('999999999'), 10000);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
});

test('stale or never-successful sources remain distinguishable from fresh results', () => {
  const now = Date.parse('2026-10-20T20:00:00Z');
  assert.equal(sourceIsStale(null, 3600, now), true);
  assert.equal(sourceIsStale('bad date', 3600, now), true);
  assert.equal(sourceIsStale('2026-10-20T19:00:00Z', 3600, now), false);
  assert.equal(sourceIsStale('2026-10-20T17:00:00Z', 3600, now), true);
});

test('public web configuration rejects server credentials and unsupported URL transport', () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    assert.equal(publicSupabaseConfig(), null);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_test_only';
    assert.equal(publicSupabaseConfig(), null);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_only';
    assert.ok(publicSupabaseConfig());
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://remote.example';
    assert.equal(publicSupabaseConfig(), null);
  } finally {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
