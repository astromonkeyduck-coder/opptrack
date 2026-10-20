# Stage 1 runbook

Read AGENTS.md, engineering-instructions.md, status.md, charter.md and stage-plan.md first. Stage 1 is authorized; stop here. `stage-0-complete` preserves the earlier checkpoint. The GitHub remote exists and points to astromonkeyduck-coder/opptrack.

## Local setup

1. Use Node 22; run `npm ci`. `.env.local` was created with empty placeholders only if absent. Never overwrite existing values or print keys. Enter `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `TRIGGER_SECRET_KEY` directly in that file. The last is your development key. Keep `APP_URL=http://localhost:3000` and `CALENDAR_WRITES_ENABLED=false`. `npm run check:env` reports names/presence only; exit 2 means setup is missing.
2. Existing hosted project `nuywbvlcwetqjalqvxzb` now has migrations 001/002 applied through authorized access. Inspect history before retrying. A fresh local/test environment applies both migration files in order, including `202610200002_hourly_cadence.sql`; keep 001 immutable. Docker/CLI are not installed here. Application keys alone do not establish a SQL-management channel.
3. Establish your intended Supabase Auth login directly when ready, disable public signups and enter your own password privately. The last hosted inspection found zero Auth users; you declined manual account creation, so no account or invitation was created. The application has no signup endpoint. After an Auth user exists, run `npm run setup:owner -- EXISTING_AUTH_USER_UUID`; the service-only RPC seeds the two active sources/gaps and refuses replacing an owner. Empty membership denies everyone, including the first visitor.
4. Run `npm run setup:sources` to retain all 59 registry routes. Existing rows are unchanged, including cursors/health. Only central and Music have adapters enabled. Stage 1 intentionally uses central hourly and Music every six hours; the Stage 0 registry's proposed cadences remain historical evidence.
5. Run `npm run dispatch` for a direct local worker collection. It uploads immutable raw captures privately, verifies reused object hashes, then commits captures/facts/run/cursor in one SQL transaction. A failed collection records its reason and schedules retry; failed persistence leaves a lease for recovery. This command does not invoke Trigger Cloud.
6. Run `npm run dev`, open http://localhost:3000, and sign in using the registered account. The inbox searches source facts and manual notes, paginates occurrences/submissions separately, and preserves save/reject per occurrence. Neither action approves a calendar write. Restart the app after changing environment values.

## Trigger development and production

The task `opportunity-source-dispatcher` in `trigger/source-dispatcher.ts` declares hourly cron `0 * * * *`, UTC, `window: "60m"`, concurrency one and a two-source lease batch. Config defaults to verified nonsecret project `proj_wurjjfgxnzhkvcewuaci`; TRIGGER_PROJECT_REF can explicitly override it. Free-created schedules require hourly-or-slower cron and a minimum 60-minute stable-offset window. Actual start occurs within that window; the payload timestamp is nominal. No upgrade was selected. Development schedules also need an active dev CLI; Production must execute in the deployed cloud worker.

Migration 002 keeps central 3,600-second and Music 21,600-second UTC polling slots independent of processing duration. `next_poll_at` is the nominal slot, `retry_not_before` is a separate Retry-After/backoff floor, and `next_due_at` is their maximum. The next hourly dispatcher can collect only after that effective due; do not promise immediate retry or minute-level alert timing. Expired leases retain failed-run evidence and missed source slots coalesce once without a burst. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

Development uses your TRIGGER_SECRET_KEY locally. All six `.env.trigger.production.example` worker values were confirmed saved for Production only, with Development unchecked; the Supabase server key is secret/unviewable, and the three external-action flags are false. Netlify values do not transfer. The GitHub app installation was confirmed October 20, 2026 at 19:28 America/New_York for opptrack only. Trigger's organization connection still does not recognize it; managed deployment/task registration/scheduling remain unfinished. Keep the repository grant limited while investigating.

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

- Completed: Supabase migrations 001/002 applied; all five Netlify variables confirmed saved in one Production context, including both false flags; all six Trigger worker variables saved for Production only with Development unchecked. The server key is stored as a secret with its value unviewable. Actual Netlify site UUID is still unknown. Free variable scopes are locked to all, so only public configuration/nonsecret flags belong on Netlify. No upgrade was used.
- Completed: Trigger GitHub app installed for opptrack only. Pending: investigate why the Trigger organization connection does not recognize it, finish managed worker deployment, and rebuild/deploy the Stage 1 Netlify commit. Saved variables and repository installation do not prove task execution or authenticated UI behavior.
- Pending: user establishes their intended Auth account and it is explicitly registered as owner. Last inspection: zero users, none created; empty membership denies access.
- Verify real owner login; anonymous and a second account must fail database and Storage HTTP access. Test all-slide upload/download, duplicate uploads, retry reconciliation and size/type rejection through actual hosted services.
- Deploy and run Trigger against that same project; record cloud run IDs, health, captures and actual inbox events. Exercise hosted lease/retry recovery and distributed contention.
- Preserve separate saved Netlify Production and Trigger prod settings; verify the deployed commit and authenticated/mobile behavior, and capture a real authenticated screenshot.
- Verify hosted database and Storage restore plus safe retention/orphan cleanup before declaring Stage 1 accepted.
- Prove scheduled collections during a user-confirmed laptop-off interval using provider run IDs and exact committed SQL run/capture correlation. Local dev, an idle successful cloud tick, or timestamp overlap alone is insufficient; allow a six-hour Music due window when claiming both sources continued.

Use `docs/stage-1-hosted-checklist.md` and `node scripts/check-hosted-access.mjs` for bounded read-only inspection. The checker separates service-key reads from actual owner/JWT access and leaves untested gates open.

Resend/domain/DNS, social tokens, HQ member feeds and calendar OAuth remain optional or later-stage requirements. Do not provision a paid plan, run an actor, RSVP, send messages or modify a real calendar. Calendar provider code, credentials, scopes and write endpoints are absent.
