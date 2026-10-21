/** Fresh public read-only capture plus replay. No database, credential, media or ticket actions. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { collectOfficialTickets, assertOfficialTicketEvidence } from "../lib/collection/official-tickets";

const directory = "private/official-tickets-live";
await mkdir(directory, { recursive: true, mode: 0o700 });
const requestMetadata: Array<{ url: string; status: number; location: string | null }> = [];
const fresh = await collectOfficialTickets({ fetch: (async (input: URL | RequestInfo, init?: RequestInit) => {
  const response = await fetch(input, init);
  requestMetadata.push({ url: String(input), status: response.status, location: response.headers.get("location") });
  return response;
}) as typeof fetch });
await writeFile(`${directory}/latest.json`, JSON.stringify(fresh, null, 2) + "\n", { mode: 0o600 });
let replay: typeof fresh | null = null;
if (fresh.pages.length) {
  const captures = new Map(fresh.pages.map(page => [page.url, page]));
  replay = await collectOfficialTickets({ now: () => new Date(fresh.startedAt), fetch: (async input => {
    const page = captures.get(String(input));
    if (!page) throw new Error("Replay requested an uncaptured route");
    return new Response(page.body, { status: page.httpStatus, headers: { "content-type": page.contentType } });
  }) as typeof fetch });
}
const summary = (batch: typeof fresh) => ({ status: batch.status, reason: batch.reason, startedAt: batch.startedAt, finishedAt: batch.finishedAt, parserVersion: batch.parserVersion, requests: batch.observations.requests, bytes: batch.observations.bytes, capturedPages: batch.pages.length, nativeRows: batch.observations.nativeRows, opportunities: batch.opportunities.length, occurrences: batch.occurrences.length, milestones: batch.milestones?.length ?? 0, explicitReleases: batch.milestones?.filter(row => row.kind === "ticket_release").map(row => ({ nativeId: row.nativeId, date: row.occursOn, text: row.sourceLocalText, timezone: row.timezone })), captureHashes: batch.pages.map(page => page.sha256), warnings: batch.observations.warnings });
const signature = (batch: typeof fresh) => JSON.stringify([batch.opportunities, batch.occurrences, batch.milestones].map(rows => rows?.map(row => [row.nativeId, row.contentSha256])));
let validatedEvidence = 0;
for (const item of [...fresh.opportunities, ...fresh.occurrences, ...(fresh.milestones ?? [])]) {
  const page = fresh.pages.find(page => page.nativeId === item.captureNativeId);
  if (!page) throw new Error("Probe item has no capture");
  assertOfficialTicketEvidence(fresh.sourceId, item, page); validatedEvidence++;
}
let previous: { attempts?: unknown[] } = {};
try { previous = JSON.parse(await readFile("reports/official-ticket-collection.json", "utf8")); } catch { /* First attempt. */ }
const report = { sourceId: fresh.sourceId, evidenceClass: "fresh-public-read-only-fetch-and-capture-replay", liveFetchMocked: false, reportedAt: new Date().toISOString(), fresh: summary(fresh), requestMetadata, evidencePointersValidated: validatedEvidence, attempts: [...(previous.attempts ?? []), summary(fresh)], replay: replay ? { evidenceClass: "replay-of-this-fresh-capture; not-another-network-fetch", ...summary(replay), semanticRecordsIdentical: signature(fresh) === signature(replay) } : null, privateCapturePath: `${directory}/latest.json`, databaseWrites: 0, calendarWrites: 0, emailsSent: 0, modelCalls: 0, paidConnectors: 0, ticketVendorRequests: 0, providerChargesUsd: 0, costBasis: "Observed public HTTPS GETs only; local compute/network and hosted service invoices are unmeasured. This probe does not prove deployed or scheduled ingestion.", limits: ["Organizer listing and linked details only; no university-wide ticket coverage", "No seat inventory, eligibility, RSVP, order, cart or reservation requests", "Exact observed on-sale date and local clock retained; unstated timezone is unknown, so no precise instant is inferred", "Link/status revisions report observed changes; they cannot prove first release time", "Structured offer availabilityStarts/validFrom ignored because fresh payload reuses event time", "Missing link never means sold out; vanished show never means cancelled"], primaryReferences: [{ url: "https://www.openingnights.fsu.edu/events", checkedAt: fresh.startedAt }, { url: "https://www.openingnights.fsu.edu/show-details/new-york-gilbert-and-sullivan-players-pirates-of-penzance", checkedAt: fresh.startedAt }] };
await mkdir("reports", { recursive: true });
await writeFile("reports/official-ticket-collection.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (fresh.status !== "success" || replay?.status !== "success" || signature(fresh) !== signature(replay)) process.exitCode = 2;
