# Architecture decisions — Stage 0

Stage 1 implementation now exists; see docs/status.md and docs/stage-1-db-contract.md for actual local verification and open hosted gates. The Stage 0 design below also describes future components that remain unimplemented.

Decision date: October 20, 2026. These are design decisions; the services are not connected or deployed.

Use Next.js + TypeScript on Netlify for production, as explicitly selected by the user. Keep Supabase Postgres/Auth/private Storage, Trigger.dev Cloud, Resend, and Google Calendar. Netlify automatically supplies its modern OpenNext adapter. Web/server routes run on Netlify; durable collection, extraction and delivery workers deploy independently to Trigger.dev Cloud. Supabase supplies relational transactions, full-text search and ownership controls without a separate search/vector service. Trigger.dev is the single workflow engine. Resend handles outbound delivery and optional signed inbound intake. Google Calendar is a later secondary-calendar adapter with optional separate free/busy consent.

Stage 0 uses Python's standard library for small portable probes and offline validation, without installing the future application. These scripts are research tools, not a competing Python runtime backend. Stage 1 should port only proven parsing behavior into typed source adapters and keep the captured evidence as parser regression inputs.

One dispatcher checks `next_due_at`, acquires per-source leases, and queues bounded work. Platform concurrency and per-provider caps are independent. Native JSON/ICS/RSS then HTML precede browser extraction; long media/browser work belongs in a worker. Store source attempts even on failure, update success timestamps only after a validated durable capture, and advance cursors transactionally. Use overlapping incremental windows plus daily reconciliation and bounded monthly partitions for future backfill.

New evidence → private/public-as-allowed capture with hash/native ID → deterministic parsing or constrained extraction → validated field claims → conservative candidate reconciliation → canonical opportunity/occurrence/milestone with visible conflicts → searchable inbox → separate save/reject/follow/approve decisions. Only an explicit approval can atomically create a calendar outbox entry. The worker then reconciles a deterministic provider event ID and records the calendar link; extraction cannot call it. Exact contracts and ownership boundaries are in [data-model.md](data-model.md) and [adapter.ts](../contracts/adapter.ts).

Use Google `calendar.app.created` when implementing secondary-calendar support; optional conflict checking requests independent least-privilege access. Provider request idempotency supplements database uniqueness and stable event IDs. Do not retry a timeout with a random new ID. Source time changes require renewed review if they affect approved facts. Never silently fill an end time; the user must confirm any estimate before calendar creation.

Operational controls for Stage 1: RLS plus explicit grants on exposed tables, private object storage, short-lived signed evidence URLs, server-only service credentials, narrow signed webhooks, capture retention/deletion, request/body limits, allowlisted outbound adapters, and no arbitrary URL fetch privileges for an extraction model. Source access restrictions propagate into derived records. Starting retention proposal: public raw captures 30 days, minimized public evidence excerpts 90 days, and private/ephemeral intake 7 days after processing unless explicitly saved and permitted; metadata/claims retained as permitted, deletion cascades to private derived content. Confirm source terms and user retention preferences before production.

No Firecrawl, Apify actor execution, RSSHub, changedetection.io, Langfuse, Kafka, Kubernetes, native app, or second workflow service is installed. Optional components need a measured gap, supported access, license review, and a budget before activation. Do not rely on GitHub Actions as the deadline-sensitive production scheduler; use it for deterministic checks.

See [production deployment](deployment.md), `netlify.toml`, and `config/production-environments.json` for separate Netlify/Trigger production variable contracts. The blank templates and executable validator are prepared; no hosted values have been applied.

## Primary references checked October 20, 2026

- [Next.js deployment options](https://nextjs.org/docs/app/getting-started/deploying): Node.js and Docker remain supported.
- [Trigger.dev scheduled tasks](https://trigger.dev/docs/tasks/scheduled): recurring dispatch and timezone handling; no schedule has been created.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): policies and grants must both be set; service credentials remain server-side.
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth): secondary-calendar scope and separate availability scopes.
- [Google event creation](https://developers.google.com/workspace/calendar/api/guides/create-events): caller-specified IDs support recovery after uncertain insert success. Follow the scope reference rather than copying broad example scopes.
- [GitHub workflow schedule caveats](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): delays/dropped runs make it unsuitable as the primary time-sensitive scheduler.

See [access-feasibility.md](access-feasibility.md) and [cost-model.md](cost-model.md) for source/vendor limitations and price evidence. No end-to-end runtime, authenticated integration, RLS policy, delivery, or calendar recovery is operational yet.
