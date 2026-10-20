import { existsSync, readFileSync } from "node:fs";
import { getWorkerClient } from "../lib/ingestion";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const client = getWorkerClient();
const { data: members, error: memberError } = await client.from("tracker_members").select("user_id").limit(2);
if (memberError || members?.length !== 1) throw new Error("Register exactly one existing Auth user with setup:owner first");
const registry = JSON.parse(readFileSync("config/source-registry.json", "utf8"));
const active = new Set(["fsu-calendar-api", "fsu-music-events"]);
const rows = registry.sources.map((source: { source_id: string; organizer: string; url: string; status: string; status_reason: string; cadence_minutes: number | null; adapter: { coverage_scope: string } }) => ({
  id: source.source_id, name: source.organizer, owner_id: members[0].user_id, url: source.url,
  adapter: source.source_id === "fsu-calendar-api" ? "localist-v1" : source.source_id === "fsu-music-events" ? "music-v1" : "unconfigured",
  enabled: active.has(source.source_id), cadence_seconds: source.source_id === "fsu-calendar-api" ? 3600 : source.source_id === "fsu-music-events" ? 21600 : null,
  next_due_at: active.has(source.source_id) ? new Date().toISOString() : null,
  health_status: active.has(source.source_id) ? "setup_needed" : source.status,
  health_message: active.has(source.source_id) ? "Awaiting first Stage 1 collection" : source.status_reason,
  coverage_note: source.adapter.coverage_scope,
}));
// Ignore duplicates so rerunning setup cannot reset cursors, health or decisions.
const { error } = await client.from("sources").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
if (error) throw new Error(`Source setup failed (${error.code})`);
console.log(`Registry setup complete: ${rows.length} routes; only central calendar and Music enabled. Existing rows unchanged.`);
