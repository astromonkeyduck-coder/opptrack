# Production deployment: Netlify + Trigger.dev Cloud

Stage 1 contains an authenticated Next.js app, Supabase migrations, manual intake and the Trigger SDK task. Hosted setup is partially applied: Supabase migrations 001/002, five Netlify Production variables and six Trigger Production-only variables are confirmed saved. The Trigger GitHub app is installed for opptrack only, but its organization connection is not recognized and managed deployment is under investigation. No owner Auth account, authenticated inbox, production worker or laptop-off collection has been verified.

## Netlify production app

Use repository root as the base directory, Node 22, build `npm run build`, publish `.next`. `netlify.toml` supplies these settings; the committed package/lockfile resolves the earlier ENOENT failure. Use Netlify's automatic modern OpenNext adapter. Do not add a static export, SPA rewrite or legacy plugin. Build devDependencies must be installed; do not set NODE_ENV=production during dependency installation.

The existing site is `luxury-longma-01d2fa`, at `https://luxury-longma-01d2fa.netlify.app`; the actual site UUID remains unverified. All five variables were confirmed saved in one **Production** context: APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, CALENDAR_WRITES_ENABLED=false and INBOUND_EMAIL_ENABLED=false. This is dashboard evidence, not an inference from template defaults. A rebuilt authenticated Stage 1 deploy remains required.

Use `.env.netlify.production.example` for this web target. The public pair needs Builds + Functions and a rebuild after changes. The existing Free plan locks variable scopes to **all scopes**; retain the Production-only context and put only the public APP_URL/public Supabase pair and nonsecret disabled flags there. No paid upgrade was selected to unlock narrower scopes. Where a future plan permits it, narrow variables to their documented scopes. The web app uses the signed-in user's Supabase session/RLS; **never add SUPABASE_SECRET_KEY to Netlify**. The optional Trigger production key is unused by Stage 1 and need not be configured. There is no enqueue or inbound Resend webhook endpoint yet.

The app uses password sign-in to an existing Supabase Auth account. Set the Supabase Auth Site URL to APP_URL, disable public signups, and register the intended owner through the service-only bootstrap. No OAuth callback/calendar scopes are needed in Stage 1. Keep preview/branch deploy credentials separate from production; never expose production secrets to untrusted builds.

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

The schema enforces single ownership, RLS, a private captures bucket, source leases/runs/captures, separate opportunities/occurrences/milestones, versions/claims and save/reject-only decisions. The hosted inspection found zero Auth users; the user declined manual account creation, and no account or invitation was created. Empty membership continues to deny access until the user establishes their intended login and it is explicitly registered.

Create/choose the existing owner account in the dashboard, then from the trusted local environment:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
```

The local server secret belongs only in ignored `.env.local` for setup/direct worker commands, and in Trigger's worker runtime for production. `setup:sources` ignores existing rows and cannot reset cursors/health. Source IDs/hashes remain scoped to their actual source; cross-source duplicate matching is deferred.

## Trigger.dev Cloud worker

The verified project ref is `proj_wurjjfgxnzhkvcewuaci`; `trigger.config.ts` defaults to this nonsecret value for managed builds and permits an explicit TRIGGER_PROJECT_REF override. All six worker variables were confirmed saved for **Production only**, with Development unchecked: APP_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, EMAIL_DELIVERY_ENABLED=false, CALENDAR_WRITES_ENABLED=false and SOCIAL_COLLECTION_ENABLED=false. The server key was stored as a secret with its value unviewable; no key value is printed or committed.

The Trigger GitHub app installation was confirmed at October 20, 2026, 19:28 America/New_York and is limited to `astromonkeyduck-coder/opptrack`. Trigger's organization connection still does not recognize that installation, so managed deployment remains under investigation. Do not broaden repository access or interpret installation as deployment. `.env.trigger.production.example` remains the worker contract; no NEXT_PUBLIC pair or Netlify Trigger API key belongs here. Deployment, task registration, scheduling and cloud runs remain unverified.

The SDK task `opportunity-source-dispatcher` declares hourly cron `0 * * * *`, UTC, with `window: "60m"`, queue concurrency one and SQL due-source leases. This accommodates the Free-created schedule policy: cadence cannot exceed hourly, and execution uses a stable offset within the hour after its nominal cron time. The nominal timestamp is not the actual start; minute-level alert timing is not promised. No upgrade was used. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

Central keeps 3,600-second UTC slots; Music keeps 21,600-second slots (00/06/12/18 UTC). Migration 002 stores `next_poll_at` independently of completion time and `retry_not_before` independently of the poll grid; effective due is their maximum. A source retry is eligible at a later dispatcher tick after that floor, not guaranteed immediately when the floor expires. Missed source slots coalesce once without a catch-up burst. Only these two free public adapters are enabled after owner setup. SDK infrastructure retries wait for lease recovery. Code registration and replay do not verify cloud execution.

The SDK is pinned to 4.7.6. The optional matching CLI was inspected and removed because its dependency tree introduced an unpatched braces advisory and vulnerable archive dependencies. Resolve/recheck its advisories before selecting a pinned deployment CLI. No CLI login/dev/deploy succeeded here. Once a verified CLI is available, run its documented dev/deploy commands for the actual project, independently of the Netlify build. CLI --env-file supplies its local process, not uploaded runtime values. Set worker values explicitly in Trigger's dashboard; deployment account tokens stay outside app runtime templates.

Verify a real cloud run ID, source-run/capture transaction and authenticated inbox rows in the same Supabase project. Record cloud logs without credentials or raw capture bodies. No paid connector is required or enabled.

## Privacy and release gate

`.env.local`, populated production dotenv files, raw captures, backups, exported event rows and screenshots remain ignored. Authenticated downloads return attachments/no-store, not public Storage URLs. Manual links are retained without fetching; supplied files remain pending verification. Model/OCR extraction and Resend are optional and unused.

Local database backup/restore and SQL access controls pass; hosted Auth/Storage HTTP, complete Storage backup, distributed contention and safe hosted purge/refresh are still required. Retention planning deletes nothing until those checks pass. Do not call this hosted-ready merely because the build passes. Keep calendar provider code, OAuth scopes and writes absent; stop after Stage 1.

## Primary references checked October 20, 2026

- [Netlify Next.js/OpenNext](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) and [environment contexts/scopes](https://docs.netlify.com/build/environment-variables/overview/).
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Storage policies](https://supabase.com/docs/guides/storage/security/access-control), [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), and [Storage errors](https://supabase.com/docs/guides/storage/debugging/error-codes).
- [Trigger scheduled tasks](https://trigger.dev/docs/tasks/scheduled), [configuration](https://trigger.dev/docs/config/config-file), and [runtime environments](https://trigger.dev/docs/deploy-environment-variables).

Provider documentation describes supported behavior; project-specific hosted verification remains necessary.
