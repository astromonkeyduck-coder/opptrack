import { existsSync, readFileSync } from "node:fs";
import { getWorkerClient } from "../lib/ingestion";
import { instagramSourceSeeds, sourceSeedUpsertOptions } from './instagram-source-seeds';
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const client = getWorkerClient();
const { data: members, error: memberError } = await client.from("tracker_members").select("user_id").limit(2);
if (memberError || members?.length !== 1) throw new Error("Register exactly one existing Auth user with setup:owner first");
const registry = JSON.parse(readFileSync("config/source-registry.json", "utf8"));
const watchlist = JSON.parse(readFileSync('config/instagram-watchlist.json', 'utf8'));
const officialDeadlines = JSON.parse(readFileSync("config/official-deadline-routes.json","utf8"));
const officialTickets = JSON.parse(readFileSync("config/official-ticket-routes.json","utf8"));
const officialRoutes = [...officialDeadlines.routes.map((r:Record<string,unknown>)=>({...r,adapter:officialDeadlines.adapter})),{source_id:officialTickets.sourceId,name:"Opening Nights ticket notices",url:officialTickets.listingUrl,adapter:officialTickets.adapter,cadence_seconds:officialTickets.cadenceSeconds,coverage_note:officialTickets.coverage}];
const active = new Set(["fsu-calendar-api", "fsu-music-events"]);
const registryRows = registry.sources.map((source: { source_id: string; organizer: string; url: string; status: string; status_reason: string; cadence_minutes: number | null; adapter: { coverage_scope: string } }) => ({
  id: source.source_id, name: source.organizer, owner_id: members[0].user_id, url: source.url,
  adapter: source.source_id === "fsu-calendar-api" ? "localist-v1" : source.source_id === "fsu-music-events" ? "music-v1" : source.source_id === "fsu-hq-public-export" ? "hq-ics-v1" : "unconfigured",
  enabled: active.has(source.source_id), cadence_seconds: source.source_id === "fsu-calendar-api" ? 3600 : ["fsu-music-events", "fsu-hq-public-export"].includes(source.source_id) ? 21600 : null,
  next_due_at: active.has(source.source_id) ? new Date().toISOString() : null,
  health_status: active.has(source.source_id) || source.source_id === "fsu-hq-public-export" ? "setup_needed" : source.status,
  health_message: source.source_id === "fsu-hq-public-export" ? "HQ public export adapter prepared; disabled until the deployed worker is verified and this exact source is activated separately." : active.has(source.source_id) ? "Awaiting first Stage 1 collection" : source.status_reason,
  coverage_note: source.adapter.coverage_scope,
}));
const instagramRows = instagramSourceSeeds(members[0].user_id, watchlist.accounts);
const existingIds = new Set(registryRows.map((row:{id:string})=>row.id));
const officialRows = officialRoutes.filter((route:{source_id:string})=>!existingIds.has(route.source_id)).map((route:{source_id:string,name:string,url:string,adapter:string,cadence_seconds:number,coverage_note:string})=>({id:route.source_id,owner_id:members[0].user_id,name:route.name,url:route.url,adapter:route.adapter,enabled:false,cadence_seconds:route.cadence_seconds,health_status:"setup_needed",health_message:"Official monitor disabled pending verified worker and separate activation",coverage_note:route.coverage_note}));
const rows = [...registryRows, ...instagramRows,...officialRows];
if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Source configuration contains duplicate IDs; nothing was seeded');
// Ignore duplicates so rerunning setup cannot reset cursors, health or decisions.
const { error } = await client.from("sources").upsert(rows, sourceSeedUpsertOptions);
if (error) throw new Error(`Source setup failed (${error.code})`);
console.log(`Source setup complete: ${registryRows.length} registry routes + ${instagramRows.length} selected Instagram accounts = ${rows.length} (including ${officialRows.length} new official route seeds). New Central/Music rows are enabled; new HQ/Instagram/official monitor rows stay disabled pending separate activation. Existing rows unchanged; Stories remain manual-only.`);
