# Production deployment: Netlify + Trigger.dev Cloud

Netlify SSR and the Trigger Production worker are deployed. Supabase migrations 001/002, Auth settings and separate web/worker variables are saved. Anonymous web checks pass. One real manual cloud test failed the required owner-setup guard before collection; this is not scheduled-run proof. Authenticated ingestion/inbox, Storage operations and laptop-off collection remain pending because no owner Auth account exists.

## Netlify production app

Use repository root, Node 22, build `npm run build`, publish `.next`. Build devDependencies must be installed; do not set NODE_ENV=production during dependency installation. The current exception explicitly pins modern OpenNext `@netlify/plugin-nextjs@5.16.4` in package/lock and declares it in `netlify.toml`.

This fixes observed missing runtime packaging: published `1d04777` compiled dynamic routes but omitted the Next runtime/functions, uploaded 238 static files and returned 404 for `/`, `/inbox` and `/api/private-media` at 23:35:43 UTC. The corrected published deploy `6ad7fd1b5a01e9295c7a246e`, commit `9fc73a619a39272dc0794f1c7d1186cdb4ea63a4`, now reports **one server function, one edge function and Next.js Runtime**. Three fresh live checks pass: home **200** with sign-in, inbox **307** anonymously, private-media **401** anonymously. This verifies runtime deployment and anonymous access behavior; no owner session is claimed.

Netlify normally recommends automatic adapter updates. Its documented manual-install route supports this explicit current-v5 fallback; the pin opts out of automatic updates and must be maintained. Do not use v4, static export or a SPA catch-all rewrite. Once automatic runtime detection is demonstrably restored, the pin can be reconsidered. [Netlify adapter configuration](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/#reverting-to-an-older-adapter-version), [official manual installation](https://github.com/opennextjs/opennextjs-netlify#manually-installing-the-nextjs-runtime).

The site is `luxury-longma-01d2fa`, at `https://luxury-longma-01d2fa.netlify.app`; its site UUID remains unverified. All five variables are confirmed saved in one **Production** context: APP_URL, public Supabase URL/publishable key, CALENDAR_WRITES_ENABLED=false and INBOUND_EMAIL_ENABLED=false. The deployed sign-in page passes; owner-authenticated behavior still needs an account and explicit owner registration.

Use `.env.netlify.production.example` for this web target. The public pair needs Builds + Functions and a rebuild after changes. The existing Free plan locks variable scopes to **all scopes**; retain the Production-only context and put only the public APP_URL/public Supabase pair and nonsecret disabled flags there. No paid upgrade was selected to unlock narrower scopes. Where a future plan permits it, narrow variables to their documented scopes. The web app uses the signed-in user's Supabase session/RLS; **never add SUPABASE_SECRET_KEY to Netlify**. The optional Trigger production key is unused by Stage 1 and need not be configured. There is no enqueue or inbound Resend webhook endpoint yet.

The app uses password sign-in. Supabase Auth Site URL was saved to the actual Netlify origin with a success confirmation; public signup and anonymous sign-in are disabled, while email confirmation remains enabled. The owner Auth account/registration is still absent. No OAuth callback/calendar scopes are needed. Keep preview/branch deploy credentials separate; never expose production secrets to untrusted builds.

```sh
npm ci
npm test
npm run test:db
npm run typecheck
npm run build
python3 scripts/validate_production_env.py
```

Use ignored `.env.netlify.production.local` to validate actual settings with `--target netlify --env-file PATH`; the validator prints names/errors only. Do not overwrite populated files when copying templates. A successful local build is not a successful Netlify deploy. Verify the actual hosted commit, owner login, unauthorized redirects, private downloads, search/pagination, and mobile inbox before acceptance.

## Supabase migration and ownership

The existing Supabase project is `nuywbvlcwetqjalqvxzb`. Migrations `202610200001_stage1.sql` and `202610200002_hourly_cadence.sql` were applied through authorized project access. Inspect migration history before retrying; never edit/reapply 001 as an upgrade. A new environment applies both in order. The second migration adds fixed UTC poll slots, separate retry floors and durable run provenance. The three app keys alone do not supply a SQL-management channel.

The schema enforces single ownership, RLS, private captures, leases/versions/claims and save/reject-only decisions. At **2026-10-20 23:48:31.583435 UTC**, hosted Auth users, owners, sources, opportunities, captures, source runs and Storage objects were all zero. The user declined manual account creation; no user or invitation was created. No guard or ownership check was bypassed. Empty membership continues to deny access until the intended login exists and is explicitly registered.

Create/choose the existing owner account in the dashboard, then from the trusted local environment:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
```

The local server secret belongs only in ignored `.env.local` for setup/direct worker commands, and in Trigger's worker runtime for production. `setup:sources` ignores existing rows and cannot reset cursors/health. Source IDs/hashes remain scoped to their actual source; cross-source duplicate matching is deferred.

## Trigger.dev Cloud worker

The verified project ref is `proj_wurjjfgxnzhkvcewuaci`; `trigger.config.ts` defaults to this nonsecret value for managed builds and permits an explicit TRIGGER_PROJECT_REF override. All six worker variables were confirmed saved for **Production only**, with Development unchecked: APP_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, EMAIL_DELIVERY_ENABLED=false, CALENDAR_WRITES_ENABLED=false and SOCIAL_COLLECTION_ENABLED=false. The server key was stored as a secret with its value unviewable; no key value is printed or committed.

After the user reconnected, the new GitHub app installation was verified for **one selected repository, opptrack only**, with main tracking Production. Trigger deploy `kx5ru529`, worker version `20261020.1`, completed at **23:46:19 UTC** on Node **24.18.0**. This is distinct from the web/local Node 22 configuration. The active/enabled schedule `sched_7piwpgtckcngy15icqk45` was created at 23:46:11 UTC, uses hourly UTC cron, a one-hour window and concurrency one. Its last scheduled run was **Never** at inspection; the displayed next time around 00:10 UTC is not a precise timing promise.

Manual Production test `run_06glndpqqqf43ur6djisksj5e1` was triggered at 23:48:17.400 UTC, ran 23:48:19.519–23:48:23.434 UTC and failed with **AbortTaskRunError** because owner setup is required before collection. It is a real cloud invocation with unmeasured dollar cost, but its synthetic `sched_1234`/`IMPERATIVE` test payload is **not evidence of scheduler execution**. No source transaction was committed. Complete owner setup before demonstrating successful source collection; do not weaken the guard.

The SDK task `opportunity-source-dispatcher` declares hourly cron `0 * * * *`, UTC, with `window: "60m"`, queue concurrency one and SQL due-source leases. This accommodates the Free-created schedule policy: cadence cannot exceed hourly, and execution uses a stable offset within the hour after its nominal cron time. The nominal timestamp is not the actual start; minute-level alert timing is not promised. No upgrade was used. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

Central keeps 3,600-second UTC slots; Music keeps 21,600-second slots (00/06/12/18 UTC). Migration 002 stores `next_poll_at` independently of completion time and `retry_not_before` independently of the poll grid; effective due is their maximum. A source retry is eligible at a later dispatcher tick after that floor, not guaranteed immediately when the floor expires. Missed source slots coalesce once without a catch-up burst. Only these two free public adapters are enabled after owner setup. SDK infrastructure retries wait for lease recovery. Code registration and replay do not verify cloud execution.

The SDK is pinned to 4.7.6. The optional matching CLI was inspected and removed because its dependency tree introduced an unpatched braces advisory and vulnerable archive dependencies. Resolve/recheck its advisories before selecting a pinned deployment CLI. No CLI login/dev/deploy succeeded here. Once a verified CLI is available, run its documented dev/deploy commands for the actual project, independently of the Netlify build. CLI --env-file supplies its local process, not uploaded runtime values. Set worker values explicitly in Trigger's dashboard; deployment account tokens stay outside app runtime templates.

Next verify a genuine scheduled cloud run, exact source-run/capture correlation and owner-visible real rows in the same project. Deployment and the failed manual test do not close those gates. Record logs without keys/raw bodies. No paid connector or upgrade was enabled.

## Privacy and release gate

`.env.local`, populated production dotenv files, raw captures, backups, exported event rows and screenshots remain ignored. Authenticated downloads return attachments/no-store, not public Storage URLs. Manual links are retained without fetching; supplied files remain pending verification. Model/OCR extraction and Resend are optional and unused.

Local database backup/restore and SQL access controls pass; hosted Auth/Storage HTTP, complete Storage backup, distributed contention and safe hosted purge/refresh are still required. Retention planning deletes nothing until those checks pass. Do not call this hosted-ready merely because the build passes. Keep calendar provider code, OAuth scopes and writes absent; stop after Stage 1.

## Primary references checked October 20, 2026

- [Netlify Next.js/OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) and [environment contexts/scopes](https://docs.netlify.com/build/environment-variables/overview/).
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Storage policies](https://supabase.com/docs/guides/storage/security/access-control), [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), and [Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes).
- [Trigger scheduled tasks](https://trigger.dev/docs/tasks/scheduled), [configuration](https://trigger.dev/docs/config/config-file), and [runtime environments](https://trigger.dev/docs/deploy-environment-variables).

Provider documentation describes supported behavior; project-specific hosted verification remains necessary.
