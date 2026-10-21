/** Bounded public HQ export adapter. It deliberately does not implement recurring-series expansion. */
import { load } from "cheerio";
import { CollectionFailure, fetchPage, stableHash } from "./http";
import { validateCollectionBatch } from "./index";
import type { CollectionBatch, CollectionOptions, NormalizedOccurrence, NormalizedOpportunity } from "./types";

export const HQ_SOURCE_ID = "fsu-hq-public-export";
export const HQ_EXPORT_URL = "https://hq.fsu.edu/ical/floridastate/ical_floridastate.ics";
export const HQ_PARSER_VERSION = "hq-ics-v1";
const MAX_EVENTS = 5_000;
const MAX_LINES = 100_000;
type Property = { name: string; params: Record<string, string>; value: string };
type Event = { properties: Property[]; index: number };
type ParsedCalendar = { events: Event[]; stamps: string[] };

function invalid(reason: string): never { throw new CollectionFailure(`HQ export ${reason}; collection is incomplete`); }

/** Split only outside quoted parameter values (ORGANIZER CN can itself contain a colon/semicolon). */
function splitUnquoted(value: string, separator: string): string[] {
  const parts: string[] = []; let quoted = false; let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted;
    if (value[index] === separator && !quoted) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  if (quoted) invalid("has an unterminated quoted parameter");
  parts.push(value.slice(start)); return parts;
}

function parseProperty(line: string): Property {
  let quoted = false; let colon = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ":" && !quoted) { colon = index; break; }
  }
  if (colon < 1) invalid("contains a malformed content line");
  const [rawName, ...rawParams] = splitUnquoted(line.slice(0, colon), ";");
  if (!/^[A-Za-z0-9-]+$/.test(rawName)) invalid("contains an invalid property name");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (equals < 1) invalid("contains a malformed property parameter");
    const name = raw.slice(0, equals).toUpperCase(); let value = raw.slice(equals + 1);
    if (!/^[A-Z0-9-]+$/.test(name) || name in params) invalid("contains duplicate or malformed parameters");
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[name] = value;
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Strict envelope checks mean truncation, HTML/login walls and unsupported structures cannot be empty success. */
function parseCalendar(body: string): ParsedCalendar {
  if (/\0|\r(?!\n)/.test(body)) invalid("contains unsupported control characters or line endings");
  const physical = body.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (physical.length > MAX_LINES) invalid("exceeds the content-line limit");
  const lines: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line)) {
      if (!lines.length) invalid("starts with a folded continuation");
      lines[lines.length - 1] += line.slice(1);
    } else if (line) lines.push(line);
  }
  if (lines[0]?.toUpperCase() !== "BEGIN:VCALENDAR" || lines.at(-1)?.toUpperCase() !== "END:VCALENDAR") {
    if (/please sign in|login required|sign in to continue|access denied|verify you are human/i.test(body)) throw new CollectionFailure("HQ returned an access page instead of a public calendar", "blocked");
    invalid("is not one complete VCALENDAR envelope");
  }
  const events: Event[] = []; const calendarProperties: Property[] = []; let current: Event | null = null;
  for (const line of lines.slice(1, -1)) {
    const property = parseProperty(line);
    if (property.name === "BEGIN") {
      if (current || property.value.toUpperCase() !== "VEVENT") invalid("contains an unsupported or nested component");
      if (events.length >= MAX_EVENTS) invalid("exceeds the event limit");
      current = { properties: [], index: events.length }; continue;
    }
    if (property.name === "END") {
      if (!current || property.value.toUpperCase() !== "VEVENT") invalid("has mismatched component boundaries");
      events.push(current); current = null; continue;
    }
    if (current) current.properties.push(property); else calendarProperties.push(property);
  }
  if (current) invalid("ends during an event");
  if (single(calendarProperties, "VERSION")?.value !== "2.0" || !single(calendarProperties, "PRODID")?.value) invalid("has no supported VERSION/PRODID");
  const method = single(calendarProperties, "METHOD")?.value.toUpperCase();
  if (method && method !== "PUBLISH") invalid("uses an unsupported scheduling METHOD");
  const stamps: string[] = [];
  for (const event of events) {
    for (const name of ["UID", "DTSTART", "DTEND", "DURATION", "SUMMARY", "DESCRIPTION", "LOCATION", "URL", "STATUS", "CREATED", "LAST-MODIFIED", "DTSTAMP", "SEQUENCE"]) single(event.properties, name);
    if (event.properties.some(property => ["RRULE", "RDATE", "EXDATE", "RECURRENCE-ID", "EXRULE"].includes(property.name))) invalid("contains recurrence that this bounded adapter does not expand");
    if (single(event.properties, "DURATION")) invalid("contains an unsupported DURATION instead of an explicit DTEND");
    const stamp = single(event.properties, "DTSTAMP"); if (stamp) stamps.push(utcTimestamp(stamp));
  }
  return { events, stamps };
}

function single(properties: Property[], name: string): Property | undefined {
  const matching = properties.filter(property => property.name === name);
  if (matching.length > 1) invalid(`repeats singleton ${name}`);
  return matching[0];
}
function eventUid(event: Event): string {
  const uid = single(event.properties, "UID")?.value;
  if (!uid || uid.length > 1_000 || /[\x00-\x1f]/.test(uid)) invalid("has a missing or invalid native UID");
  return uid;
}

/** Used once per capture by the trusted evidence validator; indexes resolve to actual native UIDs. */
export function hqEvidenceUids(body: string): string[] { return parseCalendar(body).events.map(eventUid); }

function unescapeText(value: string): string {
  // CampusGroups declares legacy quoted-printable on SUMMARY. Decode valid octets without inventing soft line breaks.
  return value.replace(/\\([nN,;\\])/g, (_, token: string) => /n/i.test(token) ? "\n" : token);
}
function readable(property: Property | undefined): string | null {
  if (!property) return null;
  let value = property.value;
  const encoding = property.params.ENCODING?.toUpperCase();
  if (property.params.CHARSET && !/^utf-?8$/i.test(property.params.CHARSET)) invalid("uses an unsupported text charset");
  if (encoding && encoding !== "QUOTED-PRINTABLE") invalid("uses an unsupported text encoding");
  if (encoding === "QUOTED-PRINTABLE") {
    const bytes: number[] = [];
    for (let index = 0; index < value.length;) {
      if (value[index] === "=" && /^[A-Fa-f0-9]{2}$/.test(value.slice(index + 1, index + 3))) { bytes.push(parseInt(value.slice(index + 1, index + 3), 16)); index += 3; }
      else { const point = value.codePointAt(index)!; bytes.push(...Buffer.from(String.fromCodePoint(point))); index += point > 0xffff ? 2 : 1; }
    }
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch { invalid("contains invalid UTF-8 text encoding"); }
  }
  const $ = load(unescapeText(value)); $("script,style").remove(); $("p,div,li,br,h1,h2,h3,h4").append(" ");
  return $.text().replace(/\s+/g, " ").trim() || null;
}

function validDate(raw: string): string {
  if (!/^\d{8}$/.test(raw)) invalid("contains an invalid calendar date");
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) invalid("contains an impossible calendar date");
  return iso;
}
type EventTime = { instant: string | null; date: string; allDay: boolean; timezone: string | null; sourceText: string; comparable: string };
function eventTime(property: Property): EventTime {
  const raw = property.value; const type = property.params.VALUE?.toUpperCase(); const zone = property.params.TZID ?? null;
  if (type && !["DATE", "DATE-TIME"].includes(type)) invalid("uses an unsupported date VALUE type");
  if (type === "DATE") {
    if (zone) invalid("attaches TZID to a date-only property");
    const date = validDate(raw); return { instant: null, date, allDay: true, timezone: null, sourceText: date, comparable: date };
  }
  if (!/^\d{8}T\d{6}Z?$/.test(raw)) invalid("contains an unsupported or invalid date-time");
  const date = validDate(raw.slice(0, 8)); const time = `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}`;
  if (Number(raw.slice(9, 11)) > 23 || Number(raw.slice(11, 13)) > 59 || Number(raw.slice(13, 15)) > 59) invalid("contains an impossible clock time");
  if (raw.endsWith("Z")) {
    if (zone) invalid("combines UTC and TZID on one property");
    const instant = `${date}T${time}.000Z`; return { instant, date, allDay: false, timezone: "UTC", sourceText: instant, comparable: instant };
  }
  return { instant: null, date, allDay: false, timezone: zone, sourceText: `${date}T${time}${zone ? ` [TZID=${zone}]` : " [floating; timezone unspecified]"}`, comparable: `${date}T${time}` };
}
function utcTimestamp(property: Property): string {
  const parsed = eventTime(property); if (!parsed.instant) invalid(`has a non-UTC ${property.name} timestamp`); return parsed.instant;
}

/** A UTC instant window is explicit; floating/date-only records are compared by their retained source dates. */
export async function collectHq(options: CollectionOptions = {}): Promise<CollectionBatch> {
  const now = options.now ?? (() => new Date());
  const batch: CollectionBatch = { sourceId: HQ_SOURCE_ID, parserVersion: HQ_PARSER_VERSION, startedAt: now().toISOString(), finishedAt: now().toISOString(), status: "failed", reason: "Collection not complete", retryAfterSeconds: null, pages: [], opportunities: [], occurrences: [], cursor: null, observations: { requests: 0, httpStatuses: [], bytes: 0, nativeRows: 0, paginationComplete: false, windowFrom: null, windowTo: null, warnings: [] } };
  try {
    const retained = options.retainedNativeIds ?? new Set<string>();
    if (!(retained instanceof Set) || retained.size > 10_000 || [...retained].some(uid => typeof uid !== "string" || !uid.length || uid.length > 1_000 || /[\x00-\x1f]/.test(uid))) throw new CollectionFailure("HQ retained native identity set exceeds its trusted reconciliation bounds");
    const days = options.days ?? 90;
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new CollectionFailure("HQ collection window must be one to 366 days");
    let from = now();
    if (options.startDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.startDate)) throw new CollectionFailure("Invalid HQ requested date window");
      validDate(options.startDate.replaceAll("-", "")); from = new Date(`${options.startDate}T00:00:00Z`);
    }
    const to = new Date(from.getTime() + days * 86_400_000);
    batch.observations.windowFrom = from.toISOString(); batch.observations.windowTo = to.toISOString();
    const fetched = await fetchPage(HQ_EXPORT_URL, "public-export", { fetch: options.fetch ?? globalThis.fetch, now, maxBytes: options.maxBytes ?? 3_145_728, timeoutMs: options.timeoutMs ?? 25_000 });
    const page = fetched.page; batch.pages.push(page); batch.observations.requests = fetched.requests; batch.observations.httpStatuses.push(page.httpStatus); batch.observations.bytes = page.byteCount;
    if (!/^(?:text\/calendar|application\/octet-stream|text\/plain)$/i.test(page.contentType)) throw new CollectionFailure("HQ returned an unexpected calendar content type", page.contentType.includes("html") ? "blocked" : "failed");
    const parsed = parseCalendar(page.body); batch.observations.nativeRows = parsed.events.length;
    const opportunities: NormalizedOpportunity[] = []; const occurrences: NormalizedOccurrence[] = []; const seen = new Set<string>(); let skipped = 0; let temporalConflicts = 0; let retainedOutsideWindow = 0;
    for (const event of parsed.events) {
      const get = (name: string) => single(event.properties, name); const uid = eventUid(event);
      if (seen.has(uid)) invalid("repeats a native UID; single-occurrence identities are ambiguous"); seen.add(uid);
      const title = readable(get("SUMMARY")); if (!title || title.length > 1_000) invalid("has a missing or oversized summary");
      const startProperty = get("DTSTART"); if (!startProperty) invalid("has an event without DTSTART");
      const start = eventTime(startProperty); const endProperty = get("DTEND"); const sourceEnd = endProperty ? eventTime(endProperty) : null;
      if (sourceEnd && (sourceEnd.allDay !== start.allDay || sourceEnd.timezone !== start.timezone)) invalid("has a mismatched event end type/timezone");
      const invalidEndOrder = !!sourceEnd && sourceEnd.comparable <= start.comparable;
      if (invalidEndOrder) temporalConflicts++;
      const end = invalidEndOrder ? null : sourceEnd;
      const status = get("STATUS")?.value.toUpperCase(); if (status && !["CONFIRMED", "TENTATIVE", "CANCELLED"].includes(status)) invalid("has an unsupported event STATUS");
      const created = get("CREATED"); const modified = get("LAST-MODIFIED"); const publishedAt = created ? utcTimestamp(created) : null; const updatedAt = modified ? utcTimestamp(modified) : null;
      if (get("SEQUENCE") && !/^\d+$/.test(get("SEQUENCE")!.value)) invalid("has an invalid SEQUENCE");
      const description = readable(get("DESCRIPTION")); const rawLocation = readable(get("LOCATION")); const withheld = !!rawLocation && /sign in|log\s?in|private|restricted|withheld/i.test(rawLocation); const location = withheld ? null : rawLocation;
      const uncertainties = ["Public HQ subscription only; private/member coverage and export completeness are unknown", "Ticket availability, eligibility and release dates are unverified", ...(!end ? ["Event end is unknown"] : []), ...(invalidEndOrder ? ["Source DTEND is not after DTSTART; conflicting end withheld without correcting the source"] : []), ...(withheld ? ["Location withheld by source; sign-in may be required"] : !location ? ["Location is unknown"] : []), ...(!start.instant && !start.allDay ? ["Source local time retained; timezone conversion is unverified"] : []), ...(start.allDay && end ? ["All-day DTEND is exclusive; source date range retained without inventing an end instant"] : []), ...(status === "TENTATIVE" ? ["Source event is tentative"] : [])];
      let sourceUrl = HQ_EXPORT_URL;
      try { const url = new URL(get("URL")?.value ?? ""); if (url.protocol === "https:" && url.hostname === "hq.fsu.edu" && !url.username && !url.password && (!url.port || url.port === "443")) sourceUrl = url.href; else uncertainties.push("Canonical public event URL is unavailable"); } catch { uncertainties.push("Canonical public event URL is unavailable"); }
      const categoryValues = event.properties.filter(property => property.name === "CATEGORIES" && property.params["X-CG-CATEGORY"] === "event_type").flatMap(property => property.value.split(/(?<!\\),/).map(value => unescapeText(value).trim()).filter(Boolean));
      const facts = { nativeId: uid, title, description, sourceUrl, kind: "event" as const, campusRelation: "fsu_affiliated" as const, categories: [...new Set(categoryValues)].sort(), sourcePublishedAt: publishedAt, sourceUpdatedAt: updatedAt, uncertainties };
      const sourceLocalText = `${start.sourceText}${sourceEnd ? ` – ${sourceEnd.sourceText}${start.allDay ? " (exclusive end)" : ""}${invalidEndOrder ? " [conflicting source end; normalized end unknown]" : ""}` : ""}`;
      const occurrenceFacts = { nativeId: uid, opportunityNativeId: uid, startAt: start.instant, endAt: end?.instant ?? null, startDate: start.date, timezone: start.timezone, sourceLocalText, datePrecision: start.instant ? "instant" as const : "date" as const, location, allDay: start.allDay, lifecycle: status === "CANCELLED" ? "cancelled" as const : status === "TENTATIVE" ? "unknown" as const : "scheduled" as const };
      // Validate every row before filtering. Disappearance/outside-window status never implies cancellation.
      const startsInWindow = start.instant ? start.instant >= from.toISOString() && start.instant < to.toISOString() : start.date >= from.toISOString().slice(0, 10) && start.date < to.toISOString().slice(0, 10);
      const ongoing = start.instant ? start.instant < from.toISOString() && !!end?.instant && end.instant > from.toISOString() : start.date < from.toISOString().slice(0, 10) && !!end && end.date > from.toISOString().slice(0, 10);
      if (!startsInWindow && !ongoing) {
        if (!retained.has(uid)) { skipped++; continue; }
        retainedOutsideWindow++;
      }
      const evidence = { captureNativeId: page.nativeId, evidencePointer: `ics-vevent:${event.index}` };
      opportunities.push({ ...facts, contentSha256: stableHash(facts), ...evidence }); occurrences.push({ ...occurrenceFacts, contentSha256: stableHash(occurrenceFacts), ...evidence });
    }
    batch.opportunities = opportunities; batch.occurrences = occurrences;
    batch.status = "success"; batch.reason = null; batch.observations.paginationComplete = true;
    batch.cursor = { windowFrom: from.toISOString(), windowTo: to.toISOString(), totalNativeRows: parsed.events.length, emittedRows: occurrences.length, skippedOutsideWindow: skipped, temporalEndConflicts: temporalConflicts, retainedOutsideWindow, retainedMissingFromExport: [...retained].filter(uid => !seen.has(uid)).length, completedAt: now().toISOString() };
    batch.observations.warnings.push(`Complete captured export envelope validated: ${parsed.events.length} native rows; ${occurrences.length} emitted within ${days}-day UTC window, ongoing or previously retained; ${skipped} untracked rows outside window`, "Export inclusion rules and publisher truncation are unknown; complete envelope does not establish complete campus/private HQ coverage", "Recurrence expansion is unsupported and causes a partial result if encountered", "Missing/disappearing events never infer cancellation; only explicit STATUS:CANCELLED does", "No ticket/application milestones, registration actions or calendar writes are inferred");
    if (retainedOutsideWindow) batch.observations.warnings.push(`${retainedOutsideWindow} previously retained native UIDs reconciled outside the discovery window, including explicit date/status edits`);
    const missingRetained = [...retained].filter(uid => !seen.has(uid)).length;
    if (missingRetained) batch.observations.warnings.push(`${missingRetained} previously retained native UIDs are absent from the captured export; no deletion or cancellation is inferred`);
    if (temporalConflicts) batch.observations.warnings.push(`${temporalConflicts} source DTEND values are not after DTSTART; conflicting ends retained only as evidence/text and normalized unknown (including outside-window rows)`);
    const newestStamp = parsed.stamps.sort().at(-1);
    if (newestStamp && now().getTime() - Date.parse(newestStamp) > 72 * 3_600_000) batch.observations.warnings.push(`Export DTSTAMP is older than 72 hours (${newestStamp}); freshness may be stale`);
  } catch (error) {
    const failure = error instanceof CollectionFailure ? error : new CollectionFailure("HQ schema or parser validation failed; collection was not empty");
    batch.observations.requests += failure.requestCount; if (failure.httpStatus !== null) batch.observations.httpStatuses.push(failure.httpStatus);
    batch.status = batch.pages.length && failure.outcome === "failed" ? "partial" : failure.outcome; batch.reason = failure.message; batch.retryAfterSeconds = failure.retryAfterSeconds; batch.cursor = null; batch.observations.paginationComplete = false;
    // A failed feed never exposes a partially parsed set to the persistence layer.
    batch.opportunities = []; batch.occurrences = [];
  }
  batch.finishedAt = now().toISOString(); return validateCollectionBatch(batch);
}
