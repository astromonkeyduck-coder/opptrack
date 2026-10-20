# Production deployment: Netlify + Trigger.dev Cloud

Stage 1 now contains an authenticated Next.js app, Supabase migrations, manual intake and the Trigger SDK task. Local build/SQL/live-source evidence is recorded in status.md. Hosted Netlify, Supabase Auth/Storage and Trigger runs remain unverified. Keep production application and worker variables separate.

## Netlify production app

Use repository root as the base directory, Node 22, build `npm run build`, publish `.next`. `netlify.toml` supplies these settings; the committed package/lockfile resolves the earlier ENOENT failure. Use Netlify's automatic modern OpenNext adapter. Do not add a static export, SPA rewrite or legacy plugin. Build devDependencies must be installed; do not set NODE_ENV=production during dependency installation.

Set the keys in `.env.netlify.production.example` in the **Production** context. APP_URL is the actual HTTPS origin. The public Supabase URL/publishable key need Builds + Functions; rebuild after changing browser values. Server flags/secrets use Functions scope where available. The web app uses the signed-in user's Supabase session/RLS; **never add SUPABASE_SECRET_KEY to Netlify**. The template's Trigger production key is optional and currently unused by Stage 1 web routes. There is no web enqueue endpoint yet. Inbound email remains disabled and no Resend webhook is implemented.

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

Apply `supabase/migrations/202610200001_stage1.sql` once through the intended project's SQL editor or an authenticated migration workflow. The three app keys alone do not supply a SQL-management channel. The migration enforces single ownership, RLS, a private captures bucket, source leases/runs/captures, separate opportunities/occurrences/milestones, claims/versions and save/reject-only decisions. Empty membership grants no first-visitor ownership.

Create/choose the existing owner account in the dashboard, then from the trusted local environment:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
```

The local server secret belongs only in ignored `.env.local` for setup/direct worker commands, and in Trigger's worker runtime for production. `setup:sources` ignores existing rows and cannot reset cursors/health. Source IDs/hashes remain scoped to their actual source; cross-source duplicate matching is deferred.

## Trigger.dev Cloud worker

Use `.env.trigger.production.example` in the intended project's **prod** environment. Worker values include SUPABASE_URL and SUPABASE_SECRET_KEY; no NEXT_PUBLIC keys or Netlify Trigger API key are needed inside the worker. Keep EMAIL_DELIVERY_ENABLED, SOCIAL_COLLECTION_ENABLED and CALENDAR_WRITES_ENABLED false. Set the non-secret TRIGGER_PROJECT_REF for CLI/config loading; no fake project reference is committed.

The real SDK task `opportunity-source-dispatcher` runs every 15 minutes, with queue concurrency one and SQL due-source leases. Central is due hourly; Music every six hours. Only these two free public adapters are enabled after owner setup. Source failures persist retry state and respect Retry-After; infrastructure retries wait for lease recovery. SDK registration/type checks and local replay do not verify cloud scheduling.

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
