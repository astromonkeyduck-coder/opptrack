# V6 human annotation field guide

This is a source-only field glossary, not proposed factual labels or predictions. Keep the v1 protocol and original references unchanged. First complete the independent whole-family/exposure review bound to the actual candidate freeze. Then directly inspect every supplied original asset/page, enumerate complete source observations and human canonical units, and annotate without candidate outputs or AI factual proposals.

The mandatory event fields are `title`, `date`, `startAt`, `endAt`, `timeZone`, `status`, `location`, `cost` and `eligibility`. Action fields are `title`, `actionType`, `occursOn`, `occursAt`, `timeZone`, `availability` and `eligibility`. Resource fields are `title` and `eligibility`. Each requires a deliberate known / unknown / not_applicable state. Unknown/not_applicable means an explicit null and human reason; a missing key is not an unknown annotation. Known facts require exact frozen text evidence or original image/PDF hash, page and human region/transcription.

Record every additional source-backed critical fact, even if the extractor later misses it. Every emitted nonnull field must also be human labeled; unscored extras block acceptance. This inventory names the additional fields current v6 and its frozen dependencies can emit. It gives no case-specific values:

| Fields | Meaning to review |
| --- | --- |
| `sourceHeading` | Literal descriptive heading retained when it does not establish the canonical program/opportunity `title`. Label these independently; a source heading does not license inventing a program name. |
| `organizer`, `speaker` | Literal source organizer and speaker claims. Do not substitute publisher/contact logos or assume a speaker is the organizer. |
| `building`, `room`, `location` | Building/room components and the composed venue. Preserve per-performance scope and conflicts. |
| `price` → `cost` | The one frozen field-name alias. Annotation/scoring uses `cost`; preserve literal source cost wording rather than inferring free admission from absence. This is not a value-conversion rule. |
| `eligibilityHeading`, `eligibilityText`, `eligibility` | A literal section heading, retained literal block and actual criterion are separate claims. Do not flatten columns/bullets or turn an isolated heading into an eligibility sentence. |
| `year`, `month`, `day`, `dateText`, `datePrecision` | Explicit full/partial source date components, wording and precision. For actions these are scoped by the action unit/type/phase; do not invent a missing year/day. |
| `dateStart`, `dateEndInclusive`, `endDateExclusive`, `allDay` | Source intervals and inclusive/exclusive boundaries. A range is not automatically one timed occurrence or an invented daily recurrence. |
| `startLocal`, `endLocal`, `startClock`, `endClock` | Source local date/clock facts distinct from UTC instants. A clock without a known date/zone does not establish an instant. |
| `actionLocal`, `actionType`, `actionPhase`, `occursOn`, `occursAt` | Literal action/reminder date/clock, type and phase. Posting, application opening, deadline and ticket release are distinct. Preserve a phase-only deadline without inventing its exact day. |
| `doorsLocal`, `doorsAt` | Doors-open facts distinct from the actual event start. |
| `timeZone`, `utcOffset`, `sourceTimeZoneAbbreviation` | Stated zone, fixed offset and source abbreviation. Source date and event-local date must not be silently exchanged; conversion requires the stated zone. |
| `recurrenceDerived` | Provenance that an occurrence was derived from a literal finite recurrence rule. Human enumeration must still verify every occurrence and exception. |

Additional explicitly annotated fields such as native identities, routing URLs or separately reviewed source/event-local representations remain permissible when the source supports them. They must not be supplied merely because a field name exists. The frozen critical-field registry prevents temporal/partial/range/precision/phase, status, availability, cost, eligibility, venue/building, organizer, identity and routing fields from being downgraded to noncritical. Noncritical prose errors remain reported without introducing a zero-all-facts gate.

Source observations retain their literal source context. Canonical units separately identify actual distinct occurrences, actions and resources; do not merge performances merely because titles, clocks or artwork resemble one another. Human duplicate/nonduplicate/distinct-performance relations and genuine readable negatives need their own explicit review. Expected blocked-processing challenges receive no semantic-negative credit.

Original and transformed source views have distinct hashes/offsets when their text differs. Review the complete original so a transformation cannot erase facts from the gold scope; cite the actual transformed representation as well for a retained field used by extraction. No factual annotation, cohort assignment or release approval is created by this guide, the six confirmed representation rules, or the presence of a candidate freeze.
