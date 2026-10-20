# Stage 0 status and evidence

**Stage 0 complete; stop here.** Prepared October 20, 2026, America/New_York. The user's authorized first prompt has been executed as source feasibility and design work. The application/tracker is not complete or deployed. No Stage 1 app build, service purchase, actor execution, organizer contact, message, RSVP or real calendar modification occurred.

The repository began empty, on an unborn `main`, with no remote or commits. All Stage 0 project files were created locally. In the follow-up GitHub setup request, the user created `https://github.com/astromonkeyduck-coder/opptrack.git`, which is now configured as `origin`. Stage 0 and the Netlify follow-up are committed and pushed to `main`. The repository is public; the user explicitly requested the GitHub push after the earlier upload had been cancelled. No CI or application deployment has run. Full file inventory: `reports/files-changed.txt`.

## Deliverables

| Requested work | Saved result |
| --- | --- |
| Inspect/preserve repository and instructions; charter/stages | `docs/charter.md`, `docs/stage-plan.md`, `docs/engineering-instructions.md`, thin `AGENTS.md`/`CLAUDE.md`; original attachment fingerprint in `reports/input-provenance.json` |
| Machine-readable real-source registry | `config/source-registry.json`, status policy in `docs/source-registry.md`; reconciliation/validation scripts |
| Execute read-only calendar/HQ/department/ticket/newsletter probes | `scripts/probe_sources.py`, `reports/probes/`, parser tests and real compact field projections |
| HQ and Instagram/public-post/Stories feasibility | `docs/access-feasibility.md`, safe `scripts/social_probe.py`, live metadata/preflight evidence, 39 costed organizer links + five archived club replacement seeds |
| Smallest data model and adapter boundaries | `docs/architecture.md`, `docs/data-model.md`, `contracts/adapter.ts`; approval/outbox is a specification, not implementation |
| Labeled evaluation and failure cases | `evaluation/cases.json`, `evaluation/validate_cases.py`, `docs/evaluation-plan.md`; 44 synthetic descriptions + one live MatPat conflict reference |
| Explicit costs, gaps, risks and Stage 1 gate | `docs/cost-model.md`, `config/cost-assumptions.json`, `evidence/cost-forecast.json`, `docs/coverage-gaps.md`, Stage 1 criteria in `docs/stage-plan.md` |
| Fresh-session continuity | `README.md`, `Makefile`, `docs/runbook.md`, this status and full command evidence |

## Actual commands and results

Commands below ran from this repository. Public probe request counts mean top-level fetch invocations; redirects can add HTTP GETs. The cap applies to those invocations, with urllib also bounding redirects. `reports/validation.json` preserves final offline stdout/stderr and exit codes. Public live probes needed an approved sandbox network escalation after restricted DNS failed; no rejected action remains pending.

| Command | Actual result |
| --- | --- |
| Repository inventory, `git status --short`, `git remote -v`, instruction search | No existing project files/remote/instructions to preserve; global AGENTS file empty. |
| `git rev-parse --verify HEAD` | Exit 128, `Needed a single revision`: no commit exists. `git remote -v` exits 0 with no output. |
| `python3 scripts/probe_sources.py --only fsu-hq-public-calendar --output reports/probes/sandbox-network-check.json --max-requests 1 --timeout 5` | Exit 2, sandbox DNS transport failure, saved explicitly; no empty-success inference. |
| First live run: `python3 scripts/probe_sources.py --output reports/probes/latest.json --start-date 2026-10-20 --months 12` | Initial 45-fetch live run preserved. The initial command wrote `latest.json`, then was copied to the named historical artifact. Exit 2 with blocked/incomplete routes. |
| `python3 scripts/probe_sources.py --output reports/probes/latest.json --start-date 2026-10-20 --months 12` | Revised 48-fetch live run; exit 2: dynamic HQ HTML and initially rejected external ICS redirect. All twelve calendar partitions parsed with matching row/occurrence totals. |
| `python3 scripts/probe_sources.py --only fsu-hq-events --output reports/probes/hq-export-live.json --max-requests 4` | Three top-level fetch invocations including a replay (five HTTP GETs including redirects); exit 2 solely for dynamic HQ HTML. The exact observed public ICS redirect is allowed and parsed successfully: 1,146 unique UIDs; replay hash unchanged. Earlier redirect investigation is also retained. |
| `python3 scripts/probe_sources.py --only fsu-hq-public-calendar --output reports/probes/hq-public-calendar-live.json --max-requests 1` | One request, exit 0; twelve actual event links after excluding create-event navigation, with title/date samples. |
| `python3 scripts/social_probe.py pilot-accounts --output config/social-pilot-accounts.json` | HTTP 200; 39 affiliation links parsed from official directory. No Instagram content collected. |
| `python3 scripts/social_probe.py apify-posts-metadata --output evidence/apify-posts-metadata.json` and `apify-stories-metadata` counterpart | Both HTTP 200; public actor build/pricing metadata only. Zero actor runs. |
| `python3 scripts/social_probe.py instagram-login --output evidence/instagram-login-probe.json` | Exit 2, setup-needed, zero upstream requests: missing `IG_ACCESS_TOKEN`, `IG_USER_ID`, `IG_API_VERSION`. |
| `python3 scripts/social_probe.py apify-dataset --output evidence/apify-dataset-probe.json` | Exit 2, setup-needed, zero upstream requests: missing `APIFY_TOKEN`, `APIFY_DATASET_ID`. No dataset or collector output fabricated. |
| `python3 scripts/reconcile_registry.py` and `python3 scripts/validate_registry.py` | Exit 0; 59 records: 8 bounded operational routes, 44 documented/untested, 4 blocked, 2 manual-only, 1 unsupported. All runtime enable flags false. |
| `make check` | Exit 0: **45 unit tests pass** (28 public-parser/failure, 12 social-safety, 5 cost invariants); registry validation passes; **45 scenario contracts validate**, six intentional invalid variants rejected. |
| `python3 scripts/cost_model.py --output evidence/cost-forecast.json` | Exit 0; deterministic offline forecast, no provider call/spend. |
| `python3 -m compileall -q scripts evaluation tests` | Exit 0; Python syntax checks pass. |
| `git diff --check` | Exit 0, but files are untracked in the initial repository; this is not a complete formatting check for the new files. |

TypeScript contracts were inspected, but no TypeScript compiler is installed/configured and no TypeScript build was run. No Next.js dependency graph or application was installed. SQL/RLS, OAuth, outbox, extraction accuracy and delivery tests cannot pass before their implementations exist. The scenario validator prints these unrun boundaries explicitly.

## Observed live versus design/mock behavior

- **Live bounded collection:** central Localist JSON, HQ public ICS, public HQ preview, Music dated cards, National Fellowships dated items, Hello FSU archive/RSS, and MatPat page/individual ICS. The eighth operational registry record is directory-link discovery. MatPat and stale archives are evidence routes, not current recommendation feeds; the count is not eight independent campus-wide sources.
- **Central calendar measurements:** seven-day 332 occurrences/293 event IDs/four pages; first month 1,059 occurrences/11 pages; twelve monthly partitions total 1,931 occurrence rows. Separate event/instance IDs and source update timestamps are present. Replay matched 100 occurrence identities; 74 recurring events had multiple instances across observations. Upstream edit/cancellation propagation remains untested.
- **HQ public export:** 1,146 unique UIDs, dates July 22, 2026–May 26, 2027; 441 starts dated on/after October 20. Exact public redirect and stable repeat verified. No full/member/private coverage or cancellation semantics established. Dynamic HTML remains a separate blocked route.
- **Other sources:** Music preview has ten dated cards; fellowship page nine date-bearing items with uncertainty. Ticket/registration/info pages are reachable but no verified on-sale/availability parser exists. Hello's latest sampled RSS item is April 30, 2023, so archive access cannot be treated as current alerts.
- **Live metadata only:** official social directory and two Apify metadata endpoints. They establish links/pricing claims, not posts, Stories, media completeness or source permission. Authenticated content checks remain unrun.
- **Synthetic/test-only:** parser failure envelopes, social API mocks, cost sensitivity tests and 44 evaluation descriptions. Image/carousel scenarios contain labeled text descriptions, not real image assets. One saved live MatPat reference tests conflicting date claims; no model has extracted or been scored on it. No runtime database/calendar mock is being presented as a real integration.

## Costs and unresolved setup

No services were bought/provisioned or paid actors/models run. Local coding/tool/subscription costs and actual invoices were not measured. The explicit core forecast is $2.50/month only if all modeled free quotas and eligibility fit, or $46.50/month for the modeled paid Supabase/Netlify Personal/Trigger baseline plus assumed model usage. A seven-day, 39-account pilot forecasts $41.15 incremental, assumes already paid/private storage, and has an **unapproved** proposed $45 cap. These are conditional forecasts, not all-in guarantees.

Full permitted HQ access still needs an allowed user subscription or administrator-scoped event-only feed/secret and visibility agreement. Instagram needs current app/version/permissions and authorized account credentials; vendor collection needs permitted use, real validated accounts/build, dataset/access and a separately approved budget. Some current Meta docs returned rate limits. Yik Yak stays manual/shared-lead; private channels remain uncovered unless a supported permitted route is established.

Hosted Stage 1 needs Supabase/Trigger setup; `origin` now points to the user-created `opptrack` repository, with remote upload complete and CI still unconfigured. Authenticated manual flyer/link intake can proceed without Resend inbound credentials; actual receiving needs domain/DNS and signed-webhook setup. Most source seeds and off-campus routes remain untested. See `docs/runbook.md` for exact capability setup and `docs/coverage-gaps.md` for broader limitations.

## Stage 1 handoff

On an explicit Stage 1 request, build the smallest authenticated private review list from the verified central calendar, one independent Music/fellowship producer and a permitted flyer/manual or signed inbound input. Add migrations/RLS/private storage, leased dispatch, durable captures/source health, evidence-linked normalization and replay-safe identities. Demonstrate real ingestion, search, login-wall/stale/partial states and ownership tests. Keep HQ/social gaps visible and proceed without their missing credentials. **Calendar writes remain disabled throughout Stage 1.** Full acceptance criteria are in `docs/stage-plan.md`; do not begin now.

## Netlify production configuration follow-up

The user selected Netlify for the future production Next.js app, retained Supabase/Trigger.dev Cloud/Resend, and requested code plus a GitHub push. Added netlify.toml, separate production templates, config/production-environments.json, scripts/validate_production_env.py and failure tests. Updated deployment/architecture instructions and the Netlify credit-based cost forecast. Hosted environment values remain not applied: no site/project IDs or credentials were supplied and the Next.js app/tasks do not exist yet. This change prepares deployment; it does not advance the app implementation or enable external calendar/delivery actions. The user's earlier cancelled upload was not performed; the later explicit push request succeeded: commit `47bdab3` published the deployment changes to `main`, including the earlier Stage 0 commit `8884768`.

Follow-up verification: `make check` passed 59 unit tests, registry validation, all 45 scenario contracts and the two production templates. `git diff --check` passed; Python tomllib parsed netlify.toml. No live Netlify/Trigger settings were applied and no app build was possible without the future Next.js package/tasks. The environment checker rejects privileged keys in browser fields and development Trigger keys in production.
