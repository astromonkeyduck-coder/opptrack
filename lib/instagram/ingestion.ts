import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkerClient, toDatabaseBatch, type DispatcherProvenance, type SourceLease } from "../ingestion";
import { isDuplicateObject, verifyStoredObject } from "../storage/integrity";
import { stableHash } from "../collection/http";
import { collectInstagram, instagramHandles, instagramScope, type InstagramBatch } from "./collector";

export function toInstagramDatabaseBatch(lease: SourceLease, batch: InstagramBatch, provenance?: DispatcherProvenance) {
  const base = toDatabaseBatch(lease, batch, provenance);
  if (!instagramHandles.has(lease.id.replace(/^instagram-/, "")) || batch.updates.length > 25 || batch.opportunities.length || batch.occurrences.length) throw new Error("Invalid Instagram persistence boundary");
  const seen = new Set<string>();
  for (const update of batch.updates) {
    const { content_hash: hash, capture_native_id: captureId, evidence_pointer: pointer, ...facts } = update;
    if (seen.has(update.native_id) || stableHash(facts) !== hash || !/^\/posts\/\d+$/.test(pointer)) throw new Error("Invalid Instagram version identity or content hash");
    seen.add(update.native_id);
    const capture = batch.pages.find(page => page.nativeId === captureId);
    if (!capture) throw new Error("Instagram update references missing private evidence");
    const stored = JSON.parse(capture.body)?.posts?.[Number(pointer.split("/").at(-1))];
    if (stableHash(stored) !== hash) throw new Error("Instagram post evidence does not match normalized facts");
  }
  return { ...base, window: { ...base.window, scope: instagramScope, history_complete: false, parent_limit: 25, child_limit: 20, media_downloaded: false, stories_collected: false, failure_category: batch.failureCategory, provider_reported_media_count: batch.providerReportedMediaCount, token_expiry_known: batch.tokenExpiryKnown }, captures: base.captures.map(capture => ({ ...capture, evidence_kind: "sanitized_api_projection" })), updates: batch.updates };
}

/** Immutable sanitized evidence upload followed by one atomic run/version transaction. */
export async function ingestInstagramBatch(lease: SourceLease, batch: InstagramBatch, client: SupabaseClient = getWorkerClient(), provenance?: DispatcherProvenance) {
  const payload = toInstagramDatabaseBatch(lease, batch, provenance);
  for (let i = 0; i < batch.pages.length; i++) {
    const page = batch.pages[i];
    const result = await client.storage.from("captures").upload(payload.captures[i].storage_path, Buffer.from(page.body), { contentType: page.contentType, upsert: false });
    if (result.error) {
      if (!isDuplicateObject(result.error)) throw new Error("Private Instagram capture upload failed; cursor unchanged");
      await verifyStoredObject(client, payload.captures[i].storage_path, page.sha256, page.byteCount);
    }
  }
  const { data, error } = await client.rpc("complete_instagram_run", { p_source_id: lease.id, p_lease_token: lease.lease_token, p_batch: payload });
  if (error) throw new Error(`Instagram capture transaction failed (${error.code ?? "database"}); cursor unchanged`);
  return data;
}

export async function runLeasedInstagramCollection(lease: SourceLease, client: SupabaseClient, provenance?: DispatcherProvenance, environment: Record<string,string|undefined> = process.env) {
  const batch = await collectInstagram(lease.id, { environment });
  const committed = await ingestInstagramBatch(lease, batch, client, provenance);
  return { sourceId: lease.id, sourceRunId: (committed as { run_id?: string } | null)?.run_id ?? null, outcome: batch.status, posts: batch.updates.length, opportunities: 0, occurrences: 0, requests: batch.observations.requests, failureCategory: batch.failureCategory };
}
