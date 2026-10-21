import Link from "next/link";
import { requireTrackerSession } from "../../lib/auth/session";
import { sourceIsStale } from "../../lib/intake/presentation";
import { MILESTONE_PAGE_SIZE, OFFICIAL_MONITOR_SOURCE_IDS, milestoneFeedLink, milestoneFilters, milestoneFutureFilter, milestoneKinds, type MilestoneRow } from "../../lib/milestones/presentation";
import { AppShell } from "../components/app-shell";
import { MilestoneResults } from "./components";

export const dynamic = "force-dynamic";
type MonitorSource = { id: string; name: string; enabled: boolean; health_status: string; health_message: string | null; last_success_at: string | null; cadence_seconds: number | null };

export default async function Deadlines({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireTrackerSession();
  const filters = milestoneFilters(await searchParams);
  let query = supabase.from("milestone_inbox").select("id,source_id,kind,occurs_at,occurs_on,availability,action_url,uncertainty,revision,title,description,source_url,categories,uncertainties,source_name,health_status,health_message,last_success_at,last_attempt_at,cadence_seconds,coverage_note,changed_at,source_local_text,timezone", { count: "exact" }).in("kind", milestoneKinds(filters.category)).order("sort_date", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
  if (filters.q) query = query.or(`title.ilike.%${filters.q}%,description.ilike.%${filters.q}%`);
  if (filters.window === "upcoming") query = query.or(milestoneFutureFilter());
  const [result, sourceResult] = await Promise.all([
    query.range((filters.page - 1) * MILESTONE_PAGE_SIZE, filters.page * MILESTONE_PAGE_SIZE - 1),
    supabase.from("sources").select("id,name,enabled,health_status,health_message,last_success_at,cadence_seconds").in("id", OFFICIAL_MONITOR_SOURCE_IDS).order("id"),
  ]);
  const rows = (result.data ?? []) as MilestoneRow[], sources = (sourceResult.data ?? []) as MonitorSource[];
  const affected = sources.filter(source => !source.enabled || source.health_status !== "success" || sourceIsStale(source.last_success_at, source.cadence_seconds));
  const missingSourceIds = OFFICIAL_MONITOR_SOURCE_IDS.filter(id => !sources.some(source => source.id === id));
  const attentionCount = affected.length + missingSourceIds.length;
  const count = result.count ?? 0;
  return <AppShell active="deadlines">
    <div className="page-heading"><div><p className="kicker">Catch it before it closes</p><h1>Deadlines & tickets.</h1><p className="subtitle">Research, fellowships, career windows and official ticket notices.</p></div></div>
    <form className="search" role="search" action="/deadlines"><label className="form-field"><span className="sr-only">Search deadlines and tickets</span><input name="q" type="search" defaultValue={filters.q} maxLength={120} placeholder="Fellowship, research, show…" /></label><label className="form-field"><span className="sr-only">Notice category</span><select name="category" defaultValue={filters.category}><option value="all">All notices</option><option value="applications">Applications</option><option value="tickets">Tickets</option></select></label><label className="form-field"><span className="sr-only">Date range</span><select name="window" defaultValue={filters.window}><option value="upcoming">Upcoming & undated</option><option value="all">All history</option></select></label><button className="button-primary">Search</button></form>
    <p className="feed-limits">Observed notices only. A ticket link does not prove available seats. Action reminders require separate approval; this page adds nothing to your calendar or email.</p>
    <div className="inbox-context"><span>{result.error ? "Count unavailable" : `${count} matching notices · Page ${filters.page}`}</span><Link href="/sources" className={sourceResult.error || attentionCount ? "health-warning" : ""}>{sourceResult.error ? "Source status unavailable" : attentionCount ? `${attentionCount} official routes need attention` : "Official source status"} ↗</Link></div>
    {sourceResult.error && <p className="notice" role="alert">Official source health could not be loaded. Current monitoring status is unavailable.</p>}
    {!sourceResult.error && attentionCount > 0 && <details className="notice"><summary>Collection needs attention</summary><ul>{affected.map(source => <li key={source.id}>{source.name}: {!source.enabled ? "disabled" : source.health_status}{sourceIsStale(source.last_success_at, source.cadence_seconds) ? " · stale or never succeeded" : ""}{source.health_message ? ` — ${source.health_message}` : ""}</li>)}{missingSourceIds.map(id => <li key={id}>{id}: unconfigured source row. Automatic collection has not been established.</li>)}</ul><p>Retained notices remain searchable. Failures do not mean there are no new opportunities.</p></details>}
    <section aria-label="Monitored deadlines and ticket notices"><MilestoneResults rows={rows} error={!!result.error} filtered={!!filters.q || filters.category !== "all"} /></section>
    {!result.error && <nav className="pagination" aria-label="Deadline and ticket pages">{filters.page > 1 && <Link href={milestoneFeedLink({ ...filters, page: filters.page - 1 })}>← Previous notices</Link>}{filters.page * MILESTONE_PAGE_SIZE < count && <Link href={milestoneFeedLink({ ...filters, page: filters.page + 1 })}>More notices →</Link>}</nav>}
  </AppShell>;
}
