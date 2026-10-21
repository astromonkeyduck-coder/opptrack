# Optional Google Calendar reads

The owner explicitly authorized a read-only Google Calendar connection for the calendar panel. This is a separate permission from event collection and saving tracker items. Calendar writes, RSVP, email and reminder delivery remain disabled. No calendar write scope, event-write endpoint, outbox or background calendar job exists.

The user-selected primary Google Calendar is connected read-only. Hosted OAuth and a real complete seven-day read were verified October 21 at 17:19–17:21 UTC. Access-token refresh has unit/replay coverage but has not yet been observed live; durable unattended access is not claimed. Test-mode grants require reconnection after seven days.

## Production setup

Use a dedicated Google Cloud project for this tracker. Enable the Google Calendar API without enabling a paid service or upgrading a plan. Configure the OAuth consent screen for the owner; if the app remains in Testing, add the owner's Google account as a test user. Google documents a seven-day refresh-token lifetime for External apps in Testing with Calendar scopes. Reconnect after that period. Publishing or extending authorization is a separate future change; it was not performed. [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), checked October 21, 2026.

Create a **Web application** OAuth client. Register the exact production redirect URI:

`https://luxury-longma-01d2fa.netlify.app/api/calendar/callback`

For local development, register `http://localhost:3000/api/calendar/callback` separately. The application never accepts a redirect URI from a browser query parameter.

Add these values to **Netlify Production server functions only**, following `.env.netlify.production.example`:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | This tracker's Web application OAuth client |
| `GOOGLE_CLIENT_SECRET` | Server-side client secret |
| `CALENDAR_TOKEN_ENCRYPTION_KEY` | Exactly 32 cryptographically random bytes encoded as canonical base64 |
| `APP_URL` | `https://luxury-longma-01d2fa.netlify.app` |
| `CALENDAR_WRITES_ENABLED` | `false` |

Do not prefix any credential with `NEXT_PUBLIC_`, print it, commit it, send it in chat, or copy it to Trigger. Generate and enter the encryption key privately. Keep it stable: losing or rotating it makes existing encrypted connections unreadable and requires reconnection. A Free plan that exposes only an all-scopes environment setting does not make a value public by itself, but server credentials must never enter browser code or build logs; do not authorize a paid upgrade to change scopes. No Supabase server key is needed in Netlify.

Apply `supabase/migrations/202610200006_google_calendar_readonly.sql` after the existing migrations. It adds a private encrypted-token table and three owner-checked RPCs. It enables no connection by itself and does not alter source scheduling, event facts or decisions.

The owner then chooses **Connect Google Calendar** in the authenticated tracker and completes Google consent directly. The only requested scope is:

`https://www.googleapis.com/auth/calendar.events.readonly`

The provider scope can permit event reads on accessible calendars, while this implementation calls only the fixed `primary` calendar endpoint. It does not enumerate or read shared/secondary calendars. If Google offers broader scopes, do not approve them; token responses with extra scopes are rejected. No account email, attendees, descriptions or locations are returned by this calendar panel.

## Request and storage boundaries

`POST /api/calendar/connect` requires an authenticated owner and same-origin browser submission. It creates a 256-bit state value and PKCE challenge. State, verifier, owner ID and a ten-minute expiry are AES-256-GCM encrypted into an HttpOnly, SameSite=Lax cookie. Production uses Secure and the `__Host-` cookie prefix.

`GET /api/calendar/callback` validates the state in constant time, checks its expiry and the same authenticated owner, and clears the cookie on completion. Authorization codes are exchanged in a POST body with Google's fixed HTTPS token endpoint; secrets never enter API URLs or application logs. The callback immediately redirects to the fixed `/inbox?calendar=…` destination with no-store and no-referrer headers.

Access and refresh tokens are encrypted with AES-256-GCM using a random nonce and owner-bound authenticated data. Only ciphertext, revision and timestamps are stored in `tracker_private.google_calendar_connections`. The private table has RLS and no direct client grants. Owner-authenticated get/put/delete RPCs return or mutate encrypted data only. Other authenticated users, anonymous users and the worker role cannot invoke these RPCs. Netlify uses the existing owner's Supabase session; it never receives a Supabase service key.

Refresh happens only while loading the owner's calendar panel. It POSTs to the fixed Google token endpoint and preserves the existing refresh token when Google omits a replacement. A UUID revision guard prevents an older refresh from overwriting a newer connection or refresh. Errors and revoked grants remain visible; they never become a successful empty calendar.

`POST /api/calendar/disconnect` removes the owner's stored encrypted connection, then attempts a fixed-body Google token revocation. Revocation failure is reported honestly. **Google revocation can invalidate every client and scope under the same Google Cloud project**, which is why this integration requires a dedicated tracker project. Do not reuse a project that serves unrelated applications. If revocation is unconfirmed, the owner can review [Google Account permissions](https://myaccount.google.com/permissions) directly.

## Events API contract

`GET /api/calendar/events?from=YYYY-MM-DD` is authenticated and read-only. The date begins a seven-day Eastern calendar window; spring/fall DST weeks use 167/169 hours correctly. The default is today's date in America/New_York.

Successful responses contain:

```json
{
  "state": "connected",
  "connected": true,
  "readOnly": true,
  "calendar": "primary",
  "events": [{ "id": "provider-id", "title": "Plan", "start": "2026-10-21T15:00:00-04:00", "end": "2026-10-21T16:00:00-04:00", "allDay": false }],
  "complete": true,
  "window": { "from": "2026-10-21", "to": "2026-10-28", "timeMin": "2026-10-21T04:00:00.000Z", "timeMax": "2026-10-28T04:00:00.000Z", "timeZone": "America/New_York" },
  "updatedAt": "2026-10-21T14:00:00.000Z"
}
```

All-day events retain `YYYY-MM-DD` values; `end` is exclusive, as in Google Calendar. Missing/hidden titles display as `Busy`. Titles are untrusted text and must be rendered as text, never HTML. Calendar event data is returned only to the authenticated owner with `Cache-Control: private, no-store`; it is not retained in tracker event tables or source captures.

At most four pages of 50 events are read, with ten-second request timeouts and 256 KiB response limits. Requests always use `GET` on the fixed `primary/events` path with `singleEvents=true`, `orderBy=startTime`, explicit bounds and a minimal field projection. No provider-supplied next URL is followed. Repeated pages/IDs, malformed times, HTML and revoked access are errors. A later transport failure can retain already validated events with `state: partial`, `complete: false` and a visible notice. Hitting 200 events also returns `truncated: true`; it never claims complete coverage. A validated explicit empty `items` array is the only successful empty result.

Other states are `unconfigured`, `disconnected`, `reconnect_required`, `unavailable`, `unauthenticated` or `invalid_request`; all have `complete: false` and a notice. The UI must display the notice, including partial results. Calendar writes stay disabled for every state.

## Verification and costs

`node --import tsx --test tests/calendar.test.ts` passes **20 tests**, including five real PostgreSQL policy/revision subchecks. These cover OAuth state/owner/expiry, PKCE, encryption/tamper protection, exact read-only scopes, body-only token exchange, refresh races, DST, minimal event fields, GET-only event reads, pagination/truncation/failure handling and owner/other-user/anonymous/database-role access. Provider calls and credentials in these tests are synthetic; they do not prove live Google access.

No paid service is enabled by this implementation. Each panel load uses up to four Calendar list requests; an expired access token adds one token refresh. OAuth connect/disconnect add the corresponding token requests. Actual production requests and provider quota/cost status must be recorded after a real connection; no zero-cost or unlimited-quota promise is implied.

Primary references checked October 21, 2026: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Google OAuth security best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Supabase database functions](https://supabase.com/docs/guides/database/functions). The Supabase Markdown changelog fetch returned unsupported content type; no changelog review is claimed from that failed fetch.

## Netlify Free scope limitation

The three variables were configured in the Production context only on October 21. Contains secret values is enabled for the client secret and encryption key. The Free plan disables per-scope editing and automatically assigns protected secrets to Builds, Functions and Runtime, excluding post processing. No upgrade was made. Application code consumes them in server Functions only; they have no NEXT_PUBLIC name, no client import and no Trigger copy. Desired functions-only scope in the template is documented intent, not a claim that the Free dashboard enforced it. Google API activation and real owner consent/read are verified; live refresh, revocation and seven-day reconnection remain untested.

## Actual hosted verification

Migrations 005/006 applied as 20261021151303/20261021152408. Hosted rollback policy audit:32/32 passed. The chosen account connected at2026-10-21T17:19:46.321154Z; SQL confirmed one ciphertext envelope with exact read-only scope without exposing it. At17:21:17.965Z the authenticated endpoint returned71 events, five all-day, complete=true, for October19–26 Eastern. No event titles or tokens are retained in committed reports. Anonymous events/image endpoints returned401. No live refresh/disconnect was forced, so the working owner connection remains intact. Screenshots and local setup credential backup remain ignored.
