/** Read-only organizer ticket notices. A ticket link is never proof of sale or inventory. */
import { load } from "cheerio";
import { CollectionFailure, fetchPage, stableHash } from "./http";
import type { CollectionBatch, CollectionOptions, NormalizedMilestone, NormalizedOccurrence, NormalizedOpportunity, RawPage } from "./types";

export const OFFICIAL_TICKET_SOURCE_ID = "fsu-opening-nights";
export const OFFICIAL_TICKET_PARSER_VERSION = "official-tickets-v1";
export const OPENING_NIGHTS_LISTING_URL = "https://www.openingnights.fsu.edu/events";
const MAX_SHOWS = 40;
const MAX_WALL_TIME_MS = 75_000;
const DETAIL_PATH = /^\/show-details\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
function invalid(message: string): never { throw new CollectionFailure(`Opening Nights ${message}; collection is incomplete`); }

function detailUrl(value: string, base = OPENING_NIGHTS_LISTING_URL): string {
  let url: URL;
  try { url = new URL(value, base); } catch { return invalid("has a malformed detail URL"); }
  if (url.origin !== "https://www.openingnights.fsu.edu" || !DETAIL_PATH.test(url.pathname) || url.search || url.hash || url.href.length > 500) invalid("has a detail link outside its bounded official route");
  return url.href;
}
function actionUrl(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return invalid("has a malformed ticket link"); }
  if (url.origin !== "https://tickets.openingnights.fsu.edu" || !/^\/main\/seats\/\d{1,10}$/.test(url.pathname) || url.search || url.hash) invalid("has an unrecognized ticket route; it was not fetched");
  return url.href;
}
function date(month: string, day: string, year: string): string {
  const monthIndex = months.indexOf(month.toLowerCase().slice(0, 3)) + 1;
  if (!monthIndex) invalid("has an unknown month");
  const result = `${year}-${String(monthIndex).padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) invalid("has an invalid date");
  return result;
}
function sourceDate(value: string): { start: string; range: boolean } {
  const match = value.match(/^([A-Za-z]{3,9}) (\d{1,2})(?:\s*-\s*([A-Za-z]{3,9}) (\d{1,2}))?, (20\d{2})$/);
  if (!match) invalid("show date no longer matches the verified card format");
  const start = date(match[1], match[2], match[5]);
  if (match[3] && date(match[3], match[4], match[5]) < start) invalid("has a backwards date range");
  return { start, range: !!match[3] };
}
function html(body: string) {
  if (!/<html\b/i.test(body) || !/<\/html\s*>\s*$/i.test(body)) invalid("response is not a complete HTML document");
  const $ = load(body); $("script,style,template").remove();
  const text = clean($("body").text());
  if (/verify you are human|access denied|please sign in to continue|login required|just a moment\.\.\.|service unavailable/i.test(text)) throw new CollectionFailure("Opening Nights returned an access or error page", "blocked");
  if (/\[(?:eventName|eventDates|eventUrlTitle)\]|\{:(?:SearchDate|HelpKeyCommand)\}/i.test(text)) throw new CollectionFailure("Opening Nights returned an unrendered event template", "blocked");
  if ($("main").length !== 1) invalid("main document region is missing or duplicated");
  return $;
}
export interface OpeningNightsCard { nativeId: string; slug: string; title: string; dateText: string; startDate: string; range: boolean; category: string; listingTicketUrl: string | null }
/** Exported for validation and synthetic replay tests, not an additional network route. */
export function openingNightsCards(body: string): OpeningNightsCard[] {
  const $ = html(body), cards: OpeningNightsCard[] = [], seen = new Set<string>();
  if ($("main a[rel=next], main .pagination, main [data-next-page]").length) invalid("listing advertises unsupported pagination");
  const elements = $("main .highlight-card");
  if (!elements.length) invalid("listing has no validated show cards; empty success is not established");
  if (elements.length > MAX_SHOWS) invalid(`listing exceeds the ${MAX_SHOWS}-show limit`);
  elements.each((_, element) => {
    const card = $(element), links = card.find("a.highlight-card-link"), title = clean(card.find(".highlight-title-line").text());
    if (links.length !== 1 || !title || title.length > 500) invalid("has a missing or ambiguous native show identity");
    const nativeId = detailUrl(links.attr("href") ?? "");
    if (seen.has(nativeId)) invalid("listing repeats a show identity"); seen.add(nativeId);
    const dateText = clean(card.find(".highlight-date-line").text()), parsedDate = sourceDate(dateText);
    const buttons = card.find(".highlight-card-actions a").filter((__, node) => /^(?:buy|get) tickets$/i.test(clean($(node).text())));
    if (buttons.length > 1) invalid("listing repeats a ticket action");
    cards.push({ nativeId, slug: new URL(nativeId).pathname.split("/").at(-1)!, title, dateText, ...{ startDate: parsedDate.start, range: parsedDate.range }, category: clean(card.find(".highlight-tag").text()), listingTicketUrl: actionUrl(buttons.attr("href")) });
  });
  return cards;
}
interface Notice { actionUrl: string | null; availability: string; releaseDate: string | null; releaseText: string | null }
function ticketNotice(body: string, expectedTitle: string): Notice {
  const $ = html(body), titles = $("main .dr-show-hero-copy h1");
  if (titles.length !== 1 || clean(titles.text()).toLowerCase() !== expectedTitle.toLowerCase()) invalid("detail title does not match its listing card");
  const actions = $("main .dr-show-hero-actions a.dr-show-action");
  const ticketActions = actions.filter((_, element) => /tickets|on sale|sold out|waitlist|unavailable/i.test(clean($(element).text())));
  if (ticketActions.length > 1) invalid("detail has ambiguous ticket notices");
  if (!ticketActions.length) return { actionUrl: null, availability: "unknown", releaseDate: null, releaseText: null };
  const action = ticketActions.first(), text = clean(action.text()), target = actionUrl(action.attr("href"));
  const release = text.match(/^Tickets go on sale\s+([A-Za-z]{3,9}) (\d{1,2}), (20\d{2}) at (\d{1,2}):(\d{2}) (AM|PM)$/i);
  if (release) {
    if (+release[4] < 1 || +release[4] > 12 || +release[5] > 59) invalid("release notice contains an invalid local clock");
    return { actionUrl: target, availability: "announced_release", releaseDate: date(release[1], release[2], release[3]), releaseText: text };
  }
  if (/on sale|tickets go|sale begins|sale opens|sold out|waitlist|unavailable/i.test(text)) invalid("ticket status changed to an unsupported notice; no availability was guessed");
  if (/^(?:buy|get) tickets$/i.test(text) && !action.hasClass("disabled") && action.attr("aria-disabled") !== "true") {
    if (!target) invalid("active ticket notice has no valid action URL");
    return { actionUrl: target, availability: "link_observed", releaseDate: null, releaseText: null };
  }
  invalid("ticket action no longer matches the verified notice format");
}

type EvidenceItem = NormalizedOpportunity | NormalizedOccurrence | NormalizedMilestone;
type EvidenceMetadata = "contentSha256" | "captureNativeId" | "evidencePointer";
function opportunityFacts(card: OpeningNightsCard): Omit<NormalizedOpportunity, EvidenceMetadata> {
  return { nativeId: card.nativeId, title: card.title, description: `Opening Nights show. Organizer date: ${card.dateText}. Ticket notices are recorded separately with their own captured evidence.`, sourceUrl: card.nativeId, kind: "event", campusRelation: "fsu_affiliated", categories: ["arts_concerts", "tickets", card.category].filter(Boolean), sourcePublishedAt: null, sourceUpdatedAt: null, uncertainties: ["Timezone, precise event clock and end time are unverified by this adapter", "Ticket link presence does not establish available seats, eligibility or first release time", "Structured offer availabilityStarts/validFrom are ignored because observed metadata reuses performance time", ...(card.range ? ["Organizer lists a multi-day program; individual sessions and exclusive end are unverified"] : [])] };
}
function occurrenceFacts(card: OpeningNightsCard): Omit<NormalizedOccurrence, EvidenceMetadata> {
  return { nativeId: `${card.nativeId}#performance`, opportunityNativeId: card.nativeId, startAt: null, endAt: null, startDate: card.startDate, timezone: null, sourceLocalText: card.dateText, datePrecision: "date", location: null, allDay: false, lifecycle: "unknown" };
}
function milestoneFacts(nativeUrl: string, notice: Notice): Omit<NormalizedMilestone, EvidenceMetadata> {
  const kind = notice.releaseDate ? "ticket_release" : "ticket_link";
  return { nativeId: `${nativeUrl}#ticket-notice`, opportunityNativeId: nativeUrl, occurrenceNativeId: `${nativeUrl}#performance`, kind, occursAt: null, occursOn: notice.releaseDate, sourceLocalText: notice.releaseText, timezone: null, availability: notice.availability, actionUrl: notice.actionUrl, uncertainty: kind === "ticket_release" ? "Organizer explicitly announces this local release date/time; timezone is unstated, so no instant/reminder is inferred. First announcement and actual inventory are unknown." : "Observed organizer link/notice only. Missing or disabled links do not mean sold out or cancellation. Prior release timing is no longer a current verified claim. Polling detects a later observed change, not the true first release time." };
}
function assertExactFacts(item: EvidenceItem, expected: object): void {
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key, (item as unknown as Record<string, unknown>)[key]]));
  const expectedHash = stableHash(expected);
  if (stableHash(actual) !== expectedHash || item.contentSha256 !== expectedHash) throw new Error("Official ticket normalized facts differ from the captured source evidence");
}
/** Resolve native identities against their precise private listing/detail capture. */
export function assertOfficialTicketEvidence(sourceId: string, item: EvidenceItem, page: RawPage): void {
  if (sourceId !== OFFICIAL_TICKET_SOURCE_ID) throw new Error("Official ticket evidence belongs only to Opening Nights");
  if (item.captureNativeId !== page.nativeId) throw new Error("Official ticket capture identity differs from evidence");
  const pointer = item.evidencePointer.match(/^official-ticket:([a-z0-9]+(?:-[a-z0-9]+)*):(listing|ticket-notice)$/);
  if (!pointer) throw new Error("Invalid official ticket evidence pointer");
  const url = `https://www.openingnights.fsu.edu/show-details/${pointer[1]}`;
  if (pointer[2] === "listing") {
    const card = page.url === OPENING_NIGHTS_LISTING_URL ? openingNightsCards(page.body).find(card => card.nativeId === url) : null;
    if (!card) throw new Error("Official ticket listing evidence does not resolve");
    if (item.nativeId === url && "title" in item) assertExactFacts(item, opportunityFacts(card));
    else if (item.nativeId === `${url}#performance` && "startDate" in item) assertExactFacts(item, occurrenceFacts(card));
    else throw new Error("Official show identity or entity kind differs from evidence");
  } else {
    if (page.url !== url || item.nativeId !== `${url}#${pointer[2]}`) throw new Error("Official ticket detail evidence identity differs");
    const $ = html(page.body), title = clean($("main .dr-show-hero-copy h1").text());
    const notice = ticketNotice(page.body, title);
    if (!("occursOn" in item)) throw new Error("Official ticket notice evidence must identify a milestone");
    assertExactFacts(item, milestoneFacts(url, notice));
  }
}

export async function collectOfficialTickets(options: CollectionOptions = {}): Promise<CollectionBatch> {
  const now = options.now ?? (() => new Date());
  // Scheduling/runtime budget uses real elapsed wall time, never source/frozen replay time.
  const deadline = Date.now() + MAX_WALL_TIME_MS;
  const batch: CollectionBatch = { sourceId: OFFICIAL_TICKET_SOURCE_ID, parserVersion: OFFICIAL_TICKET_PARSER_VERSION, startedAt: now().toISOString(), finishedAt: now().toISOString(), status: "failed", reason: "Official ticket collection has not completed", retryAfterSeconds: null, pages: [], opportunities: [], occurrences: [], milestones: [], cursor: null, observations: { requests: 0, httpStatuses: [], bytes: 0, nativeRows: 0, paginationComplete: false, windowFrom: null, windowTo: null, warnings: [] } };
  const fetcher = async (url: string, id: string) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) invalid("exceeded its 75-second collection wall-time budget before another request");
    const result = await fetchPage(url, id, { fetch: options.fetch ?? globalThis.fetch, now, maxBytes: options.maxBytes ?? 1_572_864, timeoutMs: Math.min(options.timeoutMs ?? 25_000, remaining) });
    batch.pages.push(result.page); batch.observations.requests += result.requests; batch.observations.bytes += result.page.byteCount; batch.observations.httpStatuses.push(result.page.httpStatus);
    if (Date.now() > deadline) invalid("exceeded its 75-second collection wall-time budget");
    if (result.page.url !== url) invalid("capture redirected to a different show identity");
    if (batch.observations.bytes > 8_388_608) invalid("batch exceeds its total eight MiB capture limit");
    return result.page;
  };
  try {
    const listing = await fetcher(OPENING_NIGHTS_LISTING_URL, "listing"), cards = openingNightsCards(listing.body);
    const maxPages = options.maxPages ?? MAX_SHOWS + 1;
    if (!Number.isInteger(maxPages) || maxPages < 2 || maxPages > MAX_SHOWS + 1 || cards.length + 1 > maxPages) invalid("detail capture limit cannot cover the full current listing");
    batch.observations.nativeRows = cards.length;
    for (const card of cards) {
      const detail = await fetcher(card.nativeId, `detail:${card.slug}`), notice = ticketNotice(detail.body, card.title);
      if (card.listingTicketUrl && notice.actionUrl !== card.listingTicketUrl) invalid("listing and detail ticket targets disagree; retry a stable snapshot");
      const facts = opportunityFacts(card);
      batch.opportunities.push({ ...facts, contentSha256: stableHash(facts), captureNativeId: listing.nativeId, evidencePointer: `official-ticket:${card.slug}:listing` });
      const occurrence = occurrenceFacts(card);
      batch.occurrences.push({ ...occurrence, contentSha256: stableHash(occurrence), captureNativeId: listing.nativeId, evidencePointer: `official-ticket:${card.slug}:listing` });
      // A single current notice identity survives release -> link -> absent -> corrected
      // announcement. The transaction clears old date/kind values rather than retaining
      // a stale release beside a second link row. Immutable versions retain its history.
      const milestone = milestoneFacts(card.nativeId, notice);
      batch.milestones!.push({ ...milestone, contentSha256: stableHash(milestone), captureNativeId: detail.nativeId, evidencePointer: `official-ticket:${card.slug}:ticket-notice` });
    }
    batch.status = "success"; batch.reason = null; batch.observations.paginationComplete = true;
    batch.cursor = { listingCapturedAt: listing.fetchedAt, shows: cards.length, detailPages: cards.length };
    batch.observations.warnings.push("Complete current organizer listing and every linked show detail only; no campus-wide ticket completeness", "Ticket vendor URLs are retained as action links and never fetched; no seat availability, reservation or purchase", "Sale dates are extracted only from explicit visible hero action copy with a year; timezone remains unknown", "Semantic revisions record observed ticket-link/release changes; polling does not prove the first public announcement; disappearance never means sold out or cancellation");
  } catch (error) {
    const failure = error instanceof CollectionFailure ? error : new CollectionFailure("Opening Nights parser validation failed; no successful empty result");
    batch.status = batch.pages.length && failure.outcome === "failed" ? "partial" : failure.outcome; batch.reason = failure.message; batch.retryAfterSeconds = failure.retryAfterSeconds;
    batch.observations.requests += failure.requestCount; if (failure.httpStatus !== null) batch.observations.httpStatuses.push(failure.httpStatus);
    batch.cursor = null; batch.observations.paginationComplete = false;
  }
  batch.finishedAt = now().toISOString();
  return batch;
}
