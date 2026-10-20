import { test } from "node:test";
import assert from "node:assert/strict";
import { collectCentralCalendar } from "../lib/collection";
import { dispatchDueSources, ingestCollectedBatch, toDatabaseBatch, WorkerSetupNeeded } from "../lib/ingestion";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDuplicateObject } from "../lib/storage/integrity";

const lease = { id: "fsu-calendar-api", owner_id: "11111111-1111-4111-8111-111111111111", lease_token: "22222222-2222-4222-8222-222222222222" };
const now = () => new Date("2026-10-20T12:00:00Z");

function zeroLeaseClient(members:unknown,error:{code:string}|null=null) {
  return {
    rpc:async(name:string)=>{assert.equal(name,"lease_due_sources");return {data:[],error:null};},
    from:(table:string)=>{assert.equal(table,"tracker_members");return {select:(columns:string)=>{assert.equal(columns,"user_id");return {limit:async(limit:number)=>{assert.equal(limit,1);return {data:members,error};}};}};},
    storage:{from:()=>{throw Error("Zero-lease readiness must not upload captures");}},
  } as unknown as SupabaseClient;
}

test("zero leases with no owner require setup and cannot become successful empty collection",async()=>{
  await assert.rejects(dispatchDueSources(2,zeroLeaseClient([])),WorkerSetupNeeded);
});

test("zero leases with an established owner legitimately return no due work",async()=>{
  assert.deepEqual(await dispatchDueSources(2,zeroLeaseClient([{user_id:lease.owner_id}])),[]);
});

test("owner readiness query failure or malformed response remains an infrastructure failure",async()=>{
  await assert.rejects(dispatchDueSources(2,zeroLeaseClient(null,{code:"42501"})),/readiness check failed \(42501\)/);
  await assert.rejects(dispatchDueSources(2,zeroLeaseClient(null)),/invalid response/);
});
// Deliberately synthetic empty valid feed; this is not live collection evidence.
async function emptyBatch() {
  return collectCentralCalendar({ now, fetch: async () => new Response(JSON.stringify({ events: [], page: { current: 1, total: 0, total_items: 0, next_page: null } }), { headers: { "content-type": "application/json" } }) });
}

test("successful zero-event capture commits evidence and cursor, never fabricated facts", async () => {
  const batch = await emptyBatch();
  const payload = toDatabaseBatch(lease, batch);
  assert.equal(payload.outcome, "success");
  assert.equal(payload.captures.length, 1);
  assert.equal(payload.opportunities.length, 0);
  assert.match(payload.captures[0].storage_path, /^11111111-.*\/sources\/fsu-calendar-api\/[a-f0-9]{64}\.raw$/);
  assert.equal(payload.captures[0].excerpt, null);
  assert.equal("body" in payload.captures[0], false);
});

test("source/lease mismatch and invalid successful batch are rejected before upload", async () => {
  const batch = await emptyBatch();
  assert.throws(() => toDatabaseBatch({ ...lease, id: "another-source" }, batch), /does not match/);
  assert.throws(() => toDatabaseBatch(lease, { ...batch, pages: [] }), /capture/i);
});

test("storage failure never commits or advances SQL cursor", async () => {
  let commits = 0;
  const client = {
    storage: { from: () => ({ upload: async () => ({ error: { statusCode: "403" } }) }) },
    rpc: async () => { commits++; return { data: {}, error: null }; },
  } as unknown as SupabaseClient;
  await assert.rejects(ingestCollectedBatch(lease, await emptyBatch(), client), /cursor was not advanced/);
  assert.equal(commits, 0);
});

test("confirmed immutable object duplicate is replay-safe, SQL transaction errors remain failures", async () => {
  const batch = await emptyBatch();
  let commits = 0;
  const client = {
    storage: { from: () => ({ upload: async () => ({ error: { statusCode: "409" } }), download: async () => ({ data: new Blob([batch.pages[0].body]), error: null }) }) },
    rpc: async () => { commits++; return { data: {}, error: { code: "40001" } }; },
  } as unknown as SupabaseClient;
  await assert.rejects(ingestCollectedBatch(lease, batch, client), /40001/);
  assert.equal(commits, 1);
});

test("documented duplicate response variants are narrow; other client errors remain failures", () => {
  for (const error of [{ statusCode: "ResourceAlreadyExists", status: 409 }, { statusCode: "KeyAlreadyExists" }, { statusCode: "400", message: "Asset Already Exists" }, { statusCode: "409" }]) assert.equal(isDuplicateObject(error), true);
  for (const error of [{ statusCode: "403", message: "Asset Already Exists" }, { statusCode: "400", message: "Invalid MIME type" }, { statusCode: "503" }, null]) assert.equal(isDuplicateObject(error), false);
});

test("named duplicate response must match stored bytes before metadata transaction", async () => {
  const batch = await emptyBatch();
  let commits = 0;
  const client = {
    storage: { from: () => ({ upload: async () => ({ error: { statusCode: "ResourceAlreadyExists", status: 409 } }), download: async () => ({ data: new Blob(["x".repeat(Buffer.byteLength(batch.pages[0].body))]), error: null }) }) },
    rpc: async () => { commits++; return { data: {}, error: null }; },
  } as unknown as SupabaseClient;
  await assert.rejects(ingestCollectedBatch(lease, batch, client), /hash differs/);
  assert.equal(commits, 0);
});
