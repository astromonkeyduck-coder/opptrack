# Stage 1 status

**Local Stage 1 implementation verified; hosted acceptance is still open. Stop before Stage 2.** Updated October 20, 2026, America/New_York. Stage 0 is preserved by annotated Git tag `stage-0-complete` at `795f23e4116bd98f1e26a4b933a0d0f2ca1fd7b3`; its complete historical status is in stage-0-status.md.

The remote is present: `origin` points to `https://github.com/astromonkeyduck-coder/opptrack.git`. No missing-remote blocker exists. `.env.local` was created with four empty credential placeholders, APP_URL and disabled calendar flag using exclusive creation; existing values were never overwritten. It is ignored and not tracked. Private captures, exported rows, backups, evidence HTML and screenshots remain below ignored private/. No keys were printed.

## Implemented

- Next.js 16/TypeScript private inbox for one explicitly registered Supabase Auth user. Verified-user SSR, private/no-store session handling, owner-membership checks, source/notes search, separate pagination, and occurrence save/reject decisions. No public signup UI or mock event fallback.
- Supabase migration with source runs, private captures, event/occurrence/milestone records, immutable versions/claims, native source-scoped identities, single-owner RLS/composite ownership FKs, private Storage policies, lease/recovery and atomic metadata/cursor commits. Existing immutable objects are downloaded and hash-verified on duplicate-upload responses; other failures do not advance cursors.
- Central Localist collection with contiguous pagination/row-total validation, plus independent Music public preview. Runtime schema checks, response/redirect/byte/time bounds, HTTP-200 login-wall detection and conservative unknown facts. A legitimate nullable external URL discovered live was fixed without relaxing the required native event URL/identity evidence. Withheld location placeholders become unknown fields rather than venues.
- One real Trigger SDK dispatcher task, 15-minute schedule/concurrency one, SQL source leases, Retry-After/backoff, distinct attempt/success timestamps and expired-lease recovery. Only central hourly and Music every six hours are enabled when owner setup runs. The 59-route catalog retains disabled/stale/blocked/HQ/social gaps.
- Authenticated private manual link/flyer intake: retain-only HTTPS links with no server fetch/redirect, origin/body/MIME/signature/size checks, all supplied files retained, submission/hash dedupe, private attachment downloads. Files remain pending human verification; no OCR/model extraction runs. Resend and social credentials are optional and unused.
- Retention targets and service-only bounded candidate planning protect active shared references and identify aged orphans. Hosted deletion remains disabled pending a safe refresh/deletion protocol and Storage restore check. Uncertain upload finalizations can retain orphan files; cleanup is a remaining release gate, not an automatic seven-day deletion guarantee.

## Actual evidence and commands

Full local command stdout/stderr/exit codes: reports/stage-1-verification.json. Reports label every replay/mock boundary. Initial failures remain evidence rather than “nothing new.”

| Command/action | Actual result |
| --- | --- |
| `git tag -a stage-0-complete 795f23e...` | Annotated checkpoint created before Stage 1 edits; no existing tag overwritten. |
| Exclusive `.env.local` creation; `git check-ignore`/tracked-file inspection | Empty placeholders created, mode 600; dotenv and private capture paths ignored, no tracked secret/capture file. |
| Pinned dependency install and clean `npm ci` | Root package/lockfile available for Netlify. Optional deployment CLI was removed after introducing unpatched advisories; retained SDK/application audit recorded separately. |
| `npm run collect:live -- --start=2026-10-20` (initial + corrected + final live fetches) | **12 actual public HTTP attempts total**. Final central seven-day window: 4 pages, 293 event IDs, 332 occurrences, 1,058,353 bytes. Music: 10 dated preview cards, 65,372 bytes. Initial nullable-URL schema failure is preserved in reports/stage-1-source-initial-live.json. Final report: stage-1-sources-live.json. |
| `npm test` | **43 tests pass**: collectors/dispatcher, private intake/render/freshness, and ingestion/storage-replay boundaries. Synthetic responses and component records are labeled test fixtures. |
| `npm run test:db` | **29 actual PostgreSQL checks pass** using PGlite 0.5.10. Migrations, anon/other-user denial, service-only writes, composite ownership, private Storage policies, submission dedupe, cursor rollback, genuine empty capture, retries, leases, purge planning and rehydration verified. Auth/storage compatibility tables are a test harness, not hosted services. |
| `npm run prove:live` | **8 live-data SQL checks pass**. Actual fresh source bodies normalize into 303 opportunities, 342 occurrences, 5 captures, 645 versions and 1,935 claims; all 59 health routes retained. Owner SQL role reads 342 rows over seven tested pages. Anonymous denied; other test identity sees zero. Full-text search works. Re-ingestion preserves counts/decisions. Actual database dump/restore and local raw-object deletion/marker verified. |
| `node --import tsx scripts/prove-dispatcher-replay.ts` | Exact production Trigger handler → dispatcher → collectors → ingestion → SQL RPC exercised with explicitly replayed HTTP and private-file Storage adapters. Two replayed source runs add no duplicate facts/captures/versions; five immutable objects reused and saved decision survives. **Not Trigger Cloud or Storage HTTP evidence.** |
| `npm run typecheck`, `npm run build` | Exit 0. Production dynamic auth/inbox/intake/private-download routes compile; the earlier missing-package Netlify issue is resolved locally. |
| `make check` | Exit 0: 59 existing Python tests; registry validation; 45 evaluation scenario contracts; separate production-template validation. Scenario contracts are not extraction accuracy results. |
| `npm run evidence:inbox` and in-app browser inspection | Actual inbox component renders seven sampled real source occurrences selected through owner RLS. Desktop/full-page screenshot and 390px mobile screenshot saved privately. Mobile heading visible and no horizontal overflow. Static evidence rendering explicitly labels hosted Auth/Storage/Trigger as unverified; no app auth bypass was added. |
| Production Next.js HTTP smoke on localhost | Setup page HTTP 200; /inbox and /intake redirect while unconfigured; private download denies access; foreign-origin intake rejected. No raw event catalog exposed without authentication. See stage-1-http-smoke.json. |
| `npm run check:env` | Exit 2 at last check: four credential names still missing, values hidden. Editor-open request queued in Codex; user requested the file to fill directly. |
| `git diff --check` | Exit 0. |

The 303 source-scoped opportunities can contain cross-source duplicates; no audited unique-campus count is claimed. Calendar coverage window is October 20 through the seven-day request ending October 27, as measured by the live report. Music has no full-calendar pagination claim. Unknown timezone/end/ticket facts remain visible. All event content is source evidence, never instructions.

## Live, local, mocked and untested

**Live:** fresh read-only public central/Music responses and real source facts. **Actual local database:** migrated PostgreSQL, roles/RLS, transactions, hashes/native identities, versions, decisions, source health, pagination/search, dump/restore. **Explicit adapters/fixtures:** synthetic failure tests, SQL auth/storage compatibility shell, source-HTTP replay and local-file Storage adapter in dispatcher proof. **Not yet operational/verified:** hosted Supabase Auth/JWT/Storage HTTP, cloud Trigger deployment/schedule/run, authenticated deployed inbox, hosted database/Storage restore and distributed contention. SDK registration does not close those gaps.

Local screenshots are private/stage-1-inbox-preview.jpg, stage-1-inbox-desktop.jpg and stage-1-inbox-mobile.jpg. They demonstrate real events in the inbox component with the local SQL boundary clearly shown; they do not prove an authenticated cloud session.

## Costs and remaining access

Observed public source provider charges: **$0**. Zero model calls, paid connector runs, Resend messages, calendar writes, purchases or verified cloud runs. Account invoices and coding/tool subscription costs are unmeasured. The explicit 30-day scenario is in reports/stage-1-costs.json and docs/cost-model.md: about 0.77 GB raw if every scheduled body changes; Trigger compute/invocations modeled at $1.0454 before retries under an assumed ten seconds/tick. Free quotas may fit, but storage growth, cleanup, media and actual runtime are not yet measured. An illustrative paid baseline without models is $44/month; nothing was purchased/enabled.

Remaining Stage 1 requirements: fill local Supabase URL/publishable/server-secret and Trigger development key directly; provide the non-secret Trigger project reference and existing Auth owner UUID; apply migration to the intended Supabase project; verify hosted Auth and Storage access with anonymous/other-account checks; resolve deployment CLI advisories and run the real Trigger task; apply separate Netlify/Trigger production variables and verify deployed login/inbox; test hosted backup/Storage restore, contention and safe retention/orphan cleanup. See runbook.md for concrete steps. These missing credentials do not invalidate the independent local work, and Stage 1 is not falsely marked accepted.

HQ member/full coverage, Instagram/Stories, Resend/domain setup, broader seed adapters and later-stage ranking/extraction/alerts remain unconfigured or deferred. **Calendar writes remain disabled, with no provider write code, OAuth calendar scope, or approval endpoint. Stop after Stage 1.**
