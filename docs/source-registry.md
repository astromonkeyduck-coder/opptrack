# Source registry and discovery policy

`config/source-registry.json` is the machine-readable Stage 0 inventory. The initial 49 URL records reproduce all collection/discovery seeds in section 5 of the build pack plus its MatPat regression reference; integration and manual intake routes are separate records. Related landing pages and feeds are not independent coverage denominators. `source_role` distinguishes directory seeds, intake routes, integration routes and actual collection candidates.

Every row includes affiliation evidence, access/visibility, intended adapter, credentials by reference only, cadence, rate-limit uncertainty, cost assumptions versus measured usage, owner, last attempt/success/test, cursor and operational status. All runtime `enabled` flags are false because Stage 0 does not provision a dispatcher. A successful probe does not turn on scheduling. Cadences are proposed starting budgets, conditional on provider restrictions and observed publication rate.

| Status | Meaning |
| --- | --- |
| `verified_operational` | The named bounded read-only route parsed genuine relevant payloads during a recorded test. Scope, transport, fields and window are limited to that evidence. This does not mean production readiness. |
| `documented_but_untested` | A real source seed or provider-documented route exists, but project ingestion has not been demonstrated. A pack seed alone is explicitly identified as such. |
| `blocked` | A collection attempt hit access/transport/parser limits or a required permission is unavailable. Keep the reason and last successful time separately. |
| `manual_only` | Supported only through a user/organizer-provided lead, upload or permitted forwarding. No automatic collection claim. |
| `unsupported` | No supported automated route established; do not schedule it. |

HTTP success is a transport observation. Operational collection additionally needs the expected payload, native/evidence identifiers, usable content and completeness checks. A successful empty page requires a recognized envelope and a known bounded window; a failed or ambiguous response is never empty success. Restrictions can exist at field level even when public event titles are visible. A generic login link in a public page footer is not by itself a login wall.

Affiliation checks must be conservative. An official `fsu.edu` domain supports institutional identity, not adapter completeness. Off-campus organizers and external Linktree/social profiles need official cross-links before trust. The registry records seed provenance separately from live parsing evidence. Discovered links/cohosts/accounts enter a verification queue; do not automatically ingest arbitrary URLs or student profiles.

Suggested graph: organization → owns source/account; directory → lists organization; organizer website → verifies social identity; capture → links ticket provider/cohost; calendar record → references original HQ ID. Preserve these edges and provenance instead of counting every URL as a new source of independent events. Never collect membership rosters.

Weekly discovery refresh follows official directories, organizer links, bios and cohosts. Monthly review checks source staleness, renamed accounts, broken feeds and new colleges/clubs; term changes trigger season-link and eligibility review. Expansion priorities include engineering, GIS/geography, substantive library lectures, entrepreneurship, cultural agencies, Homecoming, Circus, sustainability and sports clubs, using the official directory and HQ's permitted organization discovery. These categories remain discovery backlog, not fictional verified adapters.

Audit coverage in bounded source/time windows. Record manually observed eligible announcements, captured IDs and misses; separate discovery, access, collection, extraction, recommendation visibility and delivery failures. Social consumers/professionals, small clubs and event producers need distinct strata. Preserve catalog breadth; collection is never filtered by the user's ranking preferences.

See the source-specific evidence in `reports/probes/`, [coverage gaps](coverage-gaps.md), [access feasibility](access-feasibility.md), and [social pilot](../config/social-pilot-accounts.json). Registry status must be reconciled from actual reports, not inferred from how plausible a URL looks.
