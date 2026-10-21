/** Fresh read-only probes plus local replay. Complete public bodies stay ignored and mode 0600. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { collectOfficialDeadlines, OFFICIAL_DEADLINE_URLS, assertOfficialDeadlineEvidence } from "../lib/collection/official-deadlines";
import { validateCollectionBatch } from "../lib/collection";
import type { CollectionBatch } from "../lib/collection/types";

const directory = "private/official-deadlines-live";
await mkdir(directory, { recursive: true, mode: 0o700 });
const reportPath = "reports/official-deadlines-collection.json";
let previous: { attempts?: unknown[] } = {};
try { previous = JSON.parse(await readFile(reportPath, "utf8")); } catch { /* First attempt. */ }
const now = new Date();
const attempts = [];
for (const sourceId of Object.keys(OFFICIAL_DEADLINE_URLS)) {
  const requests: Array<{ url: string; httpStatus: number; contentType: string | null }> = [];
  const fresh = await collectOfficialDeadlines(sourceId, { fetch: (async (input, init) => {
    const response = await fetch(input, init); requests.push({ url: String(input), httpStatus: response.status, contentType: response.headers.get("content-type") }); return response;
  }) as typeof fetch });
  validateCollectionBatch(fresh);
  await writeFile(`${directory}/${sourceId}-latest.json`, JSON.stringify(fresh, null, 2) + "\n", { mode: 0o600 });
  let replay: CollectionBatch | null = null;
  if (fresh.pages.length) {
    replay = await collectOfficialDeadlines(sourceId, { now: () => new Date(fresh.startedAt), fetch: (async input => {
      const page = fresh.pages.find(p => p.url === String(input)); if (!page) throw new Error("Replay requested an uncaptured page");
      return new Response(page.body, { status: page.httpStatus, headers: { "content-type": page.contentType } });
    }) as typeof fetch });
    validateCollectionBatch(replay);
  }
  const summary = (batch: CollectionBatch) => ({ sourceId: batch.sourceId, parserVersion: batch.parserVersion, status: batch.status, reason: batch.reason, startedAt: batch.startedAt, finishedAt: batch.finishedAt, requests: batch.observations.requests, responseBytes: batch.observations.bytes, capturedPages: batch.pages.length, captureSha256: batch.pages.map(p => p.sha256), nativeRows: batch.observations.nativeRows, programs: batch.opportunities.length, milestones: batch.milestones?.length ?? 0, eventOccurrences: batch.occurrences.length, exactFutureClosingDates: (batch.milestones ?? []).filter(m => m.kind === "application_deadline" && !!m.occursAt && Date.parse(m.occursAt) > now.getTime()).length, unknownAbsoluteDates: (batch.milestones ?? []).filter(m => !m.occursAt && !m.occursOn).length, expiredClosingDates: (batch.milestones ?? []).filter(m => m.kind === "application_deadline" && !!m.occursAt && Date.parse(m.occursAt) < now.getTime()).length, paginationComplete: batch.observations.paginationComplete, warnings: batch.observations.warnings });
  const signature = (batch: CollectionBatch) => JSON.stringify({ programs: batch.opportunities.map(p => [p.nativeId, p.contentSha256]), milestones: (batch.milestones ?? []).map(m => [m.nativeId, m.contentSha256]) });
  const evidenceValid = [...fresh.opportunities, ...(fresh.milestones ?? [])].every(item => {
    assertOfficialDeadlineEvidence(sourceId, item, fresh.pages.find(p => p.nativeId === item.captureNativeId)!); return true;
  });
  const sampleFutureMilestones = (fresh.milestones ?? []).filter(m => m.kind === "application_deadline" && m.occursAt && Date.parse(m.occursAt) > now.getTime()).map(m => ({ program: fresh.opportunities.find(p => p.nativeId === m.opportunityNativeId)?.title, nativeId: m.nativeId, occursAt: m.occursAt, occursOn: m.occursOn, sourceLocalText: m.sourceLocalText, sourceUrl: m.actionUrl, uncertainty: m.uncertainty }));
  const result = { evidenceClass: "fresh-public-GET-plus-private-response-replay", mockedLiveFetch: false, fresh: summary(fresh), replay: replay ? { evidenceClass: "local-replay-not-second-network-fetch", ...summary(replay), identicalSemanticRecords: signature(fresh) === signature(replay) } : null, evidencePointersValidated: evidenceValid, requestMetadata: requests, sampleFutureMilestones, privateCapturePath: `${directory}/${sourceId}-latest.json` };
  attempts.push(result); console.log(JSON.stringify(result));
  if (fresh.status !== "success" || replay?.status !== "success" || !result.replay?.identicalSemanticRecords || !evidenceValid) process.exitCode = 2;
}
const report = {
  recordedAt: new Date().toISOString(), evidenceClass: "actual-public-collection-probes-and-replay", attempts: [...(previous.attempts ?? []), ...attempts],
  totalsForLatestAttempt: { requests: attempts.reduce((s, r) => s + r.fresh.requests, 0), responseBytes: attempts.reduce((s, r) => s + r.fresh.responseBytes, 0), programs: attempts.reduce((s, r) => s + r.fresh.programs, 0), milestones: attempts.reduce((s, r) => s + r.fresh.milestones, 0), eventOccurrences: 0 },
  initialExploratoryReads: { evidenceClass: "public-route-discovery-not-hosted-ingestion", completeRequests: 9, explanation: "ONF/Career/CRE landing, two CRE static program pages, two public vendor JavaScript bundles identifying /prog/ds/, and two unauthenticated JSON directory pages. The first sandboxed attempt failed DNS for three pages and was not counted as collection success. Bodies remain ignored. Indexed search differed from fresh ONF Goldwater day; only the actual captured publisher response is parsed." },
  zeroSideEffects: { databaseWrites: 0, productionActivation: 0, calendarWrites: 0, applicationsSubmitted: 0, emailMessages: 0, modelCalls: 0, paidConnectors: 0 },
  costModel: { cadenceSeconds: 21600, checksPer30Days: 120, publicGetsPer30DaysAtObservedPagination: 480, responseBytesPer30DaysAtObservedSize: attempts.reduce((s, r) => s + r.fresh.responseBytes, 0) * 120, upstreamGetChargeUsd: 0, cloudComputeCost: "unmeasured; no hosted run claimed", notes: "4 GETs per complete three-route check. Storage growth assumes each content body changes; content-addressed reuse lowers identical-body writes. Private capture retention deletion remains disabled. Provider API shape changes and additional pages can block this bounded adapter." },
  limits: ["Public source-specific monitoring, not all fellowships/research/career coverage", "No year guessed from fetch date or ambiguous 2026–2027/Spring2027 heading; ONF and Career local text remains visible with unknown absolute dates", "CRE uses explicit portal windows only; older program descriptions/eligibility and conflicts with other pages need confirmation", "Closed historical programs and unpublished/rolling closing deadlines remain visible; last successful fetch is not a guarantee of current applications", "Program deadlines are milestones, never event attendance occurrences or automatic reminders", "No NoleNetwork login, applicant data, submission, email alert, calendar write or paid connector", "ONF native publisher editor IDs may change on page rewrites; no cross-source merge or disappearance-based cancellation" ],
  primaryReferences: Object.values(OFFICIAL_DEADLINE_URLS),
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
