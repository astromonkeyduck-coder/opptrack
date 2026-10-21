# Bounded Instagram Business Discovery preflight

This manual read-only probe checks one handle from `config/instagram-watchlist.json`. It does not enable the Instagram adapters, write application/database facts, create a schedule, download media, extract events, publish, send messages or write calendars. Its tests use explicit synthetic responses. Separately, the fresh live v2 batch in `reports/instagram-cli-access.json` proved bounded samples for 16 accounts; `fsucre` returned an access error. The historical first UI sample is in `reports/instagram-live-access.json`.

Create the ignored credential file only if absent:

```sh
node --import tsx scripts/probe-instagram-business-discovery.ts --initialize-env
```

On first creation, `.env.instagram.probe.local` receives empty `IG_FB_USER_ACCESS_TOKEN` and `IG_CALLER_USER_ID` placeholders, mode 600. Initialization never reads or overwrites existing values. Both approved values are now present privately and the token passed live testing. Enter the authorized Facebook **User** read token and the numeric caller Instagram professional-account ID directly into this file. Never use command arguments or chat for credentials. This separate file is not loaded by the application or scheduler. Existing `.env.local` values remain separate.

The app permissions must support `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`; `pages_show_list` supports discovery of the caller's linked Page/account. A configured capability is not an OAuth grant. Meta conditionally requires an ads permission when the Page role came through Business Manager; the probe does not request permissions or add that access. See the setup and eligibility details in `docs/instagram-monitoring.md` before using it.

Caller-ID discovery is a separate authorized setup check, not an endpoint exposed by this probe. Meta's getting-started guide documents reading `/<Page ID>?fields=instagram_business_account`. When the exact Page ID is already verified in that Page's normal administrator UI, a read-only `GET /v26.0/<verified Page ID>?fields=id,instagram_business_account{id,username}` can confirm the linked account without requesting a Page access token. Never guess or enumerate IDs. Keep the returned caller ID private and compare the returned username with the intended account. An empty `/me/accounts` result does not establish that no linked Page exists; permission scopes and individual Page-asset grants are separate, and the empty-list cause remains unresolved unless actually diagnosed. It is not a source collection result and must not appear as “nothing new.”

After authorization and Page/account linkage are verified, an operator can run one explicitly selected watchlist target:

```sh
node --import tsx scripts/probe-instagram-business-discovery.ts --target=clubdownunderfsu
```

The default is one request, one media page and five items. Optional `--max-pages=2 --max-requests=2 --page-size=5` permits a larger bounded sample. Both caps have a hard maximum of three, page size has a maximum of 25, each response is capped at 256 KiB and the entire probe has a 25-second timeout. It pins `v26.0`, verified against Meta's current Business Discovery examples on October 21, 2026 UTC. It sends only GET requests to `https://graph.facebook.com/v26.0/<numeric caller ID>` with an Authorization Bearer header. It never follows redirects or provider paging URLs. Safe opaque cursor values can rebuild the same node's nested media query; child pagination is reported partial and is not fetched through another endpoint.

Only sample IDs, media/product types, timestamps, canonical permalinks and nested child IDs/types are requested. No captions, media URLs or thumbnail URLs are requested or downloaded. The CLI prints sanitized status/counts/error codes, with no token, caller ID, post IDs, caption, permalink, raw provider message or paging URL. Exceptions are replaced with fixed reason codes.

`private/instagram-preflight/<timestamp-UUID>/` contains `summary.json` and `diagnostic.json`, both mode 600 inside a mode-700 directory. Diagnostics are an allowlisted, **sanitized projection**, not lossless raw HTTP evidence. Provider paging URLs/cursors, error messages, credential data, captions, media URLs and unexpected fields are excluded. A permalink's query and fragment are removed. The stored SHA-256 describes the sanitized diagnostic JSON bytes; it is not a raw-response hash. These ignored files must stay out of commits.

Results distinguish `success_sample`, `partial`, `empty_unverified`, `setup_needed`, `blocked`, `failed` and `rate_limited`. Missing credentials make zero requests. An HTTP-200 Graph error or login wall is a failure/access problem. A valid empty media list does not establish that there is nothing new. Missing fields, repeated IDs/cursors, unconsumed carousel pages and reached request/page caps remain partial. Probe v2 compares the reported media count with returned unique rows: absent continuation alone never establishes completeness. A validated sample can succeed with paginationComplete=false. The historical v1 completeness flag was overstated and is superseded by v2 evidence. `success_sample` proves only the returned bounded sample; it is not full-account history, all-slide media capture or arbitrary-account Story coverage. A target returning no Business Discovery data remains unavailable/ineligible **unverified**, without guessing whether it is personal, private, age-gated or permission-blocked.

Exit 0 means a validated sample, 2 means setup needed, 3 means partial/blocked/rate-limited/unverified empty and 1 means a local or collection failure. There is no automatic retry and no paid connector. Read source-health status before deciding whether a later authorized rerun is appropriate.

Primary references: [Business Discovery guide and v26.0 examples](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery.md), [exact endpoint/read permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery.md), and [Meta Facebook Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md). The guide also warns that discovering another account's media does not grant permission for direct requests to those media IDs. Documentation is capability evidence; the configured app/target must still pass a live probe.
