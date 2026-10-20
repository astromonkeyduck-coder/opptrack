# Stage 1 database contract

Implementation contract (Stage 1 authorized October 20, 2026). Calendar writes have no endpoint, table or provider scope.

`tracker_members(user_id uuid primary key)` is a service-only single-owner allowlist. Empty means deny all authenticated access. `scripts/setup-owner.mjs` explicitly registers an existing Supabase Auth user ID using the server secret; browser signup cannot claim ownership.

All public tables use `owner_id uuid`, `(id, owner_id)` ownership keys and RLS. Authenticated members can read their rows; normalized facts/health are service-only writes. The `record_decision(p_occurrence_id uuid, p_action text, p_expected_revision integer)` RPC permits only `save` or `reject`, preserving append-only decisions and rejecting stale revisions. `submit_manual_intake(p_source_url text, p_note text, p_media jsonb,p_submission_key uuid default null)` creates a pending-verification manual intake for the caller; validation/egress is also enforced by the web route. Storage bucket `captures` is private, paths `<owner uuid>/<object name>`, authenticated owner reads/uploads permitted only under that prefix. No public URLs.

## Worker API

Service key only. `lease_due_sources(p_limit integer DEFAULT 2, p_lease_seconds integer DEFAULT 300)` returns source rows with `lease_token uuid`, claiming expired/due sources atomically. Source IDs are registry text IDs; `sources` includes owner_id, adapter, url, enabled, cadence_seconds, cursor jsonb, next_due_at, lease_until, lease_token, last_attempt_at, last_success_at, consecutive_failures, health_status, health_message, coverage_note.

`complete_source_run(p_source_id text, p_lease_token uuid, p_batch jsonb)` atomically records a run, deduplicated captures/versions, opportunities/occurrences/claims, and advances cursor only for `outcome=success` and `pagination_complete=true`. Failures preserve old cursor/last success, record their reason and schedule retry. Mismatched/expired lease is rejected. A successful empty feed still requires at least one capture and explicit complete pagination.

Batch shape:

```json
{
  "outcome":"success", "pagination_complete":true,
  "started_at":"2026-10-20T12:00:00Z", "finished_at":"2026-10-20T12:00:05Z",
  "http_status":200, "request_count":1, "byte_count":123,
  "parser_version":"localist-v1", "error":null,
  "retry_after_seconds":null, "cursor_after":{}, "window":{},
  "captures":[{"native_id":"page:1", "source_url":"https://calendar.fsu.edu/api/2/events", "content_sha256":"64 hex chars", "storage_path":"owner/optional-private-raw-object.json", "content_type":"application/json", "byte_count":123, "excerpt":null, "fetched_at":"2026-10-20T12:00:01Z"}],
  "opportunities":[{"native_id":"123", "title":"Actual source title", "description":"Plain text", "source_url":"https://calendar.fsu.edu/event/example", "categories":[], "campus_relation":"campus", "capture_native_id":"page:1", "content_sha256":"64 hex chars", "uncertainties":["Ticket availability unverified"], "claims":[]}],
  "occurrences":[{"native_id":"456", "opportunity_native_id":"123", "starts_at":"2026-10-20T23:00:00Z", "ends_at":null, "local_start_text":null, "timezone":"America/New_York", "date_precision":"instant", "location":null, "status":"scheduled", "content_sha256":"64 hex chars", "capture_native_id":"page:1", "claims":[]}],
  "milestones":[]
}
```

Claims are `{field, value, evidence_pointer}` and use the parent entity capture. No invented facts: missing times/locations stay null. `opportunities` unique owner/source/native ID; occurrences independently unique owner/source/native ID. Every distinct hash adds an immutable `entity_versions` row; replay does not revise unchanged entities or remove decisions. Captures unique owner/source/native ID/hash, with `run_captures` recording every observation, including unchanged replay. JSON `window` records queried bounds; no claims of complete campus coverage.

UI tables: `sources`, `source_runs`, `captures`, `opportunities`, `occurrences`, `milestones`, `field_claims`, `user_decisions`, `manual_intakes`. The `review_inbox` security-invoker view joins current occurrence facts, opportunity title/description/categories/uncertainties/source_url, source health/timestamps/cadence (`source_cadence_seconds`)/coverage and latest decision. Search can use `.ilike('title', '%query%')`/description initially; indexed `search_document` supports PostgreSQL full text. Opportunity-only manual intake stays visible via `manual_intakes` until human verified.

Manual intake accepts at most 8 files, 5 MiB each, 20 MiB combined, with PNG/JPEG/WebP/PDF MIME and app-side signature validation. Links are HTTPS with no embedded credentials and are retained without fetching. Notes are at most 5,000 characters. An optional submission UUID deduplicates retries. Private media retention defaults to 7 days (`retention_until`, `media_purged_at`); public raw captures default to 30 days. Normalized facts/claims and decision evidence remain when raw objects are purged. The database does not infer an occurrence from a pending flyer.

Fresh re-observation of the same capture hash renews public raw retention to 30 days after that fetch. If a raw object was purged, a confirmed new upload restores the private path and clears its purge marker while retaining the original capture ID, normalized identities and unique content versions.

`purge_candidates(p_limit integer default 100)` is service-only and returns `{owner_id,storage_path,candidate_reason,object_created_at}` for expired references or aged orphans under the configured owner prefix. Active capture or manual-media references protect a shared path. It only plans; production object deletion stays disabled pending hosted refresh/deletion race and restore verification. Local deletion semantics were exercised separately on test objects.
