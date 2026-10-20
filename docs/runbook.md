# Stage 1 runbook

Read AGENTS.md, engineering-instructions.md, status.md, charter.md and stage-plan.md first. Stage 1 is authorized; stop here. `stage-0-complete` preserves the earlier checkpoint. The GitHub remote exists and points to astromonkeyduck-coder/opptrack.

## Local setup

1. Use Node 22; run `npm ci`. `.env.local` was created with empty placeholders only if absent. Never overwrite existing values or print keys. Enter `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `TRIGGER_SECRET_KEY` directly in that file. The last is your development key. Keep `APP_URL=http://localhost:3000` and `CALENDAR_WRITES_ENABLED=false`. `npm run check:env` reports names/presence only; exit 2 means setup is missing.
2. In the intended Supabase project's SQL editor, apply `supabase/migrations/202610200001_stage1.sql` once. It creates only tracker tables/functions and the private captures bucket. For a fresh local Supabase CLI stack, ordinary migrations also apply; Docker/CLI are not installed here. The three application values do not authorize a raw SQL management API, so migration application cannot be inferred from keys alone.
3. Create or choose your existing Supabase Auth account in its dashboard. Disable public signups and use a password entered directly by you. The application has no signup endpoint. Run `npm run setup:owner -- EXISTING_AUTH_USER_UUID`; it calls a service-only RPC, seeds the two active sources and visible gaps, and refuses replacing an existing owner. Empty membership denies everyone, including the first browser visitor.
4. Run `npm run setup:sources` to retain all 59 registry routes. Existing rows are unchanged, including cursors/health. Only central and Music have adapters enabled. Stage 1 intentionally uses central hourly and Music every six hours; the Stage 0 registry's proposed cadences remain historical evidence.
5. Run `npm run dispatch` for a direct local worker collection. It uploads immutable raw captures privately, verifies reused object hashes, then commits captures/facts/run/cursor in one SQL transaction. A failed collection records its reason and schedules retry; failed persistence leaves a lease for recovery. This command does not invoke Trigger Cloud.
6. Run `npm run dev`, open http://localhost:3000, and sign in using the registered account. The inbox searches source facts and manual notes, paginates occurrences/submissions separately, and preserves save/reject per occurrence. Neither action approves a calendar write. Restart the app after changing environment values.

## Trigger development and production

The actual SDK task is `opportunity-source-dispatcher` in `trigger/source-dispatcher.ts`. It has one 15-minute schedule, concurrency one, a bounded two-source lease batch, and durable retries. SQL source cadences determine whether a collection is due. Set the non-secret `TRIGGER_PROJECT_REF=proj_...` for the config/CLI process. Development uses your `TRIGGER_SECRET_KEY` locally. Production workers use only `.env.trigger.production.example` values in Trigger's prod environment; Netlify values do not transfer.

The SDK is pinned to 4.7.6. The matching optional CLI was inspected and removed after its dependency tree introduced unpatched `braces` and vulnerable archive dependencies. The retained application/SDK tree audits clean after narrow ws/deepmerge-ts overrides. Resolve/recheck the CLI dependency advisories before installing a deployment CLI. A future pinned, verified CLI can run `trigger.dev dev --env-file .env.local` and deploy the real project separately; neither command has been run successfully here. SDK task registration and local handler tests do not establish cloud execution. A project reference/key alone does not deploy task code.

After deployment, invoke the task from the Trigger dashboard and record its real run ID plus the corresponding Supabase run/capture/inbox counts. Do not copy keys, raw job payloads or private captures into Git. No paid connector or email service is needed for the two adapters.

## Verification and evidence

```sh
npm test
npm run test:db
npm run typecheck
npm run build
make check
npm run collect:live -- --start=2026-10-20
npm run prove:live
node --import tsx scripts/prove-dispatcher-replay.ts
npm run evidence:inbox
```

Use a current start date for a fresh run. Collect exit 2 means blocked/failed/partial, never “nothing new.” PGlite executes real PostgreSQL migrations, constraints, roles and RLS. The harness supplies only auth/storage compatibility tables and test identities; it does not test hosted JWTs or Storage HTTP. The live database proof ingests private saved fresh responses, tests replay/pagination/search/decision preservation, and restores a real database dump. The dispatcher proof uses production handler/service/collectors with explicitly replayed HTTP and local-file Storage adapters. Reports enumerate these boundaries.

`private/stage-1-inbox.html` renders the actual inbox component using real owner-RLS-selected event rows; it is static evidence, not a deployed authenticated session. Desktop/mobile screenshots remain private. The application has no alternate unauthenticated demo data route. Local production HTTP smoke checks must show redirects/401s for private paths and an honest setup page while unconfigured.

## Manual intake and retention

Authenticated intake retains HTTPS links without any server fetch, DNS lookup or redirect, so this route has no outbound SSRF path. It accepts up to eight files, 5 MiB each/20 MiB total, with matching MIME/signatures for PNG/JPEG/WebP/PDF, bounded request parsing, same-origin checks and owner-prefixed private paths. Every supplied file is retained and shown; media contents remain pending verification. No LLM/OCR or automatic opportunity claims are generated.

Submission UUIDs and immutable file hashes prevent retry duplication. Uncertain saves preserve files because a timed-out transaction may have committed. Source raw retention targets 30 days after the latest observed fresh capture; manual media targets seven days. `npm run retention:plan` invokes the service-only candidate query, protects active shared references, and includes aged orphan candidates. It **deletes nothing**. Production cleanup needs a verified deletion/refresh maintenance protocol and Storage restore test before activation; until then, retention targets are not an automatic deletion guarantee. Local object deletion/metadata tombstone and database restore were tested separately. Review orphan/retention candidates before increasing intake volume.

## Remaining Stage 1 hosted acceptance

- Apply migrations to the intended private Supabase project and register the existing owner.
- Verify real owner login; anonymous and a second account must fail database and Storage HTTP access. Test all-slide upload/download, duplicate uploads, retry reconciliation and size/type rejection through actual hosted services.
- Deploy and run Trigger against that same project; record cloud run IDs, health, captures and actual inbox events. Exercise hosted lease/retry recovery and distributed contention.
- Apply separate Netlify Production and Trigger prod variables, verify the deployed commit and authenticated/mobile behavior, and capture a real authenticated screenshot.
- Verify hosted database and Storage restore plus safe retention/orphan cleanup before declaring Stage 1 accepted.

Resend/domain/DNS, social tokens, HQ member feeds and calendar OAuth remain optional or later-stage requirements. Do not provision a paid plan, run an actor, RSVP, send messages or modify a real calendar. Calendar provider code, credentials, scopes and write endpoints are absent.
