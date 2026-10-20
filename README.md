# Personal FSU Opportunity Tracker

Stage 1 implements a private Next.js review inbox, two real read-only collectors, a Trigger dispatcher, and Supabase migrations. Production hosting is **Netlify**. Calendar writes, email delivery, social collection and paid connectors remain disabled.

**Local verification is real; hosted operation is still pending.** Fresh central-calendar and Music responses produced 303 opportunities and 342 occurrences in actual local PostgreSQL. Supabase Auth/Storage HTTP, Trigger Cloud and the hosted Netlify release are not yet verified. There is no mock fallback in the application.

Read [status and actual results](docs/status.md), [runbook](docs/runbook.md), [deployment](docs/deployment.md), and [Stage 1 acceptance](docs/stage-plan.md). Stop after Stage 1; its hosted gate remains open. Stage 0 is preserved by Git tag `stage-0-complete` at `795f23e` and [archived status](docs/stage-0-status.md).

## Run locally

Use Node 22 and Python 3.10+. `.env.local` is ignored; enter values directly there, never in chat or Git. Do not overwrite an existing file.

```sh
npm ci
npm run check:env
npm test
npm run test:db
npm run typecheck
npm run build
make check
npm run dev
```

Apply the migration to your Supabase project, create your one Auth account in its dashboard, then register its UUID:

```sh
npm run setup:owner -- EXISTING_AUTH_USER_UUID
npm run setup:sources
npm run dispatch
```

The last command runs the same collection service locally; it is **not** evidence of Trigger Cloud execution. See the runbook for the independent worker setup and hosted checks.

## Reproduce live and replay evidence

```sh
npm run collect:live -- --start=2026-10-20
npm run prove:live
node --import tsx scripts/prove-dispatcher-replay.ts
npm run evidence:inbox
```

Choose the current date explicitly for a new observation. Full responses, database backups, exported rows, HTML and screenshots remain under ignored `private/`. Sanitized reports are in `reports/stage-1-*.json`. The dispatcher replay explicitly replaces HTTP and Storage with saved-response/private-file test adapters; it executes the actual production handler and SQL, and makes no cloud-integration claim.

## Boundaries

Central collection follows and validates Localist pagination. Music covers its public preview only. Native event and occurrence identities are separate; replay preserves decisions. Unknown locations, timezone/end times and ticket availability remain visible. The catalog retains broad source listings before ranking. HQ member activity, stale archives and unconfigured social routes remain visible gaps; no campus-wide completeness promise is made.

Manual links are retained without fetching. All uploaded slides/files are stored privately and remain pending human verification; OCR/model extraction has not run. Retention planning exists, but hosted deletion is disabled pending safe deletion/refresh and Storage restore checks.

[Source registry](config/source-registry.json), [source evidence](docs/source-probe-findings.md), [coverage gaps](docs/coverage-gaps.md), [cost model](docs/cost-model.md), and the [evaluation scenarios](evaluation/cases.json) retain Stage 0 context. Scenario descriptions and test adapters are not live integration evidence.
