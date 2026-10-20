# Stage 0 cost model

Prices checked **2026-10-20**, USD before tax. Runtime, volume, storage, token use and retry counts below are **explicit assumptions**, not production measurements. No hosted services were provisioned, model calls made, actor runs started or purchases made in Stage 0. Live free public metadata/documentation reads are the only vendor activity. Actual service invoices and current account credits are unknown.

The proposed Next.js, Supabase, Trigger.dev, Resend and Google Calendar stack remains appropriate. It separates durable evidence and approved actions from replaceable collectors without adding another workflow service. Next.js can also run on ordinary Node hosting; moving hosting does not solve gated sources. The free path is a constrained pilot possibility, not a production cost promise or a recommendation to buy anything now.

## Verified rates and constraints

| Component | Current primary evidence | Cost treatment |
| --- | --- | --- |
| Supabase | [Pricing](https://supabase.com/pricing): Free $0, 500 MB DB, 1 GB file storage, 5 GB egress, inactive projects may pause after one week. Pro starts $25/month, first project included; 8 GB DB, 100 GB storage, 250 GB egress. | Free may fit a small core shadow pilot. Paid scenario assumes one Pro project with included compute sufficient. Separate staging projects, larger compute, egress and backups can add cost. |
| Trigger.dev Cloud | [Pricing](https://trigger.dev/pricing): Free has $5 monthly credits, 10 schedules and 1-day logs. Hobby $10/month includes $10 credits. Invocation $0.000025; micro $0.0000169/s, small-1x $0.0000338/s, medium-1x $0.000085/s. | One dispatcher schedule; source-run history persists in Postgres. Count empty checks, retries and extraction worker runtime as well as useful captures. Paid fee plus usage beyond included credits, not fee plus all usage. |
| Resend | [Pricing](https://resend.com/pricing): Free 3,000 emails/month and 100/day; Pro $20/month for 50,000, additional $0.90/1,000. Inboxes consume transactional quota. | Model combines 100 outbound + 200 inbound/month with assumed daily peak 20, so Free fits. Domain verification/DNS and working inbound are setup tasks, not proven integration. Marketing, dedicated IP and automation add-ons are unnecessary. |
| Vercel / Next.js | [Vercel pricing](https://vercel.com/pricing): Hobby $0 for personal projects; Pro starts $20/month with included usage credit. | This personal app may fit Hobby subject to its current terms/limits. Paid scenario assumes one Pro seat, not unlimited compute. Browser collection belongs in workers. Next.js hosting need not be Vercel. |
| Apify platform | [Pricing](https://apify.com/pricing): Free $5 credit, Starter $19/month with $19 prepaid usage, then pay-as-you-go. Actor charges vary. | One $19 fee plus excess eligible usage; do not double-count the fee and included credit. Do not assume Free automatically permits overage. Future billable execution requires separate authorization. |
| Instagram posts actor | [Live metadata](https://api.apify.com/v2/acts/apify~instagram-post-scraper), saved `evidence/apify-posts-metadata.json`: FREE post $0.0017 + detailed-data $0.001; BRONZE post $0.0015 + detailed-data $0.0008. Optional music extra is disabled. | Use current detailed-data rates, not the Store's “from $1/1,000” headline. Every returned old post may be billed again. Metadata `minimalMaxTotalChargeUsd=0.005` is a minimum **charge-limit setting**, not evidence of an extra fixed run fee. No post run charge or output was measured. |
| Community Story actor | [Live metadata](https://api.apify.com/v2/acts/datavoyantlab~advanced-instagram-stories-scraper), saved `evidence/apify-stories-metadata.json`: username request $0.003 plus actor start $0.099 per GB, minimum one start unit/run. | Empty username checks still belong in the forecast; assumed 1 GB and one batched run/check. Larger memory or fragmented batches increase cost. Capability/permission remains unproven. |
| Runtime extraction model | No model selected or called. **Assumed sensitivity rates**: $1/million input tokens, $4/million output; 2,500 input tokens/image. | This is a replaceable model budget parameter, not a quote for any particular vendor/model. Before selection, benchmark accuracy and actual billed vision tokens, verify that provider's current price, then replace assumptions. No transcription enabled. |

Google Calendar integration is unconfigured and writes are disabled; no calendar cost was incurred. Its [current quota/pricing guide](https://developers.google.com/workspace/calendar/api/guides/quota), checked 2026-10-20, says standard usage is available without additional charge and describes a 1,000,000-request/day/project billing threshold for new quota arrangements, with future over-threshold billing details to be announced. Per-minute project/user limits also apply. A personal approval-only calendar should be far below that daily threshold, but quotas, future billing and Google Cloud/OAuth requirements must be rechecked before Stage 4. This is not an unlimited-free-API promise. Domain budget is an optional **assumed** $18/year ($1.50/month equivalent), unpurchased. An existing domain/provider subdomain may avoid it. Coding subscriptions, developer time, taxes, observability add-ons, separate staging and unlisted provider overages are excluded rather than silently treated as zero.

## Reproducible 30-day core forecast

Inputs are in `config/cost-assumptions.json`; `python3 scripts/cost_model.py --output evidence/cost-forecast.json` reproduces the arithmetic offline. Counts below are a proposed expanded operating scenario, not the number of sources currently integrated.

| Workload | Assumed volume | Raw worker charge |
| --- | --- | --- |
| Dispatcher | 96/day × 30 = 2,880, 2s micro each | `2,880 × (0.000025 + 2 × 0.0000169)` |
| HTTP/API/feed checks | 5 sources × 96/day + 15 × 24/day + 30 × 1/day = 26,100/month, 3s small each | `26,100 × (0.000025 + 3 × 0.0000338)` |
| Browser checks | 10 sources × 1/day × 30 = 300, 20s medium each | `300 × (0.000025 + 20 × 0.000085)` |
| Extraction / notification workers | 500 × 5s small; 100 × 1s small | Invocation + execution time for each |

Combined Trigger usage is **$4.088764/month** under those assumptions, within a wholly unused $5 Free credit. Extra retries and slower pages can exceed it; exceeding Free credit means budget/setup-needed, not an automatic upgrade in this project. Forecast token usage is 500 captures × 1,500 text input + 300 images × 2,500 image input = 1.5 million input; 500 × 500 = 250,000 output. At assumed rates that is **$2.50/month**, charged by the eventual model provider if used.

Estimated steady-state public media/bounded-excerpt storage is **0.312 GB**: 0.300 GB media at 30 days plus 0.012 GB minimized excerpts at 90 days; DB metadata grows roughly **0.010 GB/month** before indexes, claims, source-run logs, old versions and auth. Sensitive/member-only raw evidence must have the shorter private retention in the architecture and owner restrictions; reducing retention can reduce storage but not permission requirements. Event metadata/claims can be kept longer with bounded excerpts. Every extra carousel image and retained revision counts; free quotas are not a storage policy. Measure bytes, DB growth, egress and retry load during the thin slice. Free scenario also assumes 2 GB egress/month, an empty starting database, Vercel Hobby eligibility/quotas, and unused provider credits. The calculator returns no Free cash quote and lists setup/budget blockers when a modeled Free quota fails; unmodeled limits still need validation.

| Scenario | Forecast/month excluding optional domain and tax |
| --- | ---: |
| Supabase Free + Vercel Hobby + Trigger Free + Resend Free, **only if all quotas/current eligibility and unused credits fit**; assumed model usage | **$2.50** |
| One Supabase Pro + Vercel Pro + Trigger Hobby + Resend Free + assumed model usage | **$57.50** |
| Same paid baseline plus Resend Pro | **$77.50** |

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

**Storage condition:** 1,755 media at an assumed 1 MB each is 1.755 GB before core evidence, above Supabase Free's 1 GB. The $41.15 figure therefore assumes an already available paid/private storage allocation (e.g. the paid core scenario) or a separately costed smaller retention/selection plan. It is not an all-in Free-tier deployment price. Starting the paid baseline for a month alongside this pilot would forecast **$98.65** before domain/tax/unmeasured extras. Do not buy storage or silently discard required slide evidence to fit a quota.

Proposed **$45 incremental pilot cap is unapproved**, and $41.15 leaves little uncertainty margin. If actual run memory is 2 GB, Story start fees rise by another $8.316 before retry reserve, exceeding this cap; lower cadence/scope or a revised approved budget is needed. Single-account Story runs would produce 3,276 starts rather than 84 and roughly $324.32 in start fees alone, so batching matters. A 30-account sensitivity is $34.55; 50 accounts in one ≤50-account batch is $49.21, using the same assumptions, thus the $45 proposal cannot cover that scenario. Human audit labor is **13.65 hours assumed**, unpriced; if the audit is incomplete, report a smaller audited denominator, not fabricated recall.

Before a separately authorized pilot, require per-run maximum charge and a durable total spend ledger. Count retries, starts, empty checks, media processing and bytes. Alert at 80% of approved cap and halt paid work at 100%; retain health alerts and blocked-source state. Recheck current pricing on pilot day. The actor adapters remain disabled until permission, account validation, budget and observed-capture tests pass.

## Optional services and measurement gaps

[X pricing](https://docs.x.com/x-api/getting-started/pricing) lists $0.005 per returned Post resource for third-party reads: 1,000 returned posts adds $5 before any separately priced resources. This connector is unrun and excluded from baseline. Firecrawl, Bright Data, RSSHub hosting, changedetection.io and Langfuse are unselected; their charges are **unknown/excluded**, not zero. Add only when measured marginal opportunity discovery justifies the cost and the source permits the route.

Record per-source runs, elapsed CPU/wall time, HTTP bytes, media counts, vendor billed events/plan credits, model input/output/image tokens, cache hits, unique opportunities and cost on failed/empty checks. Record zero additional opportunities separately from failure. Stage 1 should replace representative HTTP runtimes and storage assumptions with actual values; Stage 2 chooses a model against held-out labels. No forecast here establishes operational social access, OCR quality, discovery recall, alert timeliness, invoice amount or production readiness.
