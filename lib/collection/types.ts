/** Runtime collection contract. Raw page bodies are private and must never be logged. */
export interface RawPage {
  nativeId: string;
  url: string;
  contentType: string;
  body: string;
  sha256: string;
  byteCount: number;
  fetchedAt: string;
  httpStatus: number;
}

export interface NormalizedOccurrence {
  nativeId: string;
  opportunityNativeId: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  timezone: string | null;
  sourceLocalText: string | null;
  datePrecision: "instant" | "date" | "unknown";
  location: string | null;
  allDay: boolean;
  lifecycle: "scheduled" | "cancelled" | "postponed" | "unknown";
  contentSha256: string;
  captureNativeId: string;
  evidencePointer: string;
}

export interface NormalizedOpportunity {
  nativeId: string;
  title: string;
  description: string | null;
  sourceUrl: string;
  kind: "event";
  campusRelation: "campus" | "fsu_affiliated" | "unknown";
  categories: string[];
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  uncertainties: string[];
  contentSha256: string;
  captureNativeId: string;
  evidencePointer: string;
}

export interface CollectionBatch {
  sourceId: string;
  parserVersion: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "partial" | "failed" | "blocked" | "rate_limited";
  reason: string | null;
  retryAfterSeconds: number | null;
  pages: RawPage[];
  opportunities: NormalizedOpportunity[];
  occurrences: NormalizedOccurrence[];
  cursor: Record<string, unknown> | null;
  observations: {
    requests: number;
    httpStatuses: number[];
    bytes: number;
    nativeRows: number;
    paginationComplete: boolean;
    windowFrom: string | null;
    windowTo: string | null;
    warnings: string[];
  };
}

export interface CollectionOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  startDate?: string;
  days?: number;
  maxPages?: number;
  maxBytes?: number;
  timeoutMs?: number;
}
