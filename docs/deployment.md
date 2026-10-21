# Production deployment: Netlify + Trigger.dev Cloud

The production Next.js app, single-owner Supabase inbox and hourly Trigger worker operate together. First genuine scheduled collection completed **2026-10-21 00:11:11.503 UTC**, with 303 opportunities, 342 occurrences and five private captured objects visible through the real owner's Netlify session. Full Stage 1 acceptance remains open for the specific HTTP/restore/replay/offline gates below; no Stage 2 work or paid upgrade is authorized.

## Netlify production app

Use repository root, Node 22, build `npm run build`, publish `.next`. Install devDependencies during the build; do not set NODE_ENV=production during dependency installation. The current explicit fallback pins OpenNext `@netlify/plugin-nextjs@5.16.4` in package/lock and declares it in `netlify.toml`.

Published `1d04777` compiled dynamic routes but omitted runtime/functions and returned 404 on all three tested routes at 23:35:43 UTC. Corrected deploy `6ad7fd1b5a01e9295c7a246e`, commit `9fc73a619a39272dc0794f1c7d1186cdb4ea63a4`, reports Next.js Runtime, one server and one edge function. Anonymous checks pass home200/sign-in, inbox307, private-media401. Owner login now succeeds and shows actual collected rows, page 2 and an eight-match search. The watchlist application commit `d5ed016` is separately verified published as deploy `6ad8067ad679ba54923ac5be`, with the same one server/one edge packaging. Its authenticated `/instagram` page displays 17 setup-needed accounts; Actions `39521235011` passed. See `reports/instagram-watchlist-release.json`; later documentation-only deploys are separate.

Netlify normally recommends automatic adapter updates. The documented manual installation supports this current-v5 fallback; the pin opts out of automatic updates and must be maintained. Do not use v4, static export or a SPA catch-all rewrite. Reconsider the pin only after automatic runtime detection is demonstrated. [Netlify adapter configuration](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/#reverting-to-an-older-adapter-version), [official manual installation](https://github.com/opennextjs/opennextjs-netlify#manually-installing-the-nextjs-runtime).

Site: [luxury-longma-01d2fa](https://luxury-longma-01d2fa.netlify.app), main auto-publishing; site UUID is still unverified. These five values are saved in one **Production** context:

| Netlify variable | Purpose |
| --- | --- |
| APP_URL | Actual production HTTPS origin |
| NEXT_PUBLIC_SUPABASE_URL | Public API origin |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public browser key, constrained by session/RLS |
| CALENDAR_WRITES_ENABLED | `false` |
| INBOUND_EMAIL_ENABLED | `false` |

Use `.env.netlify.production.example`. Public Supabase values are needed at build/runtime; rebuild after changes. Existing Free scope controls are locked to all scopes, so store only the public pair/origin and nonsecret false flags here. No upgrade was selected. The web app uses the signed-in user's session/RLS; **SUPABASE_SECRET_KEY must never be on Netlify**. A Trigger production key, Meta token or Resend secret is not needed by the current web app. There is no enqueue/inbound webhook endpoint.

Password sign-in is configured. Supabase Auth Site URL is the actual Netlify origin; public signup/anonymous sign-in are disabled and email confirmation retained. The user created their own confirmed account, registered privately as sole owner at **2026-10-20 23:59:54.436893 UTC**. No password/account was invented by the agent. No calendar OAuth scopes/callback are needed. Keep preview/branch credentials separate and production secrets away from untrusted builds.

```sh
npm ci
npm test
npm run test:db
npm run typecheck
npm run build
python3 scripts/validate_production_env.py
```

Ignored `.env.netlify.production.local` may validate actual settings using `--target netlify --env-file PATH`; validation prints names/errors only. Never overwrite populated files when copying templates.

## Supabase migration, ownership and sources

Existing project: `nuywbvlcwetqjalqvxzb`. Local `202610200001_stage1.sql` was applied as hosted `20261020231512` (`stage1_private_opportunity_inbox`), and `202610200002_hourly_cadence.sql` as `20261020231950` (`stage1_hourly_polling_cadence`). Inspect migration history before retrying; 001 stays immutable. A fresh environment applies both in order. Application keys alone do not provide SQL-management access.

The schema enforces single ownership, 12 RLS-protected public tables, a security-invoker inbox view, private captures, leases/versions/claims and per-occurrence save/reject decisions. Empty ownership denies everyone. Historic zero-owner checks at 23:48/23:53 UTC are preserved, then superseded by the actual confirmed owner bootstrap. Do not rerun registration against another user or replace ownership.

For a genuinely new environment only, have the user create/choose their intended Auth account privately, then use trusted setup access:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
```

`setup:sources` now seeds the original 59 registry routes plus the 17 watchlist routes, ignores existing rows and does not reset health/cursors. The extra 17 `instagram-<handle>` watchlist routes were separately inserted disabled/setup-needed at **2026-10-21 00:16:08 UTC**; hosted total 76, only Central/Music enabled. Do not enable the unconfigured adapter. Source/native identities are scoped; cross-source deduplication is deferred.

The server key belongs only in ignored trusted local setup/direct-worker files and Trigger's worker secret store. The captures bucket is private with a 5 MiB object limit. Actual scheduled ingestion has created five linked objects with matching byte metadata. Thirty-two populated hosted SQL-role/RLS checks passed in a read-only rollback transaction. These checks do not verify signed JWTs or object HTTP body access; the existing real owner browser is separate Auth evidence.

## Trigger.dev Cloud worker

Project `proj_wurjjfgxnzhkvcewuaci` is the verified nonsecret default in `trigger.config.ts`; an explicit TRIGGER_PROJECT_REF can override it. Six variables are saved for **Production only**, with Development unchecked:

| Trigger variable | Purpose |
| --- | --- |
| APP_URL | Public production app origin |
| SUPABASE_URL | Worker API origin |
| SUPABASE_SECRET_KEY | Protected/unviewable server secret; bypasses RLS, worker only |
| EMAIL_DELIVERY_ENABLED | `false` |
| CALENDAR_WRITES_ENABLED | `false` |
| SOCIAL_COLLECTION_ENABLED | `false` |

Use `.env.trigger.production.example`, separately from Netlify. Local `.env.local` contains development placeholders and must not be copied to production blindly. Existing values were not overwritten. The approved Meta token exists only in ignored local probe configuration. A future operational Instagram worker would require its own approved secret configuration and expiry/renewal proof; no Meta token is configured in Trigger Production or Netlify. No deployment-account token belongs in application runtime templates.

The authorized GitHub App installation is limited to **opptrack only**, main→Production. Managed build/deploy works; first deploy `kx5ru529`/version `20261020.1` completed 23:46:19 UTC. Successful collection used **version `20261020.3`**, SDK 4.7.6, Node 24.18.0 on Small 1x in us-east-1; this differs from web/local Node 22. The optional CLI was removed after dependency advisories; resolve/recheck before installing a pinned CLI. No successful local CLI login/dev/deploy is claimed.

Enabled schedule **`sched_7piwpgtckcngy15icqk45`** uses `0 * * * *`, UTC, `window: "60m"`, concurrency one and SQL leases. Trigger Free uses a stable offset inside that one-hour window; first nominal 00:00 UTC tick actually started **00:10:50.502**. This is compatible with Free and does not promise exact-hour or minute-level alert timing. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

Central uses 3,600-second slots; Music uses 21,600-second slots (00/06/12/18 UTC). Migration 002 separates `next_poll_at` from completion time and `retry_not_before` from the poll grid; effective due is their maximum. Success advances from the leased nominal slot, so processing over a boundary leaves the next slot due. Missed slots coalesce once; retries wait for a later dispatcher after the floor. Following the first successful run, Central is next due 01:00 UTC and Music 06:00 UTC, with leases released and no retry floor.

First genuine scheduled run **`run_06glnirsvhqdmbeiiur94st901`** completed 00:10:50.502–00:11:11.503 UTC. Runtime run-metadata retrieval verified actual task/schedule before dispatch. Cloud output IDs match SQL Central `6bdef3ce-3cb8-4b71-86d5-e0de21293a2f` and Music `91deb43b-58a8-48f9-bb30-a972c1aa73d2`, including exact captures, commits and counts. See `reports/stage-1-cloud-correlation.json`. Dashboard run estimate $0.00068775 is actual displayed usage, not a monthly invoice. The laptop remained active, so this is not offline proof.

Earlier manual Production run `run_06glndpqqqf43ur6djisksj5e1` failed the missing-owner guard at 23:48:19.519–23:48:23.434 UTC, before any fetch/row. Its synthetic `sched_1234`/`IMPERATIVE` payload is not schedule proof. Dashboard estimate: $0.00009868. Preserve this guard failure rather than recasting it as successful collection.

## Release and privacy gates

Dotenv, raw captures, rows, backups and screenshots remain ignored. Links are retained without server fetch, all supplied media stays private/pending verification, and no OCR/model or Resend integration is active. Two synthetic link-only intake records are visible; hosted two-slide upload was blocked by browser file-access tooling and remains unverified.

Owner login, real rows/search/pagination and populated SQL policy checks now pass. Still required: known-object owner/non-owner Storage HTTP and downloaded-body integrity, hosted multi-slide/idempotency/size-type checks, decisions surviving repeated hosted collection, mobile behavior, distributed contention/recovery, hosted database/Storage restore and safe retention/orphan cleanup. Retention planning deletes nothing. A user-confirmed laptop-off interval with exact scheduled source-run commits is still required; include Music's six-hour window for a claim about both adapters.

The user additionally authorized the 17-account Instagram watchlist and permitted Meta setup/access tests. Four read grants plus public_profile are verified, the approved Page/professional account is linked with inbox access Disabled, and the local probe token works. Fresh bounded CLI reads succeeded for 16 accounts; `fsucre` returned HTTP 400 / Graph 110 / subcode 2207013, cause unresolved. See `reports/instagram-cli-access.json`. No production token, scheduled Instagram ingestion, media downloads, Stories or event extraction is configured. Keep social false and all 17 sources disabled/setup-needed. No paid connector or upgrade was enabled. Calendar writes remain disabled; no broader Stage 2 work started.

## Primary references checked October 20, 2026

- [Netlify Next.js/OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) and [environment contexts/scopes](https://docs.netlify.com/build/environment-variables/overview/).
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Storage policies](https://supabase.com/docs/guides/storage/security/access-control), [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), and [Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes).
- [Trigger scheduled tasks](https://trigger.dev/docs/tasks/scheduled), [configuration](https://trigger.dev/docs/config/config-file), and [runtime environments](https://trigger.dev/docs/deploy-environment-variables).

Provider documentation describes supported behavior; it is separate from project-specific evidence.
