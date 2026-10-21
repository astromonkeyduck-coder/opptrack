import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MilestoneCard, MilestoneResults } from "../app/deadlines/components";
import { milestoneAvailability, milestoneFeedLink, milestoneFilters, milestoneFutureFilter, milestoneHealth, milestoneKinds, milestoneTiming, type MilestoneRow } from "../lib/milestones/presentation";

// Synthetic fixtures; no production seed data or calendar actions.
const row: MilestoneRow = { id: "synthetic", source_id: "fsu-opening-nights", kind: "ticket_release", occurs_at: null, occurs_on: "2026-11-30", availability: "announced_release", action_url: "https://tickets.openingnights.fsu.edu/main/seats/1234", uncertainty: "Timezone unconfirmed; inventory unknown", revision: 2, title: "Synthetic campus performance", description: "Unverified eligibility", source_url: "https://www.openingnights.fsu.edu/show-details/synthetic", categories: ["tickets"], uncertainties: ["First announcement time is unknown"], source_name: "Opening Nights", health_status: "success", health_message: null, last_success_at: "2026-10-21T20:00:00Z", last_attempt_at: "2026-10-21T20:00:00Z", cadence_seconds: 3600, coverage_note: "Official current public listing only", changed_at: "2026-10-21T20:00:00Z", source_local_text: "Tickets go on sale Nov 30, 2026 at 11:00 AM", timezone: null };

test("ticket local date preserves full year and stated clock without inventing an exact instant", () => {
  const timing = milestoneTiming(row), html = renderToStaticMarkup(createElement(MilestoneCard, { row }));
  assert.equal(timing.label, "Mon, Nov 30, 2026"); assert.match(timing.precision, /exact instant unverified/); assert.match(timing.precision, /timezone unconfirmed/);
  assert.match(html, /Tickets go on sale Nov 30, 2026 at 11:00 AM/); assert.match(html, /Original source timezone: Unconfirmed/);
  assert.ok(!html.includes("11:00 AM EST")); assert.ok(!html.includes("11:00 AM EDT")); assert.match(html, /Current facts first observed/); assert.match(html, /Revised 2/);
});

test("verified instants convert to Eastern while date-only facts never shift across midnight", () => {
  assert.equal(milestoneTiming({ ...row, occurs_at: "2026-11-01T05:30:00Z" }).label, "Nov 1, 2026, 1:30 AM EDT");
  assert.equal(milestoneTiming({ ...row, occurs_at: "2026-11-01T06:30:00Z" }).label, "Nov 1, 2026, 1:30 AM EST");
  assert.equal(milestoneTiming({ ...row, occurs_on: "2026-01-01" }).label, "Thu, Jan 1, 2026");
});

test("unknown and malformed dates cannot appear as verified reminder times", () => {
  for (const override of [{ occurs_on: null }, { occurs_on: "2026-02-30" }, { occurs_on: "not-a-date" }, { occurs_on: null, occurs_at: "2026-11-30T11:00:00" }]) {
    assert.deepEqual(milestoneTiming({ ...row, ...override }), { label: "Date unconfirmed", precision: "No date or reminder time assumed" });
  }
});

test("observed ticket link and absent link statuses retain inventory uncertainty", () => {
  assert.match(milestoneAvailability("link_observed")!, /inventory unverified/);
  assert.equal(milestoneAvailability("unknown"), "Ticket status unknown"); assert.equal(milestoneAvailability("provider_novel_claim"), null);
  const html = renderToStaticMarkup(createElement(MilestoneCard, { row: { ...row, kind: "ticket_link", occurs_on: null, availability: "link_observed" } }));
  assert.match(html, /Ticket link observed/); assert.ok(!html.includes("Seats available")); assert.ok(!html.includes("Sold out"));
});

test("application windows and ticket notices filter independently and sanitize PostgREST search", () => {
  const filters = milestoneFilters({ q: "research%,title.eq.injected", category: "tickets", window: "all", page: "3" });
  assert.deepEqual(filters, { q: "research title eq injected", category: "tickets", window: "all", page: 3 });
  assert.deepEqual(milestoneKinds("tickets"), ["ticket_link", "ticket_release"]);
  assert.deepEqual(milestoneKinds("applications"), ["application_open", "application_deadline"]);
  assert.deepEqual(milestoneFilters({ q: ["injected"], category: "bad", window: ["all"], page: "-5" }), { q: "", category: "all", window: "upcoming", page: 1 });
});

test("pagination preserves search, category and history window with bounded page numbers", () => {
  const filters = milestoneFilters({ q: "arts research", category: "applications", window: "all", page: "999999" });
  assert.equal(filters.page, 10000);
  const url = new URL(milestoneFeedLink(filters), "https://tracker.invalid");
  assert.equal(url.pathname, "/deadlines"); assert.equal(url.searchParams.get("q"), "arts research"); assert.equal(url.searchParams.get("window"), "all"); assert.equal(url.searchParams.get("category"), "applications");
});

test("upcoming filter includes unknown dates and handles Eastern day before UTC midnight", () => {
  const filter = milestoneFutureFilter(new Date("2026-10-22T01:00:00Z"));
  assert.match(filter, /occurs_at.gte.2026-10-22T01:00:00.000Z/);
  assert.match(filter, /occurs_on.gte.2026-10-21/);
  assert.match(filter, /and\(occurs_at.is.null,occurs_on.is.null\)/);
  assert.ok(!filter.includes("23:59:59"));
});

test("source freshness is distinct from historical retained notice content", () => {
  assert.equal(milestoneHealth(row, Date.parse("2026-10-21T21:00:00Z")), "Latest collection succeeded");
  assert.match(milestoneHealth(row, Date.parse("2026-10-22T00:00:00Z")), /stale/);
  assert.equal(milestoneHealth({ ...row, health_status: "blocked" }, Date.parse("2026-10-21T21:00:00Z")), "Collection blocked");
  assert.match(milestoneHealth({ ...row, last_success_at: null }, Date.parse("2026-10-21T21:00:00Z")), /never succeeded/);
});

test("untrusted notice/source text is escaped and unsafe links never become clickable", () => {
  const html = renderToStaticMarkup(createElement(MilestoneCard, { row: { ...row, title: "<script>alert(1)</script>", source_local_text: "<img src=x onerror=alert(1)>", source_name: "<b>Source</b>", action_url: "javascript:alert(1)", source_url: "https://name:password@attacker.invalid/", uncertainty: "<script>bad</script>", health_status: "blocked", health_message: "<img src=x>" } }));
  assert.match(html, /&lt;script&gt;alert/); assert.match(html, /&lt;img src=x/);
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img")); assert.ok(!html.includes("href=")); assert.ok(!html.includes("javascript:")); assert.ok(!html.includes("password@"));
});

test("data-access failures have an explicit alert and never render no-results or stale rows as success", () => {
  const html = renderToStaticMarkup(createElement(MilestoneResults, { rows: [row], error: true, filtered: false }));
  assert.match(html, /role="alert"/); assert.match(html, /data-access failure, not an empty collection/);
  assert.ok(!html.includes(row.title)); assert.ok(!html.includes("No upcoming"));
  const empty = renderToStaticMarkup(createElement(MilestoneResults, { rows: [], error: false, filtered: true }));
  assert.match(empty, /No matching notices/); assert.match(empty, /empty list does not establish/); assert.ok(!empty.includes('role="alert"'));
});

test("monitor cards offer only original-source links and no reminder, calendar or purchase action", () => {
  const html = renderToStaticMarkup(createElement(MilestoneCard, { row }));
  assert.match(html, /Official ticket page/); assert.match(html, /Source notice/);
  for (const forbidden of ["<form", "<button", "eventedit", "Add to Google Calendar", "Approve reminder", "Buy tickets", "RSVP", "mailto:"]) assert.ok(!html.includes(forbidden));
});
