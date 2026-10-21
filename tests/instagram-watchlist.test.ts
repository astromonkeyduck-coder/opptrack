import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import watchlist from '../config/instagram-watchlist.json';
import candidates from '../config/instagram-candidates.json';
import accessReport from '../reports/instagram-cli-access.json';
import candidateAccessReport from '../reports/instagram-candidates-high-priority-access.json';
import productionReport from '../reports/instagram-production-monitoring.json';
import { instagramSourceSeeds, sourceSeedUpsertOptions } from '../scripts/instagram-source-seeds';

const originalHandles = ['clubdownunderfsu', 'fsustudentengagement', 'fsustudentaffairs', 'fsustudentunion', 'aslc_fsu', 'fsuhomecoming', 'fsusga', 'fsucampusrec', 'fsuhonors', 'fsucareercenter', 'fsuip', 'fsucge', 'thecenterfsu', 'fsusustainable', 'fsucre', 'fsucosspp', 'fsucossppslc'];
const expandedHandles = ['durpfsu', 'emhs_fsu', 'fsu_cre', 'fsucollegeoflaw', 'fsueconomicsdept', 'fsuhsa', 'fsuigc', 'fsumofa', 'musicfsu', 'onf.fsu', 'openingnights'];
const approvedHandles = new Set([...originalHandles, ...expandedHandles]);

function probeFor(account: { handle: string; access_probe: { report: string } }) {
  const report = account.access_probe.report === 'reports/instagram-cli-access.json' ? accessReport
    : account.access_probe.report === 'reports/instagram-candidates-high-priority-access.json' ? candidateAccessReport : null;
  assert.ok(report, `unsupported access evidence for ${account.handle}`);
  const probe = report.accounts.find(entry => entry.target === account.handle);
  assert.ok(probe, `missing access evidence for ${account.handle}`);
  return probe;
}

test('watchlist contains only the original seventeen plus eleven explicitly approved proven additions', () => {
  assert.equal(watchlist.accounts.length, 28);
  assert.deepEqual(new Set(watchlist.accounts.map(account => account.handle)), approvedHandles);
  assert.equal(new Set(watchlist.accounts.map(account => account.source_id)).size, 28);
  for (const account of watchlist.accounts) {
    assert.match(account.handle, /^[a-z0-9._]{1,30}$/);
    assert.equal(account.source_id, `instagram-${account.handle}`);
    assert.equal(account.selection_evidence, expandedHandles.includes(account.handle) ? 'user_authorized_proven_candidate_expansion' : 'user_provided');
  }
});

test('profile links are canonical HTTPS Instagram profiles without query tokens or credentials', () => {
  for (const account of watchlist.accounts) {
    const url = new URL(account.profile_url);
    assert.equal(url.origin, 'https://www.instagram.com');
    assert.equal(url.pathname, `/${account.handle}/`);
    assert.equal(url.search, ''); assert.equal(url.hash, '');
    assert.equal(url.username, ''); assert.equal(url.password, '');
  }
});

test('automatic enablement is restricted to exactly twenty-seven proven approved routes', () => {
  assert.equal(watchlist.automatic_collection_enabled, true);
  assert.equal(watchlist.paid_connectors_enabled, false);
  assert.equal(watchlist.calendar_writes_enabled, false);
  assert.equal(watchlist.credential_values_included, false);
  const enabled = watchlist.accounts.filter(account => account.enabled);
  assert.equal(enabled.length, 27);
  assert.deepEqual(new Set(enabled.map(account => account.handle)), new Set([...approvedHandles].filter(handle => handle !== 'fsucre')));
  for (const account of watchlist.accounts) {
    assert.equal(account.stories_access, 'manual_only');
    const probe = probeFor(account);
    if (account.enabled) {
      assert.equal(account.posts_access, 'live_sample_proven');
      assert.equal(probe.accessSampleProven, true, 'selection or candidate priority alone must not authorize an unproven route');
      assert.equal(account.adapter, 'instagram-business-discovery-v1');
      assert.equal(account.cadence_seconds, 3600); assert.equal(account.status, 'enabled');
      assert.equal(account.identity_verification, 'verified_for_business_discovery_sample');
      assert.equal(account.professional_account_eligibility, 'verified_for_business_discovery_sample');
      assert.equal(account.live_sample?.scheduled_collection, false, 'a bounded access probe is not a scheduled run');
      assert.equal(account.live_sample.event_extraction, false);
    } else {
      assert.equal(account.handle, 'fsucre'); assert.equal(account.adapter, 'unconfigured');
      assert.equal(account.cadence_seconds, null); assert.equal(account.status, 'setup_needed');
      assert.equal(account.posts_access, 'blocked'); assert.equal(account.collector_snapshot, undefined);
      assert.equal(account.live_sample, undefined);
    }
  }
});

test('the two hundred nine candidate inventory entries cannot silently expand the operational watchlist or source seeds', () => {
  assert.equal(candidates.accounts.length, 209);
  assert.equal(candidates.automatic_collection_enabled, false);
  assert.ok(candidates.accounts.every(account => account.enabled_in_candidate_registry === false));
  for (const handle of expandedHandles) {
    const candidate = candidates.accounts.find(account => account.handle === handle);
    assert.ok(candidate, handle);
    assert.equal(candidate.priority, 'high');
    assert.equal(candidate.access_evidence?.access_sample_proven, true);
    assert.equal(candidate.access_evidence?.report, 'reports/instagram-candidates-high-priority-access.json');
  }
  const unselected = candidates.accounts.filter(account => !approvedHandles.has(account.handle));
  assert.ok(unselected.length > 170);
  const seedIds = new Set(instagramSourceSeeds('11111111-1111-4111-8111-111111111111', watchlist.accounts).map(source => source.id));
  assert.ok(unselected.every(account => !seedIds.has(`instagram-${account.handle}`)));
});

test('the corrected research handle stays distinct from the blocked historical route', () => {
  const historical = watchlist.accounts.find(account => account.handle === 'fsucre');
  const proven = watchlist.accounts.find(account => account.handle === 'fsu_cre');
  assert.ok(historical); assert.ok(proven);
  assert.equal(historical.enabled, false); assert.equal(historical.posts_access, 'blocked');
  assert.equal(proven.enabled, true); assert.equal(proven.posts_access, 'live_sample_proven');
  assert.notEqual(historical.source_id, proven.source_id);
  assert.equal(proven.access_probe.report, 'reports/instagram-candidates-high-priority-access.json');
  assert.equal(historical.access_probe.report, 'reports/instagram-cli-access.json');
});

test('historical manual recovery and blocked automatic attempts are scoped to their actual original sixteen accounts', () => {
  const monitoring = watchlist.production_monitoring;
  assert.equal(monitoring.report, 'reports/instagram-production-monitoring.json');
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
  assert.equal(monitoring.scheduled_verification.run_id, productionReport.scheduledVerification.runId);
  assert.equal(monitoring.scheduled_verification.invocation_kind, 'scheduled');
  assert.equal(monitoring.scheduled_verification.test_run, false);
  assert.equal(monitoring.scheduled_verification.instagram_succeeded, 0);
  assert.equal(monitoring.scheduled_verification.instagram_blocked, 16);
  assert.equal(monitoring.scheduled_verification.failure_category, 'token_expired');
  assert.equal(monitoring.recovery_production_smoke.run_id, productionReport.recoverySmoke.runId);
  assert.equal(monitoring.recovery_production_smoke.invocation_kind, 'manual');
  assert.equal(monitoring.recovery_production_smoke.test_run, true);
  assert.equal(monitoring.recovery_production_smoke.instagram_succeeded, 16);
  assert.equal(monitoring.recovery_production_smoke.posts_retained, 400);
  assert.equal(monitoring.recovery_production_smoke.versions_retained, 400);
  assert.equal(monitoring.recovery_production_smoke.duplicate_post_groups, 0);
  assert.equal(monitoring.recovery_production_smoke.duplicate_version_groups, 0);
  for (const handle of originalHandles.filter(handle => handle !== 'fsucre')) {
    const account = watchlist.accounts.find(account => account.handle === handle)!;
    const prior = productionReport.manualSmoke.database.source_health.find(row => row.id === account.source_id);
    const failed = productionReport.scheduledVerification.database.source_health.find(row => row.id === account.source_id);
    const recovered = productionReport.recoverySmoke.database.source_health.find(row => row.id === account.source_id);
    assert.ok(prior); assert.ok(failed); assert.ok(recovered);
    assert.equal(failed.last_success_at, prior.last_success_at, 'the failed schedule preserved the previous actual success');
    assert.ok(Date.parse(recovered.last_success_at) > Date.parse(failed.last_success_at));
  }
});

test('each selected account retains its own live probe evidence without inventing event facts', () => {
  const categories = new Set(watchlist.accounts.flatMap(account => account.categories));
  for (const expected of ['concerts', 'comedy', 'films', 'outdoors', 'research', 'recruiting', 'study_abroad', 'culture', 'service', 'sustainability', 'public_policy', 'involvement']) assert.ok(categories.has(expected), expected);
  let parentPosts = 0, children = 0, provenCount = 0;
  for (const account of watchlist.accounts) {
    for (const field of ['caption', 'starts_at', 'first_post_at', 'last_success_at', 'token', 'access_token']) assert.equal(Object.hasOwn(account, field), false);
    const probe = probeFor(account);
    assert.equal(account.access_probe.observed_at_utc, probe.finishedAt);
    assert.equal(account.access_probe.status, probe.status);
    assert.deepEqual(account.access_probe.http_statuses, probe.httpStatuses);
    assert.deepEqual(account.access_probe.graph_error, probe.graphError);
    assert.deepEqual(account.access_probe.reason_codes, probe.reasonCodes);
    if (!probe.accessSampleProven) continue;
    const sample = account.live_sample;
    assert.ok(sample); provenCount++;
    parentPosts += probe.counts.validUniqueMediaRows; children += probe.counts.children;
    assert.equal(sample.report, account.access_probe.report);
    assert.equal(sample.observed_at_utc, probe.finishedAt);
    assert.equal(sample.parent_posts, probe.counts.validUniqueMediaRows);
    assert.equal(sample.standalone_images, probe.counts.images);
    assert.equal(sample.reels, probe.counts.reels);
    assert.equal(sample.carousels, probe.counts.carousels);
    assert.equal(sample.carousel_children, probe.counts.children);
    assert.equal(sample.media_files_downloaded, 0); assert.equal(sample.stories_retrieved, 0);
    assert.equal(sample.pagination_complete, probe.paginationComplete);
  }
  assert.equal(provenCount, 27);
  assert.equal(watchlist.live_access_summary.proven_target_samples, provenCount);
  assert.equal(watchlist.live_access_summary.parent_posts, parentPosts);
  assert.equal(watchlist.live_access_summary.carousel_children, children);
});

test('blocked probes remain distinct from empty or unattempted accounts', () => {
  const blockedAccounts = watchlist.accounts.filter(account => account.posts_access === 'blocked');
  assert.deepEqual(blockedAccounts.map(account => account.handle), ['fsucre']);
  assert.equal(watchlist.live_access_summary.blocked_targets, 1);
  assert.equal(watchlist.live_access_summary.untested_targets, 0);
  for (const account of blockedAccounts) {
    assert.equal(account.live_sample, undefined); assert.equal(account.access_probe.status, 'blocked');
    assert.equal(account.identity_verification, 'unverified');
    assert.equal(account.professional_account_eligibility, 'unverified');
    assert.ok(account.access_probe.http_statuses.some(status => status >= 400));
    assert.equal(account.status, 'setup_needed');
  }
});

test('watchlist stays separate from the preserved Stage 0 registry', async () => {
  const registry = JSON.parse(await readFile(new URL('../config/source-registry.json', import.meta.url), 'utf8'));
  assert.equal(registry.sources.length, 59);
  const historicalIds = new Set(registry.sources.map((source: { source_id: string }) => source.source_id));
  assert.ok(watchlist.accounts.every(account => !historicalIds.has(account.source_id)));
});

test('fresh setup seeds selected accounts disabled without resetting active collection or claiming global credentials are absent', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const rows = instagramSourceSeeds(owner, watchlist.accounts);
  assert.equal(rows.length, 28);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.id, watchlist.accounts[index].source_id); assert.equal(row.owner_id, owner);
    assert.equal(row.url, watchlist.accounts[index].profile_url);
    assert.equal(row.adapter, 'unconfigured'); assert.equal(row.enabled, false);
    assert.equal(row.cadence_seconds, null); assert.equal(row.next_due_at, null);
    assert.equal(row.health_status, 'setup_needed');
    assert.match(row.health_message, /this source is seeded disabled/);
    assert.match(row.health_message, /Activation and current worker access must be verified separately/);
    assert.ok(!row.health_message.includes('worker credentials and a scheduled Instagram collector are not configured'));
    assert.ok(row.coverage_note.includes('Stories manual-only'));
    for (const field of ['cursor', 'last_success_at', 'last_attempt_at', 'lease_token', 'next_poll_at', 'retry_not_before']) assert.equal(Object.hasOwn(row, field), false);
  }
  assert.deepEqual(sourceSeedUpsertOptions, { onConflict: 'id', ignoreDuplicates: true });
});

test('source setup uses only the historical fifty-nine plus twenty-eight approved watchlist identities', async () => {
  const registry = JSON.parse(await readFile(new URL('../config/source-registry.json', import.meta.url), 'utf8'));
  const ids = [...registry.sources.map((source: { source_id: string }) => source.source_id), ...instagramSourceSeeds('11111111-1111-4111-8111-111111111111', watchlist.accounts).map(row => row.id)];
  assert.equal(ids.length, 87); assert.equal(new Set(ids).size, 87);
});
