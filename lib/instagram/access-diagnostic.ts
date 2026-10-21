import { isGraphPermissionError } from "./graph-errors";

const requiredPermissions = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"] as const;
type Json = Record<string, unknown>;
type CheckStatus = "success" | "blocked" | "failed" | "partial" | "setup_needed";
type Check = { status: CheckStatus; httpStatus: number | null; graphCode: number | null; graphSubcode: number | null; reason: string };
const record = (value: unknown): Json | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const safeInteger = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const check = (status: CheckStatus, reason: string): Check => ({ status, reason, httpStatus: null, graphCode: null, graphSubcode: null });

/** Two fixed-host read-only checks, no enumeration, scope changes, tokens or raw error text in output. */
export async function diagnoseInstagramAccess(options: { environment: Record<string, string | undefined>; fetch?: typeof fetch; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const result = {
    diagnosticVersion: "instagram-read-access-v1", startedAt: now().toISOString(), finishedAt: now().toISOString(),
    status: "setup_needed" as CheckStatus, requests: 0, responseBytes: 0,
    permissionCheck: check("setup_needed", "not_attempted"), callerCheck: check("setup_needed", "not_attempted"),
    requiredPermissions: Object.fromEntries(requiredPermissions.map(name => [name, "unverified"])) as Record<typeof requiredPermissions[number], string>,
    conclusions: [] as string[], credentialValuesLogged: false, databaseWrites: 0, tokenChanges: 0, scopesAdded: 0,
  };
  const finish = (status: CheckStatus, conclusion: string) => { result.status = status; result.conclusions.push(conclusion); result.finishedAt = now().toISOString(); return result; };
  const token = options.environment.IG_FB_USER_ACCESS_TOKEN?.trim(), callerId = options.environment.IG_CALLER_USER_ID?.trim();
  if (!token || !/^[A-Za-z0-9_.~+/=-]{16,4096}$/.test(token) || !callerId || !/^[0-9]{1,32}$/.test(callerId)) return finish("setup_needed", "existing_read_token_and_caller_id_required_no_request");

  async function request(path: string, params: Record<string, string>): Promise<{ check: Check; payload: Json | null }> {
    const url = new URL(`https://graph.facebook.com/v26.0/${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    let response: Response;
    try {
      result.requests++;
      response = await (options.fetch ?? fetch)(url, { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "FSUOpportunityTracker/0.1 (bounded read-only credential diagnosis)" } });
    } catch { return { check: check("failed", "transport_failed_not_empty"), payload: null }; }
    const outcome = check("failed", "invalid_response"); outcome.httpStatus = response.status;
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => {}); outcome.status = "blocked"; outcome.reason = "redirect_refused"; return { check: outcome, payload: null }; }
    const limit = 65_536;
    if (Number(response.headers.get("content-length") ?? 0) > limit) { await response.body?.cancel().catch(() => {}); outcome.reason = "bounded_response_exceeded"; return { check: outcome, payload: null }; }
    const reader = response.body?.getReader();
    if (!reader) return { check: outcome, payload: null };
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; result.responseBytes += part.value.byteLength;
        if (bytes > limit) { await reader.cancel(); outcome.reason = "bounded_response_exceeded"; return { check: outcome, payload: null }; }
        chunks.push(part.value);
      }
    } catch { outcome.reason = "interrupted_body"; return { check: outcome, payload: null }; }
    let payload: Json | null;
    try { payload = record(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { return { check: outcome, payload: null }; }
    const error = record(payload?.error);
    if (error || !response.ok) {
      outcome.graphCode = safeInteger(error?.code); outcome.graphSubcode = safeInteger(error?.error_subcode);
      outcome.status = "blocked";
      outcome.reason = outcome.graphCode === 190 && outcome.graphSubcode === 463 ? "token_expired" : isGraphPermissionError(outcome.graphCode) ? "permission_denied" : "authorization_or_provider_error";
      if (response.status >= 500 || error?.is_transient === true) { outcome.status = "failed"; outcome.reason = "transient_provider_error"; }
      return { check: outcome, payload: null };
    }
    outcome.status = "success"; outcome.reason = "response_received";
    return { check: outcome, payload };
  }

  const permissions = await request("me/permissions", { limit: "100" });
  result.permissionCheck = permissions.check;
  if (permissions.check.status !== "success") return finish(permissions.check.status, "permission_read_failed_production_health_unchanged");
  const entries = permissions.payload?.data;
  if (!Array.isArray(entries) || entries.length > 100 || record(permissions.payload?.paging)?.next) {
    result.permissionCheck.status = "partial"; result.permissionCheck.reason = "permission_response_missing_or_truncated";
    return finish("partial", "required_grants_unverified");
  }
  for (const name of requiredPermissions) {
    const matches = entries.map(record).filter(row => row?.permission === name);
    result.requiredPermissions[name] = matches.length !== 1 ? "not_returned_or_duplicate" : ["granted", "declined", "expired"].includes(String(matches[0]?.status)) ? String(matches[0]?.status) : "unrecognized_status";
  }
  const caller = await request(callerId, { fields: "id" });
  result.callerCheck = caller.check;
  if (caller.check.status === "success" && caller.payload?.id !== callerId) { result.callerCheck.status = "blocked"; result.callerCheck.reason = "caller_identity_mismatch"; }
  if (requiredPermissions.some(name => result.requiredPermissions[name] !== "granted")) return finish("blocked", "existing_read_grants_missing_expired_or_declined_reauthorize_same_scope_set");
  if (result.callerCheck.status !== "success") return finish(result.callerCheck.status, "read_grants_present_but_caller_access_failed_page_link_asset_grants_and_app_mode_need_review");
  return finish("success", "existing_grants_and_caller_identity_verified_target_collection_still_requires_live_probe");
}
