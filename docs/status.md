# Stage 1 status

**Instagram activation update, 9:50 pm Eastern October 20:** the new worker is deployed (5e1a57d, Trigger 20261021.3) and 16 accounts are enabled hourly. A real manual Production run succeeded for all 16, storing 400 posts/400 versions/16 private captures; owner search and pagination work. 33 hosted read-only policy checks pass. The genuine next hourly Instagram run is still pending, nominal 10 pm Eastern with provider jitter (recent starts about 10 minutes later). Do not call the manual run scheduled proof. Token expiry/renewal is unverified. No paid upgrade or calendar write. See reports/instagram-production-monitoring.json.

The remainder below preserves the earlier core Stage 1 checkpoint and its acceptance gaps.

**The live authenticated inbox contains real events from a genuine scheduled cloud collection. Stage 1 acceptance remains incomplete; stop before Stage 2.** Updated October 20 local / October 21 UTC, 2026. Stage 0 remains at annotated tag `stage-0-complete`, commit `795f23e4116bd98f1e26a4b933a0d0f2ca1fd7b3`. Origin is `https://github.com/astromonkeyduck-coder/opptrack.git`.

## Working hosted path

[The production site](https://luxury-longma-01d2fa.netlify.app) runs Next.js on Netlify. Supabase provides the single-owner Auth session, PostgreSQL/RLS and private Storage. The hourly Trigger Cloud dispatcher fetched fresh Central and Music responses, committed evidence and normalized facts, and made them visible in the owner's real browser inbox. Search for `Friendly Arbitration` returned eight matches; page 2 was verified. Two explicitly synthetic link-only manual test submissions are visible, with zero files uploaded. These are intake fixtures, not opportunities.

The first genuine scheduled Production run is **`run_06glnirsvhqdmbeiiur94st901`**, version **`20261020.3`**, task `opportunity-source-dispatcher`, schedule **`sched_7piwpgtckcngy15icqk45`**. Nominal dispatcher time was **2026-10-21 00:00:00 UTC**; actual execution was **00:10:50.502–00:11:11.503 UTC** (October 20, 8:10–8:11 pm Eastern). It completed with two successful sources, five fresh HTTP requests and **1,123,725 response bytes**. The production provenance helper retrieved and checked the actual run metadata before collection; a scheduler-shaped test payload alone does not qualify.

| Source | Committed SQL source-run ID | Actual result | Commit time UTC |
| --- | --- | --- | --- |
| Central public Localist | `6bdef3ce-3cb8-4b71-86d5-e0de21293a2f` | Four pages, 293 source IDs, 332 occurrences, 1,058,353 bytes; bounded October 20–27 window | `2026-10-21T00:11:10.931137Z` |
| Independent Music public preview | `91deb43b-58a8-48f9-bb30-a972c1aa73d2` | One page, ten dated cards/occurrences, 65,372 bytes | `2026-10-21T00:10:52.906294Z` |

The hosted snapshot has **303 opportunities, 342 occurrences, five captures/private Storage objects, 645 entity versions and 1,935 field claims**, with zero duplicate source/native identity groups. Each SQL source run matches the completed Cloud output and schedule. Exact capture hashes and object byte metadata match; this audit did not independently download/hash object bodies. Initial duplicate-free rows do not prove repeated hosted collection or decision preservation. Full evidence: `reports/stage-1-cloud-correlation.json`.

Both source leases were released, health is success and retry floors are null. Next nominal slots are Central **01:00 UTC**, Music **06:00 UTC**. The schedule is `0 * * * *`, UTC, `window: "60m"`, concurrency one, on Trigger Free. Provider offset/jitter is allowed. Migration 002 advances from the acquired UTC source slot, independently of processing time; crossing a boundary leaves the next slot due. Retry-After is a separate floor and missed slots coalesce once. This prevents completion-time drift without promising minute-level alerts.

## Configuration and access

| Service | Observed configuration |
| --- | --- |
| Supabase | Existing project `nuywbvlcwetqjalqvxzb`, migrations 001/002 applied as `20261020231512` and `20261020231950`. All 12 public tables have RLS; `review_inbox` is security-invoker; `captures` is private, 5 MiB object limit. The user created the confirmed Auth account; its existing UUID was registered privately as sole owner at **23:59:54.436893 UTC**. No account/password was created by the agent. Auth Site URL is the Netlify origin; public signup/anonymous sign-in are disabled, email confirmation retained. |
| Netlify | `luxury-longma-01d2fa.netlify.app`, main auto-publishing. Five Production values: APP_URL, public Supabase URL/publishable key, CALENDAR_WRITES_ENABLED=false, INBOUND_EMAIL_ENABLED=false. No worker secret. OpenNext v5.16.4 fixed the earlier published 404 deployment; corrected deploy `6ad7fd1b5a01e9295c7a246e` at `9fc73a6` includes one server/one edge function. Anonymous checks pass 200/307/401; a real owner session now displays collected rows. Site UUID remains unverified. |
| Trigger Cloud | Project `proj_wurjjfgxnzhkvcewuaci`, Free plan, opptrack-only GitHub App access, main→Production. Six Production-only values: APP_URL, SUPABASE_URL, protected/unviewable SUPABASE_SECRET_KEY, and false email/calendar/social flags. Development unchecked. Actual successful run used SDK 4.7.6, Node 24.18.0, Small 1x in us-east-1. Netlify/local use Node 22. |

The original 59 registry routes were seeded without resetting existing rows at **00:00:34.748965 UTC**. The user's additional 17 Instagram watchlist routes were inserted disabled/setup-needed at **00:16:08 UTC**, bringing the hosted total to **76**. Only Central hourly and Music six-hourly are enabled. HQ full/member coverage, ticket availability/release timing, stale and unconfigured routes remain visible. Music is a ten-card preview; full Music pagination, timezone, end time and location are not established. Cross-source duplicates can remain.

The user explicitly requested Instagram monitoring and Meta setup for those 17 accounts. The watchlist/readiness page and setup guidance are implemented; this narrow authorization does not start broader Stage 2. The Unpublished Meta app now has four verified read grants plus public_profile. The approved Facebook Page is linked to the existing professional Instagram account, with inbox/message access Disabled. The token is saved only in ignored local probe configuration. Fresh v2 CLI GETs at **2026-10-21 01:08:54–01:09:02 UTC** proved bounded post access for **16 of 17** accounts: 80 parent posts and 181 child IDs, 17 requests, 28,794 bytes. `fsucre` returned HTTP 400 / Graph 110 / subcode 2207013; the cause is unresolved. All returned account histories remain incomplete; no media files, captions, Stories or event extraction were collected. No production worker token, durable renewal or scheduled Instagram collector exists. See `reports/instagram-cli-access.json`. No paid connector is enabled. See `docs/instagram-monitoring.md`.

Existing `.env.local` values were not overwritten. Real keys were handled privately only for approved provider destinations. Dotenv, captures, rows, backups and screenshots remain ignored. No paid upgrade, purchase, RSVP, organizer message, email, model call or calendar write occurred.

## Verification and evidence boundaries

| Check | Actual result |
| --- | --- |
| `npm test` | **77 tests pass**, including eight Instagram watchlist/readiness and 18 bounded-preflight checks in addition to the prior collector, dispatcher, replay, intake and rendering tests. Synthetic responses remain fixtures. |
| `npm run test:db` | **29 base + 12 hourly PostgreSQL checks pass** in PGlite 0.5.10: migrations, RLS/private Storage policies, jitter/boundary timing, six-hour phases, outages and Retry-After. Local Auth/Storage compatibility tables are test infrastructure. |
| `make check` | **59 Python tests pass**; original 59 registry records, 45 scenario contracts and separate production templates validate. Contracts are not extraction accuracy. |
| `npm run typecheck`, `npm run build` | Exit 0, including the Instagram readiness page. The pinned OpenNext adapter separately generated server/edge manifests locally and is proven deployed for the existing hosted app. Watchlist commit `d5ed016` is now verified published as Netlify `6ad8067ad679ba54923ac5be`, with one server/one edge function; its authenticated page displays all 17 selected accounts. GitHub Actions `39521235011` passed. See `reports/instagram-watchlist-release.json`. |
| `npm audit` | Prior adapter-install audit exit 0, zero vulnerabilities. Optional Trigger CLI remains outside the app dependency tree; managed GitHub deploys work. |
| Hosted empty-database SQL check | Earlier **28 passed**, full rollback/no fake users or rows. Function-body hashes matched local migrated SQL. Preserved in `reports/stage-1-hosted-sql-checks.json`. |
| Hosted populated SQL check | **32 passed, 0 failed** at **00:14:24.974116 UTC**, READ ONLY repeatable-read transaction rolled back. Actual owner-role visibility, non-owner zero rows, anonymous denies, worker mutation guards and private object metadata policies tested against 303/342 populated rows. No real test account or data created. **SQL roles/transaction-local claims are not signed-JWT or Storage HTTP tests.** See `reports/stage-1-hosted-populated-rls-checks.json`. |
| Local dispatcher replay | Production handler→collector→ingestion→actual SQL RPC passed with replayed HTTP and local-file Storage: stable identities, five object reuses and saved decisions preserved. Not repeated hosted collection. See `reports/stage-1-source-dispatcher-replay.json`. |
| Hosted browser | Actual owner session shows 342 occurrences; page 2 and eight-match search verified. Two synthetic link-only intake fixtures visible; multi-file upload remains unverified. Owner and UI evidence are `reports/stage-1-owner-bootstrap.json` and `reports/stage-1-hosted-owner-ui.json`; private screenshots remain excluded from Git. |
| Anonymous hosted smoke | Initial pre-adapter three GETs all 404; corrected checks pass home200, inbox307, private-media401. Overall checker exit 2 correctly retains separate acceptance gaps. A denied invented object path does not prove known-object policy. |
| Prior manual Cloud guard test | `run_06glndpqqqf43ur6djisksj5e1`, 23:48:19.519–23:48:23.434 UTC, failed owner-setup guard before any fetch/row. Synthetic `sched_1234`/`IMPERATIVE` payload is not scheduled proof. Actual dashboard cost estimate **$0.00009868**. |
| Genuine scheduled Cloud collection | Completed run and exact SQL correlation above; dashboard cost estimate **$0.00068775**, including invocation and 19.6 seconds compute. This is provider-displayed run usage, not a monthly invoice. |

Historical zero-owner inspections at 23:48 and 23:53 UTC were accurate then and are superseded by the user-created login/owner bootstrap. Earlier release/deployment evidence remains in `reports/stage-1-hosted-deployment.json` and `reports/stage-1-connected-recheck.json`; do not erase prior failures or recast them as success.

## Remaining acceptance gates

- Real known-object owner/non-owner/anonymous Storage HTTP access, downloaded-body hash verification and private attachment/no-store behavior. SQL object metadata is already verified but is a separate boundary.
- Hosted multi-slide file upload/download, retry/idempotency, and size/type rejection. Chrome's file chooser still reports unavailable file-URL access after the user enabled it; extension-page inspection is blocked by browser URL policy. No bypass was attempted. The two submitted fixture records contain links only, zero files.
- Hosted save/reject decisions surviving repeated collection, distributed contention/lease recovery and mobile behavior. These have local coverage or desktop evidence only where specified above.
- Hosted database/Storage backup and restore, plus safe retention/refresh/orphan cleanup. Retention planning remains non-destructive; no production deletion is enabled.
- **Laptop-off proof:** the successful scheduled run occurred while this laptop was active. Record a user-confirmed powered-off interval and exact Cloud/SQL evidence inside it; include a six-hour Music due window to claim both sources continued.
- Instagram production worker integration, verified token expiry/renewal, complete bounded pagination/media evidence, and the unresolved `fsucre` access error. Read grants and 16 target samples are now proven locally. All 17 adapters remain disabled; no automatic social coverage is promised.

The hourly 30-day Trigger scenario remains **720 × assumed 10 seconds = $0.26136**, before retries; two observed run estimates total **$0.00078643**. Long-run runtime/storage and invoices remain unmeasured. Source charges observed $0; model/Resend/calendar usage zero. The no-paid constraint remains in force; see `docs/cost-model.md` and `reports/stage-1-costs.json` for assumptions.

**Calendar writes remain disabled. Stage 1 is not fully accepted and Stage 2 has not started.** Continue using `docs/runbook.md` and `docs/stage-1-hosted-checklist.md`.
