# Public HQ collection

The user authorized this bounded source extension on October 21, 2026 after asking about missing campus coverage. It adds the public institutional subscription at `https://hq.fsu.edu/ical/floridastate/ical_floridastate.ics`. The observed redirect is restricted to the same exact path on `static-prod-us-east-1.campusgroups.com`. No login, FSUID, member data or paid connector is used.

The collector validates the whole captured ICS envelope, then discovers new UIDs within the next 90 days plus known ongoing events. Before each HQ collection the worker loads existing UIDs from owner/source-filtered database pages, with a 10,000-row ceiling, explicit empty terminal page and overflow probe. Previously collected UIDs still present in the full feed are emitted even after moves into the past or beyond 90 days, including explicit cancellations. Lookup failures stop collection and cursor advancement; source-supplied cursors cannot nominate retained identities. Each native UID identifies one opportunity and occurrence in their separate identity domains. A moved date updates the same occurrence and preserves Save/Pass decisions. Replayed semantic facts retain the same hash; export retrieval timestamps do not create fact versions. Cross-source matches to Central are not automatically merged, so duplicate listings across sources remain possible.

Only an explicit `STATUS:CANCELLED` establishes cancellation. A disappeared or out-of-window UID never cancels an existing event. Recurring components, unsupported components, duplicate UIDs, malformed dates, truncated envelopes and access pages remain failed/partial/blocked, never successful empty collections. Floating and TZID times are retained with uncertainty instead of guessed UTC conversions. Conflicting source end times are normalized unknown while their exact source range remains in private evidence. Registration links do not establish availability, eligibility or a ticket release.

Fresh live probe at `2026-10-21T19:31:26–19:31:27Z`: two GETs including the redirect, 1,146,891 response bytes, 1,176 native rows, 376 upcoming/ongoing occurrences and 800 outside the bounded window. Three past rows had end-before-start conflicts. Replaying the private response produced identical semantic records. This probe made no database or calendar writes. [Probe evidence](../reports/hq-public-collection.json).

The fresh `22:57:24Z` recheck fetched the same feed hash and 1,176 native rows: 373 occurrences were still upcoming/ongoing and 803 were outside the later window because three had finished. The report retains both dated attempts. Nineteen parser tests and six retained-identity lookup tests pass; 12 actual PostgreSQL/worker replay checks include moves 180 days ahead, 30 days into the past and cancellation outside 90 days. Storage/provider calls in those replay checks are synthetic, distinct from the live feed probes.

## Deployment order

1. Run the parser, dispatcher, database, type and application build checks. Keep raw responses under ignored `private/hq-live/`.
2. Apply the generated `20261021193109_hq_public_collector.sql` migration. It admits `hq-ics-v1` to the core group and permits three exact producer slots while preserving the separate 27-account social budget. It does not enable a source.
3. Deploy the tested worker commit to Trigger Production and web commit to Netlify. Existing secrets stay separated; no new environment variable is needed.
4. Only after the new worker is live, activate the existing `fsu-hq-public-export` row at 21,600 seconds. Record first actual cloud ingestion separately from genuine scheduled proof.
5. Verify the corresponding source run, private capture, normalized records, identity uniqueness and owner inbox. Update status with exact run provenance; a local probe is not hosted collection proof.

The source shares the single hourly Trigger dispatcher. Its nominal UTC source slots are six-hourly and independent of completion time and retry floors. A core budget of three prevents a simultaneous Central/Music/HQ due slot from skipping a producer. No paid upgrade or extra schedule is needed.

## Actual hosted verification

Migration applied as `20261021225320`; Trigger deployment `yb1nrv34`/`20261021.14` at `23:01:45.671Z` matches commit `5562c54`. Exact-source activation completed at `23:19:03Z`, with expired-request outcomes verified unapplied before retry. Manual/test Cloud run `run_06gm1h2ak2qv58r47dg5biube1` ran `23:20:41.757–23:20:46.948Z`. Source run `b3eba9f2-06ea-40b0-8eb2-9a210a709240` returned two GETs/1,146,891 bytes, 1,176 full source rows, 372 normalized opportunities/occurrences, one private capture and zero duplicate native groups. Source health is success and lease released. The authenticated owner inbox/search displays actual HQ events. A 12/12 populated hosted SQL rollback audit confirms owner reads, other-user/anonymous denial, a private capture bucket and worker-only leasing; it is not signed-JWT/Storage body HTTP proof.

The next nominal poll is `2026-10-22T00:00Z`, corresponding to 8 pm Eastern October 21; the hourly Trigger Free window can delay actual execution. **No genuine scheduled HQ run or laptop-off interval has yet been observed.** Do not replace that gap with the successful manual run. Missing private/member content, export inclusion rules, full feed freshness, source-published multi-day program spans, cross-source duplicates and ticket/application milestones remain unresolved. No source text authorizes attendance or an external action.

## Costs and limits

At the measured size, 120 six-hour checks per 30 days imply 240 GETs including the redirect and approximately 137.63 MB of response bodies. This is an upper estimate of new raw storage if every body changes, before database metadata; identical bodies reuse content-addressed objects and integrity verification can add download egress. Actual source changes, retry load, billed worker seconds and shared account balances are not established by the probe. Retention execution remains disabled, so storage growth is not capped by an implemented deletion policy.

The actual first manual Cloud run displayed 3.8 usage seconds, $0.000025 invocation + $0.00012987 compute = **$0.00015487**. This is one observed run, not an invoice or monthly average; recurring HQ collection shares existing dispatcher invocations. No upgrade, new connector or paid add-on was selected.

The preceding hosted capture snapshot had 164 objects totaling 20,979,741 metadata bytes. Existing Supabase Pro, Trigger Free and Netlify Free are retained without upgrades. No model/OCR, email, purchase, RSVP or calendar action is inferred from collection. Private/member coverage, export freshness/inclusion rules and publisher-side truncation remain unknown; validating a complete envelope does not establish complete campus coverage.
