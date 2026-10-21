import assert from "node:assert/strict";
import test from "node:test";
import { assertOfficialDeadlineEvidence, collectOfficialDeadlines } from "../lib/collection/official-deadlines";
import { validateCollectionBatch } from "../lib/collection";
import { stableHash } from "../lib/collection/http";

const now = () => new Date("2026-10-21T23:40:00Z");
const html = (inside: string) => `<!DOCTYPE html><html><body>${inside}</body></html>`;
const onf = (rows = '<li data-list-item-id="stable-program"><strong>PPIA Fellowship:</strong> November 1st (11:59PM EST): fellowship deadline</li>') => html(`<div><h4>2026-2027 FELLOWSHIP DEADLINES</h4><p>All materials due.</p><ul>${rows}</ul></div><h4>2026-2027 WORKSHOPS</h4><ul><li>not a deadline</li></ul>`);
const career = (deadline = "November 9 at 11:59 PM") => html(`<h4>Spring 2027 Hiring Timeline</h4><div><table><tr><td>Step</td><td>Deadline</td></tr><tr><td>Intern FSU experiences posted in NoleNetwork</td><td>October 15</td></tr><tr><td>Student application deadline</td><td>${deadline}</td></tr><tr><td>Supervisors notify Career Center</td><td>December 12</td></tr></table></div>`);
const program = (overrides: Record<string, unknown> = {}) => ({ id: 873, name: "IDEA Grants", tag_line: "Research support", listing_url: "/prog/idea_grants/", startdate: "Sep 1 2026 12:00 AM (EDT)", deadline: "Feb 1 2027 11:59 PM (EST)", timeline: "Application window", ...overrides });
const envelope = (results: ReturnType<typeof program>[], overrides: Record<string, unknown> = {}) => JSON.stringify({ has_next: false, has_previous: false, num_pages: 1, page: 1, program_count: results.length, results, ...overrides });
const response = (body: string) => new Response(body, { headers: { "content-type": body.startsWith("{") ? "application/json" : "text/html" } });
const collect = (sourceId: string, body: string) => collectOfficialDeadlines(sourceId, { now, fetch: (async () => response(body)) as typeof fetch });

test("ONF academic-cycle heading does not invent a year from the fetch clock", async () => {
  const batch = await collect("fsu-onf-dates", onf());
  assert.equal(batch.status, "success"); assert.equal(batch.opportunities[0].kind, "program"); assert.equal(batch.occurrences.length, 0);
  assert.equal(batch.milestones!.length, 1); assert.equal(batch.milestones![0].occursOn, null); assert.equal(batch.milestones![0].occursAt, null);
  assert.match(batch.milestones![0].sourceLocalText!, /2026-2027.*November 1st/); assert.match(batch.milestones![0].uncertainty!, /omits a year/);
});
test("ONF approximate TBA remains unknown and workshops are excluded", async () => {
  const batch = await collect("fsu-onf-dates", onf('<li data-list-item-id="tba">Mid-November: <strong>Language scholarship</strong> deadline</li>'));
  assert.equal(batch.status, "success"); assert.equal(batch.milestones!.length, 1); assert.match(batch.milestones![0].uncertainty!, /approximate\/TBA/);
});
test("explicit complete row date is kept date-only without guessing closing time", async () => {
  const batch = await collect("fsu-onf-dates", onf('<li data-list-item-id="dated">November 1, 2026: <strong>Fellowship</strong> applications due</li>'));
  assert.equal(batch.status, "success"); assert.equal(batch.milestones![0].occursOn, "2026-11-01"); assert.equal(batch.milestones![0].occursAt, null); assert.equal(batch.milestones![0].timezone, null);
});
test("ONF publisher identity survives changed deadline text", async () => {
  const before = await collect("fsu-onf-dates", onf()); const after = await collect("fsu-onf-dates", onf('<li data-list-item-id="stable-program"><strong>PPIA Fellowship:</strong> November 2nd (11:59PM EST): fellowship deadline</li>'));
  assert.equal(before.milestones![0].nativeId, after.milestones![0].nativeId); assert.notEqual(before.milestones![0].contentSha256, after.milestones![0].contentSha256);
});
test("ONF duplicate or missing native row identities fail rather than collide", async () => {
  for (const rows of ['<li>November 1: <strong>Missing identity</strong></li>', '<li data-list-item-id="a">November 1: <strong>One</strong></li><li data-list-item-id="a">November 2: <strong>Two</strong></li>']) {
    const batch = await collect("fsu-onf-dates", onf(rows)); assert.equal(batch.status, "partial"); assert.equal(batch.cursor, null);
  }
});
test("HTTP200 access wall and truncated HTML never become empty success", async () => {
  const blocked = await collect("fsu-onf-dates", html("Please sign in to continue")); assert.equal(blocked.status, "blocked");
  const truncated = await collect("fsu-onf-dates", onf().replace("</html>", "")); assert.equal(truncated.status, "partial"); assert.equal(truncated.observations.paginationComplete, false);
});
test("CRE future deadline keeps explicit date, midnight opening and literal eastern offsets", async () => {
  const batch = await collect("fsu-cre-applications", envelope([program()]));
  assert.equal(batch.status, "success"); assert.equal(batch.occurrences.length, 0); assert.equal(batch.milestones!.length, 2);
  assert.equal(batch.milestones![0].occursAt, "2026-09-01T04:00:00.000Z"); assert.equal(batch.milestones![1].occursAt, "2027-02-02T04:59:00.000Z");
  assert.equal(batch.milestones![1].occursOn, "2027-02-01"); assert.equal(batch.milestones![1].timezone, "Etc/GMT+5"); assert.equal(batch.milestones![1].availability, "within_published_window");
});
test("CRE no closing deadline is retained as unknown; historical dates remain historical", async () => {
  const batch = await collect("fsu-cre-applications", envelope([program({ id: 1, deadline: "" }), program({ id: 2, startdate: "Jan 1 2025 12:00 AM (EST)", deadline: "Jul 3 2026 11:59 PM (EDT)" })]));
  assert.equal(batch.status, "success"); const unknown = batch.milestones!.find(m => m.nativeId === "1:application_deadline")!;
  assert.equal(unknown.occursAt, null); assert.equal(unknown.availability, "closing_date_not_published");
  const past = batch.milestones!.find(m => m.nativeId === "2:application_deadline")!; assert.equal(past.availability, "closed_by_published_window"); assert.equal(past.occursOn, "2026-07-03");
});
test("CRE pagination completes two pages with distinct evidence and stable identities", async () => {
  const calls: string[] = [];
  const batch = await collectOfficialDeadlines("fsu-cre-applications", { now, fetch: (async url => {
    const u = new URL(String(url)); calls.push(u.href); const second = u.searchParams.get("page") === "2";
    return response(envelope([program({ id: second ? 2 : 1 })], { program_count: 2, num_pages: 2, page: second ? 2 : 1, has_next: !second, has_previous: second }));
  }) as typeof fetch });
  assert.equal(batch.status, "success"); assert.equal(batch.observations.nativeRows, 2); assert.equal(batch.pages.length, 2); assert.equal(calls.length, 2);
  assert.equal(batch.milestones![2].captureNativeId, "page:2");
});
test("CRE pagination mismatches, repetitions, truncation and page budgets fail without cursor advance", async () => {
  for (const failure of ["wrong_page", "duplicate", "changed_count", "short_terminal", "budget"]) {
    const batch = await collectOfficialDeadlines("fsu-cre-applications", { now, maxPages: failure === "budget" ? 1 : 2, fetch: (async url => {
      const second = new URL(String(url)).searchParams.get("page") === "2";
      return response(envelope(second && failure === "short_terminal" ? [] : [program({ id: !second || failure === "duplicate" ? 1 : 2 })], { program_count: second && failure === "changed_count" ? 3 : 2, num_pages: 2, page: second && failure !== "wrong_page" ? 2 : 1, has_next: !second, has_previous: second }));
    }) as typeof fetch });
    assert.equal(batch.status, "partial", failure); assert.equal(batch.cursor, null, failure); assert.equal(batch.observations.paginationComplete, false, failure);
  }
});
test("CRE complete explicitly empty directory is successful with zero programs", async () => {
  const batch = await collect("fsu-cre-applications", envelope([])); assert.equal(batch.status, "success"); assert.equal(batch.pages.length, 1); assert.equal(batch.milestones!.length, 0);
});
test("CRE impossible dates, malformed time zones, hostile listing paths and inverted windows fail", async () => {
  for (const overrides of [{ deadline: "Feb 30 2027 11:59 PM (EST)" }, { deadline: "Feb 1 2027 11:59 PM (UTC)" }, { listing_url: "//evil.test/" }, { deadline: "Jul 1 2026 12:00 AM (EDT)" }]) {
    const batch = await collect("fsu-cre-applications", envelope([program(overrides)])); assert.equal(batch.status, "partial"); assert.equal(batch.cursor, null);
  }
});
test("CRE invalid JSON and HTML error pages retain capture and fail visibly", async () => {
  assert.equal((await collect("fsu-cre-applications", "{bad")).status, "partial");
  assert.equal((await collect("fsu-cre-applications", html("Access denied"))).status, "blocked");
});
test("Career timeline excludes staff rows and missing year stays unknown", async () => {
  const batch = await collect("fsu-career-deadlines", career()); assert.equal(batch.status, "success"); assert.equal(batch.milestones!.length, 2);
  assert.equal(batch.milestones![1].occursOn, null); assert.equal(batch.milestones![1].occursAt, null); assert.match(batch.milestones![1].sourceLocalText!, /Spring 2027.*November 9/); assert.equal(batch.occurrences.length, 0);
});
test("Career missing required student row or ambiguous timeline is partial", async () => {
  const missing = await collect("fsu-career-deadlines", career().replace("Student application deadline", "Supervisor deadline")); assert.equal(missing.status, "partial");
  const duplicate = await collect("fsu-career-deadlines", career().replace("</body>", "<h4>Fall 2026 Hiring Timeline</h4></body>")); assert.equal(duplicate.status, "partial");
});
test("request failures and Retry-After remain failures without fabricated deadlines", async () => {
  const batch = await collectOfficialDeadlines("fsu-onf-dates", { now, fetch: (async () => new Response("limited", { status: 429, headers: { "retry-after": "90" } })) as typeof fetch });
  assert.equal(batch.status, "rate_limited"); assert.equal(batch.retryAfterSeconds, 90); assert.equal(batch.observations.requests, 1); assert.equal(batch.milestones!.length, 0);
});
test("unknown source is blocked before network access", async () => {
  let calls = 0; const batch = await collectOfficialDeadlines("not-allowed", { now, fetch: (async () => { calls++; return response(onf()); }) as typeof fetch });
  assert.notEqual(batch.status, "success"); assert.equal(calls, 0);
});
test("captured program and milestone evidence validate and forged pointers/identities/times fail", async () => {
  const batch = await collect("fsu-cre-applications", envelope([program()]));
  for (const item of [...batch.opportunities, ...batch.milestones!]) assert.doesNotThrow(() => assertOfficialDeadlineEvidence(batch.sourceId, item, batch.pages[0]));
  const milestone = batch.milestones![1];
  for (const overrides of [{ nativeId: "forged" }, { evidencePointer: "official-deadline:cre:999:application_deadline" }, { occursAt: "2030-01-01T00:00:00Z" }]) assert.throws(() => assertOfficialDeadlineEvidence(batch.sourceId, { ...milestone, ...overrides }, batch.pages[0]));
});
test("fresh-capture replay preserves program and milestone hashes and returns no event occurrences", async () => {
  const body = envelope([program()]); const first = await collect("fsu-cre-applications", body); const second = await collect("fsu-cre-applications", body);
  assert.deepEqual(first.opportunities, second.opportunities); assert.deepEqual(first.milestones, second.milestones); assert.deepEqual(first.occurrences, []);
});
test("trusted ingestion boundary accepts complete evidence and rejects forged milestone relations", async () => {
  const batch = await collect("fsu-cre-applications", envelope([program()]));
  assert.equal(validateCollectionBatch(batch).milestones!.length, 2);
  const forged = structuredClone(batch); forged.milestones![0].opportunityNativeId = "other-program";
  assert.throws(() => validateCollectionBatch(forged));
  const forgedDate = structuredClone(batch); forgedDate.milestones![1].occursOn = "2027-02-02";
  assert.throws(() => validateCollectionBatch(forgedDate));
});

function withRecomputedHash<T extends Record<string, unknown>>(item: T): T {
  const { contentSha256: _old, captureNativeId: _capture, evidencePointer: _pointer, ...facts } = item;
  return { ...item, contentSha256: stableHash(facts) };
}
test("capture reconstruction rejects every forged program semantic field even with a recomputed hash", async () => {
  for (const [sourceId, body] of [["fsu-cre-applications", envelope([program()])], ["fsu-onf-dates", onf()], ["fsu-career-deadlines", career()]]) {
    const batch = await collect(sourceId, body); const item = batch.opportunities[0];
    const mutations = [
      { title: "Forged title" }, { description: "Forged description" }, { sourceUrl: "https://attacker.example/application" },
      { kind: "event" }, { campusRelation: "campus" }, { categories: ["invented category"] }, { uncertainties: [] },
      { sourcePublishedAt: "2026-01-01T00:00:00Z" }, { sourceUpdatedAt: "2026-01-01T00:00:00Z" }, { nativeId: "forged" },
    ];
    for (const change of mutations) {
      const forged = withRecomputedHash({ ...item, ...change });
      assert.throws(() => assertOfficialDeadlineEvidence(sourceId, forged as typeof item, batch.pages[0]), JSON.stringify(change));
    }
    assert.throws(() => assertOfficialDeadlineEvidence(sourceId, { ...item, contentSha256: "a".repeat(64) }, batch.pages[0]));
  }
});
test("capture reconstruction rejects forged milestone action, availability, zone, timing and uncertainty with recomputed hashes", async () => {
  const batch = await collect("fsu-cre-applications", envelope([program()])); const item = batch.milestones![1];
  for (const change of [
    { actionUrl: "https://attacker.example/apply" }, { availability: "guaranteed_open" }, { timezone: "Asia/Tokyo" },
    { occursAt: "2030-01-01T00:00:00Z" }, { occursOn: "2027-02-02" }, { sourceLocalText: "Forged local clock" },
    { uncertainty: null }, { kind: "ticket_release" }, { nativeId: "forged" }, { opportunityNativeId: "other-program" }, { occurrenceNativeId: "made-up-attendance" },
  ]) {
    const forged = withRecomputedHash({ ...item, ...change });
    assert.throws(() => assertOfficialDeadlineEvidence(batch.sourceId, forged as typeof item, batch.pages[0]), JSON.stringify(change));
  }
  assert.throws(() => assertOfficialDeadlineEvidence(batch.sourceId, { ...item, contentSha256: "b".repeat(64) }, batch.pages[0]));
});
test("CRE generic JSON pointer substitution and mismatched capture routes cannot validate as official deadline evidence", async () => {
  const batch = await collect("fsu-cre-applications", envelope([program()])); const item = batch.opportunities[0];
  assert.throws(() => assertOfficialDeadlineEvidence(batch.sourceId, { ...item, evidencePointer: "/results/0" }, batch.pages[0]));
  for (const target of ["opportunities", "milestones"] as const) {
    const forged = structuredClone(batch); forged[target]![0].evidencePointer = "/results/0";
    assert.throws(() => validateCollectionBatch(forged), "Trusted boundary must reject a source-specific pointer downgrade");
  }
  for (const change of [{ url: "https://attacker.example/prog/ds/?page=1&base_query=all" }, { url: "https://fsu-cre.smapply.us/prog/ds/?page=2&base_query=all" }, { nativeId: "page:2" }]) {
    assert.throws(() => assertOfficialDeadlineEvidence(batch.sourceId, item, { ...batch.pages[0], ...change }));
  }
});
test("availability uses capture time when processing crosses the exact published closing instant", async () => {
  let calls = 0;
  const boundary = Date.parse("2027-02-02T04:59:00Z");
  const batch = await collectOfficialDeadlines("fsu-cre-applications", {
    now: () => new Date(calls++ < 3 ? boundary - 1 : boundary + 1), fetch: (async () => response(envelope([program()]))) as typeof fetch,
  });
  assert.equal(batch.status, "success"); assert.equal(batch.pages[0].fetchedAt, new Date(boundary - 1).toISOString());
  assert.equal(batch.milestones![1].availability, "within_published_window"); assert.equal(batch.finishedAt, new Date(boundary + 1).toISOString());
  assert.doesNotThrow(() => assertOfficialDeadlineEvidence(batch.sourceId, batch.milestones![1], batch.pages[0]));
});
