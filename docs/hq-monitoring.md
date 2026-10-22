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

## Initial manual hosted verification — historical snapshot

Migration applied as `20261021225320`; Trigger deployment `yb1nrv34`/`20261021.14` at `23:01:45.671Z` matches commit `5562c54`. Exact-source activation completed at `23:19:03Z`, with expired-request outcomes verified unapplied before retry. Manual/test Cloud run `run_06gm1h2ak2qv58r47dg5biube1` ran `23:20:41.757–23:20:46.948Z`. Source run `b3eba9f2-06ea-40b0-8eb2-9a210a709240` returned two GETs/1,146,891 bytes, 1,176 full source rows, 372 normalized opportunities/occurrences, one private capture and zero duplicate native groups. Source health is success and lease released. The authenticated owner inbox/search displays actual HQ events. A 12/12 populated hosted SQL rollback audit confirms owner reads, other-user/anonymous denial, a private capture bucket and worker-only leasing; it is not signed-JWT/Storage body HTTP proof.

At that initial snapshot, the next nominal poll was `2026-10-22T00:00Z`, corresponding to 8 pm Eastern October 21, and genuine scheduled HQ execution was still pending. The later scheduled evidence below closes that specific gap. Missing private/member content, export inclusion rules, full feed freshness, source-published multi-day program spans, cross-source duplicates and HQ-specific ticket/application milestones remain unresolved. No source text authorizes attendance or an external action.

## Genuine scheduled hosted verification — October 22 UTC

Production run `run_06gm1sfdc83ge1to43d0erep01`, worker version `20261022.1`, was verified as **scheduled, not a test**. Schedule `sched_7piwpgtckcngy15icqk45` assigned the nominal `2026-10-22T00:00Z` slot; the run started at `00:10:49.350Z` and finished at `00:11:36.981Z` (8:10:49–8:11:37 pm Eastern October 21). Seven public sources succeeded; all 27 existing Instagram sources were blocked. A completed dispatcher is not an all-source success. Instagram repair is paused at the user's request; its credentials, scopes and activation were unchanged.

The matching HQ source run `bfb2ca82-2067-4e05-b0ec-bd027cf67fd0` fetched at **`00:11:05.208–00:11:07.309Z`**, recording two GETs / 1,146,891 bytes and reconciling 372 opportunities / 372 occurrences. At `00:11:54.382315Z`, HQ health was success, its lease was released, the single content-addressed capture was retained, and the next nominal poll was **`2026-10-22T06:00Z`**. Provider scheduling windows and retry floors still apply.

That same scheduled run also ingested the four new official application/ticket sources. The database held 66 milestones, 768 opportunities and 783 occurrences across 34 enabled sources. A separate populated official-source rollback audit passed **12/12** at `00:12:15.551641Z`, covering owner/nonowner/anonymous access, private capture metadata, worker-only leasing and source-configuration protection. These are actual SQL-role/local-claim checks, not signed-JWT or Storage body HTTP proof. The laptop was active; no powered-off interval or physical-phone test is established. Stage 1 still has open acceptance gates. [Correlated scheduled evidence](../reports/official-monitors-hosted-release.json), [HQ release history](../reports/hq-hosted-release.json).

## Costs and limits

At the measured size, 120 six-hour checks per 30 days imply 240 GETs including the redirect and approximately 137.63 MB of response bodies. This is an upper estimate of new raw storage if every body changes, before database metadata; identical bodies reuse content-addressed objects and integrity verification can add download egress. Actual source changes, retry load, billed worker seconds and shared account balances are not established by the probe. Retention execution remains disabled, so storage growth is not capped by an implemented deletion policy.

The actual first manual Cloud run displayed 3.8 usage seconds, $0.000025 invocation + $0.00012987 compute = **$0.00015487**. This is one observed run, not an invoice or monthly average; recurring HQ collection shares existing dispatcher invocations. No upgrade, new connector or paid add-on was selected.

The later genuine scheduled run displayed 46 billed seconds, $0.000025 invocation + $0.00155493 compute = **$0.00157993** before credits. This covers the entire combined run, including seven public producers and the 27 blocked Instagram attempts; it is not marginal HQ cost, an invoice or a monthly average.

The preceding hosted capture snapshot had 164 objects totaling 20,979,741 metadata bytes. Existing Supabase Pro, Trigger Free and Netlify Free are retained without upgrades. No model/OCR, email, purchase, RSVP or calendar action is inferred from collection. Private/member coverage, export freshness/inclusion rules and publisher-side truncation remain unknown; validating a complete envelope does not establish complete campus coverage.
