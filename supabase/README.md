# Stage 1 database

Apply the SQL files in `migrations/` in filename order to the user's existing private Supabase project through the SQL editor (or a configured Supabase migration workflow). The migration assumes Supabase's existing `auth` and `storage` schemas/roles. It creates no Auth user and purchases/provisions no service. With no configured owner, authenticated requests cannot read the tracker or claim ownership.

Create the intended account in Supabase Auth, disable public signup, and configure the application's sign-in redirect URLs. Enter the existing Auth user's UUID with:

```sh
npm run setup:owner -- <existing-auth-user-uuid>
npm run setup:sources
```

The setup script reads `.env.local` without printing any value. It requires the Supabase URL and server secret and invokes a service-only RPC. Repeating the same owner succeeds; replacing the owner fails. The initial seed activates only central Localist and Music. Runtime health is separate from the repository registry's source-access evidence. Other registry routes remain disabled.

`captures` Storage is private. Web uploads use the authenticated owner's UUID prefix, validated image/PDF input and size limits; worker captures use content-addressed private object names. Raw public captures expire 30 days after the latest fresh observation; a genuine re-upload of previously purged content restores its path/retention without duplicating facts or versions; manual media after 7. The service-only `purge_candidates` RPC plans bounded cleanup, excluding any live capture/manual reference and requiring old orphan objects to age 30 days under `sources/` or 7 days elsewhere. Production maintenance is plan-only: no hosted object deletion or automatic expiry is enabled until refresh/deletion races and Storage restore are verified. Future deletion must remove the actual object and mark its capture/intake purged. Normalized facts, hashes, claims and decisions survive raw-object deletion. SQL metadata commit/cursor advancement is atomic; uploading a Storage object is a separate external transaction, so failed metadata commits can leave an orphan for explicit review/cleanup. Never delete all objects just because a metadata query failed.

Run the local database checks without credentials:

```sh
npm run test:db
node --import tsx scripts/prove-live-database.mjs
```

The second command requires successful fresh collector batches under ignored `private/stage-1-live/`. It executes the real migration and ingestion functions on PGlite (PostgreSQL compiled to WASM), reads real events through the authenticated SQL role and RLS, replays the central batch, dumps/restores the database and tests local raw-object deletion. The local compatibility shell supplies Auth users/`auth.uid()` and Storage metadata tables. It does **not** verify hosted Auth HTTP/JWT, the Supabase Storage HTTP service, Trigger.dev Cloud, hosted backups or distributed concurrency. Reports name those untested boundaries explicitly. Private database dumps, live raw bodies and exported inbox rows stay under ignored `private/`.

Database roles are intentionally narrow: authenticated users can read their own facts, save/reject an individual occurrence through a revision-checked RPC, and submit pending private intake. They cannot forge source health, normalized facts, membership or decisions directly. Calendar approval, calendar writes and delivery execution are absent in Stage 1.


The incremental `202610200002_hourly_cadence.sql` migration keeps the historical ingestion migration unchanged. Central polling uses UTC hour slots; Music uses UTC 00:00/06:00/12:00/18:00 slots. `next_poll_at` is independent of `retry_not_before`; `next_due_at` is their effective maximum. A leased source records `leased_poll_at` from the latest elapsed slot when acquired. Completing a 12:00-slot collection at 13:01 leaves 13:00 due, rather than drifting to 14:01. Delayed dispatch coalesces missed source slots once, preventing a burst of old polling windows. Existing leases, cursors and decisions survive migration, and outstanding failure retry floors remain intact.

Source runs also retain optional Trigger run/schedule IDs, the dispatcher's nominal timestamp, the actual acquired source slot, and an invocation kind. These fields alone do not prove Cloud execution; a real Trigger run must be verified through Trigger's API. The scheduling regression report uses explicitly synthetic IDs and timestamps.

```sh
node scripts/test-hourly-database.mjs
```
