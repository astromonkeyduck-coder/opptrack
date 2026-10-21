import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { INSTAGRAM_ADAPTER, InstagramCollectionAttention, InstagramPostCard, instagramCollectionState, instagramCredentialExpiry, instagramFeedLink, instagramFilters, safeInstagramPostUrl, type InstagramPostRow, type InstagramSourceRow } from '../app/instagram/components';

// Explicit synthetic render fixtures, never seeded into the production feed.
const fixture: InstagramPostRow = {
  id: 'fixture-post', source_id: 'instagram-clubdownunderfsu', native_id: '12345',
  caption: '<script>alert(1)</script>\nAn unverified campus caption.',
  published_at: '2026-10-20T19:51:35Z', permalink: 'https://www.instagram.com/p/Synthetic_123/',
  media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED',
  children: [{ native_id: '12346', media_type: 'IMAGE', position: 0 }], children_complete: false,
  first_seen_at: '2026-10-21T01:11:00Z', last_seen_at: '2026-10-21T02:11:00Z',
};
const source: InstagramSourceRow = {
  id: fixture.source_id, adapter: INSTAGRAM_ADAPTER, enabled: true, health_status: 'success',
  health_message: null, last_attempt_at: '2026-10-21T02:11:00Z', last_success_at: '2026-10-21T02:11:00Z',
  cadence_seconds: 3600, coverage_note: null, next_due_at: '2026-10-21T03:00:00Z',
};

test('post cards escape captions and keep publication, unread media and unverified event details distinct', () => {
  const html = renderToStaticMarkup(createElement(InstagramPostCard, { row: fixture, handle: 'clubdownunderfsu' }));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Published Oct 20'));
  assert.ok(html.includes('2026'));
  assert.ok(html.includes('Publication time is not an event date'));
  assert.ok(html.includes('Child metadata incomplete'));
  assert.ok(html.includes('Images, videos and text inside them have not been captured or read'));
  assert.ok(html.includes('Open original Instagram post'));
  for (const action of ['Add to calendar', 'Approve event', 'Buy tickets', 'RSVP']) assert.ok(!html.includes(action));
});

test('older post publication keeps its year rather than appearing to be this campus year', () => {
  const html = renderToStaticMarkup(createElement(InstagramPostCard, { row: { ...fixture, published_at: '2022-10-20T19:51:35Z' }, handle: 'clubdownunderfsu' }));
  assert.ok(html.includes('Published Oct 20, 2022'));
});

test('missing caption remains unknown and unsafe post URLs never become clickable', () => {
  const html = renderToStaticMarkup(createElement(InstagramPostCard, { row: { ...fixture, caption: null, permalink: 'javascript:alert(1)', media_type: 'IMAGE' }, handle: 'clubdownunderfsu' }));
  assert.ok(html.includes('No caption was returned'));
  assert.ok(html.includes('does not establish that the image or video contains no opportunity'));
  assert.ok(html.includes('stored post link could not be verified'));
  assert.ok(!html.includes('href='));
  assert.ok(!html.includes('javascript:'));
});

test('post links admit only canonical Instagram post paths with no credentials, query strings or fragments', () => {
  for (const path of ['p/Synthetic_123/', 'reel/Synthetic_123/', 'tv/Synthetic_123/']) assert.equal(safeInstagramPostUrl(`https://www.instagram.com/${path}`), `https://www.instagram.com/${path}`);
  assert.equal(safeInstagramPostUrl('https://www.instagram.com/p/Synthetic_123'), 'https://www.instagram.com/p/Synthetic_123/');
  for (const url of [null, '', 'http://www.instagram.com/p/a/', 'https://www.instagram.com.evil.test/p/a/', 'https://user:pass@www.instagram.com/p/a/', 'https://www.instagram.com/p/a/?access_token=fixture', 'https://www.instagram.com/p/a/#fixture', 'https://www.instagram.com/accounts/login/', 'https://www.instagram.com/p/a/extra/', 'javascript:alert(1)']) assert.equal(safeInstagramPostUrl(url), null);
});

test('source state separates disabled, unattempted, stale, partial and failed collection from success', () => {
  const now = Date.parse('2026-10-21T03:00:00Z');
  assert.equal(instagramCollectionState(undefined, now), 'Automatic collection disabled');
  assert.equal(instagramCollectionState({ ...source, enabled: false }, now), 'Automatic collection disabled');
  assert.equal(instagramCollectionState({ ...source, adapter: 'unconfigured' }, now), 'Enabled source has an unexpected adapter');
  assert.equal(instagramCollectionState({ ...source, last_attempt_at: null, last_success_at: null }, now), 'Enabled · awaiting first collector attempt');
  assert.equal(instagramCollectionState(source, now), 'Enabled · latest bounded collection succeeded');
  assert.equal(instagramCollectionState({ ...source, health_status: 'partial' }, now), 'Enabled · partial');
  assert.equal(instagramCollectionState({ ...source, health_status: 'blocked', last_success_at: null }, now), 'Enabled · blocked · stale or never succeeded');
  assert.equal(instagramCollectionState({ ...source, health_status: 'failed' }, now), 'Enabled · failed');
  assert.equal(instagramCollectionState({ ...source, last_success_at: '2026-10-20T23:59:00Z' }, now), 'Enabled · stale or never succeeded');
});

test('caption search and independent feed pagination retain only allowlisted account filters', () => {
  const allowed = ['instagram-clubdownunderfsu', 'instagram-fsuip'];
  const filters = instagramFilters({ q: ' research%,caption.eq.injected ', account: 'instagram-fsuip', page: '2' }, allowed);
  assert.deepEqual(filters, { q: 'research caption eq injected', account: 'instagram-fsuip', page: 2 });
  const url = new URL(instagramFeedLink({ ...filters, page: 3 }), 'https://tracker.test');
  assert.equal(url.pathname, '/instagram'); assert.equal(url.searchParams.get('q'), filters.q);
  assert.equal(url.searchParams.get('account'), 'instagram-fsuip'); assert.equal(url.searchParams.get('page'), '3');
  assert.deepEqual(instagramFilters({ q: ['duplicate', 'params'], account: 'unknown-account', page: '-2' }, allowed), { q: '', account: '', page: 1 });
  assert.deepEqual(instagramFilters({ account: ['instagram-fsuip'], page: ['2'] }, allowed), { q: '', account: '', page: 1 });
});

test('collection attention is derived from enabled database health and retains prior-post context', () => {
  const sources = ['blocked', 'blocked', 'failed', 'rate_limited', 'partial'].map((health_status, index) => ({ ...source, id: `fixture-${index}`, health_status }));
  const html = renderToStaticMarkup(createElement(InstagramCollectionAttention, { sources }));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('Collection needs attention for 5 enabled accounts'));
  assert.ok(html.includes('Blocked: 2 · Failed: 1 · Rate limited: 1 · Partial: 1'));
  assert.ok(html.includes('Previously collected posts remain available'));
  assert.ok(html.includes('does not mean there are no new posts'));
  assert.ok(html.includes('href="#instagram-source-health"'));
  assert.ok(!html.includes('token expired'));
});

test('pending and disabled accounts do not become false failures, and successful recovery clears attention', () => {
  const render = (sources: InstagramSourceRow[]) => renderToStaticMarkup(createElement(InstagramCollectionAttention, { sources }));
  assert.equal(render([]), '');
  assert.equal(render([source]), '');
  assert.equal(render([{ ...source, health_status: 'setup_needed', last_attempt_at: null, last_success_at: null }]), '');
  assert.equal(render([{ ...source, health_status: 'blocked', enabled: false }]), '');
  assert.equal(render([{ ...source, health_status: 'blocked', adapter: 'unconfigured' }]), '');
  const blocked = { ...source, health_status: 'blocked' };
  assert.ok(render([blocked]).includes('1 enabled account.'));
  assert.equal(render([{ ...blocked, health_status: 'success' }]), '');
});

test('verified conservative expiry is displayed in Eastern time without promising current access or renewal', () => {
  const metadata = { token_expiry_verified: true, token_expires_at_conservative_utc: '2026-12-20T00:40:44.610662Z', automatic_token_renewal: false };
  const expiry = instagramCredentialExpiry(metadata, Date.parse('2026-10-21T02:30:00Z'));
  assert.equal(expiry.summary, 'Conservative credential expiry: Dec 19, 2026, 7:40 PM ET · Automatic renewal not configured');
  assert.ok(expiry.detail.includes('Meta can invalidate credentials earlier'));
  assert.ok(expiry.detail.includes('Current access failures appear in collector health'));
  assert.ok(!expiry.summary.includes('unverified'));
  assert.ok(!expiry.summary.includes('valid until'));
  const expired = instagramCredentialExpiry(metadata, Date.parse('2026-12-20T00:41:00Z'));
  assert.ok(expired.summary.startsWith('Configured credential expiry reached'));
  assert.ok(expired.detail.includes('credentials need review'));
});

test('missing, invalid or unverified expiry metadata stays explicitly unknown', () => {
  for (const metadata of [
    { token_expiry_verified: false, token_expires_at_conservative_utc: '2026-12-20T00:40:44.610662Z', automatic_token_renewal: false },
    { token_expiry_verified: true, token_expires_at_conservative_utc: 'invalid', automatic_token_renewal: false },
    { token_expiry_verified: true, automatic_token_renewal: false },
  ]) assert.equal(instagramCredentialExpiry(metadata).summary, 'Credential expiry unverified · Automatic renewal not configured');
});
