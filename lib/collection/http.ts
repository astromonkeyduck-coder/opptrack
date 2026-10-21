import { createHash } from "node:crypto";
import type { RawPage } from "./types";

const HOST_PATHS: Record<string, string[]> = {
  "calendar.fsu.edu": ["/api/2/events"],
  "music.fsu.edu": ["/events/", "/events"],
  "hq.fsu.edu": ["/ical/floridastate/ical_floridastate.ics"],
  "static-prod-us-east-1.campusgroups.com": ["/ical/floridastate/ical_floridastate.ics"],
  "onf.fsu.edu": ["/important-dates"],
  "career.fsu.edu": ["/programs-services/internfsu"],
  "fsu-cre.smapply.us": ["/prog/ds/"],
  "www.openingnights.fsu.edu": ["/events"],
};

export class CollectionFailure extends Error {
  requestCount = 0;
  constructor(
    message: string,
    readonly outcome: "failed" | "blocked" | "rate_limited" = "failed",
    readonly retryAfterSeconds: number | null = null,
    readonly httpStatus: number | null = null,
  ) { super(message); this.name = "CollectionFailure"; }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Sorted object keys prevent JSON object ordering from creating a new fact version. */
export function stableHash(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    }
    return input;
  };
  return sha256(JSON.stringify(canonical(value)));
}

export function parseRetryAfter(value: string | null, now = new Date()): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) {const seconds=Number(value);return Number.isSafeInteger(seconds)?seconds:null;}
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - now.getTime()) / 1000)) : null;
}

/** Retry-After is a floor. Jitter avoids synchronized retries after a provider outage. */
export function retryDelaySeconds(failures: number, retryAfter: number | null, random = Math.random): number {
  const exponential = Math.min(21_600, 30 * 2 ** Math.min(10, Math.max(0, failures)));
  const jitter = Math.floor(exponential * (0.5 + random() * 0.5));
  return Math.max(retryAfter ?? 0, jitter);
}

export function assertCollectorUrl(value: string): URL {
  const url = new URL(value);
  const ticketDetail = url.hostname === "www.openingnights.fsu.edu" && /^\/show-details\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname);
  const knownPath = HOST_PATHS[url.hostname]?.includes(url.pathname) || ticketDetail;
  const constrained = ["onf.fsu.edu", "career.fsu.edu", "www.openingnights.fsu.edu"].includes(url.hostname);
  const creQuery = url.hostname === "fsu-cre.smapply.us";
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !knownPath
    || (constrained && (url.search || url.hash))
    || (creQuery && (url.hash || [...url.searchParams.keys()].some(key => !["page", "base_query"].includes(key))
      || url.searchParams.getAll("page").length !== 1 || !/^[12]$/.test(url.searchParams.get("page") || "")
      || url.searchParams.getAll("base_query").length !== 1 || url.searchParams.get("base_query") !== "all"))) {
    throw new CollectionFailure("Collector redirect or URL is outside its exact public source allowlist", "blocked");
  }
  return url;
}

export async function fetchPage(urlString: string, nativeId: string, options: {
  fetch: typeof globalThis.fetch; maxBytes: number; timeoutMs: number; now: () => Date;
}): Promise<{ page: RawPage; requests: number }> {
  let url = assertCollectorUrl(urlString);
  let requests = 0;
  const timeout = AbortSignal.timeout(options.timeoutMs);
  try {
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response: Response;
    try {
      requests++;
      response = await options.fetch(url, {
        method: "GET", redirect: "manual", signal: timeout,
        headers: {
          "User-Agent": "FSUOpportunityTracker/0.1-stage1 (personal read-only campus discovery; no RSVP or calendar actions)",
          Accept: "application/json,text/calendar;q=0.95,text/html;q=0.9",
        },
      });
    } catch {
      throw new CollectionFailure("Source transport failed or timed out; collection was not empty");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new CollectionFailure("Source redirect limit exceeded or target missing", "blocked");
      url = assertCollectorUrl(new URL(location, url).href);
      continue;
    }
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel();
      throw new CollectionFailure(`Source returned HTTP ${response.status}`, "rate_limited", parseRetryAfter(response.headers.get("retry-after"), options.now()), response.status);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CollectionFailure(`Source returned HTTP ${response.status}`, [401, 403].includes(response.status) ? "blocked" : "failed", null, response.status);
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > options.maxBytes) {
      await response.body?.cancel();
      throw new CollectionFailure("Source response exceeds configured private capture byte limit");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new CollectionFailure("Source response has no body");
    const chunks: Uint8Array[] = [];
    let byteCount = 0;
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch { throw new CollectionFailure("Source response body was interrupted; collection is incomplete"); }
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > options.maxBytes) { await reader.cancel(); throw new CollectionFailure("Source response exceeds configured private capture byte limit"); }
      chunks.push(chunk.value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { page: { nativeId, url: url.href, contentType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream", body, sha256: sha256(body), byteCount, fetchedAt: options.now().toISOString(), httpStatus: response.status }, requests };
  }
  throw new CollectionFailure("Unreachable redirect state");
  } catch (error) {
    if(error instanceof CollectionFailure)error.requestCount=requests;
    throw error;
  }
}
