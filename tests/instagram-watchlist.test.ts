import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import watchlist from '../config/instagram-watchlist.json';
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

test('unproven accounts cannot silently enable collection, paid connectors or Stories', () => {
  assert.equal(watchlist.automatic_collection_enabled, false);
  assert.equal(watchlist.paid_connectors_enabled, false);
  assert.equal(watchlist.calendar_writes_enabled, false);
  assert.equal(watchlist.credential_values_included, false);
  for (const account of watchlist.accounts) {
    assert.equal(account.adapter, 'unconfigured'); assert.equal(account.enabled, false);
    assert.equal(account.cadence_seconds, null); assert.equal(account.status, 'setup_needed');
    assert.equal(account.posts_access, 'not_proven'); assert.equal(account.stories_access, 'manual_only');
    assert.equal(account.identity_verification, 'unverified');
    assert.equal(account.professional_account_eligibility, 'unverified');
  }
});

test('selection retains campus breadth without inventing event dates, captures or access evidence', () => {
  const categories = new Set(watchlist.accounts.flatMap(account => account.categories));
  for (const expected of ['concerts', 'comedy', 'films', 'outdoors', 'research', 'recruiting', 'study_abroad', 'culture', 'service', 'sustainability', 'public_policy', 'involvement']) assert.ok(categories.has(expected), expected);
  for (const account of watchlist.accounts) {
    for (const field of ['caption', 'starts_at', 'first_post_at', 'last_success_at', 'token', 'access_token']) assert.equal(Object.hasOwn(account, field), false);
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
