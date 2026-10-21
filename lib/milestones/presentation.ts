import { cleanSearch, pageNumber, sourceIsStale } from "../intake/presentation";

export const MILESTONE_PAGE_SIZE = 30;
export const OFFICIAL_MONITOR_SOURCE_IDS = ["fsu-onf-dates", "fsu-cre-applications", "fsu-career-deadlines", "fsu-opening-nights"];
export type MilestoneRow = {
  id: string; source_id: string; kind: string; occurs_at: string | null; occurs_on: string | null;
  availability: string | null; action_url: string | null; uncertainty: string | null; revision: number;
  title: string; description: string | null; source_url: string | null; categories: string[] | null;
  uncertainties: string[] | null; source_name: string; health_status: string; health_message: string | null;
  last_success_at: string | null; last_attempt_at: string | null; cadence_seconds: number | null;
  coverage_note: string | null; changed_at: string | null; source_local_text: string | null; timezone: string | null;
};
export type MilestoneFilters = { q: string; category: "all" | "applications" | "tickets"; window: "upcoming" | "all"; page: number };
export function milestoneFilters(params: Record<string, string | string[] | undefined>): MilestoneFilters {
  return { q: cleanSearch(typeof params.q === "string" ? params.q : ""), category: params.category === "applications" || params.category === "tickets" ? params.category : "all", window: params.window === "all" ? "all" : "upcoming", page: pageNumber(typeof params.page === "string" ? params.page : undefined) };
}
export function milestoneFeedLink(filters: MilestoneFilters): string {
  return `/deadlines?${new URLSearchParams({ q: filters.q, category: filters.category, window: filters.window, page: String(filters.page) })}`;
}
export function milestoneKinds(category: MilestoneFilters["category"]): string[] {
  return category === "applications" ? ["application_open", "application_deadline"] : category === "tickets" ? ["ticket_link", "ticket_release"] : ["application_open", "application_deadline", "ticket_link", "ticket_release"];
}
/** Unknown exact instants stay visible; date-only records remain through the Eastern local day. */
export function milestoneFutureFilter(now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `occurs_at.gte.${now.toISOString()},and(occurs_at.is.null,occurs_on.gte.${today}),and(occurs_at.is.null,occurs_on.is.null)`;
}
export function milestoneKindLabel(kind: string): string {
  return ({ application_open: "Applications open", application_deadline: "Application deadline", ticket_release: "Ticket release", ticket_link: "Ticket notice" } as Record<string, string>)[kind] ?? "Action notice";
}
function exactInstant(value: string | null): boolean { return !!value && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
export function milestoneTimestamp(value: string | null): string {
  return exactInstant(value) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value!)) : "Not recorded";
}
export function milestoneTiming(row: Pick<MilestoneRow, "occurs_at" | "occurs_on" | "timezone">): { label: string; precision: string } {
  if (exactInstant(row.occurs_at)) return { label: milestoneTimestamp(row.occurs_at), precision: "Verified source instant · shown in Eastern" };
  if (row.occurs_on && /^\d{4}-\d{2}-\d{2}$/.test(row.occurs_on)) {
    const date = new Date(`${row.occurs_on}T12:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === row.occurs_on) return { label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", year: "numeric", month: "short", day: "numeric" }).format(date), precision: `Source date · exact instant unverified${row.timezone ? "" : " · timezone unconfirmed"}` };
  }
  return { label: "Date unconfirmed", precision: "No date or reminder time assumed" };
}
export function milestoneAvailability(value: string | null): string | null {
  return ({ link_observed: "Ticket link observed · inventory unverified", announced_release: "Organizer release announcement", unknown: "Ticket status unknown", closed_by_published_window: "Past published application window", not_yet_open_by_published_window: "Before published application window", within_published_window: "Within published window · acceptance unverified", closing_date_not_published: "Closing date not published" } as Record<string, string>)[value ?? ""] ?? null;
}
export function milestoneHealth(row: Pick<MilestoneRow, "health_status" | "last_success_at" | "cadence_seconds">, now = Date.now()): string {
  const stale = sourceIsStale(row.last_success_at, row.cadence_seconds, now);
  return `${row.health_status === "success" ? "Latest collection succeeded" : `Collection ${row.health_status || "unknown"}`}${stale ? " · stale or never succeeded" : ""}`;
}
