# Production deployment: Netlify + Trigger.dev Cloud

Updated October 20, 2026 at the user's request. **Netlify is the production Next.js host.** Supabase remains the database/Auth/private Storage service, Trigger.dev Cloud the workflow service, and Resend the email provider. This repository currently contains Stage 0 probes, deployment configuration and an offline environment validator. No Next.js app, linked Netlify site or Trigger deployment exists yet; hosted variables have not been applied. No GitHub push is implied by this document.

## Two independent environments

`config/production-environments.json` is the machine-readable variable contract. Use separate templates:

| Destination | Template | Context | Responsibility |
| --- | --- | --- | --- |
| Netlify | `.env.netlify.production.example` | `production` | Next.js UI/SSR/server routes, authenticated review/approval intent and signed inbound webhook reception |
| Trigger.dev Cloud | `.env.trigger.production.example` | `prod` | Due-source dispatcher, collection, extraction and later delivery/outbox workers |

Netlify variables do not transfer to Trigger. Trigger variables do not transfer to Netlify. Copy shared `APP_URL` and the same Supabase project URL deliberately; only the Netlify public key goes into the browser. The privileged Supabase secret and Resend sending key belong to Trigger. Netlify server routes should use the signed-in user's Supabase session/RLS, not a worker's privileged key. The Netlify server gets a Production Trigger API key to enqueue bounded jobs; worker code must independently validate authorization/ownership. Keep privileged operations behind approved database routines.

Netlify public keys/URL and `APP_URL` use Builds + Functions scopes. Server secrets and flags use Functions scope where the account plan supports scopes. Configure **Production** values explicitly, never the default all-contexts value. If scope controls are unavailable, secrets may be visible to trusted production build code; keep them out of browser code and do not run untrusted builds with production credentials. Deploy Previews/branch deploys require separate test credentials and disabled external effects. Do not copy production variables to them. Variables in `netlify.toml` do not supply function-runtime secrets.

Use the current Supabase publishable (`sb_publishable_`) key on Netlify and server secret (`sb_secret_`) key on Trigger. Legacy JWT keys are intentionally rejected by this project's new configuration checker. Only the two declared `NEXT_PUBLIC_*` variables may be bundled into browser code. Set secret values in the provider UI, mark them secret where available, and never commit populated dotenv files. `NETLIFY_AUTH_TOKEN` and `TRIGGER_ACCESS_TOKEN` are deployment-tool credentials; keep them in local/CI secret storage, outside both application templates.

## Prepare and validate values

Copy the templates to the ignored local files, then fill values securely:

```sh
cp .env.netlify.production.example .env.netlify.production.local
cp .env.trigger.production.example .env.trigger.production.local
python3 scripts/validate_production_env.py --target netlify --env-file .env.netlify.production.local
python3 scripts/validate_production_env.py --target trigger --env-file .env.trigger.production.local
```

The validator reports names/errors only, rejects wrong-target credentials, secret keys in public fields, nonproduction Trigger keys, missing required values and unsafe stage flags. It does not contact providers or authenticate keys. Template-only validation is `python3 scripts/validate_production_env.py`; this passing does **not** mean production values exist. Keep `CALENDAR_WRITES_ENABLED=false` in both targets and `SOCIAL_COLLECTION_ENABLED=false` on Trigger. Delivery/inbound flags also default false; their credentials become required only when their implemented features are enabled. No setting alone grants permission for a calendar write.

## Netlify setup and release

After Stage 1 has created the actual Next.js app and lockfile:

1. Link the intended repository/branch to the correct Netlify site. Repository publication is a separate action; a local `origin` does not mean code was pushed. Do not import an unrelated site or assume an existing paid plan.
2. Use root base directory, `npm run build`, publish directory `.next`, Node 22 from `netlify.toml`. Let Netlify automatically use its modern OpenNext adapter. Do not add a static `next export`, SPA catch-all redirect or the legacy Next.js plugin. Build devDependencies must remain available; do not set `NODE_ENV=production` in Netlify's dependency-install environment.
3. In the site's environment-variable UI, enter only the Netlify template keys, Production context and declared scopes. Mark `TRIGGER_SECRET_KEY` and optional `RESEND_WEBHOOK_SECRET` secret. Avoid bulk `env:import`: the documented command does not expose context/scope flags, so a blind import can put production values in every context. Use per-key UI/API configuration instead.
4. Set `APP_URL` to the actual canonical HTTPS origin. Configure Supabase Auth Site URL and the implemented auth callback's exact allowed redirect URL. Do not allow arbitrary preview wildcards into production auth. Add separate test redirects/projects for previews. Register Resend's webhook only after its route and signature/replay checks exist; do not invent a currently working callback route.
5. Run application type checks/tests/build and a test-context Netlify build. Verify authenticated SSR, session cookies, private evidence access and server routes. Check browser bundles do not contain privileged values. Deploy the production web artifact only after those gates; verify the actual deployed commit and a non-secret health/auth flow. Public `NEXT_PUBLIC_*` changes need a new build; rebuild/redeploy after variable updates so generated functions/assets use the intended values.

## Trigger.dev Cloud setup and release

1. Select the correct Trigger project and **prod** environment. Add only the worker-template keys in its Environment Variables dashboard, marking Supabase and Resend keys secret at creation. Do not copy the Netlify file or use `syncEnvVars` to mirror Netlify variables wholesale.
2. In Stage 1, create/pin the actual Trigger SDK/CLI and `trigger.config.ts` with the real project reference and worker task directory. No fake project reference is committed here. A single dispatcher owns due-source checks; Netlify build hooks are not the scheduler.
3. Once dependencies/tasks exist and local checks pass, deploy separately with the pinned CLI: `npx --no-install trigger.dev deploy --env prod`. For CI, provide `TRIGGER_ACCESS_TOKEN` through the CI secret store. Deployment credentials and task runtime variables are different.
4. Setting `--env-file` on the deploy command populates the CLI process; it does **not** upload task runtime variables. Use Trigger's dashboard or explicit environment-variable API/SDK for those values. Confirm names in the selected prod environment without printing secrets; the CLI `env list --env prod` hides values by default. Importing a local dotenv file into Netlify does not configure workers.
5. Verify a read-only source job persists its run/capture in the intended Supabase project. Verify missing/expired credentials and budget caps produce visible failures. Keep schedules/delivery disabled until their stage's implementation and acceptance checks pass. Calendar writes remain disabled until the dedicated approval/outbox stage is verified.

## Current setup requirements

Netlify site ID/name/URL, Trigger project reference, Supabase production project/keys and canonical application URL have not been provided. Resend credentials/sender/domain are needed when delivery is enabled, plus a signing secret when inbound intake is enabled. No Netlify or Trigger CLI is installed in this workspace and no connected Netlify/Trigger administrative tool is available. Prepared files therefore remain **not applied**, with identifiers null in the contract. Do not replace nulls with guessed projects or blank hosted secrets. No app build/deployment was attempted while `package.json` and tasks are absent.

## Primary documentation checked October 20, 2026

- [Netlify Next.js/OpenNext support](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [build dependencies/Node selection](https://docs.netlify.com/build/configure-builds/manage-dependencies/).
- [Netlify environment contexts/scopes/runtime limits](https://docs.netlify.com/build/environment-variables/overview/) and [CLI env command](https://cli.netlify.com/commands/env/).
- [Trigger runtime environments](https://trigger.dev/docs/deploy-environment-variables), [deploy CLI](https://trigger.dev/docs/cli-deploy-commands), [env CLI](https://trigger.dev/docs/cli-env-commands).
- [Supabase key separation](https://supabase.com/docs/guides/getting-started/api-keys).

These establish documented deployment behavior. A successful build, hosted secret application or operational integration still requires project-specific evidence.
