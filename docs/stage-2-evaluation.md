# Stage 2 extraction evaluation

Stage 2 was explicitly authorized on November 2, 2026. This evaluation work strengthens extraction and reconciliation before adding collection volume. It does not authorize paid upgrades, new social accounts, Meta repair, automatic calendar additions, delivery, or later stages. The existing per-occurrence/per-reminder approval boundary stays intact.

## What exists and what it proves

`evaluation/stage2-cases.json` contains **28 synthetic, agent-authored, unreviewed cases**: 17 development and 11 assigned holdout. The set covers separate event/action/resource units, explicit intervals, original-publication-relative dates, missing context, conflicting years, distinct performances/clubs, source cross-links, unknown end/location/timezone, doors, date-only applications, DST gaps/folds, recurrence exceptions, affirmative cancellation, disappearance, sold-out/waitlist, prompt injection, complete/partial carousels and multi-page PDFs. These inputs are transcripts. An `image` or `pdf_page` tag is not a real media asset or evidence that OCR ran.

The original 45 Stage 0 contracts remain historical and unchanged. They are not automatically promoted into measured extraction successes. This new corpus also does not establish live social access, real OCR accuracy, roughly 100 varied permitted captures, independent human labels, an untouched acceptance holdout, or campus-wide recall. Its assigned synthetic holdout is a regression organization mechanism only.

`evaluation/stage2-split-manifest.json` freezes each whole case, its family and its assigned split with SHA-256. Related film examples, carousel variants, relative-date variants and DST cases stay in one split. Changing a source, label, family or split fails validation. Corrections require an explicit corpus version/change record and a new freeze; previously exposed material must not be presented as an untouched holdout.

## Runtime adapter contract

The scorer accepts `Prediction[]` from an actual runtime candidate. Each prediction has `caseId`, `units`, `processedMedia`, `status` (`complete`, `partial`, `blocked`) and `issues`. A canonical unit has `key`, `kind` (`event`, `action`, `resource`), primitive/null `fields`, and `evidenceFields`. Keys are `event:0`, `event:1`, `action:0`, etc. in source order for these fixtures. The adapter must derive predictions from source input; it must not read expected labels to repair output or manufacture keys from answers.

Only put a field in `evidenceFields` after its runtime claim validator confirms a real source unit and valid text span/quote. The baseline adapter checks the claim's value against its field, retained unit identity, processed status, integer offsets and exact quote text before emitting the flag. The scorer checks labels and evidence coverage, but the presence of an evidence flag is not proof of semantic entailment. A person must verify that a quote supports its claim. Real media evaluation must run the media adapter on actual bytes; substituting the synthetic transcript must be labeled as such. `processedMedia` contains only available image/PDF-page IDs, never caption/text IDs. Missing declared media and unavailable text require an explicit partial/blocked envelope.

Expected fields include title, start/end, date precision, location, cost, status, source timezone, doors, separate action type/time/date, availability and eligibility where relevant. Missing facts remain null. Equivalent explicit ISO offsets count as the same instant; a date-only label does not equal guessed midnight. Unknown deadline time and missing duration cannot become guessed instants. Noncritical missing facts and abstentions are counted, not silently removed from the denominator.

## Measurements and gates

Field precision is correct, label-supported, evidence-present nonnull predictions divided by nonnull predictions **within explicit labeled scope**. A matched unit's extra field absent from its partially specified expected-fields object is unscored: it is neither correct nor incorrect. `predicted`, `labeledPredicted`, `unscoredPredicted` and `predictionLabelCoverage` expose the whole prediction count and the fraction actually labeled. Unscored fields still require validated evidence and are enumerated; a human-reviewed acceptance set with unscored predictions cannot meet the scored gate until those fields are labeled. Unexpected whole units remain fully penalized.

Wrong/unsupported predictions within labeled scope count as false positives; missing expected facts and wrong values count as misses. Critical-field errors are listed separately. An explicitly expected null is an abstention boundary, not permission to invent a value. An event/action unit counts as correct only when its key/kind and required critical facts match. Duplicate predictions and invented events in negative captures cannot inflate recall. Event and action recall have separate numerators, denominators, absolute misses and Wilson 95% intervals. These are strict critical-field completeness measures, not title-only detection rates. A missing required status still fails; the adapter never invents `scheduled` to improve a score. The synthetic labels' scheduled-status expectations themselves require human adjudication.

The evaluator reports declared-media coverage, expected processing/status mismatches, missed required uncertainty flags, negative captures and per-case failures. Missing or unreadable slides remain in the media denominator and require partial status. A partial extraction is not complete processing. Reconciliation scoring separately counts wrong merges, duplicates retained, unresolved review pairs and missing predictions; extractor field correctness is not merge correctness.

`evaluation/stage2-reconciliation-cases.json` supplies 12 additional synthetic, agent-labeled pairs covering exact native identities, explicit event links, separate performances/clubs, conflicting dates/venues, generic homepages, event versus action, weak title similarity, reused poster hashes, reschedules and cancellation. Its separate manifest freezes pair content and uses the same split for related extraction families. These pair labels have zero actual human reviews and establish no production merge accuracy by themselves.

The pack targets roughly 100 varied accessible, human-labeled examples where practical and at least 95% event/action recall within the stated labeled set. The current provisional declared holdout target is 40 human-reviewed cases, reflecting the existing roughly 60/40 plan; it is not a newly measured result or a claim that the pack imposed an exact universal minimum. The scorer keeps acceptance `not_evaluated` with zero human-reviewed holdout labels. Even a perfect synthetic oracle self-check cannot accept Stage 2. `meets_scored_thresholds` would still leave media access/OCR, split exposure, runtime-model comparison, safe reconciliation, source windows and other Stage 2 gates to the full release review.

Costs distinguish known measurements from missing values. A missing cost is not zero. Provider requests and known cost totals describe only the scored runs, not an invoice, monthly average, CPU/storage budget or unlimited-free guarantee. Compare candidate models/prompts on the same frozen inputs, recording exact model/prompt versions, escalation rules, requests, tokens/bytes and observed costs. A deterministic baseline or an oracle is not a completed model comparison. No model call is made by this scorer.

## Human review packet

`evaluation/stage2-human-review.csv` is a concrete 28-row annotation packet with source context, every supplied unit and proposed expected labels. The approve/correct, correction JSON, reviewer, review time and notes columns are intentionally blank. No row has been reviewed by a person. A reviewer should approve the whole case or supply corrected expected JSON, checking every date/action/status and every available slide/page. Resolve critical disagreements through a second reviewer before calling a label adjudicated. Do not use the extraction model as its own unquestioned judge.

The packet starts the review process; synthetic labels alone will not meet the varied real-capture target. Add permitted actual JSON/ICS/HTML, real image flyers/carousels, newsletters, stored social captures where accessible, negatives and observed failures, grouped by organizer/opportunity/media family. Exclude blocked/private access from the accessible-source recall denominator while reporting those gaps explicitly. Keep personal captures private, store rights/access/retention metadata, and do not put credentials or private original media in Git.

## Owner review of the first ten real development units

The owner approved the entire first-ten real-source packet via chat, with no corrections. Confirmation was recorded at `2026-11-03T00:24:25Z`; the original viewing/review time is unknown. Exactly ten real development units are approved as reference facts, spanning 11 source-member records, eight occurrence claims and seven action claims. They remain separate from the 28 synthetic cases above, whose review fields are still blank. The other 90 real units remain unreviewed. This is a single-owner review, not independent adjudication, holdout acceptance or calendar approval.

The ignored private approval overlay pins each original example and proposed-label hash. Frozen captures, examples, family grouping, parser-label provenance and inventory remain unchanged; only the mutable human packet received annotations. [Sanitized approval evidence](../reports/stage-2-first-ten-human-review.json) records the exact scope and counts. The historical inventory-preparation report correctly retains zero human reviews created by that earlier command; the later approval report is the current overlay. Regenerating the inventory must preserve and consult this overlay rather than infer current review status from the frozen `machine_silver_unreviewed` field alone.

The approved packet has existing deterministic-adapter reference labels, not independent Stage 2 runtime predictions or canonical scored-field/processed-media gold. No accuracy percentage or benchmark pass is derived by comparing those labels with themselves. Human-approved development references can now support the next canonical evaluation preparation; no held-out or media accuracy result follows from this approval.

## Commands

`node --import tsx --test tests/stage2-evaluator.test.ts tests/stage2-baseline-adapter.test.ts` tests scoring, exact evidence-span validation and adapter boundaries. The oracle used inside scorer tests merely checks arithmetic and must never be reported as runtime/model accuracy.

`npm run evaluate:extraction` runs the deterministic rules on the **17 development inputs only**, writing ignored private predictions and a sanitized diagnostic. It validates the whole frozen manifest without scoring or diagnosing assigned holdout answers. The original run had already exposed the synthetic holdout, so the assigned set is not an untouched acceptance holdout. Exit 1 means strict development regressions failed; zero provider requests does not measure local CPU cost.

## Corrected development diagnostic — November 2

The original diagnostic is preserved byte-for-byte at `reports/stage-2-rules-diagnostic-initial.json`, SHA-256 `df8f62a96b5e055778f50944978b936d11610284ff60ee573cb60e594f8047db`. Its 44.3% field figure incorrectly penalized extra fields absent from partial labels, and caption IDs caused false media-set mismatches. That measurement is superseded by the explicitly labeled-scope method, rather than evidence of an extraction improvement. Runtime extraction behavior and frozen source/label content were not changed for this rerun. The sole canonical field alias is fixed `price` → `cost`; literal values remain unchanged.

The corrected development-only report has **58/81 labeled predictions correct (71.6%)**, out of **131 total nonnull predictions**. **50 extra fields are unscored**, with 61.8% prediction-label coverage; none of those 50 is declared correct. There are 23 wrong/unsupported predictions within labeled scope and 58/94 expected nonnull facts recovered (61.7%). Strict cases remain **0/17**, strict event recall **0/16** and action recall **1/4**. Every expected event has a missing required status; other date, recurrence, cancellation, negative and component-boundary failures remain. Zero strict event correctness does not mean zero detected events: the rules emitted 17 event candidates. Missing status remains a failed requirement, with no invented scheduling assertion.

Media-set mismatches are now zero; supplied visual-unit coverage is still **9/10** because a declared slide is missing. This is transcript bookkeeping, not real-media accuracy. The rerun made **zero model/provider requests**, and acceptance remains **not_evaluated / Stage 2 not accepted** with zero human-reviewed labels. The original and corrected figures must not be compared as a model-quality improvement. Source-span validity does not establish semantic correctness, and unscored extras require additional labels before a complete precision estimate is possible.

## File-only scorer

After a runtime adapter writes canonical predictions, run:

```sh
node --import tsx evaluation/run-stage2-evaluation.ts --predictions=private/runtime-predictions.json --candidate=exact-runtime-or-model-version --output=reports/stage-2-evaluation.json
```

The command reads files only, writes sanitized scores and calls no collector/model/provider. Exit zero means its regression cases matched their current labels; Stage 2 acceptance remains a separate field. Raw runtime results and captures stay under ignored `private/`. Do not present unit-test pass counts or a valid JSON schema as factual extraction precision.
