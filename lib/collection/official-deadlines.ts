/** Deterministic, read-only official deadline adapters. A program deadline is never an attendance occurrence. */
import { load } from "cheerio";
import { z } from "zod";
import { CollectionFailure, fetchPage, stableHash } from "./http";
import type { CollectionBatch, CollectionOptions, NormalizedMilestone, NormalizedOpportunity, RawPage } from "./types";

export const OFFICIAL_DEADLINE_PARSER = "official-deadlines-v1";
export const OFFICIAL_DEADLINE_URLS: Record<string, string> = {
  "fsu-onf-dates": "https://onf.fsu.edu/important-dates",
  "fsu-cre-applications": "https://fsu-cre.smapply.us/prog/ds/?page=1&base_query=all",
  "fsu-career-deadlines": "https://career.fsu.edu/programs-services/internfsu",
};
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthPattern = "(?:" + months.join("|") + ")";
const text = (value: string) => value.replace(/\s+/g, " ").trim();
const clean = (value: string) => { const $ = load(value); $("script,style").remove(); return text($.text()); };
function invalid(reason: string): never { throw new CollectionFailure(`Official deadline source ${reason}; no successful empty result`); }
function validDate(year: number, month: number, day: number): string {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isFinite(Date.parse(value)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) invalid("contains an impossible stated date");
  return value;
}
type DeadlineTime = { occursAt: string | null; occursOn: string | null; timezone: string | null; uncertainty: string | null };
/** Never obtains a year from the fetch clock or resolves an ambiguous academic-year heading. */
function generalDate(value: string): DeadlineTime {
  const match = value.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`, "i"));
  if (!match) return { occursAt: null, occursOn: null, timezone: null, uncertainty: /TBA|mid-|end of/i.test(value) ? "Publisher gives an approximate/TBA deadline; exact day, year or time is unverified" : "Deadline row omits a year; cycle heading is retained but no absolute date or time is assumed" };
  const date = validDate(Number(match[3]), months.findIndex(m => m.toLowerCase() === match[1].toLowerCase()) + 1, Number(match[2]));
  return { occursAt: null, occursOn: date, timezone: null, uncertainty: "Exact closing time and timezone are unverified; no end-of-day time is assumed" };
}
/** CRE explicitly publishes full calendar years and fixed US eastern abbreviations. Preserve literal offset. */
function creDate(value: string): DeadlineTime {
  const match = value.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (20\d{2}) (\d{1,2}):(\d{2}) (AM|PM) \((EST|EDT)\)$/);
  if (!match) invalid("CRE timestamp differs from the validated full-year EST/EDT format");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]) + 1;
  const date = validDate(Number(match[3]), month, Number(match[2]));
  const hour = Number(match[4]); const minute = Number(match[5]);
  if (hour < 1 || hour > 12 || minute > 59) invalid("CRE timestamp contains an invalid clock");
  const localHour = hour % 12 + (match[6] === "PM" ? 12 : 0);
  const offset = match[7] === "EST" ? 5 : 4;
  return { occursAt: new Date(Date.parse(`${date}T${String(localHour).padStart(2, "0")}:${match[5]}:00-${String(offset).padStart(2, "0")}:00`)).toISOString(), occursOn: date, timezone: `Etc/GMT+${offset}`, uncertainty: "Literal publisher EST/EDT offset retained; program eligibility and current application acceptance require confirmation on the official page" };
}
type ParsedRow = { nativeId: string; title: string; description: string | null; sourceUrl: string; categories: string[]; evidencePointer: string; milestones: Array<{ kind: "application_open" | "application_deadline"; localText: string; timing: DeadlineTime; availability: string | null }> };
function html(body: string) {
  if (!/<\/html>\s*$/i.test(body) || !/<body\b/i.test(body)) invalid("HTML envelope is truncated or unsupported");
  const $ = load(body); $("script,style").remove();
  if (/please sign in to continue|login required|access denied|verify you are human|just a moment\.\.\./i.test($.text())) throw new CollectionFailure("Official deadline source returned an access/error page with HTTP 200", "blocked");
  return $;
}
function onfRows(body: string): ParsedRow[] {
  const $ = html(body);
  const headings = $("h1,h2,h3,h4,h5,h6").filter((_, node) => /^20\d{2}\s*[-–]\s*20\d{2}\s+FELLOWSHIP DEADLINES$/i.test(text($(node).text())));
  if (headings.length !== 1) invalid("ONF fellowship heading is missing or ambiguous");
  const heading = headings.first(); const cycle = text(heading.text()).match(/20\d{2}\s*[-–]\s*20\d{2}/)![0].replace(/\s/g, "").replace("–", "-");
  const list = heading.nextAll("ul").first();
  if (!list.length || list.prevAll().filter((_, node) => /^h[1-6]$/.test(node.tagName) && node !== heading[0]).length) invalid("ONF deadline list is not directly associated with its heading");
  const rows: ParsedRow[] = [];
  list.children("li").each((_, node) => {
    const element = $(node).clone(); element.find("ul").remove();
    const local = text(element.text()); const title = text(element.find("strong").first().text()).replace(/\s*[:\-]\s*$/, "");
    const id = $(node).attr("data-list-item-id");
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !title || !/^[A-Z]/.test(local) || !new RegExp(monthPattern, "i").test(local)) invalid("ONF deadline row lacks a stable publisher identity, title or month evidence");
    const nativeId = `${cycle}:${id}`; const timing = generalDate(local);
    rows.push({ nativeId, title, description: `${cycle} fellowship deadline. ${local}`, sourceUrl: OFFICIAL_DEADLINE_URLS["fsu-onf-dates"], categories: ["fellowships", "applications"], evidencePointer: `official-deadline:onf:${nativeId}`, milestones: [{ kind: "application_deadline", localText: `${cycle} FELLOWSHIP DEADLINES — ${local}`, timing, availability: null }] });
  });
  if (!rows.length || rows.length > 100) invalid("ONF list is empty or exceeds its row bound");
  return rows;
}
const creEnvelope = z.object({ has_next: z.boolean(), has_previous: z.boolean(), num_pages: z.number().int().min(1).max(20), page: z.number().int().min(1), program_count: z.number().int().min(0).max(500), results: z.array(z.looseObject({ id: z.number().int().positive(), name: z.string().min(1), tag_line: z.string(), listing_url: z.string().regex(/^\/prog\/[a-z0-9_\-]+\/$/), startdate: z.string(), deadline: z.string(), timeline: z.string() })).max(100) });
export function parseCreDeadlineEnvelope(body: string) { return creEnvelope.parse(JSON.parse(body)); }
function creRows(body: string, now: Date): ParsedRow[] {
  const envelope = parseCreDeadlineEnvelope(body);
  return envelope.results.map(row => {
    const sourceUrl = new URL(row.listing_url, "https://fsu-cre.smapply.us").href;
    const opening = row.startdate ? creDate(row.startdate) : null; const deadline = row.deadline ? creDate(row.deadline) : null;
    if (opening?.occursAt && deadline?.occursAt && opening.occursAt >= deadline.occursAt) invalid("CRE application window closes before it opens");
    const availability = deadline?.occursAt && now.getTime() > Date.parse(deadline.occursAt) ? "closed_by_published_window" : opening?.occursAt && now.getTime() < Date.parse(opening.occursAt) ? "not_yet_open_by_published_window" : deadline ? "within_published_window" : "closing_date_not_published";
    const milestones: ParsedRow["milestones"] = [];
    if (opening) milestones.push({ kind: "application_open", localText: row.startdate, timing: opening, availability });
    milestones.push({ kind: "application_deadline", localText: row.deadline || row.timeline || "No closing deadline published", timing: deadline ?? { occursAt: null, occursOn: null, timezone: null, uncertainty: "No closing deadline published; rolling/open-ended status and availability require confirmation" }, availability });
    return { nativeId: String(row.id), title: clean(row.name), description: clean([row.tag_line, row.timeline].filter(Boolean).join(". ")) || null, sourceUrl, categories: ["research", "applications"], evidencePointer: `official-deadline:cre:${row.id}`, milestones };
  });
}
function careerRows(body: string): ParsedRow[] {
  const $ = html(body);
  const headings = $("h4").filter((_, node) => /^(Spring|Summer|Fall) 20\d{2} Hiring Timeline$/i.test(text($(node).text())));
  if (headings.length !== 1) invalid("Career Center hiring timeline heading is missing or ambiguous");
  const heading = headings.first(); const cycle = text(heading.text()).replace(/ Hiring Timeline$/i, "");
  const nativeId = `internfsu-${cycle.toLowerCase().replace(/\s/g, "-")}`;
  const tables = heading.next("div").find("table"); if (tables.length !== 1) invalid("Career Center hiring timeline is not one explicit table");
  const milestones: ParsedRow["milestones"] = [];
  tables.find("tr").each((_, node) => {
    const cells = $(node).children("td"); if (cells.length !== 2) invalid("Career timeline table shape changed");
    const label = text(cells.eq(0).text()); const localText = text(cells.eq(1).text());
    const kind = /^Student application deadline$/i.test(label) ? "application_deadline" : /^Intern FSU experiences posted in\s*NoleNetwork$/i.test(label) ? "application_open" : null;
    if (!kind) return;
    if (!localText) invalid("Career student milestone has no published date text");
    milestones.push({ kind, localText: `${cycle} Hiring Timeline — ${label}: ${localText}`, timing: generalDate(localText), availability: null });
  });
  if (milestones.filter(m => m.kind === "application_deadline").length !== 1 || milestones.filter(m => m.kind === "application_open").length !== 1) invalid("Career timeline lacks exactly one student deadline and posting opening");
  return [{ nativeId, title: `Intern FSU — ${cycle}`, description: `On-campus paid experiential learning program. ${cycle} Hiring Timeline. Only the student application opening and deadline are monitored; employer vacancies require NoleNetwork access.`, sourceUrl: OFFICIAL_DEADLINE_URLS["fsu-career-deadlines"], categories: ["career", "internships", "applications"], evidencePointer: `official-deadline:career:${nativeId}`, milestones }];
}
function parsedRows(sourceId: string, page: RawPage): ParsedRow[] {
  const expected = OFFICIAL_DEADLINE_URLS[sourceId];
  if (!expected || !Number.isFinite(Date.parse(page.fetchedAt))) invalid("has an unauthorized source or invalid capture timestamp");
  const url = new URL(page.url), configured = new URL(expected);
  if (sourceId === "fsu-cre-applications") {
    const envelope = parseCreDeadlineEnvelope(page.body);
    const allowedKeys = [...url.searchParams.keys()].sort();
    if (url.origin !== configured.origin || url.pathname !== configured.pathname || url.hash || url.username || url.password || allowedKeys.join(",") !== "base_query,page" || url.searchParams.get("base_query") !== "all" || url.searchParams.get("page") !== String(envelope.page) || page.nativeId !== `page:${envelope.page}`) invalid("CRE capture route or native page identity differs from its response");
    return creRows(page.body, new Date(page.fetchedAt));
  }
  if (page.url !== expected || page.nativeId !== "page:1") invalid("capture route or native page identity differs from its configured public source");
  if (sourceId === "fsu-onf-dates") return onfRows(page.body);
  if (sourceId === "fsu-career-deadlines") return careerRows(page.body);
  invalid("is not an authorized configured route");
}
/** One deterministic reconstruction serves collection and the trusted evidence boundary. */
function rowEntities(row: ParsedRow, page: RawPage): { opportunity: NormalizedOpportunity; milestones: NormalizedMilestone[] } {
  const opportunity = { nativeId: row.nativeId, title: row.title, description: row.description, sourceUrl: row.sourceUrl, kind: "program" as const, campusRelation: "fsu_affiliated" as const, categories: row.categories, sourcePublishedAt: null, sourceUpdatedAt: null, uncertainties: ["Program eligibility, applicant-specific availability and external application details require official confirmation", ...new Set(row.milestones.map(m => m.timing.uncertainty).filter((v): v is string => !!v))] };
  return {
    opportunity: { ...opportunity, contentSha256: stableHash(opportunity), captureNativeId: page.nativeId, evidencePointer: row.evidencePointer },
    milestones: row.milestones.map(source => {
      const facts = { nativeId: `${row.nativeId}:${source.kind}`, opportunityNativeId: row.nativeId, occurrenceNativeId: null, kind: source.kind, ...source.timing, sourceLocalText: source.localText, availability: source.availability, actionUrl: row.sourceUrl };
      return { ...facts, contentSha256: stableHash(facts), captureNativeId: page.nativeId, evidencePointer: `${row.evidencePointer}:${source.kind}` };
    }),
  };
}
function normalize(rows: ParsedRow[], page: RawPage, seen: Set<string>, batch: CollectionBatch) {
  for (const row of rows) {
    if (seen.has(row.nativeId)) invalid("repeats a native program identity across pages"); seen.add(row.nativeId);
    const entities = rowEntities(row, page);
    batch.opportunities.push(entities.opportunity); batch.milestones!.push(...entities.milestones);
  }
}
/** Rebuild every supported field and hash from the captured response; caller-supplied hashes confer no authority. */
export function assertOfficialDeadlineEvidence(sourceId: string, item: NormalizedOpportunity | NormalizedMilestone, page: RawPage): void {
  const expected = parsedRows(sourceId, page).flatMap(row => {
    const entities = rowEntities(row, page); return [entities.opportunity, ...entities.milestones];
  }).find(entity => entity.evidencePointer === item.evidencePointer);
  if (!expected) throw new Error("Official deadline evidence pointer does not resolve in its capture");
  if (stableHash(item) !== stableHash(expected)) throw new Error("Official deadline normalized facts or content hash differ from their captured evidence");
}
export async function collectOfficialDeadlines(sourceId: string, options: CollectionOptions = {}): Promise<CollectionBatch> {
  const now = options.now ?? (() => new Date());
  const batch: CollectionBatch = { sourceId, parserVersion: OFFICIAL_DEADLINE_PARSER, startedAt: now().toISOString(), finishedAt: now().toISOString(), status: "failed", reason: "Official deadline collection not complete", retryAfterSeconds: null, pages: [], opportunities: [], occurrences: [], milestones: [], cursor: null, observations: { requests: 0, httpStatuses: [], bytes: 0, nativeRows: 0, paginationComplete: false, windowFrom: null, windowTo: null, warnings: [] } };
  try {
    if (!(sourceId in OFFICIAL_DEADLINE_URLS)) invalid("is not configured");
    let expectedCount: number | null = null; let expectedPages: number | null = null; const seen = new Set<string>();
    const maxPages = sourceId === "fsu-cre-applications" ? options.maxPages ?? 8 : 1;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) invalid("has an invalid page budget");
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const url = new URL(OFFICIAL_DEADLINE_URLS[sourceId]); if (sourceId === "fsu-cre-applications") url.searchParams.set("page", String(pageNumber));
      const result = await fetchPage(url.href, `page:${pageNumber}`, { fetch: options.fetch ?? globalThis.fetch, now, maxBytes: options.maxBytes ?? 1_048_576, timeoutMs: options.timeoutMs ?? 25_000 });
      batch.pages.push(result.page); batch.observations.requests += result.requests; batch.observations.httpStatuses.push(result.page.httpStatus); batch.observations.bytes += result.page.byteCount;
      const page = result.page;
      if (sourceId === "fsu-cre-applications") {
        if (page.contentType.includes("html") || /^\s*</.test(page.body)) { html(page.body); invalid("CRE returned HTML rather than its public JSON directory"); }
        const envelope = parseCreDeadlineEnvelope(page.body);
        if (envelope.page !== pageNumber || envelope.has_previous !== (pageNumber > 1) || envelope.has_next !== (pageNumber < envelope.num_pages) || (expectedCount !== null && (expectedCount !== envelope.program_count || expectedPages !== envelope.num_pages))) invalid("CRE pagination metadata changed, repeated, skipped or disagreed");
        expectedCount = envelope.program_count; expectedPages = envelope.num_pages;
        if ((!envelope.results.length && envelope.program_count > 0) || batch.observations.nativeRows + envelope.results.length > envelope.program_count) invalid("CRE page is empty/truncated or exceeds its declared total");
        const rows = parsedRows(sourceId, page); batch.observations.nativeRows += rows.length; normalize(rows, page, seen, batch);
        if (envelope.has_next) continue;
        if (batch.observations.nativeRows !== envelope.program_count || pageNumber !== envelope.num_pages) invalid("CRE terminal page does not match complete declared totals");
      } else { const rows = parsedRows(sourceId, page); batch.observations.nativeRows += rows.length; normalize(rows, page, seen, batch); }
      batch.status = "success"; batch.reason = null; batch.observations.paginationComplete = true; batch.cursor = { checkedAt: now().toISOString(), programs: batch.opportunities.length, milestones: batch.milestones!.length };
      batch.observations.warnings.push("Read-only public program/application monitoring; no calendar, application submission or email execution", "Missing row years/timezones, approximate and rolling dates remain unknown; old records are retained rather than relabelled as current");
      batch.finishedAt = now().toISOString(); return batch;
    }
    invalid("reached its page budget before the terminal page");
  } catch (error) {
    const failure = error instanceof CollectionFailure ? error : new CollectionFailure("Official source parser/schema failed; collection was not empty");
    batch.observations.requests += failure.requestCount; if (failure.httpStatus !== null) batch.observations.httpStatuses.push(failure.httpStatus);
    batch.status = batch.pages.length && failure.outcome === "failed" ? "partial" : failure.outcome; batch.reason = failure.message; batch.retryAfterSeconds = failure.retryAfterSeconds; batch.cursor = null; batch.observations.paginationComplete = false; batch.finishedAt = now().toISOString(); return batch;
  }
}
