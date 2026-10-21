import watchlist from "../../config/instagram-watchlist.json";
import type { CollectionBatch, RawPage } from "../collection/types";
import { parseRetryAfter, sha256, stableHash } from "../collection/http";
import { validateCollectionBatch } from "../collection";

export const instagramAdapter = "instagram-business-discovery-v1";
export const instagramScope = "latest25_parent_metadata_only";
export const instagramHandles = new Set(watchlist.accounts.filter(account => account.posts_access === "live_sample_proven" && account.handle !== "fsucre").map(account => account.handle));
const numericId = /^[0-9]{1,32}$/;
const explicitInstant = /(?:Z|[+-][0-9]{2}:?[0-9]{2})$/;
type Json = Record<string, unknown>;
export interface InstagramUpdate {
  native_id: string; caption: string | null; permalink: string; published_at: string;
  media_type: string; media_product_type: string | null;
  children: Array<{ native_id: string; media_type: string; position: number }>;
  children_complete: boolean; content_hash: string; capture_native_id: string; evidence_pointer: string;
}
export interface InstagramBatch extends CollectionBatch {
  updates: InstagramUpdate[];
  failureCategory: string | null;
  providerReportedMediaCount: number | null;
  tokenExpiryKnown: boolean;
}
function record(value: unknown): Json | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null; }
function id(value: unknown): value is string { return typeof value === "string" && numericId.test(value); }
function type(value: unknown): value is string { return value === "IMAGE" || value === "VIDEO" || value === "CAROUSEL_ALBUM"; }
function safeNumber(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function safePermalink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || (url.port && url.port !== "443") || !/^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    return `https://www.instagram.com${url.pathname.replace(/\/$/, "")}/`;
  } catch { return null; }
}

/** Fixed node/fields and Bearer header: neither source content nor paging URLs can direct requests. */
export function instagramRequestUrl(callerId: string, handle: string): URL {
  if (!numericId.test(callerId) || !instagramHandles.has(handle)) throw new Error("Instagram source is outside the proven account allowlist");
  const url = new URL(`https://graph.facebook.com/v26.0/${callerId}`);
  url.searchParams.set("fields", `id,business_discovery.username(${handle}){id,username,media_count,media.limit(25){id,caption,media_type,media_product_type,timestamp,permalink,children.limit(20){id,media_type}}}`);
  return url;
}

/** One hourly overlap snapshot; publication times are never converted to event occurrences. */
export async function collectInstagram(sourceId: string, options: {
  environment?: Record<string, string | undefined>; fetch?: typeof fetch; now?: () => Date; timeoutMs?: number;
} = {}): Promise<InstagramBatch> {
  const environment = options.environment ?? process.env, now = options.now ?? (() => new Date());
  const handle = sourceId.replace(/^instagram-/, "");
  const batch: InstagramBatch = { sourceId, parserVersion: instagramAdapter, startedAt: now().toISOString(), finishedAt: now().toISOString(), status: "blocked", reason: "Instagram collection has not completed", retryAfterSeconds: null, pages: [], opportunities: [], occurrences: [], cursor: null, observations: { requests: 0, httpStatuses: [], bytes: 0, nativeRows: 0, paginationComplete: false, windowFrom: null, windowTo: null, warnings: ["Latest 25 parent posts per hourly poll; older history and posts outside this overlap can be missed", "Captions and child IDs/types only; no media files, Stories, OCR or event extraction", "Post publication is not an event date; ticket availability is unverified"] }, updates: [], failureCategory: null, providerReportedMediaCount: null, tokenExpiryKnown: false };
  const finish = (status: CollectionBatch["status"], category: string | null, reason: string | null) => {
    batch.status = status; batch.failureCategory = category; batch.reason = reason; batch.finishedAt = now().toISOString();
    batch.observations.nativeRows = batch.updates.length;
    validateCollectionBatch(batch);
    return batch;
  };
  if (sourceId !== `instagram-${handle}` || !instagramHandles.has(handle)) return finish("blocked", "source_not_authorized", "Source is outside the 16 proven Instagram accounts; no request made");
  if (environment.SOCIAL_COLLECTION_ENABLED !== "true") return finish("blocked", "setup_needed", "Instagram collection is disabled in the worker environment; no request made");
  const token = environment.IG_FB_USER_ACCESS_TOKEN?.trim(), callerId = environment.IG_CALLER_USER_ID?.trim();
  if (!token || !callerId || !numericId.test(callerId) || !/^[A-Za-z0-9_.~+/=-]{16,4096}$/.test(token)) return finish("blocked", "setup_needed", "Instagram worker credential setup is missing or invalid; no request made");
  const expiry = environment.IG_TOKEN_EXPIRES_AT?.trim();
  if (expiry) {
    if (!explicitInstant.test(expiry) || !Number.isFinite(Date.parse(expiry))) return finish("blocked", "setup_needed", "Instagram token expiry configuration is invalid; no request made");
    batch.tokenExpiryKnown = true;
    if (Date.parse(expiry) <= now().getTime()) return finish("blocked", "token_expired", "Instagram token has reached its verified expiry; replace it in Trigger Production");
  } else batch.observations.warnings.push("Token expiry/renewal is unverified; collection stops visibly if Meta rejects it");
  const redact = (text: string) => text.split(token).join("[credential redacted]").split(encodeURIComponent(token)).join("[credential redacted]");
  let response: Response;
  try {
    batch.observations.requests = 1;
    response = await (options.fetch ?? fetch)(instagramRequestUrl(callerId, handle), { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(Math.min(10_000, options.timeoutMs ?? 10_000)), headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "FSUOpportunityTracker/0.1 (read-only Instagram monitoring)" } });
  } catch { return finish("failed", "transport_failure", "Instagram transport failed or timed out; this is not an empty result"); }
  batch.observations.httpStatuses.push(response.status);
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => {}); return finish("blocked", "redirect_refused", "Instagram API redirect refused; no redirect was followed"); }
  if (response.status === 429 || response.status === 503) {
    await response.body?.cancel().catch(() => {});
    batch.retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"), now());
    addCapture({ kind: "sanitized_api_projection", scope: instagramScope, history_complete: false, posts: [], http_status: response.status, response_body_not_consumed: true });
    return finish("rate_limited", "rate_limited", "Instagram API rate limit; retry floor is retained separately from hourly cadence");
  }
  const cap = 524_288;
  if (Number(response.headers.get("content-length") ?? 0) > cap) { await response.body?.cancel().catch(() => {}); return finish("failed", "response_too_large", "Instagram response exceeded the bounded byte limit"); }
  const reader = response.body?.getReader();
  if (!reader) return finish("failed", "missing_body", "Instagram response has no body");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; batch.observations.bytes += part.value.byteLength;
      if (bytes > cap) { await reader.cancel(); return finish("failed", "response_too_large", "Instagram response exceeded the bounded byte limit"); }
      chunks.push(part.value);
    }
  } catch { return finish("failed", "interrupted_body", "Instagram response was interrupted; collection is incomplete"); }
  const text = Buffer.concat(chunks).toString("utf8");
  if (response.headers.get("content-type")?.includes("html") || /^\s*</.test(text)) return finish("blocked", "login_wall", "Instagram returned an HTML/access page instead of post metadata");
  let payload: Json | null;
  try { payload = record(JSON.parse(text)); } catch { return finish("failed", "invalid_json", "Instagram API returned malformed JSON"); }
  if (!payload) return finish("failed", "invalid_envelope", "Instagram API returned an invalid envelope");
  const graphError = record(payload.error);
  if (graphError || !response.ok) {
    const code = safeNumber(graphError?.code), subcode = safeNumber(graphError?.error_subcode);
    const projection = { kind: "sanitized_api_projection", scope: instagramScope, history_complete: false, posts: [], graph_error: { code, subcode }, http_status: response.status };
    addCapture(projection);
    if (response.status === 429 || response.status === 503 || [4, 17, 32, 613].includes(code ?? -1)) { batch.retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"), now()); return finish("rate_limited", "rate_limited", "Instagram API rate limit; retry floor is retained separately from hourly cadence"); }
    if (code === 190 || [401, 403].includes(response.status)) return finish("blocked", code === 190 && subcode === 463 ? "token_expired" : "authorization_unavailable", code === 190 && subcode === 463 ? "Instagram token expired; replace it in Trigger Production" : "Instagram token or read authorization is unavailable; review worker setup");
    if (response.status >= 500 || graphError?.is_transient === true) return finish("failed", "provider_failure", "Instagram API returned a transient/provider failure");
    return finish("blocked", "target_unavailable", `Instagram target access failed (Graph ${code ?? "unknown"}/${subcode ?? "unknown"}); cause remains unresolved`);
  }
  if (payload.id !== callerId) return finish("blocked", "caller_mismatch", "Instagram caller identity did not match worker configuration");
  const business = record(payload.business_discovery);
  if (!business || !id(business.id) || typeof business.username !== "string" || business.username.toLowerCase() !== handle) return finish("blocked", "target_mismatch_or_unavailable", "Instagram target identity/access is unavailable or mismatched");
  batch.providerReportedMediaCount = safeNumber(business.media_count);
  const media = record(business.media);
  if (!media || !Array.isArray(media.data) || media.data.length > 25) return finish("partial", "invalid_media_edge", "Instagram returned a missing or oversized bounded media edge");
  const seen = new Set<string>(); let invalid = 0, childPartial = false;
  for (const value of media.data) {
    const row = record(value), link = safePermalink(row?.permalink), timestamp = row?.timestamp;
    if (!row || !id(row.id) || seen.has(row.id) || !type(row.media_type) || row.media_product_type === "STORY" || !link || typeof timestamp !== "string" || !explicitInstant.test(timestamp) || !Number.isFinite(Date.parse(timestamp)) || (row.caption !== undefined && row.caption !== null && (typeof row.caption !== "string" || row.caption.length > 20_000))) { invalid++; continue; }
    seen.add(row.id);
    const children: InstagramUpdate["children"] = [], childIds = new Set<string>();
    let childrenComplete = true;
    if (row.media_type === "CAROUSEL_ALBUM") {
      const edge = record(row.children);
      if (!edge || !Array.isArray(edge.data) || !edge.data.length || edge.data.length > 20) childrenComplete = false;
      else {
        for (const item of edge.data) {
          const child = record(item);
          if (!child || !id(child.id) || childIds.has(child.id) || !["IMAGE", "VIDEO"].includes(String(child.media_type))) { childrenComplete = false; continue; }
          childIds.add(child.id); children.push({ native_id: child.id, media_type: String(child.media_type), position: children.length });
        }
        if (record(edge.paging)?.next) childrenComplete = false;
      }
    }
    childPartial ||= !childrenComplete;
    const facts = { native_id: row.id, caption: typeof row.caption === "string" ? redact(row.caption) : null, permalink: link, published_at: new Date(timestamp).toISOString(), media_type: row.media_type, media_product_type: ["FEED", "REELS", "AD"].includes(String(row.media_product_type)) ? String(row.media_product_type) : null, children, children_complete: childrenComplete };
    if (JSON.stringify(facts).includes(token) || JSON.stringify(facts).includes(encodeURIComponent(token))) { invalid++; continue; }
    batch.updates.push({ ...facts, content_hash: stableHash(facts), capture_native_id: "latest25", evidence_pointer: `/posts/${batch.updates.length}` });
  }
  addCapture({ kind: "sanitized_api_projection", scope: instagramScope, history_complete: false, provider_reported_media_count: batch.providerReportedMediaCount, bounded_parent_limit: 25, advertised_more_parent_posts: Boolean(record(media.paging)?.next), posts: batch.updates.map(({ content_hash: _hash, capture_native_id: _capture, evidence_pointer: _pointer, ...facts }) => facts) });
  if (!batch.updates.length) return finish("blocked", "empty_unverified", "Instagram returned no validated posts; this does not establish nothing new");
  if (invalid || childPartial) return finish("partial", "incomplete_post_metadata", "Instagram returned malformed/duplicate posts or incomplete child metadata; valid rows retained, cursor unchanged");
  if ((batch.providerReportedMediaCount !== null && batch.providerReportedMediaCount < batch.updates.length) || (batch.updates.length < 25 && batch.providerReportedMediaCount !== batch.updates.length)) return finish("partial", "bounded_window_incomplete", "Instagram returned fewer than the requested 25 posts without a matching account total; valid rows retained and bounded-window completeness is unverified");
  batch.observations.paginationComplete = true; // Complete requested latest25 snapshot, explicitly not full history.
  batch.cursor = { scope: instagramScope, history_complete: false, parent_limit: 25, observed_at: now().toISOString(), latest_published_at: batch.updates.reduce((latest, post) => post.published_at > latest ? post.published_at : latest, batch.updates[0].published_at) };
  return finish("success", null, null);

  function addCapture(projection: unknown) {
    const body = JSON.stringify(projection) + "\n";
    const page: RawPage = { nativeId: "latest25", url: `https://www.instagram.com/${handle}/`, contentType: "application/json", body, sha256: sha256(body), byteCount: Buffer.byteLength(body), fetchedAt: now().toISOString(), httpStatus: response.status };
    batch.pages.push(page);
  }
}
