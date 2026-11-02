# Stage 2 extraction evaluation

Stage 2 was explicitly authorized on November 2, 2026. This evaluation work strengthens extraction and reconciliation before adding collection volume. It does not authorize paid upgrades, new social accounts, Meta repair, automatic calendar additions, delivery, or later stages. The existing per-occurrence/per-reminder approval boundary stays intact.

## What exists and what it proves

`evaluation/stage2-cases.json` contains **28 synthetic, agent-authored, unreviewed cases**: 17 development and 11 assigned holdout. The set covers separate event/action/resource units, explicit intervals, original-publication-relative dates, missing context, conflicting years, distinct performances/clubs, source cross-links, unknown end/location/timezone, doors, date-only applications, DST gaps/folds, recurrence exceptions, affirmative cancellation, disappearance, sold-out/waitlist, prompt injection, complete/partial carousels and multi-page PDFs. These inputs are transcripts. An `image` or `pdf_page` tag is not a real media asset or evidence that OCR ran.

The original 45 Stage 0 contracts remain historical and unchanged. They are not automatically promoted into measured extraction successes. This new corpus also does not establish live social access, real OCR accuracy, roughly 100 varied permitted captures, independent human labels, an untouched acceptance holdout, or campus-wide recall. Its assigned synthetic holdout is a regression organization mechanism only.

`evaluation/stage2-split-manifest.json` freezes each whole case, its family and its assigned split with SHA-256. Related film examples, carousel variants, relative-date variants and DST cases stay in one split. Changing a source, label, family or split fails validation. Corrections require an explicit corpus version/change record and a new freeze; previously exposed material must not be presented as an untouched holdout.

## Runtime adapter contract

The scorer accepts `Prediction[]` from an actual runtime candidate. Each prediction has `caseId`, `units`, `processedMedia`, `status` (`complete`, `partial`, `blocked`) and `issues`. A canonical unit has `key`, `kind` (`event`, `action`, `resource`), primitive/null `fields`, and `evidenceFields`. Keys are `event:0`, `event:1`, `action:0`, etc. in source order for these fixtures. The adapter must derive predictions from source input; it must not read expected labels to repair output or manufacture keys from answers.

Only put a field in `evidenceFields` after its runtime claim validator confirms a real source unit and valid text span/quote. The scorer checks labels and evidence coverage, but the presence of an evidence flag is not proof of semantic entailment. A person must verify that a quote supports its claim. Real media evaluation must run the media adapter on actual bytes; substituting the synthetic transcript must be labeled as such.

Expected fields include title, start/end, date precision, location, cost, status, source timezone, doors, separate action type/time/date, availability and eligibility where relevant. Missing facts remain null. Equivalent explicit ISO offsets count as the same instant; a date-only label does not equal guessed midnight. Unknown deadline time and missing duration cannot become guessed instants. Noncritical missing facts and abstentions are counted, not silently removed from the denominator.

## Measurements and gates

Field precision is correct, label-supported, evidence-present nonnull predictions divided by all nonnull field predictions. Wrong/unsupported predictions count as false positives; missing expected facts and wrong values count as misses. Critical-field errors are listed separately. An expected null is an abstention boundary, not permission to invent a value. An event/action unit counts as correct only when its key/kind and required critical facts match. Duplicate predictions and invented events in negative captures cannot inflate recall. Event and action recall have separate numerators, denominators, absolute misses and Wilson 95% intervals.

The evaluator reports declared-media coverage, expected processing/status mismatches, missed required uncertainty flags, negative captures and per-case failures. Missing or unreadable slides remain in the media denominator and require partial status. A partial extraction is not complete processing. Reconciliation scoring separately counts wrong merges, duplicates retained, unresolved review pairs and missing predictions; extractor field correctness is not merge correctness.

`evaluation/stage2-reconciliation-cases.json` supplies 12 additional synthetic, agent-labeled pairs covering exact native identities, explicit event links, separate performances/clubs, conflicting dates/venues, generic homepages, event versus action, weak title similarity, reused poster hashes, reschedules and cancellation. Its separate manifest freezes pair content and uses the same split for related extraction families. These pair labels have zero actual human reviews and establish no production merge accuracy by themselves.

The pack targets roughly 100 varied accessible, human-labeled examples where practical and at least 95% event/action recall within the stated labeled set. The current provisional declared holdout target is 40 human-reviewed cases, reflecting the existing roughly 60/40 plan; it is not a newly measured result or a claim that the pack imposed an exact universal minimum. The scorer keeps acceptance `not_evaluated` with zero human-reviewed holdout labels. Even a perfect synthetic oracle self-check cannot accept Stage 2. `meets_scored_thresholds` would still leave media access/OCR, split exposure, runtime-model comparison, safe reconciliation, source windows and other Stage 2 gates to the full release review.

Costs distinguish known measurements from missing values. A missing cost is not zero. Provider requests and known cost totals describe only the scored runs, not an invoice, monthly average, CPU/storage budget or unlimited-free guarantee. Compare candidate models/prompts on the same frozen inputs, recording exact model/prompt versions, escalation rules, requests, tokens/bytes and observed costs. A deterministic baseline or an oracle is not a completed model comparison. No model call is made by this scorer.

## Human review packet

`evaluation/stage2-human-review.csv` is a concrete 28-row annotation packet with source context, every supplied unit and proposed expected labels. The approve/correct, correction JSON, reviewer, review time and notes columns are intentionally blank. No row has been reviewed by a person. A reviewer should approve the whole case or supply corrected expected JSON, checking every date/action/status and every available slide/page. Resolve critical disagreements through a second reviewer before calling a label adjudicated. Do not use the extraction model as its own unquestioned judge.

The packet starts the review process; synthetic labels alone will not meet the varied real-capture target. Add permitted actual JSON/ICS/HTML, real image flyers/carousels, newsletters, stored social captures where accessible, negatives and observed failures, grouped by organizer/opportunity/media family. Exclude blocked/private access from the accessible-source recall denominator while reporting those gaps explicitly. Keep personal captures private, store rights/access/retention metadata, and do not put credentials or private original media in Git.

## Commands

`node --import tsx --test tests/stage2-evaluator.test.ts` tests the scoring and acceptance boundaries, not the extraction runtime. The oracle used inside these tests merely checks scorer arithmetic and must never be reported as runtime/model accuracy.

After a runtime adapter writes canonical predictions, run:

```sh
node --import tsx evaluation/run-stage2-evaluation.ts --predictions=private/runtime-predictions.json --candidate=exact-runtime-or-model-version --output=reports/stage-2-evaluation.json
```

The command reads files only, writes sanitized scores and calls no collector/model/provider. Exit zero means its regression cases matched their current labels; Stage 2 acceptance remains a separate field. Raw runtime results and captures stay under ignored `private/`. Do not present unit-test pass counts or a valid JSON schema as factual extraction precision.
