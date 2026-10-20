# Personal FSU Opportunity Tracker

Stage 0 source feasibility and design, prepared October 20, 2026. **The tracker application is not built or deployed.** Only Stage 0 was authorized; stop here until the user requests the next stage. No calendar writes, RSVPs, messages, purchases, or paid actor runs were performed.

Start with [current status and actual commands/results](docs/status.md), [coverage gaps](docs/coverage-gaps.md), and [Stage 1 acceptance criteria](docs/stage-plan.md). [Shared instructions](docs/engineering-instructions.md) apply to all agents; [charter](docs/charter.md) defines broad campus discovery, selective recommendations, searchable review and per-occurrence/per-action calendar approval.

## Evidence and design

- [Machine-readable source registry](config/source-registry.json) and [status definitions](docs/source-registry.md): real seeds, bounded operational routes, blocked/untested/manual routes and credential references.
- [Probe findings](docs/source-probe-findings.md), [executed public-source probes](reports/probes/latest.json), [initial live run](reports/probes/initial-live-run.json), [sandbox transport failure](reports/probes/sandbox-network-check.json) and [MatPat conflict reference](reports/probes/matpat-conflict.json), and the newer [HQ export](reports/probes/hq-export-live.json)/[HQ preview](reports/probes/hq-public-calendar-live.json) follow-ups. Reports preserve failures; HTTP reachability does not mean ingestion.
- [HQ/social access feasibility and pilot](docs/access-feasibility.md), [39 officially linked pilot accounts](config/social-pilot-accounts.json), [unrun Instagram preflight](evidence/instagram-login-probe.json) and [unrun vendor dataset preflight](evidence/apify-dataset-probe.json). Vendor metadata reads are not posts/Stories collection.
- [Cost model](docs/cost-model.md), [explicit assumptions](config/cost-assumptions.json) and [reproducible forecast](evidence/cost-forecast.json). Prices, forecast volumes, observed usage and unknowns are separate. No budget was authorized.
- [Architecture decisions](docs/architecture.md), [smallest durable data model](docs/data-model.md), [typed adapter contracts](contracts/adapter.ts), [45 labeled evaluation scenarios](evaluation/cases.json) and [evaluation plan](docs/evaluation-plan.md). Synthetic cases are not live captures; scenario validation is not model or calendar validation.

## Production configuration code

The user selected **Netlify** for the production Next.js app, with Supabase, Trigger.dev Cloud and Resend retained. [Deployment instructions](docs/deployment.md), [Netlify build config](netlify.toml), and [the machine-readable environment contract](config/production-environments.json) separate the two production runtimes. Templates: [.env.netlify.production.example](.env.netlify.production.example) and [.env.trigger.production.example](.env.trigger.production.example).

Run `python3 scripts/validate_production_env.py` to verify blank templates, or use `--target netlify|trigger --env-file PATH` to validate real ignored settings without printing secrets. These are executable configuration tools; the Next.js application and hosted settings still need their later-stage setup.

## Reproduce Stage 0

Python 3.10+ with an IANA timezone database; no third-party Python packages, Node installation, service credentials or application deployment are needed for offline checks.

```sh
make check
make forecast
```

Bounded public GET probes (network permission required in restricted environments):

```sh
python3 scripts/probe_sources.py --output reports/probes/latest.json --start-date 2026-10-20 --months 12
python3 scripts/reconcile_registry.py
python3 scripts/validate_registry.py
```

Probe exit `2` means at least one source was blocked/partial, **not** no new events. Inspect the saved report. `--only`, `--months`, `--max-requests`, `--timeout` and `--max-bytes` bound the investigation. The historic start date intentionally reproduces this Stage 0 snapshot; choose a current start date explicitly for a future probe.

```sh
python3 scripts/social_probe.py --help
python3 scripts/social_probe.py instagram-login --output evidence/instagram-login-probe.json
python3 scripts/social_probe.py apify-dataset --output evidence/apify-dataset-probe.json
```

Without the documented environment setup, those content probes exit setup-needed before HTTP. They never start an Apify actor, send a message, RSVP or call Google Calendar. Put future tokens only in ignored environment/secret stores; `.env.example` lists names. Do not supply an FSU password. The proposed Next.js, Supabase, Trigger.dev, Resend and Google Calendar services remain unconfigured.

The initial local repository had no commits or configured remote. The project is now connected to [astromonkeyduck-coder/opptrack](https://github.com/astromonkeyduck-coder/opptrack) as `origin`. Stage 0 and the Netlify deployment configuration have been committed and pushed to `main`. No application deployment has occurred. See [runbook](docs/runbook.md) before continuing in a fresh session.
