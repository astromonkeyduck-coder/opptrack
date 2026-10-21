# Cost model and measured Stage 1 usage

Prices checked **2026-10-20**, USD before tax. The Stage 0 forecasts below are retained as historical assumptions; current Stage 1 measurements are recorded in the final section. Stage 0 provisioned no hosted services or paid runs. Stage 1 uses existing Netlify Free, Trigger Free and Supabase Pro plans without an upgrade. Actual invoices and current shared-account credits remain unknown.

The user selected Netlify for the production Next.js app, with Supabase, Trigger.dev Cloud and Resend retained. Google Calendar remains a future explicitly approved integration. Netlify serves the web app; Trigger.dev Cloud runs collection, extraction and notification workers. The deployment boundaries and environment-variable setup are in `docs/deployment.md`. Moving hosting does not solve gated sources. The free path is a constrained pilot possibility, not a production cost promise or a recommendation to buy anything now.

## Verified rates and constraints

| Component | Current primary evidence | Cost treatment |
| --- | --- | --- |
| Supabase | [Pricing](https://supabase.com/pricing): Free $0, 500 MB DB, 1 GB file storage, 5 GB egress, inactive projects may pause after one week. Pro starts $25/month, first project included; 8 GB DB, 100 GB storage, 250 GB egress. | Free may fit a small core shadow pilot. Paid scenario assumes one Pro project with included compute sufficient. Separate staging projects, larger compute, egress and backups can add cost. |
| Trigger.dev Cloud | [Pricing](https://trigger.dev/pricing): Free has $5 monthly credits, 10 schedules and 1-day logs. Hobby $10/month includes $10 credits. Invocation $0.000025; micro $0.0000169/s, small-1x $0.0000338/s, medium-1x $0.000085/s. | One dispatcher schedule; source-run history persists in Postgres. Count empty checks, retries and extraction worker runtime as well as useful captures. Paid fee plus usage beyond included credits, not fee plus all usage. |
| Resend | [Pricing](https://resend.com/pricing): Free 3,000 emails/month and 100/day; Pro $20/month for 50,000, additional $0.90/1,000. Inboxes consume transactional quota. | Model combines 100 outbound + 200 inbound/month with assumed daily peak 20, so Free fits. Domain verification/DNS and working inbound are setup tasks, not proven integration. Marketing, dedicated IP and automation add-ons are unnecessary. |
| Netlify / Next.js | [Netlify pricing](https://www.netlify.com/pricing/), checked 2026-10-20: Free has 300 credits/month; Personal is $9/month with 1,000 credits; base Pro is $20/month with 3,000 credits. | Paid baseline assumes Personal for this single-user app; Pro is a separate alternative. Included credits cover usage up to the plan limit. No extra credit purchase, account setup or deployment was performed during Stage 0; Stage 1 deployment is recorded below. |
| Apify platform | [Pricing](https://apify.com/pricing): Free $5 credit, Starter $19/month with $19 prepaid usage, then pay-as-you-go. Actor charges vary. | One $19 fee plus excess eligible usage; do not double-count the fee and included credit. Do not assume Free automatically permits overage. Future billable execution requires separate authorization. |
| Instagram posts actor | [Live metadata](https://api.apify.com/v2/acts/apify~instagram-post-scraper), saved `evidence/apify-posts-metadata.json`: FREE post $0.0017 + detailed-data $0.001; BRONZE post $0.0015 + detailed-data $0.0008. Optional music extra is disabled. | Use current detailed-data rates, not the Store's “from $1/1,000” headline. Every returned old post may be billed again. Metadata `minimalMaxTotalChargeUsd=0.005` is a minimum **charge-limit setting**, not evidence of an extra fixed run fee. No post run charge or output was measured. |
| Community Story actor | [Live metadata](https://api.apify.com/v2/acts/datavoyantlab~advanced-instagram-stories-scraper), saved `evidence/apify-stories-metadata.json`: username request $0.003 plus actor start $0.099 per GB, minimum one start unit/run. | Empty username checks still belong in the forecast; assumed 1 GB and one batched run/check. Larger memory or fragmented batches increase cost. Capability/permission remains unproven. |
| Runtime extraction model | No model selected or called. **Assumed sensitivity rates**: $1/million input tokens, $4/million output; 2,500 input tokens/image. | This is a replaceable model budget parameter, not a quote for any particular vendor/model. Before selection, benchmark accuracy and actual billed vision tokens, verify that provider's current price, then replace assumptions. No transcription enabled. |

Google Calendar integration is unconfigured and writes are disabled; no calendar cost was incurred. Its [current quota/pricing guide](https://developers.google.com/workspace/calendar/api/guides/quota), checked 2026-10-20, says standard usage is available without additional charge and describes a 1,000,000-request/day/project billing threshold for new quota arrangements, with future over-threshold billing details to be announced. Per-minute project/user limits also apply. A personal approval-only calendar should be far below that daily threshold, but quotas, future billing and Google Cloud/OAuth requirements must be rechecked before Stage 4. This is not an unlimited-free-API promise. Domain budget is an optional **assumed** $18/year ($1.50/month equivalent), unpurchased. An existing domain/provider subdomain may avoid it. Coding subscriptions, developer time, taxes, observability add-ons, separate staging and unlisted provider overages are excluded rather than silently treated as zero.

## Reproducible 30-day core forecast

Inputs are in `config/cost-assumptions.json`; `python3 scripts/cost_model.py --output evidence/cost-forecast.json` reproduces the historical arithmetic offline. Counts below preserve the expanded Stage 0 scenario, not current Stage 1 runtime. Its 15-minute dispatcher is incompatible with the now-verified Free-created schedule policy as written; activation would require a revised cadence/cost model. The current Stage 1 hourly forecast is below, and no paid upgrade was selected.

| Workload | Assumed volume | Raw worker charge |
| --- | --- | --- |
| Dispatcher | 96/day × 30 = 2,880, 2s micro each | `2,880 × (0.000025 + 2 × 0.0000169)` |
| HTTP/API/feed checks | 5 sources × 96/day + 15 × 24/day + 30 × 1/day = 26,100/month, 3s small each | `26,100 × (0.000025 + 3 × 0.0000338)` |
| Browser checks | 10 sources × 1/day × 30 = 300, 20s medium each | `300 × (0.000025 + 20 × 0.000085)` |
| Extraction / notification workers | 500 × 5s small; 100 × 1s small | Invocation + execution time for each |

Combined Trigger usage is **$4.088764/month** under those assumptions, within a wholly unused $5 Free credit. Extra retries and slower pages can exceed it; exceeding Free credit means budget/setup-needed, not an automatic upgrade in this project. Forecast token usage is 500 captures × 1,500 text input + 300 images × 2,500 image input = 1.5 million input; 500 × 500 = 250,000 output. At assumed rates that is **$2.50/month**, charged by the eventual model provider if used.

Estimated steady-state public media/bounded-excerpt storage is **0.312 GB**: 0.300 GB media at 30 days plus 0.012 GB minimized excerpts at 90 days; DB metadata grows roughly **0.010 GB/month** before indexes, claims, source-run logs, old versions and auth. Sensitive/member-only raw evidence must have the shorter private retention in the architecture and owner restrictions; reducing retention can reduce storage but not permission requirements. Event metadata/claims can be kept longer with bounded excerpts. Every extra carousel image and retained revision counts; free quotas are not a storage policy. Measure bytes, DB growth, egress and retry load during the thin slice. Free scenario also assumes 2 GB Supabase egress/month, an empty starting database, the Netlify credit scenario below, and unused provider credits. The calculator returns no Free cash quote and lists setup/budget blockers when a modeled Free quota fails; unmodeled limits still need validation.

Netlify has separate [credit meters](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), checked 2026-10-20. This is an assumed workload, including web traffic/compute from previews and branch deploys. Collection workers are charged only to Trigger in this model.

| Netlify meter | Assumed monthly usage | Credits |
| --- | ---: | ---: |
| Successful production deployments | 8 × 15 credits | 120 |
| Function compute | 1 GB-hour × 10 credits | 10 |
| Web bandwidth | 2 GB × 20 credits | 40 |
| Web requests | 10,000 × 2 / 10,000 | 2 |
| Other projects on the team | Assumed zero | 0 |
| **Total** | **Assumed web-app workload** | **172** |

Netlify Database, AI Gateway and Agent Runners are unused in this design; Supabase and the separately costed model/worker remain in their existing roles. Preview deployments cost zero deployment credits, but their traffic and compute count above. These historical web-usage quantities still need replacement with measured deployment/traffic/compute totals; the app now exists.

The [credit-based plan documentation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), checked 2026-10-20, distinguishes new accounts from legacy plans retained by accounts created before September 4, 2025. The user's Netlify account/plan was unverified at Stage 0; Stage 1 later observed an unchanged Free account. This historical calculator assumes credit-based pricing; it does not apply legacy bandwidth/build allowances. Check the actual team's plan and other-project usage before using the quote. With recharge off, exhausting credits can pause every project on that team. The forecast assumes recharge remains off, does not authorize extra spending, and returns no applicable plan quote when its included credits are exceeded or credit-based pricing is not assumed.

| Scenario | Forecast/month excluding optional domain and tax |
| --- | ---: |
| Supabase Free + Netlify Free + Trigger Free + Resend Free, **only if all quotas/current eligibility and unused credits fit**; assumed model usage | **$2.50** |
| One Supabase Pro + Netlify Personal + Trigger Hobby + Resend Free + assumed model usage | **$46.50** |
| Same paid baseline plus Resend Pro | **$66.50** |
| Supabase Pro + base Netlify Pro + Trigger Hobby + Resend Free + assumed model usage | **$57.50** |

No free path is promised indefinitely. A longer-lived service should choose backup/recovery and retained-health requirements deliberately; free hosting or provider log retention alone cannot prove production readiness. Supabase Pro is not required for Stage 0 or a tiny Stage 1 slice; its purchase is not authorized.

## Seven-day, 39-account social pilot forecast

The actual FSU-linked roster is `config/social-pilot-accounts.json`; access is untested. The preflight, audited denominators and promotion gates are specified in `docs/access-feasibility.md`. Those institutional accounts do **not** establish coverage of small independent clubs or consumer profiles. Five archived-handbook replacement candidates are in `config/social-pilot-supplement.json`; current ownership/type/access must be reverified before swapping them into the costed 39-account roster. Adding all five instead requires `python3 scripts/cost_model.py --accounts 44`. Keep inaccessible strata explicit and recalculate. No 100% campus or Story recall denominator exists here.

The forecast assumes all 39 accounts are eligible; four post checks/day returning three posts/account/check; twelve Story checks/day; one batch of all accounts/check; 1 GB Story actor memory; one 12-post/account capped backfill; detailed posts; no music/video transcription. Repeated old posts and no-new-content checks remain billable workload.

| Item | Formula | Forecast |
| --- | --- | ---: |
| Repeated returned posts | `39 × 7 × 4 × 3 = 3,276` | 3,276 posts |
| One-time capped backfill | `39 × 12 = 468` | 468 posts |
| Posts including detail, Starter/BRONZE | `(3,276 + 468) × (0.0015 + 0.0008)` | $8.6112 |
| Story username checks | `39 × 7 × 12 = 3,276`; `3,276 × 0.003` | $9.8280 |
| Story start fees | `7 × 12 = 84 runs`; `84 × 1 × 0.099` | $8.3160 |
| Vendor usage before retry reserve | Posts + Story checks + starts | **$26.7552** |
| Vendor usage with assumed 15% retry reserve | `26.7552 × 1.15` | $30.76848 |
| Starter cash including plan/overage | `$19 + max(0, 30.76848 - $19)` | $30.76848 |
| Assumed model extraction | 1,150.5 expected unique items, 1,755 media; 5.538 million input / 460,200 output tokens | $7.3788 |
| Storage/transfer reserve, **not a vendor quote** | Explicit allowance | $3.0000 |
| **Incremental pilot forecast** | Vendor cash + model + reserve | **$41.14728 ≈ $41.15** |

Fractional expected item counts express an average assumption, not actual captures. The Free actor-rate equivalent before retries is $28.2528, above its $5 credit; free credits cannot fund the complete proposed pilot. Actual tier eligibility and whether compute/proxy/storage events are additionally charged must be confirmed from run billing before scaling. The $3 reserve is not a guarantee it covers those unknowns.

**Storage condition:** 1,755 media at an assumed 1 MB each is 1.755 GB before core evidence, above Supabase Free's 1 GB. The $41.15 figure therefore assumes an already available paid/private storage allocation (e.g. the paid core scenario) or a separately costed smaller retention/selection plan. It is not an all-in Free-tier deployment price. Starting the Netlify Personal paid baseline for a month alongside this pilot would forecast **$87.65** before domain/tax/unmeasured extras. Do not buy storage or silently discard required slide evidence to fit a quota.

Proposed **$45 incremental pilot cap is unapproved**, and $41.15 leaves little uncertainty margin. If actual run memory is 2 GB, Story start fees rise by another $8.316 before retry reserve, exceeding this cap; lower cadence/scope or a revised approved budget is needed. Single-account Story runs would produce 3,276 starts rather than 84 and roughly $324.32 in start fees alone, so batching matters. A 30-account sensitivity is $34.55; 50 accounts in one ≤50-account batch is $49.21, using the same assumptions, thus the $45 proposal cannot cover that scenario. Human audit labor is **13.65 hours assumed**, unpriced; if the audit is incomplete, report a smaller audited denominator, not fabricated recall.

Before a separately authorized pilot, require per-run maximum charge and a durable total spend ledger. Count retries, starts, empty checks, media processing and bytes. Alert at 80% of approved cap and halt paid work at 100%; retain health alerts and blocked-source state. Recheck current pricing on pilot day. The actor adapters remain disabled until permission, account validation, budget and observed-capture tests pass.

## Optional services and measurement gaps

[X pricing](https://docs.x.com/x-api/getting-started/pricing) lists $0.005 per returned Post resource for third-party reads: 1,000 returned posts adds $5 before any separately priced resources. This connector is unrun and excluded from baseline. Firecrawl, Bright Data, RSSHub hosting, changedetection.io and Langfuse are unselected; their charges are **unknown/excluded**, not zero. Add only when measured marginal opportunity discovery justifies the cost and the source permits the route.

Record per-source runs, elapsed CPU/wall time, HTTP bytes, media counts, vendor billed events/plan credits, model input/output/image tokens, cache hits, unique opportunities and cost on failed/empty checks. Record zero additional opportunities separately from failure. Stage 1 should replace representative HTTP runtimes and storage assumptions with actual values; Stage 2 chooses a model against held-out labels. No forecast here establishes operational social access, OCR quality, discovery recall, alert timeliness, invoice amount or production readiness.

## Stage 1 measured usage and bounded forecast

The original 12 local public-source HTTP attempts plus five GETs from the first core schedule, four from the following Central tick and four from the latest verified automatic tick give **at least 25 recorded Stage 1 public-source attempts** (13 Cloud, 12 local). This lower bound excludes app/auth/health/docs traffic and Stage 0. First core collection fetched 1,123,725 bytes and created five private objects, 303 opportunities and 342 occurrences; later Central re-ingestion retained those identities. Additional local probes must be counted separately rather than assumed absent. Public-source payments observed remain $0; no provider invoice was measured. [Core correlation](../reports/stage-1-cloud-correlation.json).

| Observed Trigger run | Displayed usage | Displayed total USD |
| --- | ---: | ---: |
| Historical owner-guard manual failure `run_06glndpqqqf43ur6djisksj5e1` | 2.1 seconds | $0.00009868 |
| First genuine core schedule `run_06glnirsvhqdmbeiiur94st901` | 19.6 seconds | $0.00068775 |
| Following core schedule `run_06glo0il33pcm881rblro27j01` | 18.3 seconds | $0.00064441 |
| Successful manual/test Instagram smoke `run_06glo936eht6v3gl45naeepge1` | 12.2 seconds | $0.00043695 |
| Genuine automatic tick `run_06gloea0tch74en66hvp2iis01`: Central success, 16 expired-token blocks | 19.8 seconds | $0.00069413 |
| Recovered manual/test social smoke `run_06gloh91rq560t7h1a6lmcfre1` | 14.7 seconds | $0.00052356 |
| **Selected six-run sum** | Displayed rounded durations | **$0.00308548** |

These are actual dashboard estimates, **not an invoice, cash payment, account-wide run total or remaining-credit balance**. The following core tick is included with its actual dashboard estimate; later setup/collection activity must be added when observed. Failed checks consume requests/compute and are never priced as “nothing new.” Existing account charges, other projects, subscriptions/tools and taxes remain unmeasured. No plan upgrade or paid connector was purchased. [Cost evidence](../reports/stage-1-costs.json).

The 16-account monitor now reuses the existing single hourly dispatcher. Its manual cloud smoke made **16 Meta GETs / 285,131 response bytes**, storing **400 post identities/versions and 16 private sanitized projections**. The genuine 02:00 UTC automatic tick made another **16 Meta requests**, each returning an expired-token block; it retained 400 posts and added 16 private failure projections. A recovered manual/test run then made another **16 successful fresh GETs / 285,131 response bytes**, reusing prior projections and retaining 400 posts/versions with zero duplicate groups. There are therefore **48 known Production Meta collection requests and 32 sanitized captures** through recovery. No successful scheduled Instagram ingestion is yet verified. Source publication metadata remains separate from events; no model calls, media downloads, Stories, Resend or calendar writes were made. [Monitoring evidence](../reports/instagram-production-monitoring.json).

One-off access investigation remains separate: the prior 17-account v2 batch used 17 GETs / 28,794 bytes; earlier bounded samples and setup reads bring that dated investigation snapshot to 22 known credentialed Graph reads. The 25-post production-shape validation and later credential recheck are additional reads, as are subsequent Meta setup/exchange operations. These are not an exhaustive global API ledger. No connector fee or billing invoice was measured; absence of a purchase does not establish unlimited free API use.

The approved token extension returned HTTP 200 at `2026-10-21T02:20:49.610662Z`, lifetime `5,177,995` seconds and conservative expiry `2026-12-20T00:40:44.610662Z`. The replacement and verified expiry were saved in Trigger Production only; no App Secret remains in worker configuration. Its manual recovery used 14.7 displayed billed seconds and $0.00052356 total; the existing hourly schedule still needs a successful recovered non-test run. A roughly 60-day token is not automatic renewal. [Exchange evidence](../reports/instagram-token-extension.json).

The Free-compatible schedule is `0 * * * *`, UTC, `window: "60m"`, concurrency one. A 30-day month has **720 nominal ticks**, 720 Central checks and 120 Music checks: **3,000 core GETs** at four Central pages/one Music page. Sixteen hourly social accounts add **11,520 Meta GETs**, so the combined no-retry scenario is **14,520 source requests/month**. Each social response is bounded to 25 parents and 20 child IDs/types; provider spreading, failures and budgets can reduce actual observations. [Trigger schedule policy](https://trigger.dev/docs/tasks/scheduled#free-plan-minimum-window).

The historical 10-second core scenario is $0.26136/month. A single-mixed-core-run 21-second sensitivity is $0.529056. A **planning assumption** of 35 seconds per combined tick gives `720 × (35 × $0.0000338 + $0.000025) = $0.86976` before retries/credits. None is a measured steady-state baseline or an upper bound. Billed usage differs from wall time; failed access is faster than successful caption collection, Music is due every sixth tick, and unchanged/slow/retry workloads vary. Measure representative billed cycles before adopting a monthly budget. Trigger publishes $5 monthly Free credits, but this account's remaining/shared credits were not audited; reaching the Free limit is a budget block, not authorization to upgrade. [Trigger pricing](https://trigger.dev/pricing).

If every core body changes, historical raw evidence arithmetic is about **0.77 GB/30 days** before metadata, social projections, versions, uploads and backups. Social **HTTP response bytes are not retained-storage bytes**: only sanitized projections are retained. Unchanged projections reuse verified objects; caption changes, error projections and post/version metadata still add storage. No stable social bytes/month or egress baseline is established. Production deletion remains disabled until refresh races, safe orphan cleanup and restore are verified.

Existing Supabase Pro was observed and unchanged; its invoices are unmeasured. Published Free limits include 500 MB database/1 GB file storage, and Pro starts at $25/month with one Micro compute credit. Do not assume Free fits current retention/restore needs. [Supabase pricing](https://supabase.com/pricing). Netlify's observed Free account has 300 monthly credits; successful production deployments, compute, traffic and requests consume shared credits. No recharge/upgrade is authorized, and no full account usage total was audited. [Netlify pricing](https://www.netlify.com/pricing/).

The historical illustrative paid baseline is $9 Netlify + $25 Supabase + $10 Trigger = **$44/month**, before overages/tax/models. It is a scenario, not this project's incremental bill or permission to purchase. The historical 39-account paid actor pilot above remains unapproved and inactive; the current official Meta read route does not activate it. Calendar execution, Resend and model usage remain zero; laptop-off reliability and successful scheduled social recovery remain separate evidence gates.

The separate209-account candidate inventory is inactive:15 overlaps/194 additional,29 high priority(14 new),180 standard,three unverified aliases. Its import made zero collection requests, enabled zero routes and incurred no connector run. Do not include those candidates in the active16-account forecast until scope and access are separately resolved. See reports/instagram-candidates-import.json.
