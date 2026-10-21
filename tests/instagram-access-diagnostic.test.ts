import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseInstagramAccess } from "../lib/instagram/access-diagnostic";

// Synthetic responses only; these tests do not establish hosted access.
const token = "SYNTHETIC_PRIVATE_TOKEN_12345", caller = "17800000000000001";
const environment = { IG_FB_USER_ACCESS_TOKEN: token, IG_CALLER_USER_ID: caller };
const grants = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"];
const permissionPayload = (status = "granted") => ({ data: grants.map(permission => ({ permission, status })), ignored: token });

test("diagnostic makes no request for missing credentials or unsafe caller", async () => {
  for (const value of [{}, { ...environment, IG_CALLER_USER_ID: "1234/messages" }]) {
    let called = false;
    const result = await diagnoseInstagramAccess({ environment: value, fetch: (async () => { called = true; throw Error("must not run"); }) as typeof fetch });
    assert.equal(called, false); assert.equal(result.requests, 0); assert.equal(result.status, "setup_needed");
  }
});

test("only two fixed-host GETs inspect existing grants and caller identity without logging private fields", async () => {
  const seen: string[] = [];
  const result = await diagnoseInstagramAccess({ environment, fetch: (async (value, options) => {
    const url = new URL(String(value)); seen.push(url.pathname);
    assert.equal(url.origin, "https://graph.facebook.com"); assert.equal(url.href.includes(token), false);
    assert.equal(options?.method, "GET"); assert.equal(options?.redirect, "manual"); assert.equal(options?.credentials, "omit");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${token}`);
    if (url.pathname === "/v26.0/me/permissions") { assert.equal(url.searchParams.get("limit"), "100"); return Response.json(permissionPayload()); }
    assert.equal(url.searchParams.get("fields"), "id");
    return Response.json({ id: caller, name: "DO_NOT_STORE_NAME", access_token: token });
  }) as typeof fetch });
  assert.deepEqual(seen, ["/v26.0/me/permissions", `/v26.0/${caller}`]);
  assert.equal(result.status, "success"); assert.equal(result.databaseWrites, 0); assert.equal(result.tokenChanges, 0);
  for (const privateValue of [caller, token, "DO_NOT_STORE_NAME"]) assert.equal(JSON.stringify(result).includes(privateValue), false);
  assert.ok(Object.values(result.requiredPermissions).every(value => value === "granted"));
});

test("declined, expired and absent existing grants are distinct and never trigger new authorization", async () => {
  for (const status of ["declined", "expired", "unrecognized"]) {
    let requests = 0;
    const result = await diagnoseInstagramAccess({ environment, fetch: (async () => ++requests === 1 ? Response.json(permissionPayload(status)) : Response.json({ id: caller })) as typeof fetch });
    assert.equal(result.status, "blocked"); assert.equal(result.scopesAdded, 0);
    assert.match(result.conclusions.join(), /grants_missing/);
    assert.equal(result.requiredPermissions.instagram_basic, status === "unrecognized" ? "unrecognized_status" : status);
  }
  let requests = 0;
  const absent = await diagnoseInstagramAccess({ environment, fetch: (async () => ++requests === 1 ? Response.json({ data: [] }) : Response.json({ id: caller })) as typeof fetch });
  assert.equal(absent.requiredPermissions.instagram_basic, "not_returned_or_duplicate"); assert.equal(absent.status, "blocked");
});

test("HTTP200 Graph200 permission denial and expired token never expose error messages or call another endpoint", async () => {
  for (const error of [{ code: 200 }, { code: 190, error_subcode: 463 }]) {
    const result = await diagnoseInstagramAccess({ environment, fetch: (async () => Response.json({ error: { ...error, message: `PRIVATE ${token}`, type: token } })) as typeof fetch });
    assert.equal(result.requests, 1); assert.equal(result.status, "blocked");
    assert.equal(result.permissionCheck.reason, error.code === 200 ? "permission_denied" : "token_expired");
    assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
});

test("granted scopes cannot prove selected Page asset access or an inaccessible/mismatched caller", async () => {
  for (const callerBody of [{ error: { code: 200 } }, { id: "999999999" }]) {
    let requests = 0;
    const result = await diagnoseInstagramAccess({ environment, fetch: (async () => ++requests === 1 ? Response.json(permissionPayload()) : Response.json(callerBody)) as typeof fetch });
    assert.equal(result.status, "blocked"); assert.match(result.conclusions.join(), /page_link_asset_grants_and_app_mode/);
    assert.equal(result.requests, 2);
  }
});

test("truncated permissions, oversized data, redirects and network errors fail visibly without following or retrying", async () => {
  const samples = [
    Response.json({ ...permissionPayload(), paging: { next: `https://evil.invalid/?access_token=${token}` } }),
    new Response("x", { headers: { "content-length": "65537" } }),
    new Response(null, { status: 302, headers: { location: `https://evil.invalid/?access_token=${token}` } }),
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
  ];
  for (const sample of samples) {
    const result = await diagnoseInstagramAccess({ environment, fetch: (async () => sample) as typeof fetch });
    assert.notEqual(result.status, "success"); assert.equal(result.requests, 1); assert.equal(JSON.stringify(result).includes(token), false);
  }
  const network = await diagnoseInstagramAccess({ environment, fetch: (async () => { throw Error(token); }) as typeof fetch });
  assert.equal(network.status, "failed"); assert.equal(network.requests, 1); assert.equal(JSON.stringify(network).includes(token), false);
});
