import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectInstagram, instagramHandles, instagramRequestUrl } from "../lib/instagram/collector";
import { ingestInstagramBatch, toInstagramDatabaseBatch } from "../lib/instagram/ingestion";
import { dispatchDueSources } from "../lib/ingestion";

// Deliberately synthetic provider responses; no test establishes hosted access.
const now = () => new Date("2026-10-21T02:00:00Z");
const environment = { SOCIAL_COLLECTION_ENABLED: "true", IG_FB_USER_ACCESS_TOKEN: "SYNTHETIC_READ_TOKEN_1234", IG_CALLER_USER_ID: "1234", CALENDAR_WRITES_ENABLED: "false" };
const source = "instagram-clubdownunderfsu";
const lease = { id: source, owner_id: "11111111-1111-4111-8111-111111111111", lease_token: "22222222-2222-4222-8222-222222222222" };
const post = (overrides: Record<string, unknown> = {}) => ({ id: "2001", caption: "Synthetic flyer caption, not an event", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-10-20T19:51:35+0000", permalink: "https://www.instagram.com/p/Synthetic/?utm_source=ignored#ignored", ...overrides });
const envelope = (posts = [post()], overrides: Record<string, unknown> = {}) => ({ id: "1234", business_discovery: { id: "3333", username: "clubdownunderfsu", media_count: posts.length, media: { data: posts, paging: { next: `https://example.invalid/?access_token=${environment.IG_FB_USER_ACCESS_TOKEN}`, cursors: { after: "DO_NOT_STORE" } } }, ...overrides } });
const jsonFetch = (value: unknown, status = 200, headers: Record<string,string> = {}) => (async () => Response.json(value, { status, headers })) as typeof fetch;
const collect = (value: unknown = envelope()) => collectInstagram(source, { environment, now, fetch: jsonFetch(value) });

test("collector allowlist contains exactly the16proven accounts and excludes the unresolved target", () => {
  assert.equal(instagramHandles.size, 16); assert.equal(instagramHandles.has("fsucre"), false);
  assert.throws(() => instagramRequestUrl("1234", "fsucre"));
  assert.throws(() => instagramRequestUrl("https://attacker.invalid", "clubdownunderfsu"));
});

test("single fixed Graph GET uses Bearer only and explicitly bounds parent and child metadata", async () => {
  let calls = 0;
  const result = await collectInstagram(source, { environment, now, fetch: (async (value, options) => {
    calls++; const url = new URL(String(value));
    assert.equal(url.origin, "https://graph.facebook.com"); assert.equal(url.pathname, "/v26.0/1234");
    assert.equal(url.href.includes(environment.IG_FB_USER_ACCESS_TOKEN), false);
    assert.match(url.searchParams.get("fields")!, /media\.limit\(25\)/); assert.match(url.searchParams.get("fields")!, /children\.limit\(20\)/);
    assert.doesNotMatch(url.searchParams.get("fields")!, /media_url|thumbnail_url|stories/);
    assert.equal(options?.redirect, "manual"); assert.equal(options?.method, "GET");
    assert.equal((options?.headers as Record<string,string>).Authorization, `Bearer ${environment.IG_FB_USER_ACCESS_TOKEN}`);
    return Response.json(envelope());
  }) as typeof fetch });
  assert.equal(calls, 1); assert.equal(result.status, "success"); assert.equal(result.updates.length, 1);
  assert.deepEqual(result.opportunities, []); assert.deepEqual(result.occurrences, []);
  assert.equal(result.cursor?.history_complete, false); assert.equal(result.cursor?.parent_limit, 25);
  assert.equal(result.tokenExpiryKnown, false);
});

test("sanitized immutable evidence drops tokens, paging URLs, media URLs, owner identity and unrequested fields", async () => {
  const result = await collect(envelope([post({ caption: `Untrusted ${environment.IG_FB_USER_ACCESS_TOKEN}`, media_url: "https://cdn.invalid/private", owner: { id: "DO_NOT_STORE_OWNER" } })]));
  const body = result.pages[0].body;
  for (const forbidden of [environment.IG_FB_USER_ACCESS_TOKEN, "DO_NOT_STORE", "https://example.invalid", "media_url", "DO_NOT_STORE_OWNER", "1234"]) assert.equal(body.includes(forbidden), false);
  assert.equal(result.pages[0].url, "https://www.instagram.com/clubdownunderfsu/");
  assert.equal(result.updates[0].permalink, "https://www.instagram.com/p/Synthetic/");
  assert.equal(result.updates[0].caption, "Untrusted [credential redacted]");
});

test("stable identity/hash does not change on replay or observationtime but caption changes append distinctversion", async () => {
  const first = await collect(), replay = await collectInstagram(source, { environment, now: () => new Date("2026-10-21T03:00:00Z"), fetch: jsonFetch(envelope()) });
  assert.equal(first.updates[0].content_hash, replay.updates[0].content_hash);
  assert.equal(first.pages[0].sha256, replay.pages[0].sha256);
  const changed = await collect(envelope([post({ caption: "Synthetic edited caption" })]));
  assert.equal(changed.updates[0].native_id, first.updates[0].native_id);
  assert.notEqual(changed.updates[0].content_hash, first.updates[0].content_hash);
});

test("fewerthan25posts with missing/largertotal remains partial instead of inventing boundedwindow completeness", async () => {
  for (const media_count of [300, null]) {
    const result = await collect(envelope([post()], { media_count }));
    assert.equal(result.status, "partial"); assert.equal(result.failureCategory, "bounded_window_incomplete");
    assert.equal(result.updates.length, 1); assert.equal(result.observations.paginationComplete, false); assert.equal(result.cursor, null);
  }
  const posts = Array.from({length:25},(_,index)=>post({id:String(2000+index)}));
  const bounded = await collect(envelope(posts, {media_count:300}));
  assert.equal(bounded.status,"success"); assert.equal(bounded.cursor?.history_complete,false);
});

test("all returned carousel children retain source order and unconsumed child pages remain partial", async () => {
  const children = { data: [{ id: "301", media_type: "VIDEO" }, { id: "302", media_type: "IMAGE" }], paging: { next: "https://untrusted.invalid" } };
  const result = await collect(envelope([post({ media_type: "CAROUSEL_ALBUM", children })]));
  assert.equal(result.status, "partial"); assert.equal(result.cursor, null); assert.equal(result.observations.paginationComplete, false);
  assert.deepEqual(result.updates[0].children, [{ native_id: "301", media_type: "VIDEO", position: 0 }, { native_id: "302", media_type: "IMAGE", position: 1 }]);
  assert.equal(result.updates[0].children_complete, false);
});

test("missing credentials, disabled flag and knownexpiredtoken make zerorequests", async () => {
  for (const env of [{ ...environment, SOCIAL_COLLECTION_ENABLED: "false" }, { ...environment, IG_FB_USER_ACCESS_TOKEN: "" }, { ...environment, IG_TOKEN_EXPIRES_AT: "2026-10-21T01:59:59Z" }]) {
    let called = false;
    const result = await collectInstagram(source, { environment: env, now, fetch: (async () => { called = true; throw Error("must not fetch"); }) as typeof fetch });
    assert.equal(called, false); assert.equal(result.observations.requests, 0); assert.equal(result.status, "blocked");
  }
});

test("Graph190expiredtoken with HTTP200 is blocked and never successful empty", async () => {
  const result = await collect({ error: { code: 190, error_subcode: 463, message: `DO_NOT_STORE${environment.IG_FB_USER_ACCESS_TOKEN}` } });
  assert.equal(result.status, "blocked"); assert.equal(result.failureCategory, "token_expired");
  assert.equal(result.pages[0].body.includes(environment.IG_FB_USER_ACCESS_TOKEN), false); assert.equal(result.pages[0].body.includes("message"), false);
});

test("RetryAfter is retained and provider rate limit uses durable rate_limited outcome", async () => {
  const result = await collectInstagram(source, { environment, now, fetch: jsonFetch({ error: { code: 4 } }, 429, { "retry-after": "7200" }) });
  assert.equal(result.status, "rate_limited"); assert.equal(result.retryAfterSeconds, 7200); assert.equal(result.cursor, null);
  const html = await collectInstagram(source, {environment,now,fetch:(async()=>new Response("<html>temporarily unavailable</html>",{status:503,headers:{"content-type":"text/html","retry-after":"3600"}})) as typeof fetch});
  assert.equal(html.status,"rate_limited");assert.equal(html.retryAfterSeconds,3600);
});

test("HTML200, malformedJSON, redirect, mismatchedidentity and emptyedge cannot become nothingnew", async () => {
  const fetchers = [
    (async () => new Response("<html>login required</html>", { headers: { "content-type": "text/html" } })) as typeof fetch,
    (async () => new Response("not json")) as typeof fetch,
    (async () => new Response(null, { status: 302, headers: { location: "https://attacker.invalid" } })) as typeof fetch,
    jsonFetch({ ...envelope(), id: "9999" }), jsonFetch(envelope([])),
  ];
  for (const fetcher of fetchers) {
    const result = await collectInstagram(source, { environment, now, fetch: fetcher });
    assert.notEqual(result.status, "success"); assert.ok(result.reason); assert.equal(result.cursor, null);
  }
});

test("duplicated/malformed parentrows retain validrows with partialstatus and oversizedresponses fail", async () => {
  const duplicated = await collect(envelope([post(), post(), post({ id: "2002", timestamp: "tomorrow" })]));
  assert.equal(duplicated.status, "partial"); assert.equal(duplicated.updates.length, 1);
  const oversized = await collectInstagram(source, { environment, now, fetch: (async () => new Response("x", { headers: { "content-length": "524289" } })) as typeof fetch });
  assert.equal(oversized.status, "failed"); assert.equal(oversized.failureCategory, "response_too_large");
});

test("persistencepayload labels sanitizedevidence and boundedhistory, rejects mutatedhash/evidence", async () => {
  const batch = await collect();
  const payload = toInstagramDatabaseBatch(lease, batch);
  assert.equal(payload.window.scope, "latest25_parent_metadata_only"); assert.equal(payload.window.history_complete, false);
  assert.equal(payload.captures[0].evidence_kind, "sanitized_api_projection"); assert.deepEqual(payload.opportunities, []);
  batch.updates[0].caption = "Tampered";
  assert.throws(() => toInstagramDatabaseBatch(lease, batch), /content hash/);
});

test("immutable upload must finish before atomicInstagramRPC and failedpersistnevercommits", async () => {
  const batch = await collect(); const order: string[] = [];
  const client = {
    storage: { from: () => ({ upload: async () => { order.push("upload"); return { error: null }; } }) },
    rpc: async (name: string, args: Record<string,unknown>) => { order.push("rpc"); assert.equal(name, "complete_instagram_run"); assert.equal(args.p_source_id, source); return { data: { run_id: "synthetic_run" }, error: null }; },
  } as unknown as SupabaseClient;
  await ingestInstagramBatch(lease, batch, client); assert.deepEqual(order, ["upload", "rpc"]);
  let commits = 0;
  const broken = { storage: { from: () => ({ upload: async () => ({ error: { status: 403 } }) }) }, rpc: async () => { commits++; return {}; } } as unknown as SupabaseClient;
  await assert.rejects(ingestInstagramBatch(lease, batch, broken), /upload failed/); assert.equal(commits, 0);
});

test("core producerlease/processing finishes before16socialleases, and a socialfailure doesnotstarvecore", async t => {
  const order: string[] = [];
  const coreLease={...lease,id:"fsu-calendar-api"};
  t.mock.method(globalThis, "fetch", (async(value:RequestInfo|URL)=>String(value).startsWith("https://calendar.fsu.edu/")?Response.json({events:[],page:{current:1,total:0,total_items:0,next_page:null}}):Response.json({ error: { code: 190, error_subcode: 463 } })) as typeof fetch);
  const client = {
    from: () => ({ select: () => ({ limit: async () => ({ data: [{ user_id: lease.owner_id }], error: null }) }) }),
    rpc: async (name: string, args: Record<string,unknown>) => {
      order.push(name);
      if (name === "lease_due_sources") return { data: [coreLease], error: null };
      if (name === "complete_source_run") return {data:{run_id:"synthetic_core_run"},error:null};
      if (name === "lease_due_instagram_sources") { assert.equal(args.p_limit, 16); return { data: [lease], error: null }; }
      if (name === "complete_instagram_run") return { data: { run_id: "synthetic_run" }, error: null };
      throw Error("Unexpected synthetic RPC");
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  } as unknown as SupabaseClient;
  const result = await dispatchDueSources(2, client, { invocationKind: "local" }, environment);
  assert.deepEqual(order, ["lease_due_sources", "complete_source_run", "lease_due_instagram_sources", "complete_instagram_run"]);
  assert.equal(result[0].outcome, "success"); assert.equal(result[0].sourceId,"fsu-calendar-api");
  assert.equal(result[1].outcome, "blocked"); assert.equal(result[1].sourceId, source);
});

test("one dispatcher covers16socialsources with atmosttwoAPIrequests inflight", async t=>{
  let active=0,maximum=0,requests=0,commits=0;
  t.mock.method(globalThis,"fetch",(async(value:RequestInfo|URL)=>{
    active++;requests++;maximum=Math.max(maximum,active);
    const target=new URL(String(value)).searchParams.get("fields")!.match(/username\(([^)]+)\)/)![1];
    await new Promise(resolve=>setTimeout(resolve,2));active--;
    return Response.json(envelope([post()],{username:target}));
  }) as typeof fetch);
  const client={
    from:()=>({select:()=>({limit:async()=>({data:[{user_id:lease.owner_id}],error:null})})}),
    storage:{from:()=>({upload:async()=>({error:null})})},
    rpc:async(name:string)=>{
      if(name==="lease_due_sources")return{data:[],error:null};
      if(name==="lease_due_instagram_sources")return{data:[...instagramHandles].map(handle=>({...lease,id:`instagram-${handle}`})),error:null};
      if(name==="complete_instagram_run"){commits++;return{data:{run_id:`synthetic_${commits}`},error:null};}
      throw Error("Unexpected synthetic RPC");
    },
  } as unknown as SupabaseClient;
  const result=await dispatchDueSources(2,client,{invocationKind:"local"},environment);
  assert.equal(result.length,16);assert.equal(requests,16);assert.equal(commits,16);assert.equal(maximum,2);
  assert.ok(result.every(row=>row.outcome==="success"));
});
