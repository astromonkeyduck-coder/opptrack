/** Explicit synthetic Graph responses. No test here contacts Meta or proves live access. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoveryRequestUrl, graphVersion, initializeProbeEnvironment, preflightBusinessDiscovery, probeEnvironmentFilename, writePreflightEvidence } from "../lib/instagram/business-discovery-preflight";

const target = "clubdownunderfsu";
const token = "synthetic-token-never-a-real-credential";
const environment = { IG_FB_USER_ACCESS_TOKEN: token, IG_CALLER_USER_ID: "100000001" };
const clock = () => new Date("2026-10-21T02:00:00Z");
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-10-20T17:00:00+0000", permalink: `https://www.instagram.com/p/synthetic_${id}/`, ...extra });
const row = (id: string, extra: Record<string, unknown> = {}) => item(id, { timestamp: "2026-10-20T17:00:00+00:00", ...extra });
const payload = (rows: unknown[], extra: Record<string, unknown> = {}) => ({ id: environment.IG_CALLER_USER_ID, business_discovery: { id: "100000002", username: target, media: { data: rows, ...extra } } });
const countedPayload = (rows: unknown[], mediaCount: unknown, extra: Record<string, unknown> = {}) => {
  const body = payload(rows, extra);
  return { ...body, business_discovery: { ...body.business_discovery, media_count: mediaCount } };
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noFetch = async () => { throw Error("Synthetic test must not fetch"); };
function responses(values: Response[], visit?: (url: URL, options?: RequestInit) => void): typeof fetch {
  return (async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    visit?.(url, options);
    const result = values.shift(); if (!result) throw Error("Unexpected synthetic request"); return result;
  }) as typeof fetch;
}

test("Instagram preflight missing credentials performs exactly zero requests", async () => {
  let calls = 0;
  const result = await preflightBusinessDiscovery({ target, environment: {} }, { now: clock, fetch: (async () => { calls++; return noFetch(); }) as typeof fetch });
  assert.equal(calls, 0); assert.equal(result.summary.status, "setup_needed"); assert.equal(result.summary.requests, 0);
  assert.deepEqual(result.summary.missingVariables, ["IG_FB_USER_ACCESS_TOKEN", "IG_CALLER_USER_ID"]);
});

test("only exact user watchlist handles and numeric caller IDs can select the fixed Graph node", async () => {
  for (const bad of ["../me", "me", "https://127.0.0.1/", "100000001/media", "100000001?fields=messages"]) {
    const result = await preflightBusinessDiscovery({ target, environment: { ...environment, IG_CALLER_USER_ID: bad } }, { fetch: noFetch as typeof fetch });
    assert.equal(result.summary.status, "setup_needed"); assert.equal(result.summary.requests, 0);
  }
  for (const bad of ["unselected_account", "clubdownunderfsu){messages}", "https://www.instagram.com/clubdownunderfsu/", token]) {
    const result = await preflightBusinessDiscovery({ target: bad, environment }, { fetch: noFetch as typeof fetch });
    assert.equal(result.summary.status, "blocked"); assert.equal(result.summary.target, null); assert.equal(result.summary.requests, 0);
  }
  assert.throws(() => discoveryRequestUrl("100000001", target, 5, "cursor){messages}"));
  assert.throws(() => discoveryRequestUrl("100000001", target, 26));
});

test("sample uses GET and Bearer auth, fixed v26.0, no caption/media URL fields, no redirects", async () => {
  let calls = 0;
  const result = await preflightBusinessDiscovery({ target: `@${target.toUpperCase()}`, environment }, { now: clock, fetch: responses([response(payload([item("1001")]))], (url, options) => {
    calls++; assert.equal(url.origin, "https://graph.facebook.com"); assert.equal(url.pathname, "/v26.0/100000001");
    assert.equal(graphVersion, "v26.0"); assert.equal(url.searchParams.has("access_token"), false); assert.equal(url.href.includes(token), false);
    assert.match(url.searchParams.get("fields")!, /business_discovery\.username\(clubdownunderfsu\)/);
    assert.doesNotMatch(url.searchParams.get("fields")!, /caption|media_url|messages|publish|stories/);
    assert.equal(options?.method, "GET"); assert.equal(options?.redirect, "manual"); assert.equal(options?.credentials, "omit");
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${token}`);
  }) });
  assert.equal(calls, 1); assert.equal(result.summary.status, "success_sample"); assert.equal(result.summary.accessSampleProven, true);
  assert.equal(result.summary.sampleOnly, true); assert.equal(result.summary.automaticMonitoringEnabled, false); assert.equal(result.summary.storiesTested, false);
});

test("Graph HTTP-200 errors and expired authorization never become empty success or leak messages", async () => {
  for (const [code, status] of [[190, "setup_needed"], [10, "blocked"], [4, "rate_limited"]] as const) {
    const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response({ error: { code, error_subcode: 463, message: `Invalid access_token=${token}`, type: token } })]) });
    assert.equal(result.summary.status, status); assert.equal(result.summary.graphError?.code, code); assert.equal(result.summary.requests, 1);
    assert.equal(result.summary.accessSampleProven, false); assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(JSON.stringify(result).includes("Invalid access_token"), false);
  }
  const transient = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response({ error: { code: 2, is_transient: true, message: token } })]) });
  assert.equal(transient.summary.status, "failed"); assert.equal(JSON.stringify(transient).includes(token), false);
});

test("redirects, HTML login pages, non-JSON and provider throttling stay explicit", async () => {
  const fixtures = [
    [new Response(null, { status: 302, headers: { location: `https://evil.test/?access_token=${token}` } }), "blocked"],
    [new Response("<html>Please log in</html>", { headers: { "content-type": "text/html" } }), "blocked"],
    [new Response("not JSON", { headers: { "content-type": "text/plain" } }), "failed"],
    [new Response("<html>Rate limit</html>", { status: 429 }), "rate_limited"],
  ] as const;
  for (const [fixture, expected] of fixtures) {
    const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([fixture]) });
    assert.equal(result.summary.status, expected); assert.equal(result.summary.requests, 1); assert.equal(result.summary.accessSampleProven, false);
    assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes("evil.test"), false);
  }
});

test("missing/ineligible targets, identity mismatches and a valid empty edge remain distinguishable", async () => {
  for (const body of [{ id: environment.IG_CALLER_USER_ID }, { id: environment.IG_CALLER_USER_ID, business_discovery: null }, { ...payload([]), id: "99999999" }, { id: environment.IG_CALLER_USER_ID, business_discovery: { id: "100000002", username: "unselected_account", media: { data: [] } } }]) {
    const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(body)]) });
    assert.equal(result.summary.status, "blocked"); assert.equal(result.summary.accessSampleProven, false);
  }
  const empty = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(payload([]))]) });
  assert.equal(empty.summary.status, "empty_unverified"); assert.equal(empty.summary.metadataReturned, true); assert.equal(empty.summary.accessSampleProven, false);
  assert.match(empty.summary.reasonCodes.join(), /does_not_prove_no_new/);
});

test("media pages rebuild the same allowlisted node from cursor values and never retain next URLs", async () => {
  const next = { next: `https://evil.test/unsafe?access_token=${token}`, cursors: { after: "safe_cursor==" } };
  const urls: URL[] = [];
  const result = await preflightBusinessDiscovery({ target, environment, maxPages: 2, maxRequests: 2 }, { fetch: responses([response(payload([row("1001")], { paging: next })), response(payload([row("1002")]))], url => { urls.push(url); }) });
  assert.equal(result.summary.status, "success_sample"); assert.equal(result.summary.requests, 2); assert.equal(result.summary.counts.validUniqueMediaRows, 2);
  assert.ok(urls.every(url => url.origin === "https://graph.facebook.com" && url.pathname === "/v26.0/100000001"));
  assert.match(urls[1].searchParams.get("fields")!, /media\.after\(safe_cursor==\)/);
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes("evil.test"), false); assert.equal(JSON.stringify(result.privateDiagnostics).includes("safe_cursor"), false);
});

test("caps, absent/unsafe/repeated cursors and duplicate pages cannot imply complete history", async () => {
  const paging = { next: "https://graph.facebook.com/ignored", cursors: { after: "safe_cursor" } };
  for (const limits of [{ maxPages: 1, maxRequests: 3 }, { maxPages: 3, maxRequests: 1 }]) {
    const result = await preflightBusinessDiscovery({ target, environment, ...limits }, { fetch: responses([response(payload([row("1001")], { paging }))]) });
    assert.equal(result.summary.status, "partial"); assert.equal(result.summary.requests, 1); assert.equal(result.summary.paginationComplete, false); assert.equal(result.summary.accessSampleProven, true);
  }
  for (const after of [undefined, "bad){messages}", token]) {
    const result = await preflightBusinessDiscovery({ target, environment, maxPages: 3, maxRequests: 3 }, { fetch: responses([response(payload([row("1001")], { paging: { next: "untrusted", cursors: { after } } }))]) });
    assert.equal(result.summary.status, "partial"); assert.equal(result.summary.requests, 1); assert.match(result.summary.reasonCodes.join(), /cursor/);
  }
  const repeated = await preflightBusinessDiscovery({ target, environment, maxPages: 3, maxRequests: 3 }, { fetch: responses([response(payload([row("1001")], { paging })), response(payload([row("1002")], { paging }))]) });
  assert.equal(repeated.summary.status, "partial"); assert.equal(repeated.summary.requests, 2); assert.match(repeated.summary.reasonCodes.join(), /cursor/);
  const duplicate = await preflightBusinessDiscovery({ target, environment, maxPages: 2, maxRequests: 2 }, { fetch: responses([response(payload([row("1001")], { paging })), response(payload([row("1001")]))]) });
  assert.equal(duplicate.summary.status, "partial"); assert.match(duplicate.summary.reasonCodes.join(), /duplicate_media/);
});

test("a valid five-post sample without next cannot claim pagination complete when the provider reports 369 posts", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => row(String(1001 + index)));
  const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(countedPayload(rows, 369))]) });
  assert.equal(result.summary.status, "success_sample"); assert.equal(result.summary.accessSampleProven, true);
  assert.equal(result.summary.requests, 1); assert.equal(result.summary.counts.validUniqueMediaRows, 5);
  assert.equal(result.summary.counts.providerReportedMediaCount, 369); assert.equal(result.summary.paginationComplete, false);
  assert.ok(result.summary.reasonCodes.includes("provider_media_count_exceeds_sample_without_continuation"));
  assert.equal(result.summary.sampleOnly, true);
});

test("missing or invalid provider totals leave pagination unverified even when no continuation is advertised", async () => {
  const fullPage = Array.from({ length: 5 }, (_, index) => row(String(1001 + index)));
  for (const mediaCount of [undefined, "5", -1]) {
    const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(countedPayload(fullPage, mediaCount))]) });
    assert.equal(result.summary.status, "success_sample"); assert.equal(result.summary.accessSampleProven, true);
    assert.equal(result.summary.counts.providerReportedMediaCount, null); assert.equal(result.summary.paginationComplete, false);
    assert.ok(result.summary.reasonCodes.includes("item_limit_reached_without_continuation_or_total"));
  }
  const shortPage = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(payload([row("1001")]))]) });
  assert.equal(shortPage.summary.status, "success_sample"); assert.equal(shortPage.summary.paginationComplete, false);
  assert.ok(shortPage.summary.reasonCodes.includes("provider_media_count_missing_pagination_unverified"));
});

test("pagination completeness requires matching stable provider totals and no advertised parent or child remainder", async () => {
  const complete = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(countedPayload([row("1001")], 1))]) });
  assert.equal(complete.summary.status, "success_sample"); assert.equal(complete.summary.paginationComplete, true);
  assert.equal(complete.summary.sampleOnly, true);
  const next = { next: "https://graph.facebook.com/ignored", cursors: { after: "safe_cursor" } };
  const changed = await preflightBusinessDiscovery({ target, environment, maxPages: 2, maxRequests: 2 }, { fetch: responses([response(countedPayload([row("1001")], 3, { paging: next })), response(countedPayload([row("1002")], 2))]) });
  assert.equal(changed.summary.status, "success_sample"); assert.equal(changed.summary.paginationComplete, false);
  assert.ok(changed.summary.reasonCodes.includes("provider_media_count_inconsistent_pagination_unverified"));
  const smaller = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(countedPayload([row("1001"), row("1002")], 1))]) });
  assert.equal(smaller.summary.paginationComplete, false);
  assert.ok(smaller.summary.reasonCodes.includes("provider_media_count_inconsistent_pagination_unverified"));
  const capped = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(countedPayload([row("1001")], 1, { paging: next }))]) });
  assert.equal(capped.summary.status, "partial"); assert.equal(capped.summary.paginationComplete, false);
});

test("sample classifies returned posts, Reels and ordered carousel child metadata without fetching media", async () => {
  const content = [row("1001"), row("1002", { media_type: "VIDEO", media_product_type: "REELS" }), row("1003", { media_type: "CAROUSEL_ALBUM", children: { data: [{ id: "2001", media_type: "IMAGE" }, { id: "2002", media_type: "VIDEO" }] } })];
  const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(payload(content))]) });
  assert.equal(result.summary.status, "success_sample"); assert.equal(result.summary.requests, 1);
  assert.deepEqual(result.summary.counts, { providerReportedMediaCount: null, returnedMediaRows: 3, validUniqueMediaRows: 3, invalidMediaRows: 0, images: 1, videos: 1, reels: 1, carousels: 1, children: 2, childPagesRemaining: 0 });
  assert.deepEqual(result.privateDiagnostics.pages[0].media[2].children.map(child => child.id), ["2001", "2002"]);
  assert.equal(result.summary.storiesTested, false);
});

test("nested carousel remainder is partial and never triggers a separate child endpoint", async () => {
  const carousel = row("1001", { media_type: "CAROUSEL_ALBUM", children: { data: [{ id: "2001", media_type: "IMAGE" }], paging: { next: `https://graph.facebook.com/2001/children?access_token=${token}`, cursors: { after: "child_cursor" } } } });
  const result = await preflightBusinessDiscovery({ target, environment, maxPages: 3, maxRequests: 3 }, { fetch: responses([response(payload([carousel]))]) });
  assert.equal(result.summary.status, "partial"); assert.equal(result.summary.requests, 1); assert.equal(result.summary.counts.children, 1); assert.equal(result.summary.counts.childPagesRemaining, 1);
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes("child_cursor"), false);
});

test("malformed media/child fields and provider page oversize remain partial", async () => {
  for (const value of [row("1001", { timestamp: null }), row("1001", { id: null }), row("1001", { permalink: "https://evil.test/p/example/" }), row("1001", { media_type: "CAROUSEL_ALBUM" }), row("1001", { media_type: "CAROUSEL_ALBUM", children: { data: [{ id: "2001", media_type: "IMAGE" }, { id: "2001", media_type: "IMAGE" }] } })]) {
    const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(payload([value]))]) });
    assert.equal(result.summary.status, "partial"); assert.ok(result.summary.counts.invalidMediaRows > 0);
  }
  const oversizedPage = await preflightBusinessDiscovery({ target, environment, pageSize: 1 }, { fetch: responses([response(payload([row("1001"), row("1002")]))]) });
  assert.equal(oversizedPage.summary.status, "partial"); assert.match(oversizedPage.summary.reasonCodes.join(), /item_limit/);
});

test("diagnostics are a sanitized projection; captions, media URLs, tokens and query parameters never persist", async () => {
  const result = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([response(payload([row("1001", { caption: `Sensitive caption ${token}`, media_url: `https://cdn.test/?token=${token}`, permalink: `https://www.instagram.com/p/synthetic_1001/?access_token=${token}#private` })]))]) });
  assert.equal(result.summary.status, "success_sample"); assert.equal(result.privateDiagnostics.losslessRawCapture, false);
  const serialized = JSON.stringify(result);
  for (const excluded of [token, "Sensitive caption", "cdn.test", "access_token=", "#private"]) assert.equal(serialized.includes(excluded), false);
  assert.equal(result.privateDiagnostics.pages[0].media[0].permalink, "https://www.instagram.com/p/synthetic_1001/");
});

test("transport and oversized body failures count attempts without leaking exception text", async () => {
  const network = await preflightBusinessDiscovery({ target, environment }, { fetch: (async () => { throw Error(`Request https://graph.facebook.com/?access_token=${token}`); }) as typeof fetch });
  assert.equal(network.summary.status, "failed"); assert.equal(network.summary.requests, 1); assert.equal(JSON.stringify(network).includes(token), false);
  const large = await preflightBusinessDiscovery({ target, environment }, { fetch: responses([new Response("x".repeat(262_145))]) });
  assert.equal(large.summary.status, "failed"); assert.equal(large.summary.requests, 1); assert.match(large.summary.reasonCodes.join(), /byte_limit/);
});

test("credential initialization is mode 600 and exclusive; evidence is private and correctly labels its hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "instagram-preflight-synthetic-"));
  try {
    assert.equal(await initializeProbeEnvironment(root), "created");
    const filename = path.join(root, probeEnvironmentFilename);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    await writeFile(filename, "SYNTHETIC_EXISTING_VALUE=preserve-me\n");
    assert.equal(await initializeProbeEnvironment(root), "already_exists"); assert.equal(await readFile(filename, "utf8"), "SYNTHETIC_EXISTING_VALUE=preserve-me\n");
    const result = await preflightBusinessDiscovery({ target, environment: {} }, { fetch: noFetch as typeof fetch });
    const saved = await writePreflightEvidence(result, root);
    assert.equal(saved.filesWritten, 2); assert.equal((await stat(saved.directory)).mode & 0o777, 0o700);
    for (const basename of ["summary.json", "diagnostic.json"]) assert.equal((await stat(path.join(saved.directory, basename))).mode & 0o777, 0o600);
    const summary = JSON.parse(await readFile(path.join(saved.directory, "summary.json"), "utf8"));
    assert.equal(summary.losslessRawCapture, false); assert.match(summary.diagnosticHashBasis, /not raw HTTP/); assert.match(summary.diagnosticSha256, /^[a-f0-9]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("private diagnostics refuse a symlinked private directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "instagram-preflight-synthetic-"));
  const destination = await mkdtemp(path.join(os.tmpdir(), "instagram-preflight-destination-"));
  try {
    await symlink(destination, path.join(root, "private"));
    const result = await preflightBusinessDiscovery({ target, environment: {} }, { fetch: noFetch as typeof fetch });
    await assert.rejects(writePreflightEvidence(result, root), /cannot be a symlink/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }); }
});
