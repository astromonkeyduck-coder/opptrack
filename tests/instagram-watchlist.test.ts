import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import watchlist from '../config/instagram-watchlist.json';
import accessReport from '../reports/instagram-cli-access.json';
import { instagramSourceSeeds, sourceSeedUpsertOptions } from '../scripts/instagram-source-seeds';

const selectedHandles = ['clubdownunderfsu', 'fsustudentengagement', 'fsustudentaffairs', 'fsustudentunion', 'aslc_fsu', 'fsuhomecoming', 'fsusga', 'fsucampusrec', 'fsuhonors', 'fsucareercenter', 'fsuip', 'fsucge', 'thecenterfsu', 'fsusustainable', 'fsucre', 'fsucosspp', 'fsucossppslc'];

test('watchlist contains exactly the user-selected 17 unique handles and stable source IDs', () => {
  assert.equal(watchlist.accounts.length, 17);
  assert.deepEqual(watchlist.accounts.map(account => account.handle), selectedHandles);
  assert.equal(new Set(watchlist.accounts.map(account => account.handle)).size, 17);
  assert.equal(new Set(watchlist.accounts.map(account => account.source_id)).size, 17);
  for (const account of watchlist.accounts) {
    assert.match(account.handle, /^[a-z0-9._]{1,30}$/);
    assert.equal(account.source_id, `instagram-${account.handle}`);
    assert.equal(account.selection_evidence, 'user_provided');
  }
});

test('profile links are exact canonical HTTPS Instagram profiles without query tokens or credentials', () => {
  for (const account of watchlist.accounts) {
    const url = new URL(account.profile_url);
    assert.equal(url.origin, 'https://www.instagram.com');
    assert.equal(url.pathname, `/${account.handle}/`);
    assert.equal(url.search, ''); assert.equal(url.hash, '');
    assert.equal(url.username, ''); assert.equal(url.password, '');
  }
});

test('live-sample evidence never silently enables collection, paid connectors or Stories', () => {
  assert.equal(watchlist.automatic_collection_enabled, false);
  assert.equal(watchlist.paid_connectors_enabled, false);
  assert.equal(watchlist.calendar_writes_enabled, false);
  assert.equal(watchlist.credential_values_included, false);
  for (const account of watchlist.accounts) {
    assert.equal(account.adapter, 'unconfigured'); assert.equal(account.enabled, false);
    assert.equal(account.cadence_seconds, null); assert.equal(account.status, 'setup_needed');
    assert.equal(account.stories_access, 'manual_only');
    if (account.posts_access === 'live_sample_proven') {
      assert.equal(account.identity_verification, 'verified_for_business_discovery_sample');
      assert.equal(account.professional_account_eligibility, 'verified_for_business_discovery_sample');
      assert.equal(account.live_sample?.report, 'reports/instagram-cli-access.json');
      assert.equal(account.live_sample.scheduled_collection, false);
      assert.equal(account.live_sample.event_extraction, false);
    } else {
      assert.ok(['blocked', 'not_proven'].includes(account.posts_access));
      assert.equal(account.identity_verification, 'unverified');
      assert.equal(account.professional_account_eligibility, 'unverified');
      assert.equal(account.live_sample, undefined);
    }
  }
  assert.equal(watchlist.accounts.filter(account => account.posts_access === 'live_sample_proven').length, accessReport.totals.liveTargetSamplesProven);
});

test('selection retains campus breadth without inventing event dates, captions or collector success', async () => {
  const categories = new Set(watchlist.accounts.flatMap(account => account.categories));
  for (const expected of ['concerts', 'comedy', 'films', 'outdoors', 'research', 'recruiting', 'study_abroad', 'culture', 'service', 'sustainability', 'public_policy', 'involvement']) assert.ok(categories.has(expected), expected);
  for (const account of watchlist.accounts) {
    for (const field of ['caption', 'starts_at', 'first_post_at', 'last_success_at', 'token', 'access_token']) assert.equal(Object.hasOwn(account, field), false);
  }
  const proven = watchlist.accounts.filter(account => account.posts_access === 'live_sample_proven');
  assert.equal(proven.length, accessReport.totals.liveTargetSamplesProven);
  assert.equal(watchlist.accounts.length - proven.length, accessReport.totals.targetsWithoutProvenSample);
  assert.equal(watchlist.live_access_summary.proven_target_samples, proven.length);
  assert.equal(watchlist.live_access_summary.parent_posts, accessReport.totals.validParentPosts);
  assert.equal(watchlist.live_access_summary.carousel_children, accessReport.totals.carouselChildren);
  for (const account of watchlist.accounts) {
    const probe = accessReport.accounts.find(entry => entry.target === account.handle);
    assert.ok(probe, account.handle);
    assert.equal(account.access_probe.report, 'reports/instagram-cli-access.json');
    assert.equal(account.access_probe.observed_at_utc, probe.finishedAt);
    assert.equal(account.access_probe.status, probe.status);
    assert.deepEqual(account.access_probe.http_statuses, probe.httpStatuses);
    assert.deepEqual(account.access_probe.graph_error, probe.graphError);
    assert.deepEqual(account.access_probe.reason_codes, probe.reasonCodes);
    if (!probe.accessSampleProven) continue;
    const sample = account.live_sample;
    assert.ok(sample);
    assert.equal(sample.observed_at_utc, probe.finishedAt);
    assert.equal(sample.parent_posts, probe.counts.validUniqueMediaRows);
    assert.equal(sample.standalone_images, probe.counts.images);
    assert.equal(sample.reels, probe.counts.reels);
    assert.equal(sample.carousels, probe.counts.carousels);
    assert.equal(sample.carousel_children, probe.counts.children);
    assert.equal(sample.media_files_downloaded, 0);
    assert.equal(sample.stories_retrieved, 0);
    assert.equal(sample.pagination_complete, probe.paginationComplete);
  }
});

test('blocked API attempts remain distinct from empty or unattempted accounts', () => {
  const blockedProbes = accessReport.accounts.filter(probe => probe.status === 'blocked');
  const blockedAccounts = watchlist.accounts.filter(account => account.posts_access === 'blocked');
  assert.deepEqual(blockedAccounts.map(account => account.handle), blockedProbes.map(probe => probe.target));
  assert.equal(watchlist.live_access_summary.blocked_targets, blockedProbes.length);
  assert.equal(watchlist.live_access_summary.untested_targets, watchlist.accounts.length - accessReport.totals.attempted);
  for (const account of blockedAccounts) {
    assert.equal(account.live_sample, undefined);
    assert.equal(account.access_probe.status, 'blocked');
    assert.equal(account.identity_verification, 'unverified');
    assert.equal(account.professional_account_eligibility, 'unverified');
    assert.ok(account.access_probe.http_statuses.some(status => status >= 400));
    assert.equal(account.status, 'setup_needed');
  }
});

test('watchlist is separate from the preserved Stage 0 registry', async () => {
  const registry = JSON.parse(await readFile(new URL('../config/source-registry.json', import.meta.url), 'utf8'));
  assert.equal(registry.sources.length, 59);
  const historicalIds = new Set(registry.sources.map((source: { source_id: string }) => source.source_id));
  assert.ok(watchlist.accounts.every(account => !historicalIds.has(account.source_id)));
});

test('source setup seeds every selected profile privately without scheduling or claiming success', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const rows = instagramSourceSeeds(owner, watchlist.accounts);
  assert.equal(rows.length, 17);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.id, watchlist.accounts[index].source_id);
    assert.equal(row.owner_id, owner);
    assert.equal(row.url, watchlist.accounts[index].profile_url);
    assert.equal(row.adapter, 'unconfigured'); assert.equal(row.enabled, false);
    assert.equal(row.cadence_seconds, null); assert.equal(row.next_due_at, null);
    assert.equal(row.health_status, 'setup_needed');
    assert.match(row.health_message, /production worker credentials and a scheduled Instagram collector are not configured/);
    assert.ok(!row.health_message.includes('no Meta token or live post access verified'));
    assert.ok(row.coverage_note.includes('Stories manual-only'));
    for (const field of ['cursor', 'last_success_at', 'last_attempt_at', 'lease_token', 'next_poll_at', 'retry_not_before']) assert.equal(Object.hasOwn(row, field), false);
  }
});

test('source setup ignores existing identities and preserves the historical 59 plus selected 17 boundary', async () => {
  assert.deepEqual(sourceSeedUpsertOptions, { onConflict: 'id', ignoreDuplicates: true });
  const registry = JSON.parse(await readFile(new URL('../config/source-registry.json', import.meta.url), 'utf8'));
  const ids = [...registry.sources.map((source: { source_id: string }) => source.source_id), ...instagramSourceSeeds('11111111-1111-4111-8111-111111111111', watchlist.accounts).map(row => row.id)];
  assert.equal(ids.length, 76); assert.equal(new Set(ids).size, 76);
});
