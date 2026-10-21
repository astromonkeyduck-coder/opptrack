/** Read-only HQ probe. Only summary metadata is public; the complete response stays in ignored private/. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { collectHq } from "../lib/collection/hq";

const directory = "private/hq-live";
await mkdir(directory, { recursive: true, mode: 0o700 });
let priorReport: { attemptHistory?: unknown[]; fresh?: unknown } | null = null;
try { priorReport = JSON.parse(await readFile("reports/hq-public-collection.json", "utf8")); } catch { /* First probe has no prior evidence. */ }
const requests: Array<{ url: string; status: number; location: string | null; contentType: string | null }> = [];
const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
  const response = await fetch(input, init);
  requests.push({ url: String(input), status: response.status, location: response.headers.get("location"), contentType: response.headers.get("content-type") });
  return response;
}) as typeof fetch;
const fresh = await collectHq({ fetch: fetcher });
await writeFile(`${directory}/latest.json`, JSON.stringify(fresh, null, 2) + "\n", { mode: 0o600 });
let replay: Awaited<ReturnType<typeof collectHq>> | null = null;
if (fresh.pages.length) {
  const captured = JSON.parse(await readFile(`${directory}/latest.json`, "utf8")) as typeof fresh;
  const page = captured.pages[0];
  replay = await collectHq({ now: () => new Date(fresh.observations.windowFrom ?? fresh.startedAt), fetch: (async () => new Response(page.body, { status: page.httpStatus, headers: { "content-type": page.contentType } })) as typeof fetch });
}
const summaries = (batch: typeof fresh) => ({ status: batch.status, reason: batch.reason, parserVersion: batch.parserVersion, startedAt: batch.startedAt, finishedAt: batch.finishedAt, requests: batch.observations.requests, responseBytes: batch.observations.bytes, capturedPages: batch.pages.length, nativeRows: batch.observations.nativeRows, opportunities: batch.opportunities.length, occurrences: batch.occurrences.length, cursor: batch.cursor, paginationComplete: batch.observations.paginationComplete, captureSha256: batch.pages.map(page => page.sha256), warnings: batch.observations.warnings });
const semanticSignature = (batch: typeof fresh) => JSON.stringify({ opportunities: batch.opportunities.map(row => [row.nativeId, row.contentSha256]), occurrences: batch.occurrences.map(row => [row.nativeId, row.contentSha256]) });
const report = {
  evidenceClass: "fresh-public-read-only-fetch-and-private-replay", mockedLiveFetch: false, reportedAt: new Date().toISOString(),
  sourceId: fresh.sourceId, fresh: summaries(fresh), requestMetadata: requests,
  attemptHistory: [...(priorReport?.attemptHistory ?? (priorReport?.fresh ? [priorReport.fresh] : [])), summaries(fresh)],
  replay: replay ? { evidenceClass: "replay-of-fresh-private-response; not-second-network-fetch", ...summaries(replay), identicalSemanticRecords: semanticSignature(fresh) === semanticSignature(replay) } : null,
  privateCapturePath: `${directory}/latest.json`,
  databaseWrites: 0, calendarWrites: 0, modelCalls: 0, paidConnectors: 0, upstreamGetChargesUsd: 0,
  costBasis: "Public HTTPS GETs only. Local compute/network and service invoices are unmeasured. No production activation or hosted ingestion is claimed by this probe.",
  limits: ["Public institutional subscription only; private/member visibility and publisher truncation are unknown", "Upcoming 90 days UTC plus known ongoing events; previously retained native UIDs reconcile outside that window; whole feed validated before filtering", "No recurring-series expansion; such input remains partial", "No disappearance-based cancellations, ticket milestones, RSVP, purchase or calendar execution", "Source UID identities are independent across collectors; cross-source duplicates may remain"],
  primaryReferences: [{ url: "https://www.rfc-editor.org/rfc/rfc5545", checkedAt: "2026-10-21", relevantSections: ["3.1 content-line unfolding", "3.3.4 DATE", "3.3.5 DATE-TIME floating/UTC/TZID", "3.6.1 VEVENT exclusive end", "3.8.4.7 UID"] }],
};
await mkdir("reports", { recursive: true });
await writeFile("reports/hq-public-collection.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (fresh.status !== "success" || replay?.status !== "success" || !report.replay?.identicalSemanticRecords) process.exitCode = 2;
