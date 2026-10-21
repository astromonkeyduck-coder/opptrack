import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import watchlist from "../../config/instagram-watchlist.json";

export const graphVersion = "v26.0";
export const probeEnvironmentFilename = ".env.instagram.probe.local";
const handles = new Set(watchlist.accounts.map(account => account.handle));
const numericId = /^[0-9]{1,32}$/;
const cursorPattern = /^[A-Za-z0-9_+=/-]{1,2048}$/;
const instant = /(?:Z|[+-][0-9]{2}:?[0-9]{2})$/;
const maxResponseBytes = 262_144;
const environmentTemplate = "# Facebook USER read token and caller Instagram professional account ID.\n# Enter directly; never put credentials in command arguments or chat.\n# The read-only probe pins Graph API v26.0 and does not enable monitoring.\nIG_FB_USER_ACCESS_TOKEN=\nIG_CALLER_USER_ID=\n";

type ProbeStatus = "setup_needed" | "blocked" | "failed" | "rate_limited" | "empty_unverified" | "partial" | "success_sample";
type JsonRecord = Record<string, unknown>;
type PrivateMedia = { id: string; mediaType: string; productType: string | null; timestamp: string; permalink: string; children: Array<{ id: string; mediaType: string }> };
type DiagnosticPage = { page: number; httpStatus: number; responseBytes: number; graphError?: { code: number | null; subcode: number | null }; targetId?: string; media: PrivateMedia[]; mediaPagingRemaining: boolean; childPagingRemaining: number };

export interface PreflightOptions {
  target: string;
  environment?: Record<string, string | undefined>;
  maxPages?: number;
  maxRequests?: number;
  pageSize?: number;
}

export interface PreflightResult {
  summary: {
    probeVersion: string; apiVersion: string; target: string | null; startedAt: string; finishedAt: string;
    status: ProbeStatus; reasonCodes: string[]; missingVariables: string[]; requests: number; pages: number;
    responseBytes: number; httpStatuses: number[]; graphError: { code: number | null; subcode: number | null } | null;
    metadataReturned: boolean; accessSampleProven: boolean; paginationComplete: boolean; sampleOnly: true;
    counts: { providerReportedMediaCount: number | null; returnedMediaRows: number; validUniqueMediaRows: number; invalidMediaRows: number; images: number; videos: number; reels: number; carousels: number; children: number; childPagesRemaining: number };
    storiesTested: false; automaticMonitoringEnabled: false;
  };
  privateDiagnostics: { evidenceKind: string; losslessRawCapture: false; excludedFields: string[]; pages: DiagnosticPage[] };
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function validId(value: unknown): value is string {
  return typeof value === "string" && numericId.test(value);
}
function mediaType(value: unknown): value is string {
  return value === "IMAGE" || value === "VIDEO" || value === "CAROUSEL_ALBUM";
}
function permalink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["www.instagram.com", "instagram.com"].includes(url.hostname) || url.username || url.password || (url.port && url.port !== "443") || !/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    // Drop all query/fragment data, including provider-returned bearer parameters.
    return `https://www.instagram.com${url.pathname}`;
  } catch { return null; }
}
function continuation(value: unknown) {
  const paging = record(value);
  const after = record(paging?.cursors)?.after;
  return { more: Boolean(paging?.next), after: typeof after === "string" && cursorPattern.test(after) ? after : null };
}

/** One fixed Graph node; no provider URL or endpoint can control the request. */
export function discoveryRequestUrl(callerId: string, target: string, pageSize: number, after: string | null = null): URL {
  if (!numericId.test(callerId) || !handles.has(target) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25 || (after !== null && !cursorPattern.test(after))) throw new Error("Invalid bounded Business Discovery request");
  const media = `media${after ? `.after(${after})` : ""}.limit(${pageSize}){id,media_type,media_product_type,timestamp,permalink,children.limit(20){id,media_type}}`;
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${callerId}`);
  url.searchParams.set("fields", `id,business_discovery.username(${target}){id,username,media_count,${media}}`);
  return url;
}

/** Read-only, bounded access hypothesis. This is not a scheduled social collector. */
export async function preflightBusinessDiscovery(options: PreflightOptions, dependencies: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<PreflightResult> {
  const now = dependencies.now ?? (() => new Date());
  const environment = options.environment ?? process.env;
  const target = options.target.trim().replace(/^@/, "").toLowerCase();
  const result: PreflightResult = {
    summary: { probeVersion: "business-discovery-preflight-v2", apiVersion: graphVersion, target: handles.has(target) ? target : null, startedAt: now().toISOString(), finishedAt: now().toISOString(), status: "setup_needed", reasonCodes: [], missingVariables: [], requests: 0, pages: 0, responseBytes: 0, httpStatuses: [], graphError: null, metadataReturned: false, accessSampleProven: false, paginationComplete: false, sampleOnly: true, counts: { providerReportedMediaCount: null, returnedMediaRows: 0, validUniqueMediaRows: 0, invalidMediaRows: 0, images: 0, videos: 0, reels: 0, carousels: 0, children: 0, childPagesRemaining: 0 }, storiesTested: false, automaticMonitoringEnabled: false },
    privateDiagnostics: { evidenceKind: "sanitized-diagnostic-projection", losslessRawCapture: false, excludedFields: ["credentials", "Graph paging URLs and cursor values", "error messages", "captions", "media and thumbnail URLs", "unrequested provider fields"], pages: [] },
  };
  const summary = result.summary;
  const finish = (status: ProbeStatus, reason: string) => { summary.status = status; summary.accessSampleProven = summary.counts.validUniqueMediaRows > 0; if (reason && !summary.reasonCodes.includes(reason)) summary.reasonCodes.push(reason); summary.finishedAt = now().toISOString(); return result; };
  if (!handles.has(target)) return finish("blocked", "target_not_in_user_watchlist");
  const maxPages = options.maxPages ?? 1, maxRequests = options.maxRequests ?? 1, pageSize = options.pageSize ?? 5;
  if (![maxPages, maxRequests].every(value => Number.isInteger(value) && value >= 1 && value <= 3) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25) return finish("blocked", "invalid_request_or_page_limit");
  const token = environment.IG_FB_USER_ACCESS_TOKEN?.trim();
  const callerId = environment.IG_CALLER_USER_ID?.trim();
  if (!token) summary.missingVariables.push("IG_FB_USER_ACCESS_TOKEN");
  if (!callerId) summary.missingVariables.push("IG_CALLER_USER_ID");
  if (summary.missingVariables.length) return finish("setup_needed", "credentials_missing_no_request");
  if (!numericId.test(callerId!)) return finish("setup_needed", "caller_instagram_id_must_be_numeric");
  if (!/^[A-Za-z0-9_.~+/=-]{16,4096}$/.test(token!)) return finish("setup_needed", "invalid_token_format_no_request");
  const fetcher = dependencies.fetch ?? fetch;
  const signal = AbortSignal.timeout(25_000);
  const seenIds = new Set<string>(), seenCursors = new Set<string>();
  let providerCountChanged = false;
  let after: string | null = null;
  for (let pageIndex = 0; pageIndex < maxPages && summary.requests < maxRequests; pageIndex++) {
    const url = discoveryRequestUrl(callerId!, target, pageSize, after);
    let response: Response;
    try {
      summary.requests++;
      response = await fetcher(url, { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "FSUOpportunityTracker/0.1 (bounded read-only Instagram access preflight)" } });
    } catch { return finish("failed", "transport_or_timeout_no_empty_success"); }
    summary.httpStatuses.push(response.status);
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => {}); return finish("blocked", "redirect_refused_no_follow"); }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maxResponseBytes) { await response.body?.cancel().catch(() => {}); return finish("failed", "response_byte_limit_exceeded"); }
    const reader = response.body?.getReader();
    if (!reader) return finish("failed", "missing_response_body");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength; summary.responseBytes += part.value.byteLength;
        if (bytes > maxResponseBytes) { await reader.cancel(); return finish("failed", "response_byte_limit_exceeded"); }
        chunks.push(part.value);
      }
    } catch { return finish("failed", "response_body_interrupted"); }
    const diagnostic: DiagnosticPage = { page: pageIndex + 1, httpStatus: response.status, responseBytes: bytes, media: [], mediaPagingRemaining: false, childPagingRemaining: 0 };
    result.privateDiagnostics.pages.push(diagnostic);
    if (response.status === 429 || response.status === 503) return finish("rate_limited", "provider_rate_limit_no_automatic_retry");
    const text = Buffer.concat(chunks).toString("utf8");
    if (response.headers.get("content-type")?.includes("html") || /^\s*</.test(text)) return finish("blocked", "html_or_login_wall_not_media");
    let payload: JsonRecord | null;
    try { payload = record(JSON.parse(text)); } catch { return finish("failed", "non_json_response"); }
    if (!payload) return finish("failed", "invalid_graph_envelope");
    const error = record(payload.error);
    if (error || !response.ok) {
      summary.graphError = error ? { code: safeInteger(error.code), subcode: safeInteger(error.error_subcode) } : null;
      if (summary.graphError) diagnostic.graphError = summary.graphError;
      if (response.status === 429 || response.status === 503 || [4, 17, 32, 613].includes(summary.graphError?.code ?? -1)) return finish("rate_limited", "provider_rate_limit_no_automatic_retry");
      if ([401, 403].includes(response.status) || summary.graphError?.code === 190) return finish("setup_needed", "token_or_authorization_unavailable");
      if (response.status >= 500 || error?.is_transient === true) return finish("failed", "provider_http_or_transient_graph_failure");
      return finish("blocked", "graph_error_or_http_failure");
    }
    if (payload.id !== callerId) return finish("blocked", "caller_response_identity_mismatch");
    const business = record(payload.business_discovery);
    if (!business) return finish("blocked", "target_unavailable_or_ineligible_unverified");
    if (!validId(business.id) || typeof business.username !== "string" || business.username.toLowerCase() !== target) return finish("blocked", "target_response_identity_mismatch");
    summary.metadataReturned = true; diagnostic.targetId = business.id;
    const reportedCount = safeInteger(business.media_count);
    if (reportedCount !== null) {
      if (summary.counts.providerReportedMediaCount !== null && summary.counts.providerReportedMediaCount !== reportedCount) providerCountChanged = true;
      summary.counts.providerReportedMediaCount = reportedCount;
    }
    const media = record(business.media);
    if (!media || !Array.isArray(media.data)) return finish("partial", "nested_media_edge_missing_or_invalid");
    summary.pages++;
    summary.counts.returnedMediaRows += media.data.length;
    if (media.data.length > pageSize) return finish("partial", "media_page_exceeds_requested_item_limit");
    const page = continuation(media.paging);
    diagnostic.mediaPagingRemaining = page.more;
    for (const value of media.data) {
      const row = record(value);
      const link = permalink(row?.permalink);
      const timestamp = row?.timestamp;
      if (!row || !validId(row.id) || !mediaType(row.media_type) || typeof timestamp !== "string" || !instant.test(timestamp) || !Number.isFinite(Date.parse(timestamp)) || !link || link.includes(token!) || link.includes(encodeURIComponent(token!))) { summary.counts.invalidMediaRows++; continue; }
      if (seenIds.has(row.id)) return finish("partial", "duplicate_media_identity_or_repeated_page");
      seenIds.add(row.id);
      const children = record(row.children);
      const childItems: PrivateMedia["children"] = [];
      if (row.media_type === "CAROUSEL_ALBUM") {
        if (!children || !Array.isArray(children.data) || children.data.length === 0 || children.data.length > 20) { summary.counts.invalidMediaRows++; continue; }
        const childIds = new Set<string>();
        for (const childValue of children.data) {
          const child = record(childValue);
          if (!child || !validId(child.id) || !mediaType(child.media_type) || childIds.has(child.id)) { summary.counts.invalidMediaRows++; continue; }
          childIds.add(child.id); childItems.push({ id: child.id, mediaType: child.media_type });
        }
        if (continuation(children.paging).more) { diagnostic.childPagingRemaining++; summary.counts.childPagesRemaining++; }
      }
      const product = typeof row.media_product_type === "string" && ["REELS", "FEED", "STORY", "AD"].includes(row.media_product_type) ? row.media_product_type : null;
      diagnostic.media.push({ id: row.id, mediaType: row.media_type, productType: product, timestamp, permalink: link, children: childItems });
      summary.counts.validUniqueMediaRows++;
      if (row.media_type === "IMAGE") summary.counts.images++;
      if (row.media_type === "VIDEO") summary.counts.videos++;
      if (product === "REELS") summary.counts.reels++;
      if (row.media_type === "CAROUSEL_ALBUM") summary.counts.carousels++;
      summary.counts.children += childItems.length;
    }
    summary.accessSampleProven = summary.counts.validUniqueMediaRows > 0;
    if (summary.counts.invalidMediaRows) return finish("partial", "media_or_child_fields_missing_invalid_or_duplicated");
    if (summary.counts.childPagesRemaining) return finish("partial", "nested_child_pagination_unconsumed");
    if (!page.more) {
      // A missing paging.next only describes what this response advertised. In
      // nested Business Discovery samples it can be absent despite a larger
      // media_count; do not turn that omission into a full-pagination claim.
      const knownCount = summary.counts.providerReportedMediaCount;
      if (providerCountChanged || (knownCount !== null && knownCount < summary.counts.validUniqueMediaRows)) summary.reasonCodes.push("provider_media_count_inconsistent_pagination_unverified");
      else if (knownCount === null) summary.reasonCodes.push(media.data.length === pageSize ? "item_limit_reached_without_continuation_or_total" : "provider_media_count_missing_pagination_unverified");
      else if (knownCount > summary.counts.validUniqueMediaRows) summary.reasonCodes.push("provider_media_count_exceeds_sample_without_continuation");
      else {
        summary.paginationComplete = true;
        summary.reasonCodes.push("provider_media_count_matches_returned_rows_no_advertised_remainder");
      }
      return summary.accessSampleProven ? finish("success_sample", "bounded_media_sample_only") : finish("empty_unverified", "empty_media_does_not_prove_no_new_content");
    }
    if (!page.after || page.after.includes(token!) || page.after.includes(encodeURIComponent(token!)) || seenCursors.has(page.after)) return finish("partial", "media_cursor_missing_invalid_or_repeated");
    seenCursors.add(page.after); after = page.after;
  }
  return finish("partial", "request_or_page_cap_reached_more_media_unconsumed");
}

/** Exclusive create never reads or overwrites an existing credential file. */
export async function initializeProbeEnvironment(root = process.cwd()): Promise<"created" | "already_exists"> {
  try { await writeFile(path.join(root, probeEnvironmentFilename), environmentTemplate, { flag: "wx", mode: 0o600 }); return "created"; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return "already_exists"; throw new Error("Private probe environment initialization failed"); }
}

/** Only sanitized projections are persisted, under ignored private/, with mode 600. */
export async function writePreflightEvidence(result: PreflightResult, root = process.cwd()) {
  const workspace = await realpath(root);
  const privateRoot = path.join(workspace, "private");
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(privateRoot)).isSymbolicLink()) throw new Error("Private evidence directory cannot be a symlink");
  const parent = path.join(privateRoot, "instagram-preflight");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await lstat(parent)).isSymbolicLink()) throw new Error("Private evidence directory cannot be a symlink");
  const directory = path.join(parent, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const diagnostics = JSON.stringify(result.privateDiagnostics, null, 2) + "\n";
  const digest = createHash("sha256").update(diagnostics).digest("hex");
  await writeFile(path.join(directory, "diagnostic.json"), diagnostics, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(directory, "summary.json"), JSON.stringify({ ...result.summary, diagnosticSha256: digest, diagnosticHashBasis: "Sanitized diagnostic JSON bytes; not raw HTTP response bytes", losslessRawCapture: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { filesWritten: 2, directory };
}
