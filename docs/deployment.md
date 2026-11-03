# Production deployment: Netlify + Trigger.dev Cloud

Updated November 2, 2026. Next.js/Netlify, private Supabase and the single hourly Trigger dispatcher are deployed. The user explicitly authorized Stage 2; stop before Stage 3 and retain unresolved Stage 1 gates. The seven public producer routes have current successful health. The 27 authorized Instagram routes have historical scheduled success followed by blocked access; Meta repair remains paused. Netlify permits only individually approved create-only Google Calendar actions; Trigger calendar execution remains disabled. No paid upgrade, model API spending, expanded social access or automatic calendar additions are authorized. [Current status](status.md) and [Stage 2 release evidence](../reports/stage-2-release.json) supersede dated release snapshots below.

## November 2/3 parser v3 continuation

New requests default to stage2-rules-v3; archived v1/v2 jobs retain exact original execution. Migration 20261103011203_stage2_extractor_v3.sql is applied as hosted 20261103012026; existing job, attempt, decision and Calendar command hashes are unchanged. [V3 release](../reports/stage-2-v3-release.json) records current published runtime IDs. No environment variable or grant changed: extraction stays Production-only on the existing hourly schedule, Trigger calendar/email flags remain false, and Google secrets stay Netlify-only. The two-private-image scheduled proof is v2 evidence, not an actual v3 private job.

## November 2 Stage 2 runtime

The preceding v2 continuation used forward migration `20261103003949_stage2_extractor_versions.sql` (hosted `20261103005000`), archived immutable v1 execution and default v2 for new requests. Private intake adds normal screenshot paste through its existing owner-authenticated multipart route; no environment variable or permission expansion is required. V2 runtime `ef00f52` is published as Netlify `6ae9318f07b9a300a28a1934` and deployed as Trigger `l4rzbotq` / `20261103.2`. The owner-authenticated paste route saved two synthetic slides into private Storage with exact original hashes. [V2 release evidence](../reports/stage-2-v2-release.json) records its publication checks; the following initial foundation deployment remains history.

Migration `20261102194633_stage2_evidence_jobs.sql` is applied as hosted `20261102221746`; its 26-check hosted rollback policy audit passed. Runtime commit `90612d7b3e676a130412ac6d21dca48763767d12` is published on Netlify as `6ae91dd9395579873c5ee0fb` and deployed on Trigger as `iaohc393` / version `20261102.8`. The initial text path used `c1bfab2` / Netlify `6ae91b9de754f72dfb3b6108` / Trigger `3fqff5ic` (`20261102.7`). Trigger's `STAGE2_EXTRACTION_ENABLED=true` is saved in **Production only**; its example default remains false.

Netlify queues owner-only immutable extraction snapshots after durable intake and never receives a Supabase worker secret. Trigger retains calendar/email flags false and receives no Google/model secret. The existing hourly dispatcher starts a separate bounded extraction task; no faster cron or paid upgrade is introduced. SQL limits two newly started jobs and twelve attempted visual pages per owner per UTC day. Results stay private unverified suggestions, without catalog promotion or calendar authority.

Actual owner-authenticated notes-only intake completed in manual Production run `run_06gpt6g6fqap2codcf9j8loma2` on version `20261102.7`; hosted SQL records one succeeded attempt and the owner UI displays two evidence-linked suggestions. This is a **synthetic text input with zero uploaded assets**, not hosted private-media OCR, Storage HTTP, automatic-schedule or laptop-off proof. It made zero model or Calendar calls. The rules diagnostic still fails its quality gate and no human-reviewed holdout has been accepted. Follow [the Stage 2 runbook](stage-2-runbook.md), [current release evidence](../reports/stage-2-release.json) and [hosted text-job evidence](../reports/stage-2-hosted-text-job.json). A later manual public-PDF Cloud run `run_06gpt7k4u80g6jcgsg994f5ca2` verified all six pages, Tesseract 5.3.0 and Poppler 22.12.0; [native probe evidence](../reports/stage-2-cloud-native-probe.json) preserves the initial redirect failure and an idle operator attempt. Public native execution is separate from private Storage/media and schedule proof. Stage 2 is not accepted.

## November 1 approval-only writer

The user explicitly authorized a narrow create-only Google writer. Migration `20261102021158_approved_calendar_writes.sql` is applied as hosted `20261102022214`; **Netlify Production** `CALENDAR_WRITES_ENABLED=true` is saved, and the owner has granted the dedicated owned-event scope. Keep the template default false for new environments. Keep **Trigger Production** `CALENDAR_WRITES_ENABLED=false`; no Google credential or executor belongs there. The current Stage 2 checks preserve the existing succeeded Calendar command and create no calendar action. [Writer release evidence](../reports/calendar-write-release.json).

The owner reconnects using `/api/calendar/connect?mode=write` and reviews the exact `calendar.events.owned` consent. Existing read credentials survive cancelled/failed consent. The grant can manage events on owned calendars; application code uses fixed primary-calendar GET/insert only. It does not update/delete events or add attendees/recurrence/default reminders. Each event/reminder has a separate `/calendar` preview and explicit POST approval. Source collection, Save/Pass/Undo and previous saved cards do not write Google events. [Writer runbook](calendar-writes.md). Older read-only release/configuration snapshots below remain history.

## Netlify production app

Use repository root, Node 22, build `npm run build`, publish `.next`. Install devDependencies during builds. The explicit OpenNext fallback pins `@netlify/plugin-nextjs@5.16.4` in package/lock and `netlify.toml`, producing one server/one edge function. Do not use v4, static export or a SPA catch-all. The pin opts out of automatic adapter updates and must be maintained; revisit only after automatic runtime detection works.

Site [luxury-longma-01d2fa](https://luxury-longma-01d2fa.netlify.app) tracks main; its UUID remains unverified. Keep these five values in one **Production** context:

| Netlify variable | Purpose |
| --- | --- |
| APP_URL | Actual production HTTPS origin |
| NEXT_PUBLIC_SUPABASE_URL | Public Supabase API origin |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public browser key, constrained by session/RLS |
| CALENDAR_WRITES_ENABLED | `true` for the individually approved Netlify writer only |
| INBOUND_EMAIL_ENABLED | `false` |

Use `.env.netlify.production.example`. Public build values require a rebuild after changes. Existing Free controls lock scopes to all scopes. The table above contains public configuration and nonsecret feature flags. The separately authorized Google read/approval-only write integration adds server-only credentials below; no paid upgrade is authorized to narrow provider scopes. Server values must never be prefixed `NEXT_PUBLIC_`, imported by client code, or printed in build logs. **No Supabase server secret, Instagram token/caller ID or Meta App Secret belongs on Netlify.** The app uses the signed-in owner's session/RLS, including the owner-only database extraction queue. It has no direct Trigger API credential or enabled inbound-email endpoint.

### Google Calendar server credentials and consent

Primary Google Calendar reads, cloud configuration and fresh owned-event consent are verified. The November 1 approval-only extension permits a separately approved insert for one eligible event or action reminder. The dedicated Google project is `iron-radio-512315-g3`, with no billing activation authorized. Google execution and encrypted tokens stay on Netlify; Trigger never receives these credentials.

| Additional Netlify variable | Purpose |
| --- | --- |
| GOOGLE_CLIENT_ID | Dedicated Web application OAuth client; server functions |
| GOOGLE_CLIENT_SECRET | Protected client secret; server functions only |
| CALENDAR_TOKEN_ENCRYPTION_KEY | Stable 32 random bytes as canonical base64; server functions only |

These three variables are required together for the enabled calendar integration: absent or incomplete configuration displays setup-needed instead of pretending calendar access works. No access/refresh token is stored in environment variables. Google credentials and the encryption key never belong in Trigger or browser bundles. No Supabase service key is added to Netlify; existing owner-session RPCs store only AES-256-GCM ciphertext in a private RLS table. The original connection migration `202610200006_google_calendar_readonly.sql` is applied as hosted `20261021152408`, with its 32-check policy audit verified October 21. The later approval/outbox migration is recorded above; new environments apply the committed migration sequence before enabling the writer.

Register exactly `https://luxury-longma-01d2fa.netlify.app/api/calendar/callback` for the Web client. The authenticated same-origin read connection uses `https://www.googleapis.com/auth/calendar.events.readonly`; write mode requests the dedicated `https://www.googleapis.com/auth/calendar.events.owned` scope after explicit consent. State/PKCE and a ten-minute HttpOnly cookie protect the callback. Reads call the fixed `primary` events endpoint and return minimal event titles/times to the owner. The separately approved writer uses fixed primary-calendar GET/insert only, never updates/deletes, and does not treat Save/Pass/Undo as approval. Use a dedicated project because disconnect revocation can affect all clients/scopes under that project. Full setup, failure states, retention boundaries and provider references: [Calendar read runbook](calendar-readonly.md).

Password sign-in uses the actual Netlify Auth Site URL. The user-created confirmed account is already the sole owner; public signup/anonymous sign-in are disabled and confirmation remains enabled. Do not invent another login or replace ownership. Keep preview/development settings separate.

Historical October 21 worker release `2073828` had GitHub Actions `39616984224` success at `2026-10-21T14:32:19Z` and verified Trigger deployment below. Earlier web/runtime release evidence includes commit `5e1a57dc42fc4562f1a9990b05568c2bd55044d1`, Netlify deploy `6ad815cc31d991b1f07a39bd`, Actions `39527759560` success. The owner has viewed real posts, caption search and pagination. Historical static-only `1d04777` returned 404; corrected `9fc73a6`/`6ad7fd1b5a01e9295c7a246e` proved runtime packaging and anonymous home 200/inbox 307/private-media 401. [Earlier deployment](../reports/stage-1-hosted-deployment.json), [watchlist release](../reports/instagram-watchlist-release.json), [monitoring release/run evidence](../reports/instagram-production-monitoring.json). Later code releases require their own published confirmation.

## Supabase migrations and ownership

Existing project `nuywbvlcwetqjalqvxzb` began with these immutable migrations. This table is the October 21 baseline, not the complete current history; apply all files in `supabase/migrations` in order in a new environment.

| Local migration | Hosted version |
| --- | --- |
| `202610200001_stage1.sql` | `20261020231512` |
| `202610200002_hourly_cadence.sql` | `20261020231950` |
| `202610200003_instagram_monitoring.sql` | `20261021012900` |
| `202610200004_instagram_27_accounts.sql` | `20261021142636` |

Inspect history before applying/retrying; a new environment applies all in order. The Supabase CLI was unavailable locally, so 003/004 followed the repository's existing sequence. Management access is separate from application API keys.

Calendar migrations 005/006 are applied as 20261021151303/20261021152408; their 32-check hosted rollback audit passed. It creates `tracker_private.google_calendar_connections` with RLS, ciphertext-only fields and owner-checked encrypted get/put/delete RPCs. UUID revision guards prevent stale refreshes from overwriting a newer connection. It adds no source, calendar write, service key, approval or outbox. The historical October 21 consent and complete 71-event read are recorded in `reports/swipe-review-release.json`. The later owned-event grant, encrypted credential refresh and single-item writer have separate evidence in [the writer runbook](calendar-writes.md) and current status; long-term reconnection remains an operational concern.

The initial fourteen public tables have RLS; later calendar/extraction migrations add their own ownership policies and checks. Both `review_inbox` and `instagram_updates_current` are security-invoker; authenticated reads require the sole owner. Captures use private Storage. Current manual intake accepts at most 4 MiB per file and combined, plus 64 KiB multipart overhead; the earlier bucket limit is not the upload UI limit. Service-only RPCs lease/complete collections; authenticated clients cannot forge source facts or Instagram versions. Source/native identities and content hashes preserve stable posts and append edited versions. Publication metadata stays separate from event/occurrence records.

For a genuinely new environment only, have the user select/create their intended confirmed Auth login privately, then use trusted setup access:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
```

`setup:sources` seeds 59 original registry and 28 watchlist routes, ignores conflicts and preserves current health/cursors. Fresh Instagram routes are disabled. The October 21 expansion snapshot had 87 source records and 29 enabled routes: Central, Music and exactly 27 approved Instagram accounts. The later public HQ and official monitor release recorded 89 source rows and 34 enabled routes (seven public producers plus the same 27 Instagram accounts); this does not imply healthy social access. [Official monitor release](../reports/official-monitors-hosted-release.json). Use an explicit validated account-ID list for activation; never a broad Instagram prefix. `fsucre`, generic social and paid routes stay disabled. Migration 003 itself enables nothing.

The separate `config/instagram-candidates.json` inventory contains 209 candidate records (at import: 15 overlaps, 194 additional; 29 high/14 new, 180 standard, three unverified aliases). It is not source enablement or access evidence; no candidate was probed or seeded by the import. The later separately authorized 11-source activation is not part of the import: its dated activation state was 87 sources/29 enabled, with 26 inventory overlaps active and 183 candidates inactive. No Stage 2 source expansion is authorized.

The server secret stays in trusted ignored setup/worker files and Trigger Production. Thirty-two populated core and 33 social hosted SQL-role checks passed read-only/rollback, with no fake users/rows. These are separate from signed-JWT and known-object HTTP tests, which remain open. Existing owner browser sessions are real Auth evidence.

## Trigger.dev Cloud production worker

Project `proj_wurjjfgxnzhkvcewuaci` tracks main through a GitHub App limited to **opptrack only**. Use `.env.trigger.production.example`, separately from Netlify and local development. Current runtime settings are Production-only; Development remains unchecked:

| Trigger variable | Purpose |
| --- | --- |
| APP_URL | Production app origin |
| SUPABASE_URL | Worker API origin |
| SUPABASE_SECRET_KEY | Protected worker server secret; bypasses RLS |
| EMAIL_DELIVERY_ENABLED | `false` |
| CALENDAR_WRITES_ENABLED | `false` |
| SOCIAL_COLLECTION_ENABLED | `true` for the existing approved 27 accounts; access is currently blocked and repair paused |
| STAGE2_EXTRACTION_ENABLED | `true` in Production only; safe template default remains `false` |
| IG_FB_USER_ACCESS_TOKEN | Protected Facebook User read token, worker only |
| IG_CALLER_USER_ID | Protected linked professional-account numeric ID |
| IG_TOKEN_EXPIRES_AT | Optional verified expiry only; never guess |

Historical October 21 token exchange returned conservative expiry `2026-12-20T00:40:44.610662Z`, and a genuine scheduled run later succeeded for all 27 accounts at nominal 18:00 UTC. The next recorded 19:00 UTC tick blocked all 27 with Graph access failures; the later repair was paused by the user after Meta identity confirmation failed. A future expiry date does not establish current access. Preserve prior posts and visible source failures; do not change credentials, scopes or source activation to repair access without separate authorization. No App Secret is used by the collector and no automatic renewal is established. [Historical token exchange](../reports/instagram-token-extension.json), [success then block](../reports/swipe-review-release.json), [repair pause](../reports/official-monitors-hosted-release.json).

Managed builds have used SDK `4.7.6`, Node `24.18.0`, Small 1 x/us-east-1; web/local use Node 22. The optional local CLI was removed after dependency advisories; no local CLI deployment is claimed. Keep deployment-account tokens out of runtime templates and logs.

The one active schedule `sched_7piwpgtckcngy15icqk45` remains `0 * * * *`, UTC, `window: "60m"`, concurrency one, on Free. Starts are spread inside the hour. Migration 002 uses nominal Central-hourly/Music-six-hour UTC slots and a separate retry floor, so processing time does not skip cycles. Missed slots coalesce; retries wait for later eligible ticks. Migration 003 leases core before social; the 27-source Instagram group (migration 004) has two requests in flight and a bounded 90-second loop. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

First genuine core schedule `run_06glnirsvhqdmbeiiur94st901` ran `00:10:50.502–00:11:11.503Z`, version `20261020.3`; provider provenance and exact SQL IDs match 303 opportunities/342 occurrences/five captures. [Core correlation](../reports/stage-1-cloud-correlation.json).

Manual/test social run `run_06glo936eht6v3gl45naeepge1`, version `20261021.3`, ran `01:47:34.222–01:47:47.737Z`: 16 successful reads, 400 posts/versions, 16 private projections. Genuine schedule `run_06gloea0tch74en66hvp2iis01`, version `20261021.4`, nominal `02:00Z`, ran `02:11:04.492–02:11:25.903Z`: Central success and 16 expired-token blocks, with exact 17 SQL IDs correlated. Total social projections became 32; prior posts survived. Recovered manual/test run `run_06gloh91rq560t7h1a6lmcfre1` then ran `02:23:19.396–02:23:35.587Z` with 16 successful fresh reads, 400 stable posts/versions, 32 retained captures, zero duplicate groups and next nominal social polls `03:00Z`. This is historical evidence: later genuine 14:00 UTC schedule `run_06gltj5jsr8t0547pls4achk01` succeeded for Central and the original 16 Instagram accounts. [Monitoring evidence](../reports/instagram-production-monitoring.json).

## Historical October 21 27-account release

At that release, worker commit `20738287729e018b7ee6d2cf58e3955a089d2b1d` was deployed as `5k9yr7qh`, version `20261021.7`, verified 10:31:39 am Eastern October 21. Forward migration 004 raises only the private social lease ceiling to 27; no RLS/storage/slot/core-priority changes. An initial expired management request was confirmed unapplied before a successful verified retry. The migration itself enables no source.

Exact 11-source activation through `scripts/activate-instagram-11-expansion.sql` completed `14:32:21.903094Z`, yielding 87 sources/29 enabled. Manual/test Cloud run `run_06glto7pof47do100m2q5b7me1` ran `14:32:47.118–14:32:58.246Z`:11 GETs, 228,647 bytes, 11 successes and 275 newly retained posts. That SQL/owner UI snapshot showed 677 posts/versions, 45 sanitized captures, zero duplicate groups and 27 healthy sources with released leases. At the time, the first full 27-account scheduled run was pending. A later nominal 18:00 UTC run succeeded for all 27, followed by the 19:00 UTC access failures recorded above; the historical healthy snapshot is not current health. [Release/run evidence](../reports/instagram-27-account-expansion.json).

The 33-check expanded hosted audit passed at 14:35:44.214128 UTC against 677 posts/45 private objects/27 enabled accounts; it remains a SQL-role test, not signed-JWT/Storage HTTP. [Policy report](../reports/instagram-27-hosted-policy-checks.json).

## Release checks and retained gaps

```sh
npm ci
npm test
npm run test:db
npm run typecheck
npm run build
make check
python3 scripts/validate_production_env.py
```

Current validation and deployment checks are recorded in [the v3 release](../reports/stage-2-v3-release.json). Hosted audits are separate: 26 original Stage 2 SQL-role checks and eight v2 checks passed with rollback; no additional v3 role-fixture audit is claimed. The owner-authenticated two-slide paste upload preserved 104,545 bytes privately, and the genuine hourly parent/child read both stored images with matching hashes. These synthetic inputs prove execution, not real flyer accuracy. Anonymous access to both known app media URLs returned 401. [Scheduled private-media evidence](../reports/stage-2-scheduled-private-ocr.json).

Owner original-download body verification, signed other-user/direct-Storage HTTP checks, isolated hosted backup/Storage restoration, independent-session contention, current physical-phone checks and a user-confirmed laptop-off interval remain open. Include Music's six-hour window for laptop-off evidence. Stage 2 additionally needs varied human-reviewed development/independent holdout examples, semantic correctness and authorized model/prompt comparison. Stories, social image/video access, full histories, private HQ access and ticket-inventory completeness remain gaps; Meta repair is paused. Dotenv, raw captures, uploaded objects, screenshots and backups remain ignored. Safe orphan cleanup and production deletion remain disabled. Calendar additions remain individually approved on Netlify only; Trigger writes, model spending, paid upgrades and Stage 3 remain unauthorized.

Primary references: [Netlify OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [environment scopes](https://docs.netlify.com/build/environment-variables/overview/), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Storage policies](https://supabase.com/docs/guides/storage/security/access-control), [Trigger environments](https://trigger.dev/docs/deploy-environment-variables), and [Trigger schedules](https://trigger.dev/docs/tasks/scheduled). Provider documentation is separate from project evidence.
