# Instagram automatic monitoring

The user explicitly authorized automatic monitoring for the **16 accounts with proven access**, using the existing hourly Trigger dispatcher and no paid upgrade. `fsucre` remains disabled after HTTP 400 / Graph 110 / subcode 2207013, cause unresolved. Calendar writes remain disabled.

## Implemented path and activation boundary

`lib/instagram/collector.ts` makes one fixed-host Bearer-authenticated Graph v26.0 GET per due account. Each hourly overlap snapshot requests at most 25 parent posts, captions, canonical permalinks, publication timestamps and 20 ordered child IDs/types per carousel. No media URLs, images, videos, Stories, OCR or event dates are collected. Returned timestamps are publication facts.

The existing single Trigger schedule remains `0 * * * *` UTC with Free-compatible 60-minute window and concurrency one. Central/Music retain their own priority lease group; Instagram has a separate 16-source budget and two requests in flight. Requests time out after 10 seconds and the social loop stops starting work after 90 seconds. Source-specific failures persist their own health/retry floor; persistence failures leave leases for recovery. This is not minute-level or full-history coverage.

Migration 003 adds owner-protected `instagram_updates`, append-only `instagram_update_versions`, a security-invoker current view, explicit sanitized-capture kinds, and a service-only atomic completion RPC. An unchanged native ID/content hash reuses its row/version; caption edits add a version. Captures are private sanitized API projections, not raw HTTP bodies. Their hashes describe retained projection bytes. Upload-before-transaction can leave an orphan after a failed commit; deletion remains disabled.

The authenticated `/instagram` page searches captions, filters accounts and pages stable results. Captions are escaped plaintext. Source enablement, actual attempts/successes, staleness and failures come from Supabase; enablement alone is not a run proof. Posts stay separate from verified opportunity occurrences.

**Activation status:** migration 003 is applied as hosted 20261021012900. Worker commit 5e1a57d is deployed as Trigger 4qe6zd7w / version 20261021.3 and Netlify 6ad815cc31d991b1f07a39bd. The 16 exact approved sources are enabled hourly; Production social=true, calendar/email=false. A real manual cloud run at 9:47 pm Eastern succeeded for all 16, storing 400 private post updates and 16 sanitized captures. Thirty-three populated hosted SQL policy checks pass, and the owner browser shows 400 real posts, page 2 and a 25-match caption search. This is not yet genuine scheduled Instagram proof; the next nominal hourly tick is 10 pm Eastern with jitter. See reports/instagram-production-monitoring.json.

## Credentials and limits

Only Trigger Production receives `IG_FB_USER_ACCESS_TOKEN` and `IG_CALLER_USER_ID`, in addition to the existing worker settings. Netlify receives no Instagram secret. `SOCIAL_COLLECTION_ENABLED=true` enables worker dispatch only after the 16 proven source rows are activated. `IG_TOKEN_EXPIRES_AT` is optional and must only contain an actually verified expiry; currently it is unset. Meta token expiry/renewal is unverified. The collector marks rejected/expired credentials as an access failure, retains prior posts and never reports an empty success. Automatic token renewal has not been established.

No paid connector or upgrade is enabled. Meta App remains Unpublished, and continued access depends on its actual grants and token validity. Full account history, more than 25 posts between checks, old caption edits/deletions and arbitrary-target Stories can be missed. Images/video contents remain unread; private manual intake remains available for permitted links and every supplied flyer slide.

## Evidence and validation

Historical initial access: reports/instagram-live-access.json (first UI sample), reports/instagram-cli-access.json (16 samples plus one blocked target). Fresh production-collector shape validation: reports/instagram-collector-live-validation.json, HTTP 200, 25 posts / 25 captions / 35 children, no database writes. Synthetic tests are separate from live evidence: 98 application tests; 29 base + 12 hourly + 19 Instagram PostgreSQL checks; 60 Python checks; typecheck/build pass. The current status/runbook must record actual deployed commit, run IDs, source-run UUIDs and database updates before calling monitoring operational.

Primary references: [Meta Business Discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery.md), [Meta Facebook Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md), [Trigger scheduled tasks](https://trigger.dev/docs/tasks/scheduled), [Trigger pricing](https://trigger.dev/pricing), and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Provider capabilities are separate from this project's live evidence.
