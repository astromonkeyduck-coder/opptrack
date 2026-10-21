import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import watchlist from '../config/instagram-watchlist.json';
import accessReport from '../reports/instagram-cli-access.json';
import productionReport from '../reports/instagram-production-monitoring.json';
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

test('production enablement is restricted to the sixteen proven and explicitly authorized accounts', () => {
  assert.equal(watchlist.automatic_collection_enabled, true);
  assert.equal(watchlist.paid_connectors_enabled, false);
  assert.equal(watchlist.calendar_writes_enabled, false);
  assert.equal(watchlist.credential_values_included, false);
  for (const account of watchlist.accounts) {
    assert.equal(account.stories_access, 'manual_only');
    if (account.posts_access === 'live_sample_proven') {
      assert.equal(account.adapter, 'instagram-business-discovery-v1'); assert.equal(account.enabled, true);
      assert.equal(account.cadence_seconds, 3600); assert.equal(account.status, 'enabled');
      assert.equal(account.collector_snapshot?.report, 'reports/instagram-production-monitoring.json');
      assert.equal(account.collector_snapshot.invocation_kind, 'manual');
      assert.equal(account.collector_snapshot.trigger_run_id, productionReport.recoverySmoke.runId);
      assert.equal(account.collector_snapshot.health_status, 'success');
      assert.equal(account.collector_snapshot.failure_category, null);
      const source = productionReport.recoverySmoke.database.source_health.find(row => row.id === account.source_id);
      assert.ok(source);
      assert.equal(account.collector_snapshot.last_attempt_at, source.last_attempt_at);
      assert.equal(account.collector_snapshot.last_success_at, source.last_success_at);
      assert.equal(account.identity_verification, 'verified_for_business_discovery_sample');
      assert.equal(account.professional_account_eligibility, 'verified_for_business_discovery_sample');
      assert.equal(account.live_sample?.report, 'reports/instagram-cli-access.json');
      assert.equal(account.live_sample.scheduled_collection, false);
      assert.equal(account.live_sample.event_extraction, false);
    } else {
      assert.equal(account.adapter, 'unconfigured'); assert.equal(account.enabled, false);
      assert.equal(account.cadence_seconds, null); assert.equal(account.status, 'setup_needed');
      assert.equal(account.collector_snapshot, undefined);
      assert.ok(['blocked', 'not_proven'].includes(account.posts_access));
      assert.equal(account.identity_verification, 'unverified');
      assert.equal(account.professional_account_eligibility, 'unverified');
      assert.equal(account.live_sample, undefined);
    }
  }
  assert.equal(watchlist.accounts.filter(account => account.posts_access === 'live_sample_proven').length, accessReport.totals.liveTargetSamplesProven);
  assert.equal(watchlist.accounts.filter(account => account.enabled).length, 16);
});

test('manual Production recovery preserves the genuine blocked scheduled attempt without claiming automatic success', () => {
  const monitoring = watchlist.production_monitoring;
  assert.equal(monitoring.report, 'reports/instagram-production-monitoring.json');
  assert.equal(monitoring.activated_at_utc, productionReport.configuration.activationAtUtc);
  assert.equal(monitoring.cadence_seconds, 3600);
  assert.equal(monitoring.parent_limit_per_poll, 25); assert.equal(monitoring.child_limit_per_carousel, 20);
  assert.equal(monitoring.history_complete, false); assert.equal(monitoring.event_extraction, false);
  assert.equal(monitoring.media_downloads, 0); assert.equal(monitoring.stories_collected, 0);
  assert.equal(monitoring.token_expiry_verified, true); assert.equal(monitoring.automatic_token_renewal, false);
  assert.equal(monitoring.token_expires_at_conservative_utc, productionReport.configuration.tokenExpiresAtConservativeUtc);
  assert.equal(monitoring.manual_production_smoke.run_id, productionReport.manualSmoke.runId);
  assert.equal(monitoring.manual_production_smoke.invocation_kind, 'manual');
  assert.equal(monitoring.manual_production_smoke.test_run, true);
  assert.equal(monitoring.manual_production_smoke.posts_retained, 400);
  assert.equal(monitoring.scheduled_verification.status, 'executed_credential_blocked');
  assert.equal(monitoring.scheduled_verification.run_id, productionReport.scheduledVerification.runId);
  assert.equal(monitoring.scheduled_verification.invocation_kind, 'scheduled');
  assert.equal(monitoring.scheduled_verification.test_run, false);
  assert.equal(monitoring.scheduled_verification.schedule_id, productionReport.scheduledVerification.scheduleId);
  assert.equal(monitoring.scheduled_verification.instagram_succeeded, 0);
  assert.equal(monitoring.scheduled_verification.instagram_blocked, 16);
  assert.equal(monitoring.scheduled_verification.failure_category, 'token_expired');
  assert.equal(monitoring.scheduled_verification.outcome, 'completed_with_social_blocks');
  assert.equal(monitoring.scheduled_verification.laptop_off_proof, false);
  assert.equal(monitoring.operational, true);
  assert.equal(monitoring.token_status, 'valid_at_recovery_smoke');
  assert.equal(monitoring.exact_token_expiry_instant_known, false);
  assert.equal(monitoring.credential_recovery, 'completed_production_manual_success');
  assert.equal(monitoring.recovery_production_smoke.run_id, productionReport.recoverySmoke.runId);
  assert.equal(monitoring.recovery_production_smoke.invocation_kind, 'manual');
  assert.equal(monitoring.recovery_production_smoke.test_run, true);
  assert.equal(monitoring.recovery_production_smoke.instagram_succeeded, 16);
  assert.equal(monitoring.recovery_production_smoke.instagram_blocked, 0);
  assert.equal(monitoring.recovery_production_smoke.posts_retained, 400);
  assert.equal(monitoring.recovery_production_smoke.versions_retained, 400);
  assert.equal(monitoring.recovery_production_smoke.duplicate_post_groups, 0);
  assert.equal(monitoring.recovery_production_smoke.duplicate_version_groups, 0);
  assert.equal(monitoring.next_scheduled_success_verification.status, 'pending');
  assert.equal(monitoring.next_scheduled_success_verification.next_nominal_at_utc, '2026-10-21T03:00:00Z');
  assert.equal(watchlist.live_access_summary.scheduled_collection_enabled, true);
  assert.equal(watchlist.live_access_summary.scheduled_collection_attempt_verified, true);
  assert.equal(watchlist.live_access_summary.scheduled_collection_verified, false);
  assert.equal(watchlist.live_access_summary.manual_production_collection_verified, true);
  assert.equal(watchlist.live_access_summary.manual_recovery_verified, true);
  for (const account of watchlist.accounts.filter(account => account.enabled)) {
    const prior = productionReport.manualSmoke.database.source_health.find(row => row.id === account.source_id);
    const failed = productionReport.scheduledVerification.database.source_health.find(row => row.id === account.source_id);
    assert.ok(prior); assert.ok(failed);
    assert.equal(failed.last_success_at, prior.last_success_at, 'the historical failed schedule preserved the previous actual success');
    assert.ok(Date.parse(account.collector_snapshot!.last_success_at) > Date.parse(failed.last_success_at));
    assert.ok(Date.parse(account.collector_snapshot!.last_attempt_at) > Date.parse(failed.last_attempt_at));
  }
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
