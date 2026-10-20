# Stage 0 public source probes

Verified October 20, 2026. These are bounded read-only collection experiments, not deployed integrations. Python uses only the standard library; this does not replace the proposed production TypeScript stack. No login, passwords, OAuth tokens, purchases, registrations, organizer contact, or calendar writes were used.

## Reproduce and interpret

Run from the repository root:

```sh
python3 -m unittest discover -s tests -p 'test_probe_sources.py' -v
python3 scripts/probe_sources.py --output reports/probes/latest.json --start-date 2026-10-20 --months 12
python3 scripts/probe_sources.py --only fsu-hq-events --output reports/probes/hq-export-live.json --max-requests 4
python3 scripts/probe_sources.py --only fsu-hq-public-calendar --output reports/probes/hq-public-calendar-live.json --max-requests 1
```

These exact commands were run. The final parser suite passed **28 tests**, all synthetic structure/failure examples explicitly labeled as such. The full run attempted **48 top-level fetches** and exited **2**, preserving both the dynamic HQ HTML shell and the then-disallowed CDN redirect as incomplete. A later, narrowly allowed HQ-only run performed **3 top-level fetches** (5 HTTP GETs including the two observed redirects), parsed the real export and its replay, and exited **2** solely because the separate HQ HTML event-list payload remains uncollected. The final public HQ preview run performed **1 GET**, parsed 12 event links, and exited **0**. See each JSON's `command`, timestamps, script hash, request records, and probe outcomes.

The restricted shell initially could not resolve public hosts. The reproducible `--only fsu-hq-public-calendar --output reports/probes/sandbox-network-check.json --max-requests 1 --timeout 5` run exited 2 with DNS failure; this is an execution-environment failure, not evidence of no source events. Bounded public GET execution was then approved outside that network restriction. Exploratory default-urllib requests to Music and tickets returned 403, while the transparent `FSUOpportunityTracker/0.0-stage0` User-Agent in the runnable probe obtained public HTML. This transport sensitivity is a reliability finding.

Limits are 100 top-level fetch invocations per run (urllib separately bounds redirects), 30 seconds maximum per request (25 by default), 3 MiB per response, and a 150 ms interval. No automatic retries obscure the first failure. The URL guard accepts public FSU HTTPS hosts, rejects action-style `doWork`/`createBO`/checkout queries, and permits only the exact publicly observed CampusGroups institutional export path. It does not grant general CampusGroups crawling. A source failure remains a failure even if another independent probe succeeds.

## What actually worked

| Source and evidence | Observed result | Practical limit |
| --- | --- | --- |
| [FSU Localist API](https://calendar.fsu.edu/api/2/events?days=7), `latest.json` | Seven-day window: 332 native occurrence IDs across 293 event IDs, 4 pages; page 5 returned 0 after the declared terminal page. Twelve complete monthly partitions cover 2026-10-20 through 2027-10-20 exclusive, totaling 1,931 occurrence rows and 1,343 distinct event IDs. | This measures published data returned in tested windows, not every campus event or future announcement. |
| Same API, month 1 | 1,059 occurrences over 11 pages, with returned occurrence counts equal to declared `total_items`. | The 1,000-event ICS/RSS feed warning must not be assumed to cap this tested JSON pagination route. Provider limits may change. |
| Same API, recurrence/replay | 90 events marked recurring; 74 have multiple distinct native occurrence IDs across captures. Repeated first page matched all 100 event/occurrence row identities with unchanged stable content hashes. | No upstream event was edited by this project. Update propagation, recurrence exceptions, cancellations and deletion semantics remain untested live. |
| [HQ public department preview](https://calendar.fsu.edu/department/fsu-hq), `hq-public-calendar-live.json` | 12 real canonical event links (6 upcoming and 6 recent), date text and title samples. | An older full report counted 13 candidate links because it included submit-event navigation; the later single-source result supersedes that count. Locations can be restricted despite public titles/times. A complete HQ mirror is unproved. |
| [Public HQ ICS](https://hq.fsu.edu/ical/floridastate/ical_floridastate.ics), `hq-export-live.json` | Exact URL first observed inside public HQ page JavaScript; HTTP302 to `https://static-prod-us-east-1.campusgroups.com:443/ical/floridastate/ical_floridastate.ics`. HTTP200 `text/calendar`, 1,119,964 bytes, 1,146 VEVENTs and unique UIDs. DTSTART span July 22, 2026–May 26, 2027; supplemental measurement found 441 starts on/after October 20, 2026. Identical bounded replay hash. | Public institutional export only. Its inclusion rules, truncation policy, private/member event coverage and update delay are unknown. This discovery does not establish full HQ access. |
| Same HQ ICS | All 1,146 records have DTEND, SEQUENCE, LAST-MODIFIED and DTSTAMP; none has STATUS, RECURRENCE-ID or RRULE. Latest observed modification/stamp token is `20261020T010458Z`. | No STATUS field means no live evidence for cancellation representation; disappearance must not imply cancellation. |
| [College of Music](https://music.fsu.edu/events/), `latest.json` | Deterministic HTML probe extracted 10 dated event cards and their detail links, including concerts/recitals. An actual linked detail page was fetched. | Homepage preview only. Full calendar pagination, detail consistency and timezone/end parsing remain to implement. Unknown timezone/end are null. |
| [National Fellowships important dates](https://onf.fsu.edu/important-dates), `latest.json` | 9 date-bearing HTML items captured as evidence; samples include TBA deadlines, a November fellowship deadline and October 22 research opportunities presentation with its observed registration link. | Date interpretation is not approved scheduling. Academic-year context, TBA dates and source `EST` labels require review. Registration links were recorded, never executed. |
| [Hello FSU weekly archive](https://hello.fsu.edu/weekly-top-5), `latest.json` | 10 announcement links; followed its actual RSS link and one actual article. RSS has native GUIDs and publication dates. | Latest sampled RSS publication is April 30, **2023**. This is a stale archive, not evidence of a current newsletter. Inbound email/webhook and flyer OCR remain unconfigured. |
| [MatPat archive](https://calendar.fsu.edu/event/golden-torch-lecture-series-presents-an-evening-with-matpat), `matpat-conflict.json` | Live header gives September 29, 2026, 20:00–21:00 EDT; description also references March 4. Its linked ICS was actually parsed. | The discrepancy blocks inferring a ticket-release date. Original announcement/on-sale time and historical alert timeliness remain null. |

## Reachable without operational ticket extraction

The [ticket office](https://tickets.fsu.edu/) and its observed Golden Torch information page returned guest HTML; the information page exposed no event dates in the tested response. An observed seating-map link contained action-style `doWork`/`createBO` parameters and was not executed. Two actual event `ticket_url` links from the calendar were followed to public FSU alumni registration information. Generic `register` text is not evidence of ticket inventory, sold-out status, or on-sale time. Ticket-status ingestion remains **unverified**, even though those pages are reachable.

The [HQ events page](https://hq.fsu.edu/events) returns HTTP200 with unrendered `[eventName]`/`[eventDates]` placeholders. That HTML route is a dynamic shell; it is never recorded as an empty successful event collection. Its public export is a separately proven route. Full permissioned HQ coverage still requires a supported FSU-approved subscription/institutional integration or authorized member-only intake; this probe neither possesses nor requests institutional API credentials.

The law calendar exploratory GET returned public navigation pointing to the central calendar rather than independent dated event facts. CRE/UROP exploratory GET confirmed applications for 2026–2027 were closed, without an exact deadline. Neither was promoted as a separate operational event adapter.

## Evidence retention and provenance

- `reports/probes/latest.json`: full 48-request probe metadata, hashes, IDs, complete partition summaries, limited parsed samples. It retains the historical redirect failure; apply the newer HQ export and preview reports for current conclusions.
- `reports/probes/hq-export-live.json`: canonical successful public export and hash replay, separate from the failed dynamic HTML route.
- `reports/probes/hq-public-calendar-live.json`: corrected canonical event-link filter and real preview titles.
- `reports/probes/matpat-conflict.json`: minimal live conflict excerpt, native IDs, occurrence claim and its original request record.
- `reports/probes/parser-samples.json`: **real public field projections**, explicitly `synthetic: false`, `lossless_response: false`. Same event ID with two different native occurrence IDs. This is not the original full HTTP body or a fabricated API response.
- `reports/probes/initial-live-run.json`: earlier 45-request historical run before stronger count/occurrence checks. Superseded for parser conclusions, preserved to expose changes and initial failures.
- `reports/probes/hq-export-redirect.json`: supplemental actual redirect/header/date-span measurement. The runnable HQ report supersedes its ad hoc collection method.
- `reports/probes/sandbox-network-check.json`: actual restricted-network DNS failure.

The bounded HTTP bodies were hashed in memory rather than committed wholesale. Records omit attendee/member lists, contacts and user profiles. ONF excerpts were minimized to date labels/program names; public Outlook Safe Links were replaced by the HTTPS destination already encoded in them, dropping email-security tracking metadata without fetching those targets. The historical full report marks this evidence minimization and retains original response hashes. These projections support bounded evidence inspection; production replay needs private raw captures and parser versions in Stage 1.

## Tested failures versus untested operations

Synthetic tests exercise HTTP200 login/error/template detection, public-page login-link false positives, malformed JSON/occurrences, native event/instance identity, stable fact hashing, empty or truncating pagination, changing totals, replay keys, RSS/Atom structure, malformed ICS, exact export allowlisting and tracking minimization. They are parser checks, not a live vendor, OCR, retry, extraction-quality or calendar pilot. Source reports do not certify production service, deployment, private access, or campus-wide completeness.

Stage 1 can start with the verified JSON route plus independent Music/ONF evidence and authenticated manual intake; the useful public HQ export can join with its measured scope visible. It must retain source-run failures separately from capture counts, persist occurrence IDs without collapsing same-title performances, preserve unresolved dates, and keep calendar execution disabled.
