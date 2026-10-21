import assert from "node:assert/strict";
import test from "node:test";
import { runInstagramAccessCheck } from "../trigger/instagram-access-check";

const token = "SYNTHETIC_TASK_SECRET_12345", caller = "17800000000000001";
const environment = { IG_FB_USER_ACCESS_TOKEN: token, IG_CALLER_USER_ID: caller, SOCIAL_COLLECTION_ENABLED: "true" };
const granted = { data: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"].map(permission => ({ permission, status: "granted" })) };

test("manual Cloud access handler returns only sanitized findings with no writes or target read after a grant failure", async () => {
  let calls = 0;
  const result = await runInstagramAccessCheck({ environment, fetch: (async () => { calls++; return Response.json({ error: { code: 190, error_subcode: 463, message: token } }, { status: 401 }); }) as typeof fetch });
  assert.equal(calls, 1); assert.equal(result.targetCheck, null); assert.equal(result.automaticMonitoringRepaired, false);
  assert.equal(result.diagnostic.databaseWrites, 0); assert.equal(result.diagnostic.tokenChanges, 0);
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes(caller), false);
});

test("manual Cloud handler distinguishes working caller/grants from denied Business Discovery and never emits raw metadata", async () => {
  let calls = 0;
  const result = await runInstagramAccessCheck({ environment, fetch: (async () => {
    calls++; if (calls === 1) return Response.json(granted); if (calls === 2) return Response.json({ id: caller });
    return Response.json({ error: { code: 200, message: `PRIVATE ${token}` } }, { status: 400 });
  }) as typeof fetch });
  assert.equal(calls, 3); assert.equal(result.diagnostic.status, "success");
  assert.equal(result.targetCheck?.failureCategory, "permission_denied"); assert.equal(result.targetCheck?.validatedParentPosts, 0);
  for (const value of [token, caller, "PRIVATE", "pages", "updates"]) assert.equal(JSON.stringify(result).includes(`\"${value}\"`), false);
});
