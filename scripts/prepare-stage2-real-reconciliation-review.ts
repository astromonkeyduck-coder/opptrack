/** Real DEVELOPMENT proposals only; no labels, predictions, providers or production writes. */
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluationSha256 } from '../evaluation/stage2-evaluator';
import { reviewedSha256, type FrozenSourceEvidence, type ReviewedExample } from '../evaluation/stage2-reviewed-contract';

const version = 'stage2-real-development-reconciliation-review-v1';
const firstApprovalFile = 'reports/stage-2-first-ten-human-review.json';
const nextApprovalFile = 'reports/stage-2-next25-human-review.json';
const packetReferenceFile = 'reports/stage-2-next-review-packet.json';
const checkedFiles = new Map<string, string>(), captures = new Map<string, Buffer>();
async function checkedRead(file: string, maximum = 5 * 1024 * 1024) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve('.') + path.sep) || /sealed-holdout|acceptance-human|holdout-gold/i.test(file)) throw new Error('Outside approved development custody.');
  if ((await stat(file)).size > maximum) throw new Error('A development artifact exceeds its existing size limit.');
  const bytes = await readFile(file); checkedFiles.set(file, reviewedSha256(bytes)); return bytes;
}
const json = async (file: string) => JSON.parse((await checkedRead(file)).toString('utf8'));
const firstApproval = await json(firstApprovalFile), nextApproval = await json(nextApprovalFile);
const packetReference = await json(packetReferenceFile), priorPacket = await json(packetReference.privateArtifacts.reviewJson);
const priorEntries = new Map<string, { examplePath: string }>(priorPacket.entries.map((entry: { exampleId: string; examplePath: string }) => [entry.exampleId, entry]));
const selected = [...firstApproval.examples.map((entry: { exampleId: string; examplePath: string; exampleContentSha256: string }) => ({ id: entry.exampleId, file: entry.examplePath, sha256: entry.exampleContentSha256 })), ...nextApproval.inventoryExamples.map((entry: { exampleId: string; exampleContentSha256: string }) => ({ id: entry.exampleId, file: priorEntries.get(entry.exampleId)?.examplePath, sha256: entry.exampleContentSha256 }))];
assert.equal(selected.length, 30); assert.equal(new Set(selected.map(entry => entry.id)).size, 30);
const snapshot = `private/stage2-review/snapshot-${String(firstApproval.snapshotId).slice(0, 16)}/`;

type Quote = { field: string; start: number; end: number; quote: string; scope: 'exact_frozen_raw_record'; rawRecordSha256: string; capturePath: string; captureSha256: string; originalPointer: string };
type Property = { name: string; value: string; parameters: string; start: number; end: number };
type NativeRecord = {
  id: string; exampleId: string; familyId: string; exampleFile: string; exampleSha256: string; memberIndex: number;
  sourceId: string; opportunityNativeId: string; occurrenceNativeId: string; title: string; organizer: string | null;
  authorityUrl: string | null; startAt: string; endAt: string; sourceDate: string; sourceExplicitStatus: string | null;
  capturedAt: string; capturePath: string; captureSha256: string; captureNativeId: string; originalPointer: string; rawRecordSha256: string;
  originalNormalizedReference: { opportunity: ReviewedExample['members'][number]['silverLabels']['opportunity']; occurrence: ReviewedExample['members'][number]['silverLabels']['occurrences'][number] };
  sourceClaimHistory: object[]; evidence: Quote[];
};
const records: NativeRecord[] = [], unsupported: Array<{ exampleId: string; sourceId: string; reason: string }> = [];
function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function icsProperties(raw: string): Property[] {
  const lines: Array<{ text: string; start: number; end: number }> = []; let start = 0;
  for (const match of raw.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue;
    const text = match[0].replace(/[\r\n]+$/, ''), end = match.index! + text.length;
    if (/^[ \t]/.test(text) && lines.length) { lines.at(-1)!.text += text.slice(1); lines.at(-1)!.end = end; }
    else lines.push({ text, start: match.index!, end });
    start = end;
  }
  void start;
  return lines.flatMap(line => {
    let quoted = false, colon = -1;
    for (let i = 0; i < line.text.length; i++) { if (line.text[i] === '"') quoted = !quoted; if (!quoted && line.text[i] === ':') { colon = i; break; } }
    if (colon < 1) return [];
    const semicolon = line.text.slice(0, colon).indexOf(';');
    return [{ name: line.text.slice(0, semicolon < 0 ? colon : semicolon).toUpperCase(), value: line.text.slice(colon + 1), parameters: semicolon < 0 ? '' : line.text.slice(semicolon, colon), start: line.start, end: line.end }];
  });
}
const text = (value: string) => value.replace(/\\([nN,;\\])/g, (_, escaped: string) => /[nN]/.test(escaped) ? '\n' : escaped).trim();
function compactUtc(value: string | undefined) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); if (!match) return null;
  return instant(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
}
function authority(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'hq.fsu.edu' || url.pathname !== '/rsvp' || !/^\d+$/.test(url.searchParams.get('id') || '') || url.username || url.password) return null; return `https://hq.fsu.edu/rsvp?id=${url.searchParams.get('id')}`; } catch { return null; }
}
function jsonPointer(value: unknown, pointer: string) {
  assert.ok(pointer.startsWith('/'));
  return pointer.slice(1).split('/').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], value);
}
function quote(evidence: FrozenSourceEvidence, field: string, start: number, end: number): Quote {
  assert.ok(start >= 0 && end > start && end <= evidence.rawInput.length);
  return { field, start, end, quote: evidence.rawInput.slice(start, end), scope: 'exact_frozen_raw_record', rawRecordSha256: reviewedSha256(evidence.rawInput), capturePath: evidence.capturePath, captureSha256: evidence.bodySha256, originalPointer: evidence.originalPointer };
}
function jsonQuote(evidence: FrozenSourceEvidence, field: string, key: string, value: unknown) {
  const literal = JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${key}"\\s*:\\s*${literal}`).exec(evidence.rawInput);
  if (!match) throw new Error('Expected explicit native JSON property lacks an exact frozen quote.');
  return quote(evidence, field, match.index, match.index + match[0].length);
}
for (const reference of selected) {
  if (!reference.file?.startsWith(snapshot + 'examples/')) throw new Error('Approved example escaped the original development snapshot.');
  const bytes = await checkedRead(reference.file); assert.equal(reviewedSha256(bytes), reference.sha256);
  const example = JSON.parse(bytes.toString('utf8')) as ReviewedExample; assert.equal(example.exampleId, reference.id);
  for (const [memberIndex, member] of example.members.entries()) for (const occurrence of member.silverLabels.occurrences) {
    const evidence = member.evidence.find(evidence => occurrence.evidencePointer === evidence.originalPointer || occurrence.evidencePointer.startsWith(evidence.originalPointer + '/'));
    if (!evidence) { unsupported.push({ exampleId: reference.id, sourceId: member.sourceId, reason: 'No unique original source anchor for this occurrence.' }); continue; }
    if (!evidence.capturePath.startsWith(snapshot + 'captures/')) throw new Error('Original capture escaped development custody.');
    if (!captures.has(evidence.capturePath)) captures.set(evidence.capturePath, await checkedRead(evidence.capturePath));
    const capture = captures.get(evidence.capturePath)!; assert.equal(reviewedSha256(capture), evidence.bodySha256);
    let title: string, opportunityNativeId: string, occurrenceNativeId: string, startAt: string | null, endAt: string | null, sourceDate: string, organizer: string | null = null, authorityUrl: string | null, status: string | null = null;
    const proofs: Quote[] = [];
    if (member.sourceId === 'fsu-calendar-api' && evidence.contentType.includes('json')) {
      const raw = JSON.parse(evidence.rawInput);
      assert.deepEqual(jsonPointer(JSON.parse(capture.toString('utf8')), evidence.originalPointer), raw);
      const instance = raw.event_instances?.map((wrapped: { event_instance: { id: string | number; start: string; end?: string } }) => wrapped.event_instance).find((instance: { id: string | number }) => String(instance.id) === occurrence.nativeId);
      if (!instance) { unsupported.push({ exampleId: reference.id, sourceId: member.sourceId, reason: 'Native occurrence ID not found in the original JSON record.' }); continue; }
      title = raw.title; opportunityNativeId = String(raw.id); occurrenceNativeId = String(instance.id); startAt = instant(instance.start); endAt = instant(instance.end); sourceDate = String(instance.start).slice(0, 10); authorityUrl = authority(raw.url);
      proofs.push(jsonQuote(evidence, 'opportunity_native_id', 'id', raw.id), jsonQuote(evidence, 'occurrence_native_id', 'id', instance.id), jsonQuote(evidence, 'title', 'title', raw.title), jsonQuote(evidence, 'start', 'start', instance.start));
      if (instance.end) proofs.push(jsonQuote(evidence, 'end', 'end', instance.end));
      if (authorityUrl) proofs.push(jsonQuote(evidence, 'event_specific_authority_url', 'url', raw.url));
      // The JSON "live" field is publication visibility, not event lifecycle.
    } else if (member.sourceId === 'fsu-hq-public-export' && evidence.contentType.includes('calendar')) {
      assert.ok(capture.toString('utf8').includes(evidence.rawInput), 'Original ICS excerpt must occur verbatim inside its pinned full capture.');
      const props = icsProperties(evidence.rawInput), get = (name: string) => props.find(property => property.name === name);
      const uid = get('UID'), summary = get('SUMMARY'), begin = get('DTSTART'), end = get('DTEND'), url = get('URL'), host = get('ORGANIZER');
      if (!uid || !summary || !begin) { unsupported.push({ exampleId: reference.id, sourceId: member.sourceId, reason: 'Native UID/title/start absent from original ICS.' }); continue; }
      opportunityNativeId = occurrenceNativeId = uid.value; title = text(summary.value); startAt = compactUtc(begin.value); endAt = compactUtc(end?.value); sourceDate = `${begin.value.slice(0,4)}-${begin.value.slice(4,6)}-${begin.value.slice(6,8)}`; authorityUrl = authority(url?.value); status = get('STATUS')?.value || null;
      organizer = host ? host.parameters.match(/(?:^|;)CN=(?:"([^"]*)"|([^;]*))/)?.slice(1).find(Boolean)?.trim() || null : null;
      for (const [field, property] of [['occurrence_native_id', uid], ['title', summary], ['start', begin], ['end', end], ['event_specific_authority_url', url], ['organizer', host]] as const) if (property) proofs.push(quote(evidence, field, property.start, property.end));
    } else { unsupported.push({ exampleId: reference.id, sourceId: member.sourceId, reason: 'No independently explicit complete interval/native-ID route supported for this review packet.' }); continue; }
    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt) || !authorityUrl) { unsupported.push({ exampleId: reference.id, sourceId: member.sourceId, reason: 'A complete valid source interval and explicit event-specific HQ URL are required; partial/unknown values are not filled.' }); continue; }
    assert.equal(opportunityNativeId, member.silverLabels.opportunity.nativeId); assert.equal(occurrenceNativeId, occurrence.nativeId);
    assert.equal(instant(occurrence.startAt), startAt); assert.equal(instant(occurrence.endAt), endAt);
    const originalNormalizedReference = { opportunity: member.silverLabels.opportunity, occurrence };
    const id = evaluationSha256([member.sourceId, opportunityNativeId, occurrenceNativeId, evidence.bodySha256, evidence.originalPointer]);
    records.push({ id, exampleId: reference.id, familyId: example.familyId, exampleFile: reference.file, exampleSha256: reference.sha256, memberIndex, sourceId: member.sourceId, opportunityNativeId, occurrenceNativeId, title, organizer, authorityUrl, startAt, endAt, sourceDate, sourceExplicitStatus: status, capturedAt: evidence.fetchedAt, capturePath: evidence.capturePath, captureSha256: evidence.bodySha256, captureNativeId: occurrence.captureNativeId, originalPointer: evidence.originalPointer, rawRecordSha256: reviewedSha256(evidence.rawInput), originalNormalizedReference,
      sourceClaimHistory: [{ sourceId: member.sourceId, opportunityNativeId, occurrenceNativeId, sourcePublishedAt: member.silverLabels.opportunity.sourcePublishedAt, sourceUpdatedAt: member.silverLabels.opportunity.sourceUpdatedAt, captureNativeId: occurrence.captureNativeId, capturedAt: evidence.fetchedAt, captureSha256: evidence.bodySha256, opportunityContentSha256: member.silverLabels.opportunity.contentSha256, occurrenceContentSha256: occurrence.contentSha256, evidencePointer: occurrence.evidencePointer, note: 'One retained captured version only; not an exhaustive production claim/version history.' }], evidence: proofs });
  }
}
type Proposal = { left: NativeRecord; right: NativeRecord; proposed: 'same_occurrence' | 'separate_occurrences'; reason: string; category: string };
const positives: Proposal[] = [], negatives: Proposal[] = [];
let differentClubCandidates = 0;
for (let a = 0; a < records.length; a++) for (let b = a + 1; b < records.length; b++) {
  const left = records[a], right = records[b];
  if (left.title.trim().toLowerCase() === right.title.trim().toLowerCase() && left.organizer && right.organizer && left.organizer !== right.organizer) differentClubCandidates++;
  if (left.sourceId === right.sourceId) continue;
  if (left.authorityUrl === right.authorityUrl && left.startAt === right.startAt && left.endAt === right.endAt) positives.push({ left, right, proposed: 'same_occurrence', category: 'cross_source_explicit_authority_link_and_identical_interval', reason: 'Two different source-native identities cite the same event-specific HQ URL and exactly equal independently parsed source instants. Title similarity is not used as the identity proof.' });
  else if (left.title.trim().toLowerCase() === right.title.trim().toLowerCase() && left.authorityUrl !== right.authorityUrl && (Date.parse(left.endAt) <= Date.parse(right.startAt) || Date.parse(right.endAt) <= Date.parse(left.startAt))) negatives.push({ left, right, proposed: 'separate_occurrences', category: 'same_title_different_explicit_event_ids_and_disjoint_intervals', reason: 'The title repeats, but both explicit event-specific HQ IDs and source intervals differ. These are proposed separate occurrence identities; organizer/series identities may still be related.' });
}
const pairKey = (proposal: Proposal) => evaluationSha256([proposal.left.id, proposal.right.id, proposal.proposed]);
positives.sort((a,b) => pairKey(a).localeCompare(pairKey(b)));
negatives.sort((a,b) => Math.abs(Date.parse(a.left.startAt) - Date.parse(a.right.startAt)) - Math.abs(Date.parse(b.left.startAt) - Date.parse(b.right.startAt)) || pairKey(a).localeCompare(pairKey(b)));
const negativeFamilies = new Map<string, number>();
const selectedNegatives = negatives.filter(proposal => { const family = [proposal.left.familyId, proposal.right.familyId].sort().join('|'), count = negativeFamilies.get(family) || 0; if (count >= 2) return false; negativeFamilies.set(family, count + 1); return true; }).slice(0, 4);
const chosen = [...positives.slice(0, 6), ...selectedNegatives];
const preservationExpectations = {
  nativeAndCatalogIdentities: 'Keep both source IDs, opportunity native IDs, occurrence native IDs, their existing database IDs if present, content/version hashes and source pointers. No deletion, rekeying or physical entity collapse.',
  sourceClaimsAndVersions: 'Preserve all captured source claims/versions, differing titles/venues/status evidence and original field pointers. A relation does not choose a source fact as canonical truth. Reject stale confirmation if either current source fingerprint changed.',
  reviewDecisions: 'Keep each occurrence save/pass action and revision exactly where recorded. Conflicting decisions remain separately visible. Do not propagate or backfill decisions from a relation.',
  calendarApprovals: 'Keep existing approval command IDs, generations, snapshots, payloads and Google event IDs unchanged. A relation itself creates no calendar item. If either confirmed alias already has an approval, reject a second approval; if both have existing approvals, require review rather than deleting either.',
  relationLifecycle: 'Only a later explicit owner decision could add a reversible relation plus history. Confirm/reject/revoke records must be audited. Revoking a relation never deletes source records or calendar events.',
  inspectedProductionState: false, actualPairSpecificDecisionsOrApprovalsLoaded: false,
};
const pairs = chosen.map(proposal => {
  const before = [proposal.left, proposal.right].map(record => ({ sourceId: record.sourceId, opportunityNativeId: record.opportunityNativeId, occurrenceNativeId: record.occurrenceNativeId, captureNativeId: record.captureNativeId, captureSha256: record.captureSha256, rawRecordSha256: record.rawRecordSha256, sourcePointer: record.originalPointer, originalNormalizedReference: record.originalNormalizedReference }));
  return { id: 'real-reconcile-' + pairKey(proposal).slice(0, 16), scope: 'previously_exposed_approved_development_only', labelStatus: 'proposal_unreviewed_not_human_label', proposedRelation: proposal.proposed, category: proposal.category, reason: proposal.reason, left: proposal.left, right: proposal.right, identitiesBefore: before, expectedIdentitiesAfterAnyRelationReview: structuredClone(before), identityBeforeAfterSha256: evaluationSha256(before), preservationExpectations, review: { decision: null, reviewer: null, reviewedAt: null, sourceIdentityChecked: null, intervalChecked: null, organizerAndPerformanceChecked: null, conflictingClaimsChecked: null, preservationExpectationsChecked: null, corrections: null } };
});
for (const pair of pairs) { assert.deepEqual(pair.identitiesBefore, pair.expectedIdentitiesAfterAnyRelationReview); assert.equal(pair.review.decision, null); assert.equal(pair.left.sourceId === pair.right.sourceId, false); }
for (const [file, sha256] of checkedFiles) assert.equal(reviewedSha256(await readFile(file)), sha256, 'An original approved development artifact changed.');
const packetId = evaluationSha256({ version, approvals: [checkedFiles.get(firstApprovalFile), checkedFiles.get(nextApprovalFile)], pairs, checkedFiles: [...checkedFiles] });
const directory = `private/stage2-reconciliation-review/${packetId.slice(0,16)}`;
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
async function frozen(file: string, content: string) {
  try { await writeFile(file, content, { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(file, 'utf8') !== content) throw new Error('Existing review packet differs; never overwrite human review.'); }
  await chmod(file, 0o600);
}
const packet = { version, packetId, allDevelopment: true, acceptedHumanPairLabels: 0, selectedApprovedExamples: selected.map(reference => ({ exampleId: reference.id, exampleFile: reference.file, sha256: reference.sha256 })), pairs, preservationExpectations, coverageGaps: ['No same-title/different-club hard negative can be asserted from this bounded approved set unless explicitly present; no fabricated clubs or pairs are added.', 'Date-only/unknown-time sources cannot prove identical instants and are excluded from strong positives.', 'These pairs cluster within three previously exposed source families and are not an acceptance holdout or a representative merge benchmark.', 'Native source status and local date may differ from older normalized references; original facts are preserved, not silently harmonized.', 'No actual decision/approval associations or exhaustive historical claims were queried; the preservation checklist is an expectation for later testing.'], sourceFilesVerifiedUnchanged: [...checkedFiles].map(([file, sha256]) => ({ file, sha256 })), runtimeChanged: false, holdoutRead: false };
await frozen(`${directory}/packet.json`, JSON.stringify(packet, null, 2) + '\n');
const escape = (value: unknown) => String(value ?? 'unknown').replaceAll('|','\\|').replaceAll('\n',' ');
const fileLink = (label: string, file: string) => `[${label}](<${path.resolve(file)}>)`;
const markdown = ['# Real development reconciliation review', '', 'These are source-backed proposals from the 30 already approved development examples. Every pair decision is blank. Prior extraction/reference approval does not approve these relations or calendar actions.', '', 'For each pair choose **same occurrence**, **separate occurrences**, or **needs more evidence**. Check each original native identity/link, literal start/end and timezone, organizer/performance, conflicting source facts, and the preservation checklist. Record corrections and supporting source quote. Status is not inferred from publication visibility or missing STATUS.', '', 'Reviewer: ______  Confirmation time: ______', '', ...pairs.flatMap(pair => [
  `## ${pair.id}`, '', `Proposed: ${pair.proposedRelation.replaceAll('_',' ')}. This is not a human label.`, pair.reason, '', 'Decision: ______  Corrections / quote: ______', '', '| Side | Source | Title | Source start → end (UTC conversion) | Explicit event URL |', '| --- | --- | --- | --- | --- |', ...[pair.left, pair.right].map((record,index) => `| ${index ? 'Right' : 'Left'} | ${escape(record.sourceId)} | ${escape(record.title)} | ${escape(record.startAt)} → ${escape(record.endAt)} | ${escape(record.authorityUrl)} |`), '',
  ...[pair.left,pair.right].flatMap((record,index) => [`### ${index ? 'Right' : 'Left'} original identity`, '', `Opportunity native ID: ${record.opportunityNativeId}`, `Occurrence native ID: ${record.occurrenceNativeId}`, `Organizer if explicitly quoted: ${record.organizer || 'unknown'}`, `Literal source date: ${record.sourceDate}; explicit source STATUS: ${record.sourceExplicitStatus || 'not stated'}.`, `Capture: ${record.capturedAt}; SHA-256 ${record.captureSha256}`, `Original pointer: ${record.originalPointer}; exact frozen record SHA-256 ${record.rawRecordSha256}`, fileLink('Frozen full source capture',record.capturePath), fileLink('Approved original example and unchanged normalized references',record.exampleFile), '', ...record.evidence.flatMap(evidence => [`${evidence.field}, exact frozen-record offsets ${evidence.start}–${evidence.end}:`, '```text', evidence.quote, '```', ''])]),
  '### Required preservation checks', '', '- Both native/source/catalog identities and all source versions/claims remain unchanged.', '- Save/pass decisions stay on their original occurrences, including conflicts.', '- Approval command IDs, snapshots and existing Google event payloads remain unchanged; a relation creates nothing in Calendar.', '- Confirmed aliases cannot receive a second Calendar approval. Two existing approvals require review; neither is automatically deleted.', '- A changed source fingerprint blocks stale confirmation. Confirm/reject/revoke keeps history and never physically collapses source records.', '', `Exact full identity snapshots are retained in packet.json; before/expected-after SHA-256 ${pair.identityBeforeAfterSha256}.`, '',
]), '## Limits', '', ...packet.coverageGaps.map(gap => '- ' + gap), '', 'The existing 12 synthetic reconciliation cases remain synthetic and were not opened, relabeled or used as real review evidence.', ''];
await frozen(`${directory}/review.md`, markdown.join('\n'));
const selectedRecords = new Set(pairs.flatMap(pair => [pair.left.id,pair.right.id]));
const publicManifest = { schemaVersion: 1, recordedAt: new Date().toISOString(), command: 'node --import tsx scripts/prepare-stage2-real-reconciliation-review.ts', version, packetId, sourceSha256: reviewedSha256(await readFile(import.meta.filename)), status: 'real_development_pair_proposals_ready_zero_human_pair_labels', counts: { approvedDevelopmentExamplesAllowed: 30, explicitCompleteNativeRecordsAvailable: records.length, strongPositiveCandidatePool: positives.length, differentOccurrenceNegativeCandidatePool: negatives.length, differentClubCandidatePool: differentClubCandidates, selectedPairs: pairs.length, sameOccurrenceProposals: pairs.filter(pair => pair.proposedRelation === 'same_occurrence').length, separateOccurrenceProposals: pairs.filter(pair => pair.proposedRelation === 'separate_occurrences').length, selectedNativeRecords: selectedRecords.size, selectedFrozenFamilies: new Set(pairs.flatMap(pair => [pair.left.familyId,pair.right.familyId])).size, verifiedOriginalCaptures: captures.size, humanPairLabels: 0, syntheticPairsAdded: 0 }, privateArtifacts: { directory, packet: `${directory}/packet.json`, review: `${directory}/review.md`, packetSha256: reviewedSha256(await readFile(`${directory}/packet.json`)), reviewSha256: reviewedSha256(await readFile(`${directory}/review.md`)), fileMode: '0600', directoryMode: '0700' }, pairs: pairs.map(pair => ({ id: pair.id, proposedRelation: pair.proposedRelation, category: pair.category, leftIdentitySha256: pair.left.id, rightIdentitySha256: pair.right.id, beforeAfterIdentitySnapshotSha256: pair.identityBeforeAfterSha256, humanDecision: null })), excludedOrUnsupportedRecords: unsupported, coverageGaps: packet.coverageGaps, originalSourceAndLabelFilesChanged: false, existingSyntheticCasesOpened: false, existingSyntheticCasesRelabeled: false, runtimeFilesChanged: false, currentValidationChanged: false, providerCalls: 0, databaseCalls: 0, calendarCalls: 0, modelCalls: 0, holdoutRead: false, stage2Accepted: false, realReconciliationAccuracyEstablished: false };
await writeFile('reports/stage-2-real-reconciliation-review-packet.json', JSON.stringify(publicManifest, null, 2) + '\n');
console.log(JSON.stringify({ report: 'reports/stage-2-real-reconciliation-review-packet.json', review: path.resolve(`${directory}/review.md`), ...publicManifest.counts, stage2Accepted: false }));
