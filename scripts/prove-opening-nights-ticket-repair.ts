/** Offline proof only. Preserves raw captures; never fetches, signs in or writes a database. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { assertOfficialTicketEvidence, collectOfficialTickets, openingNightsCards, OPENING_NIGHTS_LISTING_URL } from "../lib/collection/official-tickets";
import type { CollectionBatch, RawPage } from "../lib/collection/types";

const directory = "private/opening-nights-ticket-repair";
const baselineSha = "321db61d92c1224787f6440bc0e647580a4c6e1f62c030db4268e7489ac72e50";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sourcePath = "lib/collection/official-tickets.ts";
const archive = `${directory}/adapter-before-repair.ts.txt`;
const original = await readFile(archive, "utf8");
assert.equal(sha(original), baselineSha, "Original pre-repair adapter must remain exact.");
// Only relative helper resolution changes in this private importable copy.
// The original byte-identical source archive remains untouched and hash-pinned.
const importable = `${directory}/adapter-before-importable.ts`;
const resolved = original.replace('from "./http"', 'from "../../lib/collection/http"').replace('from "./types"', 'from "../../lib/collection/types"');
try { assert.equal(await readFile(importable, "utf8"), resolved); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(importable, resolved, { flag: "wx", mode: 0o600 }); }
const baseline = await import(pathToFileURL(path.resolve(importable)).href) as { collectOfficialTickets: typeof collectOfficialTickets };
const domPath = `${directory}/observed-dom-facts.json`;
const healthPath = `${directory}/hosted-health.json`;
const dom = JSON.parse(await readFile(domPath, "utf8"));
const health = JSON.parse(await readFile(healthPath, "utf8"));
await chmod(healthPath, 0o600);
const retainedPath = "private/official-tickets-live/latest.json";
const retainedBytes = await readFile(retainedPath);
const retained = JSON.parse(retainedBytes.toString()) as CollectionBatch;
for (const page of retained.pages) assert.equal(sha(page.body), page.sha256, "Retained response body must match its original hash.");

async function replay(engine: typeof collectOfficialTickets, pages: ReadonlyArray<RawPage | { url: string; body: string; httpStatus: number; contentType: string }>, now: string) {
  const map = new Map(pages.map(page => [page.url, page]));
  return engine({ now: () => new Date(now), fetch: (async input => {
    const page = map.get(String(input));
    if (!page) throw new Error("Offline replay requested an uncaptured route");
    return new Response(page.body, { status: page.httpStatus, headers: { "content-type": page.contentType } });
  }) as typeof fetch });
}
const oldRaw = await replay(baseline.collectOfficialTickets, retained.pages, retained.startedAt);
const newRaw = await replay(collectOfficialTickets, retained.pages, retained.startedAt);
assert.equal(oldRaw.status, "success"); assert.equal(newRaw.status, "success");
assert.deepEqual([newRaw.opportunities, newRaw.occurrences, newRaw.milestones], [oldRaw.opportunities, oldRaw.occurrences, oldRaw.milestones], "All old captured facts and native identities must remain identical.");
let originalEvidenceItems = 0;
for (const item of [...newRaw.opportunities, ...newRaw.occurrences, ...(newRaw.milestones ?? [])]) {
  assertOfficialTicketEvidence(newRaw.sourceId, item, newRaw.pages.find(page => page.nativeId === item.captureNativeId)!);
  originalEvidenceItems++;
}

assert.equal(dom.sourceUrl, "https://www.openingnights.fsu.edu/show-details/new-york-gilbert-and-sullivan-players-pirates-of-penzance");
assert.equal(dom.notices.length, 2);
const card = openingNightsCards(retained.pages.find(page => page.url === OPENING_NIGHTS_LISTING_URL)!.body).find(card => card.nativeId === dom.sourceUrl)!;
assert.ok(card); assert.equal(card.title, dom.title);
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const document = (inner: string) => `<!doctype html><html><body><main>${inner}</main></body></html>`;
const listing = document(`<div class="highlight-card"><a class="highlight-card-link" href="${escape(card.nativeId)}"><h3 class="highlight-title-line">${escape(card.title)}</h3><div class="highlight-date-line">${escape(card.dateText)}</div><span class="highlight-tag">${escape(card.category)}</span></a></div>`);
const detail = document(`<div class="dr-show-hero-copy"><h1>${escape(dom.title)}</h1></div><div class="dr-show-hero-actions">${dom.notices.map((notice: { href: string; class: string; text: string }) => `<a href="${escape(notice.href)}" class="${escape(notice.class)}">${escape(notice.text)}</a>`).join("")}</div>`);
const reconstructed = [{ url: OPENING_NIGHTS_LISTING_URL, body: listing, httpStatus: 200, contentType: "text/html" }, { url: dom.sourceUrl, body: detail, httpStatus: 200, contentType: "text/html" }];
const beforeDom = await replay(baseline.collectOfficialTickets, reconstructed, retained.startedAt);
const afterDom = await replay(collectOfficialTickets, reconstructed, retained.startedAt);
assert.equal(beforeDom.status, "partial"); assert.match(beforeDom.reason!, /ambiguous ticket notices/);
assert.equal(afterDom.status, "success"); assert.equal(afterDom.milestones!.length, 1);
const notice = afterDom.milestones![0];
assert.equal(notice.nativeId, `${card.nativeId}#ticket-notice`); assert.equal(notice.availability, "announced_release");
assert.equal(notice.occursAt, null); assert.equal(notice.timezone, null); assert.equal(notice.occursOn, "2026-11-30");
assert.ok(notice.uncertainty!.includes(dom.notices[1].text));
assert.ok(notice.uncertainty!.includes(dom.notices[1].href));
assert.deepEqual(afterDom.opportunities[0], newRaw.opportunities.find(row => row.nativeId === card.nativeId));
assert.deepEqual(afterDom.occurrences[0], newRaw.occurrences.find(row => row.opportunityNativeId === card.nativeId));
assert.equal(notice.nativeId, newRaw.milestones!.find(row => row.opportunityNativeId === card.nativeId)!.nativeId);
for (const item of [...afterDom.opportunities, ...afterDom.occurrences, ...afterDom.milestones!]) assertOfficialTicketEvidence(afterDom.sourceId, item, afterDom.pages.find(page => page.nativeId === item.captureNativeId)!);

const report = {
  checkedAt: new Date().toISOString(), command: "node --import tsx scripts/prove-opening-nights-ticket-repair.ts",
  sourceId: afterDom.sourceId, parserVersion: afterDom.parserVersion,
  evidenceClass: "Actual hosted public-source health metadata; current rendered DOM facts; offline raw-capture and DOM-reconstruction replays. Current full raw-HTTP collection remains unproven.",
  originalAdapter: { archive, initialArchivePath: dom.baseline.archive, sourceSha256: baselineSha, baselineCommit: dom.baseline.commit, importableCopy: importable, importResolutionOnlyChanged: true, originalSourceBytesChanged: false, archiveExtensionChangedToAvoidCompilingTheUnresolvedOriginalImports: true },
  currentAdapter: { path: sourcePath, sourceSha256: sha(await readFile(sourcePath)) },
  scriptSha256: sha(await readFile(import.meta.filename)),
  observedFailure: { sourceHealth: health.health.health_status, consecutiveFailures: health.health.consecutive_failures, lastSuccessAt: health.health.last_success_at, nextPollAt: health.health.next_poll_at, retryNotBefore: health.health.retry_not_before, latestRun: health.runs[0], latestFailingDetail: health.latestCaptureMetadata.at(-1), providerRateLimitObservedInLastEight: health.runs.slice(0, 8).some((row: { httpStatus: number; outcome: string }) => [429, 503].includes(row.httpStatus) || row.outcome === "rate_limited"), diagnosis: "Two separate audience scopes were counted as competing general notices: a disabled explicit on-sale announcement and an explicitly Sponsor/Member-labeled action. This is not evidence of open unrestricted sales or inventory." },
  recordedDom: { path: domPath, sha256: sha(await readFile(domPath)), sourceUrl: dom.sourceUrl, recordedAt: dom.recordedAt, evidenceClass: dom.evidenceClass, actions: dom.notices, rawHttpBodyObtained: false },
  rawProbeAttempts: dom.directRawHttpAttempts, cachedWebReader: dom.cachedWebReader, browserNavigation: dom.browserNavigation,
  retainedRawReplay: { capturePath: retainedPath, captureSha256: sha(retainedBytes), capturedAt: retained.startedAt, pages: retained.pages.length, originalStatus: oldRaw.status, repairedStatus: newRaw.status, opportunities: newRaw.opportunities.length, occurrences: newRaw.occurrences.length, milestones: newRaw.milestones!.length, allNormalizedFactsAndNativeIdentitiesIdentical: true, evidenceItemsRevalidated: originalEvidenceItems },
  observedDomReconstruction: { evidenceClass: "Offline parser replay using actual observed rendered-DOM action facts and a constructed document wrapper; not raw HTTP integration or accuracy evaluation.", originalStatus: beforeDom.status, originalReason: beforeDom.reason, repairedStatus: afterDom.status, opportunityAndOccurrenceFactsUnchanged: true, stableOpportunityNativeId: card.nativeId, stableOccurrenceNativeId: afterDom.occurrences[0].nativeId, stableMilestoneNativeId: notice.nativeId, milestone: notice, warnings: afterDom.observations.warnings },
  safetyRules: ["Explicit Sponsor/Member links remain quoted with their URL in notice uncertainty; they never establish this user's eligibility, inventory, unrestricted access or an earlier sale time.", "Competing unscoped releases/links remain partial, regardless of DOM order. Unknown audience wording is not discarded.", "A restricted-only route produces an unknown notice, without a general action URL or invented release.", "Yearless/unsupported general sale copy still fails; timezone and exact instant remain unknown.", "Original show, occurrence and single current notice native identities remain stable; new audience text can revise only the relevant notice facts.", "Provider Retry-After and application cadence/backoff are not reset or changed."],
  deployment: { applied: false, sourceHealthCleared: false, scheduledRecoveryVerified: false, nextStep: "Deploy existing-source adapter, then wait for normal hourly dispatcher after the retained retry floor. Require actual full current listing/detail success before claiming recovered health." },
  gaps: ["Direct raw HTTP failed locally at DNS resolution; this is distinct from the hosted HTTP200 semantic failure.", "The cached web-reader result is not current-source proof.", "The current 17-show raw listing and every detail were not freshly collected under this investigation's cap; rendered DOM is not an original response capture.", "The browser's automatic subresource requests/bytes were not metered; no claim that aggregate browser traffic fits the separate raw-probe byte cap.", "This repair does not establish seat inventory, buyer eligibility or ticket release/announcement history.", "No Stage2 human holdout or other acceptance gate was satisfied by this source repair."],
  boundaries: { actualSupabaseReadOnlySqlCalls: 2, databaseWrites: 0, authUsersCreated: 0, credentialsRead: false, storageReads: 0, ticketVendorRequestsByProbe: 0, ticketActionsClicked: 0, calendarCalls: 0, modelCalls: 0, paidConnectors: 0, cadenceChanges: 0, retryResets: 0, newSources: 0, holdoutAccess: false },
  costs: { newPaidServices: 0, providerApiUsd: 0, readSqlAndBrowserNetworkComputeMeasured: false },
};
const output = "reports/opening-nights-ticket-repair.json";
try { const previous = await readFile(output); await writeFile(output.replace(/\.json$/, `-history-${sha(previous).slice(0,16)}.json`), previous, { flag: "wx" }); }
catch (error) { if (!["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code!)) throw error; }
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: output, before: beforeDom.status, after: afterDom.status, retainedRawPages: retained.pages.length, retainedNormalizedFactsIdentical: true, directRawHttpCompleted: false, deployed: false, actualNetworkRequestsByThisReplay: 0 }));
