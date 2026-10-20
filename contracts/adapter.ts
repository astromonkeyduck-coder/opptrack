/** Stage 0 design contracts. No collector, database, OAuth, or calendar implementation. */
export type Id = string;
export type ISOInstant = string; // RFC3339 with offset; validate at runtime in Stage 1.
export type ISODate = string; // YYYY-MM-DD; never means midnight by itself.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type AccessClass = "public" | "member" | "permissioned" | "manual";
export type SourceStatus = "verified_operational" | "documented_but_untested" | "blocked" | "manual_only" | "unsupported";

export interface Source {
  id: Id;
  ownerId: Id;
  organizationId: Id | null;
  url: string;
  affiliationEvidenceUrls: string[];
  accessClass: AccessClass;
  status: SourceStatus;
  adapter: string;
  credentialRef: string | null; // Server-side reference only; never the secret/token.
  enabled: boolean;
  cadenceSeconds: number | null; // null for disabled/manual sources; registry minutes × 60.
  nextDueAt: ISOInstant | null;
  lastAttemptAt: ISOInstant | null;
  lastSuccessAt: ISOInstant | null;
  consecutiveFailures: number;
  cursor: Json;
  expectedFormat: string;
  verifiedAt: ISOInstant | null;
  leaseUntil: ISOInstant | null;
}

export interface Capture {
  id: Id;
  ownerId: Id;
  sourceId: Id;
  runId: Id;
  nativeId: string | null;
  sourceUrl: string;
  contentSha256: string;
  privateObjectKey: string | null;
  excerpt: string | null;
  media: Array<{ index: number; mimeType: string; privateObjectKey: string | null; sourceUrl: string; fetchedAt: ISOInstant | null }>;
  mediaCompleteness: "complete" | "partial" | "unknown";
  publishedAt: ISOInstant | null;
  sourceUpdatedAt: ISOInstant | null;
  firstSeenAt: ISOInstant;
  fetchedAt: ISOInstant;
  accessClass: AccessClass;
  parserVersion: string;
  retainUntil: ISOInstant;
}

export interface FetchWindow { from: ISOInstant; to: ISOInstant }
export interface CollectRequest {
  source: Readonly<Source>;
  runId: Id;
  window: FetchWindow | null;
  cursor: Json;
  maxRequests: number;
  maxBytes: number;
  deadlineAt: ISOInstant;
  signal: AbortSignal;
}
export interface RunObservations {
  requests: number;
  bytes: number;
  nativeRecordsSeen: number | null;
  paginationComplete: boolean;
  windowCovered: FetchWindow | null;
  providerCostUsd: number | null; // null is unknown; 0 is a measured zero charge.
  costBasis: "measured" | "estimated" | "unknown";
  httpStatuses: number[];
  warnings: string[];
}
export type CollectResult =
  | { outcome: "success"; captures: Capture[]; nextCursor: Json; observations: RunObservations }
  | { outcome: "partial"; captures: Capture[]; nextCursor: null; observations: RunObservations; reason: string }
  | { outcome: "blocked" | "failed" | "rate_limited"; captures: []; nextCursor: null; observations: RunObservations; reason: string; retryAfterSeconds: number | null }
  | { outcome: "not_modified"; captures: []; nextCursor: Json; observations: RunObservations; validatedPriorRunId: Id };

export interface ReadOnlyCollector {
  id: string;
  version: string;
  collect(request: CollectRequest): Promise<CollectResult>;
}

export type EvidencePointer =
  | { captureId: Id; kind: "text"; start: number; end: number }
  | { captureId: Id; kind: "json"; jsonPointer: string }
  | { captureId: Id; kind: "image"; slideIndex: number; region: [number, number, number, number] | null }
  | { captureId: Id; kind: "video"; seconds: number; endSeconds: number | null };

export type FactTime =
  | { precision: "instant"; value: ISOInstant; timezone: string; sourceLocalText: string }
  | { precision: "date"; value: ISODate; timezone: string; sourceLocalText: string }
  | { precision: "unknown"; value: null; timezone: string | null; sourceLocalText: string | null };

export interface FieldClaim {
  id: Id;
  ownerId: Id;
  subject: { kind: "opportunity" | "occurrence" | "milestone"; id: Id };
  field: string;
  value: Json;
  evidence: EvidencePointer[]; // At least one, enforced at validation/database boundary.
  authority: "organizer" | "ticket_provider" | "official_aggregate" | "third_party" | "user_correction";
  observedAt: ISOInstant;
  sourcePublishedAt: ISOInstant | null;
  extractorVersion: string;
  promptVersion: string | null;
  modelId: string | null;
  resolution: "candidate" | "selected" | "conflicting" | "superseded";
}

export interface Opportunity {
  id: Id;
  ownerId: Id;
  kind: "event" | "program" | "application" | "evergreen_resource" | "club";
  title: string;
  organizationIds: Id[];
  categories: string[];
  campusRelation: "campus" | "fsu_affiliated" | "off_campus" | "unknown";
  revision: number;
  reviewState: "unreviewed" | "needs_verification" | "reviewable";
}

export interface Occurrence {
  id: Id;
  ownerId: Id;
  opportunityId: Id;
  nativeInstanceKey: string | null; // Native event instance ID or UID + RECURRENCE-ID.
  seriesKey: string | null;
  originalStart: FactTime | null; // Preserve identity when a recurring instance moves.
  start: FactTime;
  end: FactTime;
  doors: FactTime;
  location: string | null;
  lifecycle: "scheduled" | "cancelled" | "postponed" | "unknown";
  dateConflict: boolean;
  revision: number;
}

export interface Milestone {
  id: Id;
  ownerId: Id;
  opportunityId: Id;
  occurrenceId: Id | null;
  kind: "ticket_release" | "registration_open" | "application_close" | "audition" | "waitlist" | "other_action";
  at: FactTime;
  availability: "available" | "sold_out" | "waitlist" | "closed" | "unknown";
  actionUrl: string | null;
  dateConflict: boolean;
  revision: number;
}

export interface ExtractRequest {
  captures: ReadonlyArray<Capture>;
  sourceTimezone: string | null;
  extractorVersion: string;
}
export interface ExtractResult {
  opportunities: Opportunity[]; // Empty is valid for irrelevant material.
  occurrences: Occurrence[];
  milestones: Milestone[];
  claims: FieldClaim[];
  issues: Array<{ code: string; captureId: Id; detail: string }>;
  mediaProcessed: Array<{ captureId: Id; slideIndex: number }>;
}
export interface Extractor { extract(request: ExtractRequest): Promise<ExtractResult> }

export type CalendarTarget = { kind: "occurrence" | "milestone"; id: Id; revision: number };
export interface UserDecision {
  id: Id;
  ownerId: Id;
  target: CalendarTarget;
  action: "save" | "not_this_time" | "less_like_this" | "approve_calendar" | "revoke_calendar";
  createdAt: ISOInstant;
  approvedSnapshot: CalendarSnapshot | null;
  supersedesDecisionId: Id | null;
}
export interface CalendarSnapshot {
  title: string;
  description: string;
  location: string | null;
  timing:
    | { kind: "timed"; start: ISOInstant; end: ISOInstant; timezone: string; endBasis: "source" | "user_confirmed_estimate" }
    | { kind: "all_day"; date: ISODate; endDateExclusive: ISODate; deadlineTimeUnknown: boolean };
  claimIds: Id[];
  userAdjustments: Array<{ field: string; value: Json; confirmedAt: ISOInstant }>;
  payloadSha256: string;
}
export interface CalendarOutboxEntry {
  id: Id;
  ownerId: Id;
  connectionId: Id;
  decisionId: Id;
  target: CalendarTarget;
  command: "calendar_create" | "calendar_update" | "calendar_delete";
  actionKey: string; // Database UNIQUE; stable across every retry of this approved action.
  providerEventId: string; // Deterministic allowed Google ID, persisted before network call.
  snapshot: CalendarSnapshot;
  state: "pending" | "leased" | "retry" | "uncertain" | "needs_review" | "needs_reauth" | "succeeded" | "dead_letter" | "superseded";
  attempts: number;
  nextAttemptAt: ISOInstant;
  leaseUntil: ISOInstant | null;
}
// Collection/extraction never receive a calendar writer or mail-sending capability.
// A future writer accepts only an authorized durable outbox entry, not an event candidate.
