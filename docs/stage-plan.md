# Stage plan

Stage 1 is explicitly authorized by the user on October 20, 2026. Stage 0 is preserved at Git tag stage-0-complete. Stop after Stage 1; later stages remain a continuation map, not permission to implement them. The user separately authorized the 17-account Instagram watchlist and Meta setup. That narrow extension does not authorize broader Stage 2 extraction or a completed social pilot; access must be proven per account/format.

| Stage | Deliverable | Gate |
| --- | --- | --- |
| 0 | Source registry, executed public probes, HQ/social feasibility, contracts, evaluation design, costs and coverage gaps | Evidence recorded; failures and unrun routes visible; Stage 1 handoff ready |
| 1 | Small authenticated review inbox using real central calendar, one independent producer, and private manual/inbound intake | Replay-safe ingestion, private storage/RLS, source health; calendar disabled |
| 2 | Evidence extraction, all-slide media handling, time correctness and conservative reconciliation | Human-labeled development/holdout evaluation with reported misses and uncertainty |
| 3 | Useful review/search/recommendation views and durable feedback | Catalog stays searchable; exploration remains visible; occurrence decisions survive duplicates |
| 4 | Email and individually approved calendar writes | Transactional approval/outbox, deterministic provider IDs and failure reconciliation tested |
| 5 | Broader campus discovery and permissioned HQ routes where available | Verified adapters and marginal-source value measured |
| 6 | Social routes that pass a seven-day pilot | Per-account/format evidence and authorized access; gaps retained |
| 7 | Fourteen-day shadow run and production readiness | Reliability, restore, access, costs and missed-event audits pass |

## Stage 1 acceptance criteria

1. On a separately authorized Stage 1 request, install a pinned Next.js/TypeScript app and Supabase migrations in this repository. Use Netlify for production hosting. Configure one private Supabase project, single-user authentication, and separate Netlify/Trigger production variables per docs/deployment.md and config/production-environments.json. Calendar execution stays disabled and no OAuth calendar write scope is requested yet.
2. Replay the Stage 0 central feed and independent Music/producer source evidence; resolve any changed endpoint before activation. Persist captures, native IDs, content versions, source runs, separate event/occurrence/milestone records, evidence pointers, and unresolved facts. If one route is blocked, display that status and use another proven independent campus producer rather than substitute synthetic opportunities.
3. One leased due-source dispatcher uses Trigger.dev; retries honor Retry-After and jitter/backoff. Cursor advancement and capture persistence are atomic. A partial/truncated response fails or stays partial; failed collection cannot become a successful empty result. Last attempt and last success remain separate. No external paid connector is automatically enabled.
4. Authenticated manual flyer/link intake is sufficient initially; Resend inbound may replace or supplement it only after domain/webhook setup. Store uploads privately, validate size/type, prevent SSRF/internal-network redirects, and process all supplied slides. Model extraction is schema-validated, evidence-backed, and budgeted. Deterministic feed facts do not need a model call.
5. A basic mobile-friendly authenticated list/search displays actual collected opportunities, source links, date/location uncertainty, and source freshness. Broad catalog retention precedes ranking; no polished multi-view app is required yet. HQ/social setup-needed routes remain visible.
6. Re-ingestion proves no duplicate versions/occurrences and no lost user decisions. Meaningful checks cover HTTP-200 login walls, malformed feeds, truncated pagination, stale sources, lease/retry behavior, ownership/RLS, private storage, and zero-event captures. Verify migrations against a local/test database, including anonymous and other-user denials; written policies alone do not pass.
7. Record real commands, screenshots of the basic inbox, measured source counts/windows, actual costs or zero usage, remaining gaps, and a fresh-session runbook. Calendar, RSVP, purchase, and organizer messaging paths remain absent/disabled. Stop after Stage 1.

## Current Stage 1 gate (October 20 local / October 21 UTC, 2026)

The hosted path now works: fresh Central and Music HTTP → genuine scheduled Trigger Production worker → private Supabase captures/normalized facts → the real authenticated Netlify inbox. The first scheduled run produced 303 source-scoped opportunities, 342 occurrences and five linked private objects. The owner browser demonstrated real rows, pagination and search. Thirty-two populated hosted PostgreSQL/RLS checks passed; these SQL-role checks remain distinct from browser JWT and Storage HTTP checks.

**Stage 1 is not fully accepted.** Remaining gates include known-object owner/non-owner Storage HTTP and downloaded-body integrity, hosted multi-slide upload/idempotency, occurrence decisions surviving repeated hosted collection, mobile behavior, backup/Storage restore, distributed contention and safe retention/orphan cleanup. The scheduled run occurred while the laptop was active; a user-confirmed powered-off interval is still required. Do not advance to Stage 2.

The 17 Instagram routes are registered disabled/setup-needed, separately from the original 59-route registry. Meta developer registration and user-completed app creation are confirmed; the app is Unpublished. The approved local token and actual read grants now support bounded live samples for 16 accounts; `fsucre` failed with HTTP 400// Graph 110 / subcode 2207013, cause unresolved. This access investigation is not production monitoring: worker credentials/expiry, pagination/media and ingestion remain unconfigured. Arbitrary third-party Stories remain manual-only. See reports/instagram-cli-access.json. See docs/status.md, docs/instagram-monitoring.md and the hosted checklist for evidence and exact boundaries.
