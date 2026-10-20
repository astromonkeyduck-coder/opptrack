import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { collectSource, validateCollectionBatch } from "../collection";
import type { CollectionBatch } from "../collection/types";
import { isDuplicateObject, verifyStoredObject } from "../storage/integrity";

export interface SourceLease {
  id: string;
  owner_id: string;
  lease_token: string;
  consecutive_failures?: number;
}

export interface DispatcherProvenance {
  triggerRunId?: string;
  scheduledAt?: string;
  scheduleId?: string;
  invocationKind: "scheduled" | "manual" | "replay" | "local";
}

export class WorkerSetupNeeded extends Error {
  constructor() {
    super("Setup needed: tracker owner is not configured; no source collection was started");
    this.name = "WorkerSetupNeeded";
  }
}

export function getWorkerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Setup needed: Supabase URL and server secret are missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Metadata/cursor commit is one SQL transaction, after immutable private object upload. */
export function toDatabaseBatch(lease: SourceLease, batch: CollectionBatch, provenance?: DispatcherProvenance) {
  batch = validateCollectionBatch(batch);
  if (batch.sourceId !== lease.id) throw new Error("Collection source does not match lease");
  const path = (sha: string) => `${lease.owner_id}/sources/${lease.id}/${sha}.raw`;
  return {
    trigger_run_id: provenance?.triggerRunId ?? null,
    dispatcher_scheduled_at: provenance?.scheduledAt ?? null,
    trigger_schedule_id: provenance?.scheduleId ?? null,
    invocation_kind: provenance?.invocationKind ?? "local",
    outcome: batch.status,
    pagination_complete: batch.observations.paginationComplete,
    started_at: batch.startedAt,
    finished_at: batch.finishedAt,
    http_status: batch.observations.httpStatuses.at(-1) ?? null,
    request_count: batch.observations.requests,
    byte_count: batch.observations.bytes,
    parser_version: batch.parserVersion,
    error: batch.reason,
    retry_after_seconds: batch.retryAfterSeconds,
    cursor_after: batch.cursor,
    window: { from: batch.observations.windowFrom, to: batch.observations.windowTo, native_rows: batch.observations.nativeRows, warnings: batch.observations.warnings },
    captures: batch.pages.map(page => ({
      native_id: page.nativeId, source_url: page.url, content_sha256: page.sha256,
      storage_path: path(page.sha256), content_type: page.contentType,
      byte_count: page.byteCount, excerpt: null, fetched_at: page.fetchedAt,
    })),
    opportunities: batch.opportunities.map(item => ({
      native_id: item.nativeId, title: item.title, description: item.description,
      source_url: item.sourceUrl, categories: item.categories, campus_relation: item.campusRelation,
      source_published_at: item.sourcePublishedAt, source_updated_at: item.sourceUpdatedAt,
      capture_native_id: item.captureNativeId, content_sha256: item.contentSha256,
      uncertainties: item.uncertainties,
      claims: ["title", "description", "source_url"].map(field => ({
        field, value: field === "title" ? item.title : field === "description" ? item.description : item.sourceUrl,
        evidence_pointer: item.evidencePointer,
      })),
    })),
    occurrences: batch.occurrences.map(item => ({
      native_id: item.nativeId, opportunity_native_id: item.opportunityNativeId,
      starts_at: item.startAt, ends_at: item.endAt, start_date: item.startDate,
      local_start_text: item.sourceLocalText, timezone: item.timezone,
      date_precision: item.datePrecision, all_day: item.allDay,
      location: item.location, status: item.lifecycle,
      content_sha256: item.contentSha256, capture_native_id: item.captureNativeId,
      claims: [
        { field: "start", value: item.startAt ?? item.startDate, evidence_pointer: item.evidencePointer },
        { field: "end", value: item.endAt, evidence_pointer: item.evidencePointer },
        { field: "location", value: item.location, evidence_pointer: item.evidencePointer },
      ],
    })),
    milestones: [],
  };
}

export async function ingestCollectedBatch(lease: SourceLease, batch: CollectionBatch, client = getWorkerClient(), provenance?: DispatcherProvenance) {
  const payload = toDatabaseBatch(lease, batch, provenance);
  // Paths are content addressed. A retry can reuse an existing immutable object;
  // only a confirmed duplicate is ignored, never a transport/auth failure.
  for (let i = 0; i < batch.pages.length; i++) {
    const page = batch.pages[i];
    const result = await client.storage.from("captures").upload(payload.captures[i].storage_path, Buffer.from(page.body), {
      contentType: page.contentType, upsert: false,
    });
    if (result.error) {
      if (!isDuplicateObject(result.error)) throw new Error("Private capture upload failed; cursor was not advanced");
      await verifyStoredObject(client, payload.captures[i].storage_path, page.sha256, Buffer.byteLength(page.body));
    }
  }
  const { data, error } = await client.rpc("complete_source_run", {
    p_source_id: lease.id, p_lease_token: lease.lease_token, p_batch: payload,
  });
  if (error) throw new Error(`Capture transaction failed (${error.code ?? "database"}); cursor was not advanced`);
  return data;
}

export async function runLeasedCollection(lease: SourceLease, client = getWorkerClient(), provenance?: DispatcherProvenance) {
  const batch = await collectSource(lease.id);
  // A source failure is a durable run and retry time, not an infrastructure exception.
  const committed = await ingestCollectedBatch(lease, batch, client, provenance);
  return { sourceId: lease.id, sourceRunId: (committed as { run_id?: string } | null)?.run_id ?? null, outcome: batch.status, opportunities: batch.opportunities.length, occurrences: batch.occurrences.length, requests: batch.observations.requests };
}

export async function dispatchDueSources(limit = 2, client = getWorkerClient(), provenance?: DispatcherProvenance) {
  const { data, error } = await client.rpc("lease_due_sources", { p_limit: Math.min(2, Math.max(1, limit)), p_lease_seconds: 600 });
  if (error) throw new Error(`Source leasing failed (${error.code ?? "database"})`);
  if (!data?.length) {
    // An empty owner allowlist also produces zero leases. Distinguish setup from
    // an established private tracker with no sources currently due.
    const { data: members, error: readinessError } = await client.from("tracker_members").select("user_id").limit(1);
    if (readinessError) throw new Error(`Tracker owner readiness check failed (${readinessError.code ?? "database"})`);
    if (!Array.isArray(members)) throw new Error("Tracker owner readiness check returned an invalid response");
    if (!members.length) throw new WorkerSetupNeeded();
    return [];
  }
  const results = [];
  for (const lease of (data ?? []) as SourceLease[]) {
    try {
      results.push(await runLeasedCollection(lease, client, provenance));
    } catch {
      // Leave the lease intact on infrastructure/storage/transaction failures. It
      // expires and is recovered; never mark a failed persistence as collection success.
      results.push({ sourceId: lease.id, outcome: "infrastructure_failure", reason: "Capture persistence failed; lease will expire and retry" });
    }
  }
  if (results.some(result => result.outcome === "infrastructure_failure")) throw new Error("One or more source runs could not persist; retry after lease recovery");
  return results;
}
