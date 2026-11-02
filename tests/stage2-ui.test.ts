import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { canRetryExtraction, ExtractionJobResult, extractionPageLink, extractionStateLabel, extractionTargetId, parseDisplayedExtraction, QueueExtractionForm, type ExtractionJobDetail } from '../app/extractions/components';
import type { ExtractionResult } from '../lib/extraction/contracts';
import { InstagramPostCard, type InstagramPostRow } from '../app/instagram/components';

const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const target = '33333333-3333-4333-8333-333333333333';
const title = 'Campus <film>';
const text = `${title}\nDates are unverified.`;
const result: ExtractionResult = {
  version: 'stage2-result-v1', complete: true, issues: [],
  units: [{ assetId: '1', page: null, status: 'processed', text, method: 'ocr', sha256: createHash('sha256').update(text).digest('hex'), issues: [] }],
  candidates: [{ key: 'event:0', kind: 'event', fields: { title, startAt: null, endAt: null }, issues: ['date_unknown'], claims: [{ field: 'title', value: title, evidence: [{ unitId: '1:0', start: 0, end: title.length, quote: title }] }] }],
  stats: { processedAssets: 1, expectedAssets: 1, processedPages: 1, engine: 'synthetic-ui-fixture-not-live-ocr', elapsedMs: 1 },
};
const job: ExtractionJobDetail = {
  id, owner_id: owner, manual_intake_id: target, instagram_update_id: null, state: 'succeeded', attempts: 1, error_code: null,
  extractor_version: 'stage2-rules-v1', created_at: '2026-11-02T12:00:00Z', finished_at: '2026-11-02T12:00:01Z', retry_not_before: null,
  input_snapshot: { sourceUrl: 'https://calendar.fsu.edu/event/synthetic', media: [{ assetId: '1', storagePath: `${owner}/manual/${target}/01-${'a'.repeat(64)}.png`, mimeType: 'image/png', byteCount: 100 }] },
  result,
};
const render = (value: ExtractionJobDetail) => load(renderToStaticMarkup(createElement(ExtractionJobResult, { job: value })));

test('stage 2 results remain unverified suggestions with exact escaped evidence and explicit unknowns', () => {
  const $ = render(job);
  assert.match($('section[aria-label="Selected flyer details"]').text(), /unverified suggestions/);
  assert.match($('.extraction-candidate').text(), /Event suggestion · Unverified/);
  assert.equal($('.extraction-candidate h3').text(), title);
  assert.equal($('film').length, 0);
  assert.match($('.extraction-fields').text(), /StartsUnknownEndsUnknown/);
  assert.equal($('blockquote').text(), title);
  assert.match($('.extraction-claim').text(), /File 1 · characters 0–13/);
  assert.equal($('input[type="checkbox"]').length, 0);
  assert.equal($('a[href*="calendar?kind"],form[action*="calendar/approve"]').length, 0);
});

test('queue forms submit only an existing source identity and cannot carry content or calendar approval', () => {
  const $ = load(renderToStaticMarkup(createElement(QueueExtractionForm, { kind: 'manual', targetId: target })));
  assert.equal($('input[name="kind"]').attr('value'), 'manual');
  assert.equal($('input[name="target_id"]').attr('value'), target);
  assert.equal($('input').length, 2);
  assert.equal($('button').text(), 'Read flyer details');
  assert.equal($('input[name="url"],input[name="content"],input[name="fingerprint"],input[name="approved"]').length, 0);
  assert.equal(renderToStaticMarkup(createElement(QueueExtractionForm, { kind: 'manual', targetId: 'javascript:bad' })), '');
});

test('partial and failed reads never become a successful empty extraction message', () => {
  const partial = { ...result, complete: false, candidates: [], issues: ['missing_media'], units: [{ ...result.units[0], status: 'blocked' as const, text: '', sha256: null, issues: ['media_unavailable'] }], stats: { ...result.stats, processedAssets: 0, processedPages: 0 } };
  const $ = render({ ...job, state: 'partial', result: partial });
  assert.match($('[role="alert"]').text(), /Only part of the supplied material was read/);
  assert.match($('section').text(), /Unread material remains unknown/);
  assert.doesNotMatch($('section').text(), /No opportunities were identified/);
  const failed = render({ ...job, state: 'failed', result: null, error_code: 'private_read_failed' });
  assert.match(failed('[role="alert"]').text(), /does not mean the source contains no opportunities/);
});

test('a complete negative result is distinct from a queued job and a rejected stored result', () => {
  const negative = render({ ...job, result: { ...result, candidates: [] } });
  assert.match(negative('section').text(), /No opportunities were identified in the processed material/);
  const queued = render({ ...job, state: 'queued', attempts: 0, result: null });
  assert.match(queued('section').text(), /waiting for the hourly worker/);
  assert.doesNotMatch(queued('section').text(), /No opportunities were identified/);
  const invalid = structuredClone(result);
  invalid.candidates[0].claims[0].evidence[0].quote = 'A fabricated quote';
  assert.equal(parseDisplayedExtraction(invalid), null);
  const rejected = render({ ...job, result: invalid });
  assert.match(rejected('[role="alert"]').text(), /could not be safely displayed/);
  assert.equal(rejected('.extraction-candidate').length, 0);
});

test('original private downloads stay within the owner prefix and unsafe source schemes are not linked', () => {
  const $ = render(job);
  const download = $('a').filter((_, element) => $(element).text() === 'Download original file 1');
  assert.equal(download.length, 1);
  assert.ok(download.attr('href')!.startsWith('/api/private-media?path='));
  const bad = render({ ...job, input_snapshot: { sourceUrl: 'javascript:alert(1)', media: [{ storagePath: 'other-owner/manual/private.png' }] } });
  assert.equal(bad('a').length, 0);
  assert.match(bad('section').text(), /original bytes unavailable/);
});

test('every PDF page and missing Instagram media are visible without fetching the original URL', () => {
  const pdf = structuredClone(result);
  pdf.units = [{ ...pdf.units[0], page: 1, method: 'pdf-text-and-ocr' }, { ...pdf.units[0], page: 2, method: 'pdf-text-and-ocr', status: 'blocked', text: '', sha256: null, issues: ['page_budget'] }];
  pdf.candidates[0].claims[0].evidence[0].unitId = '1:1';
  pdf.complete = false;
  const $ = render({ ...job, state: 'partial', result: pdf });
  assert.match($('.extraction-units').text(), /File 1 · page 1/);
  assert.match($('.extraction-units').text(), /File 1 · page 2 · blocked/);
  const ig = render({ ...job, manual_intake_id: null, instagram_update_id: target, state: 'blocked', result: null, input_snapshot: { media: [{ assetId: '1', nativeId: 'retained-only' }] } });
  assert.match(ig('section').text(), /Instagram media has not been downloaded/);
});

test('retries are explicit, respect cooldown and stop after three attempts', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(canRetryExtraction({ state: 'partial', attempts: 1, retry_not_before: null }, now), true);
  assert.equal(canRetryExtraction({ state: 'failed', attempts: 2, retry_not_before: '2026-11-02T12:01:00Z' }, now), false);
  assert.equal(canRetryExtraction({ state: 'blocked', attempts: 3, retry_not_before: null }, now), false);
  assert.equal(canRetryExtraction({ state: 'queued', attempts: 1, retry_not_before: null }, now), false);
  assert.equal(canRetryExtraction({ state: 'failed', attempts: 1, retry_not_before: 'invalid' }, now), false);
  const $ = render({ ...job, state: 'partial', result: null });
  assert.equal($('input[name="job_id"]').attr('value'), id);
  assert.equal($('button').text(), 'Retry this read');
  assert.match($('form').text(), /same saved input/);
});

test('retained Instagram captions expose only a private caption queue action with no approval control', () => {
  const row: InstagramPostRow = { id: target, source_id: 'instagram-synthetic', native_id: '123', caption: 'A retained synthetic caption.', published_at: '2026-11-02T10:00:00Z', permalink: 'https://www.instagram.com/p/Synthetic_123/', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', children: [{ native_id: '124', media_type: 'IMAGE', position: 0 }], children_complete: true, first_seen_at: '2026-11-02T10:01:00Z', last_seen_at: '2026-11-02T10:01:00Z' };
  const $ = load(renderToStaticMarkup(createElement(InstagramPostCard, { row, handle: 'synthetic' })));
  assert.equal($('button').filter((_, element) => $(element).text() === 'Read retained caption').length, 1);
  assert.equal($('input[name="kind"]').attr('value'), 'instagram');
  assert.equal($('input[name="target_id"]').attr('value'), target);
  assert.match($('.post-details').text(), /Images, videos and text inside them have not been captured or read/);
  assert.equal($('input[type="checkbox"],a[href*="calendar?kind"]').length, 0);
});

test('queue links preserve page and validated identities while states keep failure separate from empty', () => {
  assert.equal(extractionTargetId('bad-id'), false);
  const url = new URL(extractionPageLink(2, id), 'https://tracker.test');
  assert.equal(url.pathname, '/extractions'); assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('job'), id);
  assert.equal(new URL(extractionPageLink(2, 'https://evil.test'), 'https://tracker.test').searchParams.has('job'), false);
  assert.equal(extractionStateLabel('blocked'), 'Read blocked');
  assert.equal(extractionStateLabel('succeeded'), 'Read complete · unverified');
});
