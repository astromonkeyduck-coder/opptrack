# Production deployment: Netlify + Trigger.dev Cloud

Next.js/Netlify, private Supabase and the single hourly Trigger worker are deployed. Core scheduled collection works. The authorized 16-account Instagram extension is deployed and enabled; its manual smoke collected 400 posts, but its first genuine automatic tick was blocked by token expiry. The replacement token/verified expiry are installed; a fresh manual Production recovery succeeded, while recovered scheduled success still needs separate evidence. No paid upgrade, calendar write or Stage 2 work is authorized.

## Netlify production app

Use repository root, Node 22, build `npm run build`, publish `.next`. Install devDependencies during builds. The explicit OpenNext fallback pins `@netlify/plugin-nextjs@5.16.4` in package/lock and `netlify.toml`, producing one server/one edge function. Do not use v4, static export or a SPA catch-all. The pin opts out of automatic adapter updates and must be maintained; revisit only after automatic runtime detection works.

Site [luxury-longma-01d2fa](https://luxury-longma-01d2fa.netlify.app) tracks main; its UUID remains unverified. Store these five values in one **Production** context:

| Netlify variable | Purpose |
| --- | --- |
| APP_URL | Actual production HTTPS origin |
| NEXT_PUBLIC_SUPABASE_URL | Public Supabase API origin |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public browser key, constrained by session/RLS |
| CALENDAR_WRITES_ENABLED | `false` |
| INBOUND_EMAIL_ENABLED | `false` |

Use `.env.netlify.production.example`. Public build values require a rebuild after changes. Existing Free controls lock scopes to all scopes, so only public configuration/nonsecret disabled flags belong here. **No Supabase server secret, Instagram token/caller ID or Meta App Secret belongs on Netlify.** The app uses the signed-in owner's session/RLS and has no worker enqueue, calendar OAuth or inbound-email endpoint.

Password sign-in uses the actual Netlify Auth Site URL. The user-created confirmed account is already the sole owner; public signup/anonymous sign-in are disabled and confirmation remains enabled. Do not invent another login or replace ownership. Keep preview/development settings separate.

Current Instagram application release evidence includes commit `5e1a57dc42fc4562f1a9990b05568c2bd55044d1`, Netlify deploy `6ad815cc31d991b1f07a39bd`, Actions `39527759560` success. The owner has viewed real posts, caption search and pagination. Historical static-only `1d04777` returned 404; corrected `9fc73a6`/`6ad7fd1b5a01e9295c7a246e` proved runtime packaging and anonymous home200/inbox307/private-media401. [Earlier deployment](../reports/stage-1-hosted-deployment.json), [watchlist release](../reports/instagram-watchlist-release.json), [monitoring release/run evidence](../reports/instagram-production-monitoring.json). Later code releases require their own published confirmation.

## Supabase migrations and ownership

Existing project `nuywbvlcwetqjalqvxzb` has these immutable migrations:

| Local migration | Hosted version |
| --- | --- |
| `202610200001_stage1.sql` | `20261020231512` |
| `202610200002_hourly_cadence.sql` | `20261020231950` |
| `202610200003_instagram_monitoring.sql` | `20261021012900` |

Inspect history before applying/retrying; a new environment applies all in order. The Supabase CLI was unavailable locally, so 003 followed the repository's existing sequence. Management access is separate from application API keys.

Fourteen public tables have RLS. Both `review_inbox` and `instagram_updates_current` are security-invoker; authenticated reads require the sole owner. Captures use a private 5 MiB bucket. Service-only RPCs lease/complete collections; authenticated clients cannot forge source facts or Instagram versions. Source/native identities and content hashes preserve stable posts and append edited versions. Publication metadata stays separate from event/occurrence records.

For a genuinely new environment only, have the user select/create their intended confirmed Auth login privately, then use trusted setup access:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
```

`setup:sources` seeds 59 original registry and 17 watchlist routes, ignores conflicts and preserves current health/cursors. Fresh Instagram routes are disabled. Current production has 76 source records and 18 enabled routes: Central, Music and exactly 16 approved Instagram accounts. Use an explicit validated account-ID list for activation; never a broad Instagram prefix. `fsucre`, generic social and paid routes stay disabled. Migration 003 itself enables nothing.

The separate `config/instagram-candidates.json` inventory has209 inactive candidates (15 overlaps,194 additional;29 high/14 new,180 standard,three unverified aliases). It is not source enablement or access evidence; no candidate was probed or seeded by the import. The deployed76-source/18-enabled state remains unchanged.

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
| SOCIAL_COLLECTION_ENABLED | `true` for the approved 16-account extension |
| IG_FB_USER_ACCESS_TOKEN | Protected Facebook User read token, worker only |
| IG_CALLER_USER_ID | Protected linked professional-account numeric ID |
| IG_TOKEN_EXPIRES_AT | Optional verified expiry only; never guess |

The approved replacement exchange returned conservative expiry `2026-12-20T00:40:44.610662Z`; the replacement token and verified expiry are installed in Trigger Production only. Manual recovery succeeded for all 16 accounts; a subsequent genuine automatic success is still unverified. The prior token demonstrably expired. No App Secret is required by the collector; transient exchange input was removed. A roughly 60-day exchange is not automatic renewal. Expired/revoked access must remain visibly blocked and preserve prior posts. [Token extension](../reports/instagram-token-extension.json).

Managed builds have used SDK `4.7.6`, Node `24.18.0`, Small 1x/us-east-1; web/local use Node 22. The optional local CLI was removed after dependency advisories; no local CLI deployment is claimed. Keep deployment-account tokens out of runtime templates and logs.

The one active schedule `sched_7piwpgtckcngy15icqk45` remains `0 * * * *`, UTC, `window: "60m"`, concurrency one, on Free. Starts are spread inside the hour. Migration 002 uses nominal Central-hourly/Music-six-hour UTC slots and a separate retry floor, so processing time does not skip cycles. Missed slots coalesce; retries wait for later eligible ticks. Migration 003 leases core before social; the 16-source Instagram group has two requests in flight and a bounded 90-second loop. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

First genuine core schedule `run_06glnirsvhqdmbeiiur94st901` ran `00:10:50.502–00:11:11.503Z`, version `20261020.3`; provider provenance and exact SQL IDs match 303 opportunities/342 occurrences/five captures. [Core correlation](../reports/stage-1-cloud-correlation.json).

Manual/test social run `run_06glo936eht6v3gl45naeepge1`, version `20261021.3`, ran `01:47:34.222–01:47:47.737Z`: 16 successful reads, 400 posts/versions, 16 private projections. Genuine schedule `run_06gloea0tch74en66hvp2iis01`, version `20261021.4`, nominal `02:00Z`, ran `02:11:04.492–02:11:25.903Z`: Central success and 16 expired-token blocks, with exact 17 SQL IDs correlated. Total social projections became 32; prior posts survived. Recovered manual/test run `run_06gloh91rq560t7h1a6lmcfre1` then ran `02:23:19.396–02:23:35.587Z` with 16 successful fresh reads, 400 stable posts/versions, 32 retained captures, zero duplicate groups and next nominal social polls `03:00Z`. **Successful scheduled Instagram ingestion remains unverified.** [Monitoring evidence](../reports/instagram-production-monitoring.json).

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

Current evidence: 103 application tests, 60 local PostgreSQL checks plus six worker replay checks, 60 Python tests and 33 populated hosted social SQL checks. Local fixtures are separate from live integrations. An authenticated 390×844 viewport passed on `5e1a57d`; physical phone remains untested. Known-object downloads and hosted multi-slide intake are unverified; browser approval/tooling blocks were not bypassed. Two synthetic link-only intake records contain zero files.

Dotenv, captured payloads, rows, screenshots and backups remain ignored. Private capture hashes describe sanitized projections for Instagram, raw bodies for core. Uploaded objects cannot share SQL rollback; safe orphan cleanup and production deletion remain disabled. Other open gates include event decisions after repeated hosted collection, distributed recovery, backup/Storage restore, verified credential renewal, successful scheduled social recovery and a user-confirmed laptop-off interval. Include Music's six-hour due window before claiming both core sources survived laptop shutdown. Stories/full history/media extraction/HQ member coverage/tickets remain gaps. Calendar/email/paid connectors and broader Stage 2 remain disabled.

Primary references: [Netlify OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [environment scopes](https://docs.netlify.com/build/environment-variables/overview/), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Storage policies](https://supabase.com/docs/guides/storage/security/access-control), [Trigger environments](https://trigger.dev/docs/deploy-environment-variables), and [Trigger schedules](https://trigger.dev/docs/tasks/scheduled). Provider documentation is separate from project evidence.
