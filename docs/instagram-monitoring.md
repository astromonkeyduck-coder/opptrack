# Selected Instagram opportunity accounts

The user explicitly selected 17 handles for opportunity monitoring on October 20, 2026. `config/instagram-watchlist.json` is separate from the preserved 59-source registry. Source IDs are `instagram-<handle>`, with canonical profile URLs. Selection alone does not verify identity, eligibility or access. Fresh bounded live Business Discovery samples are now proven for **16 of 17 accounts**. **fsucre** returned HTTP 400 / Graph 110 / subcode 2207013; its cause is unresolved. This is access evidence, not operational monitoring.

The authenticated `/instagram` page reads owner-protected source health and displays the separately recorded sample evidence. **Last collector attempt/success** remain collector timestamps; the manual Graph Explorer probe does not manufacture a SourceRun or advance those fields. Missing rows are setup-needed; health query failures are unavailable, never “nothing new.” The page has no inferred event dates or mock event facts.

Normal `npm run setup:sources` now combines the preserved 59 registry routes and these 17 selected accounts: **76 source identities**. It uses conflict-ignore inserts, so rerunning setup cannot reset existing health, cursors, leases or decisions. The selected rows remain disabled/unconfigured with null cadence. The hosted seed is recorded separately; this documentation does not claim the local setup command was executed against production.

## Current capability

- **Selected/configured:** concerts, comedy, speakers, clubs, films, campus announcements, Homecoming/ticket information, leadership, outdoors, Honors, recruiting, study abroad, culture, service, sustainability, research and public-policy accounts.
- **Live access samples:** 16 targets returned five parent posts each via authorized CLI GETs: 80 parent posts and 181 child IDs in total. The exact target username and professional eligibility are verified only for each returned Business Discovery sample; this is not an institutional affiliation audit or continuing-access guarantee.
- **Not operational:** scheduled Instagram collection. All 17 sources remain adapter `unconfigured`, enabled=false, null cadence and setup-needed until durable collection/media/pagination gates pass. No automated source ingestion, media download or event extraction is claimed.
- **Stories:** manual-only. An arbitrary target's Stories route has not been established. Do not infer it from Business Discovery or own-account Story support.
- **Available now:** authenticated private manual link/flyer intake. Supply only material you may retain and include every supplied slide. Links are retained without server fetching; media/facts stay pending verification.

The user-selected handles are clubdownunderfsu, fsustudentengagement, fsustudentaffairs, fsustudentunion, aslc_fsu, fsuhomecoming, fsusga, fsucampusrec, fsuhonors, fsucareercenter, fsuip, fsucge, thecenterfsu, fsusustainable, fsucre, fsucosspp and fsucossppslc. Focus labels reflect the user's intended discovery scope; they are not claims about current account content.

## Meta setup and minimum read permissions

Current primary Meta Markdown guides were retrieved with HTTP 200 on October 20, 2026, despite earlier ordinary guide URLs returning 429. Those documentation reads alone proved no access. The later authorized setup and live sample below establish the first bounded target read through **Instagram API with Facebook Login / Business Discovery**. The caller must be a Business/Creator Instagram account linked to a managed Facebook Page; target eligibility is checked independently. Consumer/age-gated targets remain excluded. One selected account remains blocked with an unresolved provider error. [Business Discovery reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery.md).

| Purpose | Permission | Boundary |
| --- | --- | --- |
| Business Discovery reads | `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement` | The documented Facebook **User** access-token requirements for this endpoint; no publishing/messaging grant is requested. |
| Discover the caller's managed Page and linked IG ID | `pages_show_list` | Separate setup permission for `/me/accounts`; it is not an additional target-collection capability. |
| Page role received through Business Manager | `ads_read` **or** `ads_management` | Conditional provider requirement only in that specific role path. Do not add either proactively; inspect the actual role/access error first and prefer the narrower applicable read grant. |

These Facebook Login permissions are distinct from the `instagram_business_*` permissions used by Instagram Login. Do not substitute another login route's scope names. Business Discovery documentation requires `instagram_manage_insights` for this read route; that does not authorize this project to start unrelated insights collection. [Current Business Discovery permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery.md).

1. Use your own authorized Business/Creator IG account linked to a Facebook Page you manage; confirm the appropriate Page tasks and developer/app role. Do not enter your Facebook/Instagram password in this tracker or share session cookies.
2. In Meta for Developers, follow the current Instagram app flow. The use-case label is **Manage messaging and content on Instagram**; the documented Business-app path is **Other → Business**. Add Instagram, choose **API setup with Facebook Login**, and configure Facebook Login for Business. An app supports only one Instagram login setup. The broad use-case label is not a reason to accept its default messaging/publishing permission bundles. [Create an Instagram app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app.md), [Instagram use-case setup](https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case.md).
3. Request only the three Business Discovery read permissions above, plus `pages_show_list` when discovering the Page. Authorize through Meta's normal flow as the legitimate app-role/Page user. Confirm actually granted scopes and token expiry; keep the Facebook **User token** private. No publish, comment-management or messaging permission is needed for this proposed collector.
4. Use the documented `/me/accounts` → Page `instagram_business_account` → caller IG ID flow. Request only required identification/task fields and avoid returning/logging a Page access token. Do not save a full setup response that might contain tokens. The current get-started guide uses **v26.0 examples**; verify the version supported by the actual app rather than guessing a default. [Facebook Login get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md).
5. Enter credentials directly into the approved server secret destination when a probe is ready. Never paste tokens into chat, URLs, screenshots, this watchlist, browser code, Git or public logs. Current collection remains disabled; do not add new production scopes or schedule changes solely because setup fields exist.

Standard Access is limited to app-role/development use. Advanced Access for non-role users requires the applicable App Review and Business Verification. Meta also documents review requirements around third-party content, so a sole-admin Standard Access test must prove the actual intended target route before claiming review is unnecessary or that all 17 accounts work. [Access levels](https://developers.facebook.com/documentation/development/graph-api/overview/access-levels.md), [Instagram platform overview](https://developers.facebook.com/documentation/instagram-platform/overview).

## Probe and activation gates

The bounded v2 probe passed for 16 selected accounts. Preserve the per-account outcomes in `reports/instagram-cli-access.json`; `fsucre` remains blocked/setup-needed after its provider error. Do not infer that it has no posts or substitute another handle without verification. Record caller/target identity, actual grants, API version, outcome/error, request count and timestamps without keys or signed media URLs. Permission/token/rate-limit/parser failure is never “no new posts.”

Business Discovery returns target media through nested field expansion; it does **not** grant direct GET access to the target media IDs. Validate nested media/children fields and every pagination page before claiming all-slide capture. Some licensed/copyright audio and other-account Reels with downloading disabled may omit `media_url` while returning other fields. Treat missing content as an explicit media gap, not a complete extraction. [Business Discovery field limitations](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery.md).

Only promote a source after proving permitted live access, stable native identities/hashes, evidence timestamps, pagination/media completeness, visible uncertainty, retries/rate limits and measured bounded usage. Preserve user decisions and duplicate prevention when connecting any resulting opportunities to the review inbox. No enabled flag or cadence changes until that evidence exists.

Stories remain a separate manual-only gap. Meta's authorized-account Stories reference documents 24-hour availability and exclusions such as Live stories and reshares; it does not establish access to these 17 other accounts' Stories. Own-account Story support must not be relabeled as arbitrary-target Story monitoring. [Stories reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/stories.md).

No paid connector, automatic email, follow action, calendar scope or calendar write is enabled. Selection does not promise complete Instagram coverage or automatic monitoring. Earlier source feasibility evidence remains in `docs/access-feasibility.md`.

Validation: `node --import tsx --test tests/instagram-watchlist.test.ts`, `npm run typecheck`, and `npm run build`. Tests validate scope, canonical links, disabled seeds, conflict-ignore behavior and 59+17 identities, and reconcile positive sample counts to the saved live report. They do not perform live Instagram requests or promote a source.

## Setup actually observed

The user completed developer registration and app creation. App `4387142291430378` remains **Unpublished**. With explicit approval, a public Page was created and linked to the existing professional IG account; saved inbox/message access is **Disabled**. The earlier Ready-for-testing capabilities were configuration only. A subsequent live `/me/permissions` response now confirms the four requested read grants—`instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`—plus standard `public_profile`. No publishing, messaging, ads or business-management capability bundle was added. No personal-account conversion occurred.

`/me/accounts` returned a successful `data:[]`; its cause is unresolved and was not interpreted as no posts. A read of the exact Page asset ID from the legitimate admin UI returned the expected professional username and caller IG ID without requesting a Page access-token field. The approved User token is now stored only in ignored `.env.instagram.probe.local`, mode 600, and passed fresh CLI reads. No production worker token is configured. Token expiry and renewal are unmeasured; a working local sample is not proof of durable monitoring. Never print or commit it. Earlier setup evidence remains in `reports/instagram-setup.json`.

## First live target sample

[`reports/instagram-live-access.json`](../reports/instagram-live-access.json), recorded **2026-10-21 00:52:27 UTC**, preserves the sanitized evidence for one fresh Graph API Explorer GET using **v26.0** and target **clubdownunderfsu**. It returned **5 parent posts: 2 standalone images, 1 Reel and 2 carousels, with 12 child IDs**. UI latency was 510 ms; an independent HTTP status was not separately captured. The provider's media count is not a full-history capture claim.

This is a live API response, not a replay or mock. It proves neither complete pagination nor downloaded carousel images: **media files downloaded 0, Stories retrieved 0, scheduled Instagram runs 0, event extraction 0**. Publication timestamps are publication facts, not inferred event or ticket-sale times. The private screenshot remains excluded from Git. None of these facts enables a source or advances a collector's last-success timestamp.

## Live CLI watchlist access investigation

`reports/instagram-cli-access.json` records **17 fresh GETs from 2026-10-21 01:08:54 to 01:09:02 UTC**, using the saved local token with Bearer authorization headers. Sixteen targets returned HTTP 200 with five parent posts each. `fsucre` returned HTTP 400, Graph code 110 / subcode 2207013. The underlying cause is unresolved; no raw error text or credential was saved publicly. This batch read 28,794 bytes, 80 valid parent posts and 181 child IDs. It downloaded no media and requested no captions.

All 16 samples report incomplete history: the provider media count exceeds the five-post sample and returned no continuation. Probe v2 preserves access success while keeping `paginationComplete=false`; it never treats a missing next link as full history. One earlier v1 CLI read of Club Downunder returned five posts but overstated its completeness flag; the v2 result supersedes that flag.

All 17 source adapters remain disabled/unconfigured with null cadence. No SourceRuns, opportunity rows, collector timestamps, production environment values or schedules were created by these access probes. The Stage 0 source registry remains unchanged. No broader extraction stage started.
