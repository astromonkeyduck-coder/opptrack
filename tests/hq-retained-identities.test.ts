import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRetainedHqNativeIds, runLeasedCollection, type SourceLease } from '../lib/ingestion';

const lease: SourceLease = { id: 'fsu-hq-public-export', owner_id: '11111111-1111-4111-8111-111111111111', lease_token: '22222222-2222-4222-8222-222222222222' };
const row = (index: number) => ({ id: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`, native_id: `synthetic-uid-${index}` });
function fixtureClient(rows: ReturnType<typeof row>[], cap = 500, failureAt = -1) {
  const ranges: number[][] = []; let queries = 0;
  const client = {
    from: (table: string) => {
      assert.equal(table, 'opportunities');
      return { select: (columns: string) => {
        assert.equal(columns, 'id,native_id');
        return { eq: (source: string, sourceId: string) => {
          assert.equal(source, 'source_id'); assert.equal(sourceId, lease.id);
          return { eq: (owner: string, ownerId: string) => {
            assert.equal(owner, 'owner_id'); assert.equal(ownerId, lease.owner_id);
            return { order: (column: string, options: { ascending: boolean }) => {
              assert.equal(column, 'id'); assert.equal(options.ascending, true);
              return { range: async (from: number, to: number) => {
                ranges.push([from, to]); const request = queries++;
                return request === failureAt ? { data: null, error: { code: 'synthetic_read_error' } } : { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
              } };
            } };
          } };
        } };
      } };
    },
  } as unknown as SupabaseClient;
  return { client, ranges };
}

test('HQ retained identities paginate 500 rows by owner/source and require a terminal empty page', async () => {
  const fixture = fixtureClient(Array.from({ length: 1201 }, (_, index) => row(index)));
  const result = await loadRetainedHqNativeIds(lease, fixture.client);
  assert.equal(result.size, 1201); assert.ok(result.has('synthetic-uid-1200'));
  assert.deepEqual(fixture.ranges, [[0, 499], [500, 999], [1000, 1499], [1201, 1700]]);
});

test('short server-capped pages cannot hide retained identities or skip rows', async () => {
  const fixture = fixtureClient(Array.from({ length: 503 }, (_, index) => row(index)), 200);
  assert.equal((await loadRetainedHqNativeIds(lease, fixture.client)).size, 503);
  assert.deepEqual(fixture.ranges, [[0, 499], [200, 699], [400, 899], [503, 1002]]);
});

test('exactly 10000 identities need a final one-row probe; an extra identity fails visibly', async () => {
  const exact = fixtureClient(Array.from({ length: 10_000 }, (_, index) => row(index)));
  assert.equal((await loadRetainedHqNativeIds(lease, exact.client)).size, 10_000);
  assert.deepEqual(exact.ranges.at(-1), [10_000, 10_000]);
  const overflow = fixtureClient(Array.from({ length: 10_001 }, (_, index) => row(index)));
  await assert.rejects(loadRetainedHqNativeIds(lease, overflow.client), /exceeded its 10000-row bound/);
});

test('lookup failure stops a leased HQ run before any source fetch, upload or cursor transaction', async context => {
  let fetches = 0;
  context.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('No source request expected'); });
  const fixture = fixtureClient(Array.from({ length: 501 }, (_, index) => row(index)), 500, 1);
  await assert.rejects(runLeasedCollection(lease, fixture.client), /lookup failed/);
  assert.equal(fetches, 0);
  assert.equal((await loadRetainedHqNativeIds(lease, fixtureClient([]).client)).size, 0);
});

test('duplicate, unordered or malformed retained identities and runaway short pagination fail closed', async () => {
  for (const rows of [
    [row(0), row(0)],
    [row(1), row(0)],
    [row(0), { ...row(1), native_id: row(0).native_id }],
    [{ ...row(0), native_id: '' }],
    [{ ...row(0), native_id: 'x'.repeat(1001) }],
    [{ ...row(0), native_id: 'bad\nuid' }],
  ]) await assert.rejects(loadRetainedHqNativeIds(lease, fixtureClient(rows).client), /repeated or malformed/);
  await assert.rejects(loadRetainedHqNativeIds(lease, fixtureClient(Array.from({ length: 100 }, (_, index) => row(index)), 1).client), /did not complete/);
});

test('other core producers cannot query the HQ retained identity route', async () => {
  await assert.rejects(loadRetainedHqNativeIds({ ...lease, id: 'fsu-calendar-api' }, fixtureClient([]).client), /restricted to the HQ/);
});
