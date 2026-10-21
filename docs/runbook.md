# Stage 1 runbook

Read AGENTS.md, engineering-instructions.md, status.md, charter.md and stage-plan.md first. Stage 1 and the user's narrow 17-account Instagram setup request are authorized; stop before broader Stage 2. `stage-0-complete` preserves the earlier checkpoint. Origin points to astromonkeyduck-coder/opptrack.

## Current hosted baseline

The real owner can use [the inbox](https://luxury-longma-01d2fa.netlify.app/inbox). First genuine scheduled Production run `run_06glnirsvhqdmbeiiur94st901` completed **2026-10-21 00:10:50.502–00:11:11.503 UTC**, version `20261020.3`, schedule `sched_7piwpgtckcngy15icqk45`. Five fresh GETs produced 303 source-scoped opportunities, 342 occurrences and five private captured objects. Exact Cloud→SQL IDs/hashes/counts are in `reports/stage-1-cloud-correlation.json`. The laptop was active; offline acceptance is still open.

The user created a confirmed Auth account and it was registered as sole owner **2026-10-20 23:59:54.436893 UTC**. Do not create another account or replace ownership. Original 59 registry routes were seeded without resetting existing rows. Seventeen Instagram routes were added disabled/setup-needed at **00:16:08 UTC**; hosted total 76, only Central/Music enabled. Existing owner login, desktop real rows, page 2 and an eight-match search are verified. Mobile, hosted decisions/replay and known-object Storage HTTP remain open.

## Local setup

1. Use Node 22 and `npm ci`. `.env.local` was created with empty placeholders only if absent; never overwrite existing values or print keys. Enter the public Supabase URL/publishable key, server key and Trigger **development** key directly there if local work needs them. Keep APP_URL local and CALENDAR_WRITES_ENABLED=false. `npm run check:env` prints names/presence only; exit 2 means missing setup.
2. Existing hosted project `nuywbvlcwetqjalqvxzb` has migrations 001/002. Inspect history before retrying. A fresh local/test environment applies both files in order; keep 001 immutable. Docker/CLI are not installed here. Application keys alone do not establish SQL-management access.
3. Auth Site URL is the actual Netlify origin; public signup/anonymous sign-in are disabled and confirmation remains enabled. Ownership is already configured. For a genuinely new deployment only, have the user establish their intended Auth login privately, then run `npm run setup:owner -- EXISTING_AUTH_USER_UUID`. The service-only RPC refuses owner replacement; empty membership denies everyone.
4. `npm run setup:sources` now seeds the original 59 registry routes plus the 17 Instagram watchlist routes and ignores existing rows, preserving cursors/health. Preserve `instagram-<handle>` identities and disabled/unconfigured state; do not enable them without a proven permitted adapter. The original registry remains 59 records, separate from the additional watchlist.
5. `npm run dispatch` directly runs local collection, not Trigger Cloud. It uploads immutable private evidence, verifies reused hashes, then commits facts/run/cursor atomically. Failed collection records a reason/retry; failed persistence leaves a recoverable lease. Do not use direct/manual collection to consume slots when collecting evidence for the real schedule.
6. `npm run dev` opens local development. Sign in with the existing intended owner. Saving/rejecting affects one occurrence only and does not approve calendar writes. Restart after environment changes.

## Production web/worker separation

Follow `docs/deployment.md`, `config/production-environments.json` and separate example files. Existing values must remain intact.

- **Netlify Production:** APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, CALENDAR_WRITES_ENABLED=false, INBOUND_EMAIL_ENABLED=false. Free scopes are locked to all; only public configuration/nonsecret flags are stored here. Never put a server key on Netlify. Rebuild after public build-value changes.
- **Trigger Production only:** APP_URL, SUPABASE_URL, SUPABASE_SECRET_KEY (protected/unviewable), EMAIL_DELIVERY_ENABLED=false, CALENDAR_WRITES_ENABLED=false, SOCIAL_COLLECTION_ENABLED=false. Development is unchecked. Future approved Meta tokens belong in worker secret storage, never web/browser variables or Git.
- **Local:** ignored `.env.local` uses the development Trigger key. Deployment-account/read-audit tokens remain outside application runtime templates. No key belongs in a command argument, report or screenshot.

Netlify main auto-publishes with the pinned OpenNext v5.16.4 adapter, one server and one edge function. The earlier static-only deployment returned 404 and is preserved as failed evidence. Corrected anonymous checks pass 200/307/401, and the existing owner session displays real events. New changes must have their own published commit verified; local build success is insufficient.

## Trigger cadence and provenance

`opportunity-source-dispatcher` declares `0 * * * *`, UTC, `window: "60m"`, concurrency one and a two-source lease batch. Verified project ref is `proj_wurjjfgxnzhkvcewuaci`; the GitHub App remains scoped to opptrack only, main→Production. Managed GitHub builds work. The optional CLI was removed after dependency advisories; resolve/recheck it before installing a pinned CLI. Local/web Node is 22; the observed managed worker is Node 24.18.0, SDK 4.7.6.

Free-created schedules execute at a stable provider offset inside the one-hour window. The first nominal 00:00 UTC tick actually started 00:10:50.502. Do not promise exact-hour starts. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

Migration 002 uses fixed UTC slots: Central 3,600 seconds, Music 21,600 seconds (00/06/12/18 UTC). `next_poll_at` is independent of completion, `retry_not_before` is the Retry-After/backoff floor, `next_due_at` is their maximum. Success advances from `leased_poll_at`, so a boundary-crossing completion does not skip the next cycle. Missed slots coalesce once without an outage burst. Retries wait for a later dispatcher tick after the effective due time; no immediate retry promise. After the first success the next slots were Central 01:00 UTC and Music 06:00 UTC.

A real non-test/non-replay run retrieves its own SDK run metadata and verifies run/task/schedule before labeling SQL provenance scheduled. Preserve the provider run/version/environment, exact SQL source-run IDs, captures and commits. The earlier manual run `run_06glndpqqqf43ur6djisksj5e1` failed the owner guard before any fetch; its synthetic scheduler payload is not schedule proof. Its dashboard estimate was $0.00009868; the first genuine successful schedule estimate was $0.00068775. These are run-display estimates, not monthly invoices.

## Verification

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

Use a current start date for a new live fetch. Collect exit 2 means blocked/failed/partial, never “nothing new.” Current results: 58 TypeScript tests, 29 base plus 12 hourly PostgreSQL checks, 59 Python tests; typecheck/build pass. Tests use synthetic/replayed responses where labeled. PGlite runs actual PostgreSQL/roles but supplies local Auth/Storage compatibility infrastructure. The live/replay proofs are not repeated hosted collection or hosted object HTTP.

Actual populated hosted policy check: `scripts/hosted-populated-rls-check.sql`, READ ONLY repeatable-read/rollback, **32 pass**. It tests existing owner-role visibility and anonymous/non-owner isolation using transaction-local claims, including five private object metadata rows. It creates no account/row and does not verify signed JWTs or download bytes. Report: `reports/stage-1-hosted-populated-rls-checks.json`. The real owner browser is separate Auth/session evidence.

`node scripts/check-hosted-access.mjs --app-url=https://luxury-longma-01d2fa.netlify.app` performs bounded reads. Its private detailed report excludes keys/identities. Exit 1 means failure, exit 2 missing setup/evidence. Service reads, SQL-role checks, browser access and owner/non-owner Storage HTTP are separate gates.

## Manual intake, Instagram and retention

Intake retains HTTPS links without server fetch/DNS/redirect, so links do not create an outbound SSRF route. Up to eight files are allowed, 5 MiB each/20 MiB total, with bounded parsing, MIME/signature checks and owner-prefixed private paths. All supplied slides are retained pending verification; no OCR/model facts are generated. UUID/hash identities support retry reconciliation. A timed-out uncertain save preserves files because a transaction may have committed.

Two link-only synthetic acceptance submissions are visible. Hosted two-slide upload is **not verified**: Chrome's chooser still reports file-URL access unavailable after the user enabled it; extension inspection is policy-blocked. No alternate-surface workaround was used. Do not present the prepared 356-byte fixture PNGs as uploaded evidence. Known-object download, multi-file/idempotency and size/type rejection remain hosted checks.

`docs/instagram-monitoring.md` describes the 17-account watchlist and permitted Business Discovery route. The approved Page/professional IG link and four read grants plus public_profile are verified; inbox/message access is Disabled. The token is stored privately in ignored `.env.instagram.probe.local` (mode 600), separate from `.env.local`, Netlify and Trigger. Never print or commit it. Fresh bounded CLI reads proved 16 target samples; `fsucre` returned HTTP 400 / Graph 110 / subcode 2207013, cause unresolved. See `reports/instagram-cli-access.json` and `docs/instagram-probe.md`. No worker token or scheduled Instagram collector exists; expiry/renewal, pagination and media remain unverified. Keep social false, all 17 adapters disabled/setup-needed and Stories manual-only. Resend/social/HQ credentials remain optional; no paid connector or publishing/message scope.

Raw retention target is 30 days after latest fresh capture; manual media target seven days. `npm run retention:plan` is service-only and **deletes nothing**. Hosted database/Storage restore and a race-safe refresh/deletion protocol are required before cleanup. Local database restore and local deletion/metadata tombstone tests are separate evidence. Do not silently purge evidence or enable deletion.

## Remaining acceptance

Use `docs/stage-1-hosted-checklist.md` to close known-object HTTP/integrity, hosted multi-slide intake, occurrence decisions/repeated collection, mobile, contention/lease recovery, backup/Storage restore and safe retention/orphan gates. Record a user-confirmed powered-off interval, then exact scheduled Cloud/SQL collection inside it; include Music's six-hour due window when claiming both adapters. This session's scheduled run proves cloud execution while the laptop was on.

Calendar provider code, OAuth scopes and write endpoints remain absent. No calendar write, email, RSVP, purchase, organizer message, paid connector or paid upgrade is authorized by this runbook. Stop after Stage 1 and retain honest remaining gaps.
