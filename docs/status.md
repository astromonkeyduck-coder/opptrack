# Stage 1 status

**Hourly scheduling is implemented and locally verified. Hosted acceptance is still open. Stop before Stage 2.** Updated October 20, 2026, America/New_York. Stage 0 remains preserved by annotated tag `stage-0-complete` at `795f23e4116bd98f1e26a4b933a0d0f2ca1fd7b3`. Origin is `https://github.com/astromonkeyduck-coder/opptrack.git`; no missing-remote blocker exists.

## Current implementation

Next.js/TypeScript on Netlify, Supabase Auth/PostgreSQL/private Storage, and one Trigger Cloud dispatcher. Central public Localist collection targets hourly; the independent Music public preview targets six-hourly. Native source identities, immutable evidence/versions, separate occurrences/milestones, bounded pagination, retries, source health, private manual flyer/link intake, search and occurrence save/reject are implemented. Unknown ticket, location and timezone facts remain visible. The 59-route registry retains HQ, stale and unconfigured social gaps. Resend/social credentials are optional and unused.

The dispatcher now uses `0 * * * *`, UTC, `window: "60m"`, concurrency one, compatible with Trigger Free. Actual execution can have the provider's stable offset within the hour. Migration 002 separates fixed UTC `next_poll_at` from `retry_not_before`; success advances from the acquired source slot rather than completion time. Boundary crossings leave the next slot due. Recovery coalesces missed source slots once rather than bursting through an outage. Retry-After remains an independent lower bound. The original 001 migration is unchanged.

Each committed source run can retain the actual Trigger run ID, verified schedule ID, nominal dispatcher time, source slot and invocation kind. A scheduler-shaped payload alone cannot count as scheduled production evidence. Missing owner configuration now aborts visibly with setup-needed instead of completing as a misleading zero-result run.

The web app authenticates one explicitly registered Supabase Auth owner. Empty ownership denies access. Links submitted manually are retained without server-side fetching; uploads remain private and pending verification. No OCR/model extraction runs. Retention planning is non-destructive; production deletion remains disabled until restore and race safety are demonstrated.

## Hosted configuration actually performed

| Service | Observed state |
| --- | --- |
| Supabase | Existing healthy project `nuywbvlcwetqjalqvxzb`. Applied migration 001 as `20261020231512` (`stage1_private_opportunity_inbox`) and 002 as `20261020231950` (`stage1_hourly_polling_cadence`). All 12 public tables have RLS; captures bucket is private with 5 MiB limit. Auth Site URL saved to the real Netlify origin, public signup disabled, anonymous sign-ins disabled and email confirmation retained. **Zero Auth users/registered owners; none created or invited.** |
| Netlify | Existing `luxury-longma-01d2fa.netlify.app`, main auto-publishing. Five Production-only values saved: APP_URL, public Supabase URL/publishable key, CALENDAR_WRITES_ENABLED=false, INBOUND_EMAIL_ENABLED=false. No worker secret was placed here. The previously published `1d04777` deploy returned HTTP 404 for all three tested app routes: its successful build omitted the Next server adapter. Explicit pinned OpenNext v5 adapter now generates server/edge routing artifacts locally; hosted redeploy verification remains pending. |
| Trigger Cloud | Existing project `proj_wurjjfgxnzhkvcewuaci`, org `plangplangplang-6ce7`, Free plan. Six Production-only variables saved: APP_URL, SUPABASE_URL, protected/unviewable SUPABASE_SECRET_KEY and false email/calendar/social flags; Development was unchecked. GitHub now reports installed and repository `astromonkeyduck-coder/opptrack` connected, Production branch main. Deployment and actual scheduled ingestion remain unverified. |

Existing values in `.env.local` were never overwritten. Real keys were handled privately only for the user-approved provider destinations, never printed. Dotenv, raw captures, rows, backups and screenshots remain ignored; no private paths or secret values were found in the pending commit scan. No paid upgrade, connector, purchase, RSVP, email or calendar write was enabled.

## Actual commands and evidence

| Check | Actual result and boundary |
| --- | --- |
| `npm test` | **51 tests pass**, covering collectors, dispatcher provenance/readiness, replay/storage, intake, freshness and rendering. Synthetic responses are test fixtures. |
| `npm run test:db` | **29 base + 12 hourly PostgreSQL checks pass** using PGlite 0.5.10. Includes jitter, processing over a boundary, six-hour phases, Retry-After, outages, migration with active leases, RLS and private Storage policies. Auth/Storage compatibility shell is local test infrastructure. |
| `make check` | **59 Python tests pass**; 59 registry records, 45 scenario contracts and separate production templates validate. Contracts are not extraction accuracy results. |
| `npm run typecheck`, `npm run build` | Exit 0. Explicit `@netlify/plugin-nextjs@5.16.4` lifecycle also generated the server-handler function, function/edge manifests and all seven Next app route entries locally. Hosted runtime remains a separate check. |
| `npm audit` | Exit 0 after adapter dependency installation: zero reported vulnerabilities. Optional Trigger CLI remains outside the application dependency tree; managed GitHub builds are configured instead. |
| Hosted SQL rollback-only access checks | **28 passed, 0 failed**. Anonymous/non-owner denies, service worker guards, private Storage policy and invoker view checks executed against the actual project. Verified complete rollback: zero users, owners, sources, opportunities, captures, runs or objects created. All four deployed SQL function body hashes match freshly migrated local SQL. Empty data means positive owner/JWT/populated-data isolation and Storage HTTP remain untested. |
| `node --import tsx scripts/prove-dispatcher-replay.ts` | Production handler→collector→ingestion→actual SQL RPC proof passes with explicitly replayed source HTTP and local-file Storage. Actual SQL source-run UUID correlation, no duplicate entities/versions, five immutable object reuses and saved decision preservation. **Not Trigger Cloud evidence.** |
| `node scripts/check-hosted-access.mjs --app-url=https://luxury-longma-01d2fa.netlify.app` | Initial pre-adapter hosted smoke made three real GETs at 23:35:43Z, all HTTP 404, exit 1. Missing local keys remain setup-needed; no failure is reported as nothing new. Detailed report private; no credential-backed HTTP checks claimed. |
| `git check-ignore`, tracked/pending file scan, `git diff --check` | Dotenv/private evidence ignored; no tracked credential/private capture; whitespace check passes. |

Command outputs and scheduling SQL details: `reports/stage-1-hourly-verification.json`, `reports/stage-1-hourly-database-tests.json`, `reports/stage-1-hosted-sql-checks.json`. Initial Stage 1 local results remain in `reports/stage-1-verification.json`. Live source evidence: 12 actual public GET attempts across initial/corrected/final collection; final Central seven-day window October 20–27 has 293 source event IDs/332 occurrences over four pages (1,058,353 bytes); Music has 10 dated preview cards (65,372 bytes). Fresh bodies normalized locally into 303 source-scoped opportunities, 342 occurrences, five captures, 645 versions and 1,935 claims. Cross-source duplicates can remain. Real-event local inbox screenshots and SQL pagination/search proof exist; they do not prove hosted login.

## Remaining Stage 1 gates

- Configure the user's intended app identity and register its Auth UUID as owner; user declined the manual account step, so no account was created. A Supabase dashboard login is separate from app authentication. Without the owner, production collection intentionally stops before source fetching and the authenticated inbox cannot be demonstrated.
- Verify the new Netlify deploy actually packages Next server functions, publishes the intended commit, returns the sign-in page and enforces anonymous inbox/private-media denial. Then prove real owner login, search/pagination, decisions and manual intake through hosted Auth/Storage HTTP.
- Deploy and inspect the hourly production Trigger task/schedule. Prove runtime run-metadata retrieval, real source fetches, private Storage objects and source-run IDs correlated to Trigger IDs. No cloud ingestion run IDs or database updates are claimed yet.
- Record a user-confirmed powered-off interval, then correlate genuine scheduled Production runs and database commits within it. This session has not established that the laptop was off. Merely deploying a cloud task cannot close that gate. Music needs a six-hour due window.
- Complete hosted backup/Storage restore, populated-data owner/other-user isolation, distributed contention, safe retention/refresh and orphan cleanup. Security-advisor warnings and the intentional policy choices are recorded in the hosted SQL report; they were not silently dismissed.

The hourly 30-day Trigger scenario is **720 ticks × assumed 10 seconds = $0.26136** before retries, with no paid plan change. Estimated source requests/raw storage remain about 3,000 GETs and 0.77 GB if every scheduled body changes; actual runtime/storage/invoices are unmeasured. Observed source charges are $0, model/Resend/calendar calls zero. See `docs/cost-model.md` and `reports/stage-1-costs.json`. HQ full/member coverage and Instagram/Stories remain unconfigured; no campus-wide completeness claim is made.

**Calendar writes remain disabled. No Stage 2 work is authorized or started.** Continue from `docs/runbook.md` and `docs/stage-1-hosted-checklist.md`; do not mark Stage 1 accepted until the remaining hosted evidence exists.
