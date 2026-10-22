import { safeExternalUrl } from "../../lib/intake/presentation";
import { milestoneAvailability, milestoneHealth, milestoneKindLabel, milestoneTimestamp, milestoneTiming, type MilestoneRow } from "../../lib/milestones/presentation";

export function MilestoneCard({ row }: { row: MilestoneRow }) {
  const timing = milestoneTiming(row), source = safeExternalUrl(row.source_url), action = safeExternalUrl(row.action_url);
  const availability = milestoneAvailability(row.availability);
  const uncertainty = [...new Set([row.uncertainty, ...(row.uncertainties ?? [])].filter((value): value is string => !!value))];
  const caution = row.kind === "ticket_release" ? "Release time is local; timezone and seat availability are unconfirmed."
    : row.kind === "ticket_link" ? "A ticket link does not confirm available seats or eligibility."
    : !row.occurs_at && !row.occurs_on ? "An exact date or year is missing. Check the official notice before planning."
    : row.occurs_at ? "Check eligibility and current application acceptance with the source."
    : "Closing time and timezone are unconfirmed.";
  return <article className="milestone-card">
    <div className="milestone-date"><span>{milestoneKindLabel(row.kind)}</span><strong>{timing.label}</strong><small>{timing.precision}</small></div>
    <div className="milestone-content"><div className="tags"><span>{row.source_name}</span>{row.revision > 1 && <span className="decision">Revised {row.revision}</span>}</div><h2>{row.title}</h2>
      {availability && <p className="milestone-status">{availability}</p>}
      {row.source_local_text && <p className="milestone-source-text">{row.source_local_text}</p>}
      {row.description && <details className="post-details"><summary>About this opportunity</summary><p>{row.description}</p></details>}
      <p className="uncertainty">{caution}</p>
      <p className="small">{row.revision > 1 ? "Current facts first observed" : "First recorded"}: {milestoneTimestamp(row.changed_at)} · {milestoneHealth(row)}</p>
      {row.health_status !== "success" && row.health_message && <p className="health-warning">{row.health_message}</p>}
      <div className="card-actions">{action && <a href={action} target="_blank" rel="noopener noreferrer">{row.kind.startsWith("ticket_") ? "Official ticket page" : "Official application information"} ↗</a>}{source && source !== action && <a href={source} target="_blank" rel="noopener noreferrer">Source notice ↗</a>}</div>
      <details className="post-details"><summary>Source details</summary><p className="small">Last successful read: {milestoneTimestamp(row.last_success_at)}<br />Last attempt: {milestoneTimestamp(row.last_attempt_at)}<br />Original source timezone: {row.timezone || "Unconfirmed"}</p>{uncertainty.length > 0 && <p className="small">{uncertainty.join(" · ")}</p>}{row.coverage_note && <p className="small">{row.coverage_note}</p>}<p className="small">Recorded changes show what a poll observed. They do not establish the first public announcement.</p></details>
    </div>
  </article>;
}

export function MilestoneResults({ rows, error, filtered }: { rows: MilestoneRow[]; error: boolean; filtered: boolean }) {
  if (error) return <p className="notice" role="alert">Deadlines and ticket notices could not be loaded. This is a data-access failure, not an empty collection. Source status may still show the latest recorded attempts.</p>;
  if (!rows.length) return <div className="empty"><h2>{filtered ? "No matching notices." : "No upcoming dated or undated notices yet."}</h2><p>Try another search or All history. Review Sources for blocked, stale or unconfigured routes; an empty list does not establish that nothing new was announced.</p></div>;
  return <div className="milestone-list">{rows.map(row => <MilestoneCard key={row.id} row={row} />)}</div>;
}
