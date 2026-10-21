# Official fellowship, research and career deadline monitoring

The user explicitly requested these bounded official sources on October 21, 2026. The adapter is `official-deadlines-v1`; source seeds and exact public routes are in [the route configuration](../config/official-deadline-routes.json). The Stage 0 source registry remains historical access evidence. The existing ONF source identity `fsu-onf-dates` is reused; CRE and Career have distinct identities. Production activation/deployment evidence belongs in status and the release report. This document by itself does not claim the hosted schedule is running.

| Route | Actual fresh read at 23:39 UTC October 21 | Limits |
| --- | --- | --- |
| [ONF Important Dates](https://onf.fsu.edu/important-dates) | One captured HTML response; 18 fellowship programs / 18 closing milestones | Rows omit individual years under a 2026–2027 heading; all retain source text and unknown absolute dates. Four approximate/TBA rows remain approximate. Workshops are outside this parser. Publisher editor IDs can change when a page is rewritten. |
| [CRE public application directory](https://fsu-cre.smapply.us/prog/ds/?page=1&base_query=all) | Two complete JSON pages, all 14 programs / 28 opening-or-closing milestones; five future exact closes, eight past closes, one unpublished close | Public program windows only, no applications/applicant profiles/login. Old program descriptions, eligibility and cross-page conflicts are not resolved by the directory. |
| [Career Center Intern FSU](https://career.fsu.edu/programs-services/internfsu) | One captured HTML response; one Spring 2027 program / two student milestones | October 15 opening and November 9 at 11:59 PM closing omit row years/timezone. They remain unknown absolute dates rather than assigning 2026 from the season. Employer/admin steps and NoleNetwork vacancies are excluded. |

The fresh run made **four GETs / 235,362 response bytes**, normalizing **33 programs / 48 milestones / zero attendance occurrences**. Complete raw captures stay ignored and mode 0600 under `private/official-deadlines-live/`. A local replay of these actual responses produced identical native identities and semantic hashes for every route. This is local network/replay evidence, separate from Trigger scheduling, hosted storage and the owner interface. The [sanitized collection report](../reports/official-deadlines-collection.json) preserves the first DNS-denied attempts as failures.

The five explicit future CRE closing dates are Global Scholars Ambassador November 2, Global Scholars 2027 November 6, FURC funding November 7, Julius Scholars December 1, and IDEA Grants February 1, 2027. Each exact local clock and literal EST/EDT offset comes from the portal, including Julius Scholars' explicit `12:00 AM` at the start of December 1. The interface must show source text and uncertainty rather than presenting a guessed end-of-day reminder. The portal's fixed EST/EDT offsets are represented by IANA fixed-offset zones `Etc/GMT+5` / `Etc/GMT+4`; no DST correction is silently substituted.

Programs and milestones remain separate from attendance occurrences. A changed deadline updates the same native milestone identity and fact version. Closed records remain historical; a disappearing program does not establish cancellation. Save, application submission, email delivery and calendar approval are separate actions. This extension enables none of those executions. In-app monitoring/freshness does not mean a Resend alert was sent.

Run read-only proof with:

```sh
node --import tsx scripts/probe-official-deadlines.ts
node --import tsx --test tests/official-deadlines.test.ts
```

The parser checks complete HTML, exact section/table association, expected native IDs and duplicate protection. The CRE envelope must have stable totals/pages and every page must be visited, with no repeated identities, unexplained empty pages or premature terminal page. A login/error page, schema mismatch, redirect outside the exact allowlist, HTTP failure, interrupted/oversized response or page budget exhaustion never becomes “nothing new.” Failed/partial batches retain a reason and do not advance a cursor. Runtime evidence validation reconstructs each row from its private capture and checks the normalized milestone's identity/date against that evidence.

All three routes are targeted every six hours. At the observed two-page CRE directory, this is **480 public GETs and about 28.24 MB response bodies per 30 days**. Upstream public GET charges are zero; hosted worker runtime/invoices remain unmeasured until an actual production run is recorded. Retention deletion stays disabled. The public vendor bundles used to discover the endpoint are exploratory evidence only; production never fetches or executes them.

Coverage stays bounded: no all-FSU completeness claim, general web search worker, private research portal, employer detail scraping, fellowship-provider reconciliation, automated application, organizer contact, paid connector, model/OCR, email execution or calendar writer. Missing years, stale program descriptions and applicant-specific eligibility remain visible. Stage 2 has not started.
