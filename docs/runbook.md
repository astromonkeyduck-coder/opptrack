# Stage 1 runbook

Read AGENTS.md, engineering-instructions.md, status.md, charter.md and stage-plan.md first. Stage 1 and the user's explicit 27-account automatic Instagram extension are authorized. Stop before broader Stage 2. `stage-0-complete` preserves Stage 0; origin is `astromonkeyduck-coder/opptrack`.

## Current checkpoint

The real owner can use [events](https://luxury-longma-01d2fa.netlify.app/inbox) and the separate [Instagram feed](https://luxury-longma-01d2fa.netlify.app/instagram). The 14:34 UTC snapshot has 345 opportunities, 393 occurrences, 677 Instagram posts/versions and 45 private sanitized projections. There are 87 sources and 29 enabled routes: Central hourly, Music six-hourly and 27 Instagram accounts hourly. fsucre remains blocked/disabled; successful fsu_cre is distinct. Generic/unproven/paid routes remain disabled.

Genuine scheduled `run_06gltj5jsr8t0547pls4achk01`, nominal 14:00 UTC October 21, had 17 successful source runs including Central and the original 16 Instagram accounts (`14:10:50.550–14:11:22.439Z`). This proves recovered scheduled 16-account collection. The authorized 11-source expansion was activated at 14:32:21.903094 UTC; manual/test `run_06glto7pof47do100m2q5b7me1`, worker `20261021.7`, then succeeded for all 11 (`14:32:47.118–14:32:58.246Z`,11 GETs/228,647 bytes/275 new posts). No duplicate groups; all 27 health states successful and leases released. **First genuine full 27-account tick remains pending nominal 15:00 UTC/11 am Eastern**, with provider spreading. [Expansion proof](../reports/instagram-27-account-expansion.json).

Preserve the earlier 02:00 UTC expired-token schedule and successful manual recovery in [historical monitoring evidence](../reports/instagram-production-monitoring.json). The replacement User token and verified conservative expiry `2026-12-20T00:40:44.610662Z` are in Trigger Production only; no automatic renewal is established. No user-confirmed powered-off interval exists.

The 209-account inventory was imported inactive; 29 high-priority read checks later yielded 26 successes/three access blocks. Eleven new successes were separately authorized and activated; the inventory now overlaps 26 active handles, leaving 183 inactive candidates (three blocked high-priority plus 180 standard). Three aliases remain unverified. Do not activate other candidates or merge fsu_cre with fsucre. [Probe](../reports/instagram-candidates-high-priority-access.json), [activation](../scripts/activate-instagram-11-expansion.sql).

## Local setup and safe configuration

1. Use Node 22 and `npm ci`. Preserve populated dotenv files. Ignored `.env.local` contains development configuration; `npm run check:env` prints names/presence only. Never paste keys into chat, commands, URLs, reports or screenshots.
2. Existing Supabase project `nuywbvlcwetqjalqvxzb` has immutable migrations 001/002/003/004, hosted as `20261020231512`, `20261020231950`, `20261021012900`, `20261021142636`. A new test environment applies all in order. Supabase CLI/Docker were unavailable locally; PGlite executes the real SQL with explicit test Auth/Storage shells.
3. The confirmed user-created Auth account is already the sole owner. Do not replace ownership or create another login. New deployments only: have the user establish their intended Auth account privately, then run `npm run setup:owner -- EXISTING_AUTH_USER_UUID`. Public signup/anonymous sign-in remain disabled.
4. `npm run setup:sources` seeds 59 registry plus 28 watchlist routes, ignores conflicts and preserves existing cursors/health. Fresh social rows deliberately start disabled. Preserve the approved exact 27 IDs; never enable by an `instagram-%` prefix, which also matches unrelated historical routes. The migration itself enables no sources.
5. `npm run dev` starts local web development; `npm run dispatch` is a direct local/manual worker, not scheduled Cloud proof. Do not consume production due slots with repeated manual collection while gathering automatic evidence.
6. Saving/rejecting applies to one occurrence and never authorizes a calendar action. Calendar and email flags remain false. Resend, HQ credentials and unproven social routes are optional.

## Production web/worker separation

Follow [deployment](deployment.md), `config/production-environments.json` and the separate example templates. Netlify main auto-publishes Next.js with pinned OpenNext `5.16.4`, one server and one edge function. New code needs its own published commit confirmation; a local build alone is insufficient.

- **Netlify Production:** APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, CALENDAR_WRITES_ENABLED=false, INBOUND_EMAIL_ENABLED=false. Existing Free controls use all scopes; only public configuration/nonsecret flags belong here. Rebuild after public build-value changes. No server/Instagram secret.
- **Trigger Production only:** APP_URL, SUPABASE_URL, protected SUPABASE_SECRET_KEY, EMAIL_DELIVERY_ENABLED=false, CALENDAR_WRITES_ENABLED=false, SOCIAL_COLLECTION_ENABLED=true, protected IG_FB_USER_ACCESS_TOKEN and protected IG_CALLER_USER_ID. Use IG_TOKEN_EXPIRES_AT only for a verified expiry. Development remains separate.
- **Local probes:** ignored mode-600 `.env.instagram.probe.local` is separate from development/web files. Deployment-account tokens and transient Meta App Secrets do not belong in application runtime templates or Git. The production collector never needs the App Secret.

Credential hygiene limitation: a Meta diagnostic tool automatically displayed test User/App tokens during setup; the longer-lived production token and raw App Secret were not printed and no credentials entered Git. Preserve this disclosure in the run evidence. Do not automatically rotate credentials or disable the working monitor without the user's instruction.

## Dispatcher, cadence and recovery

Task `opportunity-source-dispatcher`, project `proj_wurjjfgxnzhkvcewuaci`, uses the single active `sched_7piwpgtckcngy15icqk45`: `0 * * * *`, UTC, `window: "60m"`, concurrency one. The GitHub App is restricted to opptrack and main tracks Production. Managed Cloud has used SDK `4.7.6`, Node `24.18.0`; local/web use Node 22. No paid upgrade or additional workflow engine is authorized.

Trigger Free spreads starts within the hour. Nominal `02:00Z` triggered at `02:10:46.320Z` and started at `02:11:04.492Z`; do not promise exact-hour alerts. Central's 3,600-second and Music's 21,600-second UTC slots are independent of completion time. `next_due_at=max(next_poll_at,retry_not_before)`; success advances from `leased_poll_at`, boundary crossings leave the next slot due, outages coalesce rather than burst. Retries wait for a later dispatcher tick after the floor. [Schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

Core sources lease first, independently of the 27-source social budget. Social runs use two requests in flight, 10-second request timeouts and a 90-second dispatch budget. A Meta failure cannot consume Central/Music leases. Failed source access must retain a failure category and never appear as a successful empty check. Persistence errors retain leases for recovery rather than advancing cursors.

For Meta recovery, complete the authorized account verification directly with Meta, then handle tokens privately. The approved fixed-host POST token exchange was live-tested successfully, using body parameters without secrets in URLs/logs. Current Meta documentation describes GET; the observed successful POST is recorded as project evidence, not a guarantee for other endpoints. Do not fall back to a secret-bearing GET URL. App Secret input was transient and removed. [Exchange evidence](../reports/instagram-token-extension.json).

Install the replacement only in Trigger Production and save the returned verified expiry. Verify one bounded read, then one bounded manual Cloud recovery run; a manual success remains distinct from automatic success. Allow the existing real hourly schedule to run and correlate provider run/version/schedule/test flag with exact SQL source-run IDs, captures, attempts/successes and costs. Preserve the failed automatic run in reports. No automatic renewal is established; an expired or revoked token requires an honest blocked state and renewed login/access.

## Verification commands and evidence

```sh
npm test
npm run test:db
npm run typecheck
npm run build
make check
```

Current recorded checks: **111 JavaScript tests**, **63 local PostgreSQL checks** (29 base, 12 hourly, 22 Instagram), **six production-module Instagram replay checks**, **60 Python tests**. `test:db` includes the Instagram replay command; do not count it twice. Synthetic/replayed HTTP and in-memory replay Storage are explicitly labeled. PostgreSQL/RLS are real; local Auth/Storage compatibility shells do not emulate hosted JWT/HTTP.

Fresh core collection may use `npm run collect:live -- --start=YYYY-MM-DD` with the actual date, followed by `npm run prove:live`; direct ingestion is a mutation and must not interfere with due-slot evidence. `node --import tsx scripts/prove-dispatcher-replay.ts` proves the core handler path against replay fixtures. `npm run test:instagram:replay` proves actual social collector/ingestion modules through SQL, including edit/replay, corrupt-object rejection and expired-token health. Exit 2 from a collector means blocked/partial/failed, never “nothing new.”

Hosted `scripts/hosted-populated-rls-check.sql` passed 32 read-only core policy checks; `scripts/hosted-instagram-rls-check.sql` passed 33 populated social policy checks again at 14:35:44 UTC against 677 posts/45 private objects/27 enabled sources; see `reports/instagram-27-hosted-policy-checks.json`. Both use repeatable-read/rollback and transaction-local owner/nonowner/anon claims, create no accounts and disclose no private identifiers. They are separate from real owner browser sessions and known-object Storage HTTP. Reports: `reports/stage-1-hosted-populated-rls-checks.json`, `reports/instagram-hosted-policy-checks.json`.

Historical owner-browser checks verified event rows/search/page 2,400 social posts, 20-row second page and 25 `homecoming` matches. The latest real owner session shows 677 posts/27 successful accounts; new-account filter `instagram-fsu_cre` returned 25 matches and was restored to All. A 390×844 viewport passed without horizontal overflow on `5e1a57d`; physical-phone testing remains separate. A later unapplied viewport override is not another pass. Known-object download remains unverified because browser download approval could not establish origin; do not bypass that boundary.

## Intake, retention and remaining acceptance

Manual intake retains HTTPS links without server fetch/DNS/redirect, so submitted links create no outbound SSRF route. Up to eight private files, 5 MiB each/20 MiB total, are validated by MIME/signature and owner path. All supplied slides are retained pending verification. No OCR/model facts are generated. Submission UUID/hash identities support retries; an uncertain timed-out save preserves files because SQL may have committed.

Two synthetic link-only submissions exist, zero files. Hosted multi-slide upload/download/idempotency and type-size rejection remain unverified: Chrome's file chooser reported unavailable file-URL access, and extension inspection was policy-blocked. Prepared fixtures are not upload evidence.

Capture retention target is 30 days after latest fresh capture; manual media target seven days. `npm run retention:plan` is service-only and deletes nothing. Safe refresh/deletion races, Storage restore and database backup/restore must be verified before cleanup. Upload-before-SQL can leave an orphan; never purge evidence silently.

Open Stage 1 gates include the full 27-account genuine scheduled run and credential-renewal handling, known-object owner/nonowner/anonymous Storage HTTP and downloaded-body integrity, hosted file intake, event decisions surviving repeated collection, distributed contention/recovery, restore and safe retention. Record a user-confirmed powered-off interval and actual Cloud/SQL commits inside it; include Music's six-hour window before claiming both core sources continued. The observed scheduled runs occurred while the laptop was active.

Stories, media contents, full social history, older edits/deletions, HQ/member scope and ticket availability remain gaps. No calendar code/write OAuth, RSVP, purchase, organizer messaging, email send, paid connector or upgrade is enabled. Stop after Stage 1.
