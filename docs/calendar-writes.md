# Individually approved Google Calendar additions

On November 1, 2026 the user explicitly confirmed adding an approval-only writer after the read-only connection was explained. This narrow extension supersedes the historical disabled-write baseline only in Netlify. It does not authorize the rest of Stage 4, email delivery, automatic additions, changes/deletions, guests, recurring events, paid services or resuming Meta repair.

## User flow

An event's Details or Saved view offers **Review calendar addition** when the Netlify feature flag is enabled. `/calendar?kind=occurrence&id=…` loads the current source facts. The user reviews the exact title, start/end, Eastern timezone, location, source link and uncertainty, then checks the single-item approval and presses **Approve this event & add to Google**. Save, Pass and Undo remain private tracker decisions. Existing saved items are not backfilled.

The Deadlines & tickets page offers **Choose reminder time**. The user chooses both start and end in Eastern time, reviews them and approves that one reminder separately. These are calendar blocks with no pop-up/default notification. The source's uncertain year/timezone is not guessed. An optional explicit 15-minute choice sets the displayed end; nothing is preselected. Nonexistent/repeated local DST times are rejected rather than silently shifted.

Only future scheduled events with verified exact starts and ends qualify. Unknown durations, all-day/date-only rows without a verified exclusive end, cancellations and postponements stay blocked. Other source-health warnings remain visible. Approval history at `/calendar` links to the latest 50 commands for explicit recovery. The API returns no credentials or personal-calendar contents with these records.

## Configuration and Google consent

- Netlify Production: `CALENDAR_WRITES_ENABLED=true`, with the existing server-only Google client and encryption key. Templates retain the safe default `false`. Netlify Free's all-scope environment limitation remains documented; secrets never enter browser bundles.
- Trigger Production: `CALENDAR_WRITES_ENABLED=false`. It receives no Google key/token or Calendar executor.
- The existing read connection remains usable until a successful new consent. The explicit write-connect form requests exactly `https://www.googleapis.com/auth/calendar.events.owned`, with owner-bound encrypted state, PKCE and a ten-minute expiry. Google permits event management on owned calendars; the application uses only fixed primary-calendar GET and insert routes. The owner reviews the grant directly with Google. No broader calendar/ACL scope is accepted.
- The app remains a Google test app: Calendar refresh grants may expire after seven days. Reconnection is an explicit user action, not automatic renewal. No paid plan or billing activation is required by this implementation; actual provider usage/invoices remain separate evidence.

The Google scope's capability is broader than the application's create-only implementation. Code has no Google event PATCH, PUT or DELETE path, no calendar creation route, attendees, recurrence or default reminders. Manual Google editor links remain available separately.

## Approval, destination and retry boundaries

Generated migration `20261102021158_approved_calendar_writes.sql` is hosted as `20261102022214`. It adds a private RLS-protected immutable approval/command table. New public wrappers are security invokers; private definers pin an empty search path, require the owner member and deny anonymous/nonowner/worker access. Source ingestion privileges are unchanged.

`calendar_write_preview` returns current opportunity and occurrence/milestone facts and a canonical SHA-256 fingerprint. The fingerprint includes the exact calendar description/title blueprint and Google authorization generation/scope. `calendar_write_approve` serializes duplicate targets, locks parent and target facts, rechecks the fingerprint and persists both approval snapshot and deterministic Google event ID atomically **before** any provider call. Idempotency is per owner/target; cross-source representations still need manual duplicate review. One owner/target has one immutable command; later source changes cannot replace it or silently alter its approved time.

The destination is bound conservatively to an OAuth authorization generation, rather than an unverified account email. Token refresh preserves that generation; every new consent rotates it. Pending/uncertain commands cannot execute under a reconnected generation, even if the user picked the same account. This deliberately requires manual recovery instead of risking an addition to a different primary calendar. Previously completed history records the connection used at approval; it does not verify current Google presence after manual user edits/deletions.

The Netlify executor uses the owner's existing authenticated Supabase session and encrypted Google connection, with no Supabase service key. It validates the owned-event grant before approving or claiming. A second grant/generation check after refresh prevents a parallel reconnect from substituting another account's token.

Delivery claims use a 60-second lease token and fenced completion. A duplicate request with an active lease waits; a stale process cannot finish a replacement lease. No background retry scheduler exists. An explicit retry keeps the frozen approved payload and original provider ID. Retry-After floors are persisted, bounded to 24 hours.

Google is read first by the persisted event ID. An existing event counts as success only when its command metadata, title, description, location, exact interval and reminder settings match. Otherwise nothing is overwritten. A new insert has that same ID, no attendees/recurrence and default reminders off. A timeout, 409, malformed successful response or uncertain result-storage acknowledgement triggers a bounded reconciliation read and retains an honest uncertain state if unresolved. No blind fresh-ID retry occurs.

Before a new insert the current preview must still match the approved fingerprint and remain eligible. If the source changed, was cancelled or the occurrence started, retry can only reconcile an already existing matching event; it cannot insert one. The UI displays current changes beside the frozen approved facts. Source updates never edit or delete a Google entry. Review Undo also does not delete one.

## Verification and limits

Commands used:

```sh
npm test
npm run test:db
npm run typecheck
npm run build
make check
```

Focused provider tests use synthetic Google HTTP/credentials and test lost responses, malformed HTTP 200, 409 conflicts, cooldowns, destination changes, source changes, exact scopes and no-write guards. The SQL suite executes actual PGlite PostgreSQL with synthetic Auth/Storage compatibility shells. It is distinct from hosted JWT/HTTP evidence.

The hosted rollback script `scripts/hosted-calendar-write-check.sql` passed **32/32** role/access/approval/fingerprint/lease/destination checks on November 1 Eastern (`2026-11-02T02:22:35.560590Z`). It temporarily uses synthetic source facts/commands and a transactional scope metadata fixture, rolls everything back, makes **zero Google calls**, and leaves **zero persistent row changes**. A separate read confirmed zero real commands and the retained read-only connection after the audit. Advisors found no new warnings; existing member-policy, older definer and leaked-password-protection findings remain recorded. The old public connection-put definer is now an invoker.

Live OAuth consent and actual Google insertion require separate observed evidence. No real event/reminder is created merely to test deployment without that specific item's approval. Until the owner grants write access, the feature must report connection-required, not operational success. See the current release report and status for the latest boundary.

Primary references checked November 1, 2026: [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [event IDs and insertion](https://developers.google.com/workspace/calendar/api/guides/create-events), [Supabase database functions](https://supabase.com/docs/guides/database/functions). The changelog Markdown fetch again returned unsupported content type; no successful changelog scan is claimed.


Release checkpoint: runtime commit `e7790d9` is pushed, GitHub verification passed and the new production write endpoints deny anonymous requests with 401. Netlify's Production flag was saved/read back as true, with other contexts empty. After the user unlocked, Netlify verified published deploy `6ae7f4fdd79280473e00a37f` / Production main `e7790d9`, dated November 1 at 9:27 pm Eastern. The authenticated exact single-event preview and empty approval history are verified. After explicit action-time authorization, a waiting expired OAuth request failed safely; a fresh unchanged consent flow connected at `2026-11-02T03:15:32.042388Z`. SQL verifies the exact owned-event scope, valid encrypted envelope and rotated authorization generation. A real authenticated primary read at `03:16:01.498Z` returned 19 events (three all-day), complete=true, for November 2–9 Eastern. Titles/IDs and credentials were not committed. The approval checkbox remains unchecked, its button disabled, and history/SQL have zero commands. The final SQL read has zero commands and the new owned-event scope; actual insertion awaits a separately approved item. Current evidence: [calendar-write-release.json](../reports/calendar-write-release.json). Local final validation is 303 application tests, 155 SQL checks plus six Instagram worker replays, 63 Python tests, 29 focused writer/UI tests, type checking and build. No actual Google insertion is claimed.
