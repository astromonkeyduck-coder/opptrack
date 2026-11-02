/** File-only inventory of existing permitted public captures. No HTTP, credentials or database access. */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { validateCollectionBatch } from '../lib/collection';
import type { CollectionBatch, NormalizedOpportunity, RawPage } from '../lib/collection/types';

const VERSION = 'stage2-public-review-inventory-v1';
const sources = [
  { file: 'private/stage1-reingestion-live/fsu-calendar-api.json', id: 'fsu-calendar-api', quota: 35 },
  { file: 'private/stage1-reingestion-live/fsu-music-events.json', id: 'fsu-music-events', quota: 10 },
  { file: 'private/hq-live/latest.json', id: 'fsu-hq-public-export', quota: 25 },
  { file: 'private/official-deadlines-live/fsu-cre-applications-latest.json', id: 'fsu-cre-applications', quota: 10 },
  { file: 'private/official-deadlines-live/fsu-career-deadlines-latest.json', id: 'fsu-career-deadlines', quota: 1 },
  { file: 'private/official-deadlines-live/fsu-onf-dates-latest.json', id: 'fsu-onf-dates', quota: 10 },
  { file: 'private/official-tickets-live/latest.json', id: 'fsu-opening-nights', quota: 9 },
] as const;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const escapeCsv = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const markdownCode = (value: string) => value.split('\n').map(line => '    ' + line).join('\n');

type CaptureEvidence = { pointer: string; capture: RawPage; rawInput: string; excerptMethod: string };
type Member = { batch: CollectionBatch; file: string; opportunity: NormalizedOpportunity; identity: string; organizer: string | null; organizerBasis: string; links: string[]; category: string; evidence: CaptureEvidence[] };
function sourcePage(batch: CollectionBatch, nativeId: string): RawPage {
  const page = batch.pages.find(item => item.nativeId === nativeId); if (!page) throw new Error('A source label has no matching original capture.'); return page;
}
function resolvePointer(body: string, pointer: string): unknown {
  let value: unknown = JSON.parse(body);
  for (const segment of pointer.slice(1).split('/')) value = (value as Record<string, unknown>)?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
  if (value === undefined) throw new Error('An original JSON pointer did not resolve.'); return value;
}
function icsEvent(body: string, pointer: string): string {
  const match = /^ics-vevent:(\d+)$/.exec(pointer); if (!match) throw new Error('Invalid original VEVENT pointer.');
  const events = [...body.matchAll(/^BEGIN:VEVENT\r?\n[\s\S]*?^END:VEVENT\r?$/gm)];
  const value = events[Number(match[1])]?.[0]; if (!value) throw new Error('Original VEVENT did not resolve.'); return value;
}
function evidenceFor(batch: CollectionBatch, opportunity: NormalizedOpportunity): CaptureEvidence[] {
  const page = sourcePage(batch, opportunity.captureNativeId), pointer = opportunity.evidencePointer;
  if (pointer.startsWith('/')) return [{ pointer, capture: page, rawInput: JSON.stringify(resolvePointer(page.body, pointer), null, 2), excerptMethod: 'Original JSON value resolved by its recorded JSON pointer; full original body frozen separately.' }];
  if (pointer.startsWith('ics-vevent:')) return [{ pointer, capture: page, rawInput: icsEvent(page.body, pointer), excerptMethod: 'Exact original VEVENT block at the recorded event index; no new source read.' }];
  if (batch.sourceId === 'fsu-cre-applications') {
    const envelope = JSON.parse(page.body) as { results: Array<{ id: number }> };
    const native = envelope.results.find(row => String(row.id) === opportunity.nativeId); if (!native) throw new Error('Original CRE program did not resolve.');
    return [{ pointer, capture: page, rawInput: JSON.stringify(native, null, 2), excerptMethod: 'Original public JSON directory program selected by native ID; full envelope frozen separately.' }];
  }
  const $ = load(page.body);
  if (batch.sourceId === 'fsu-music-events') {
    const links = $('a[href]').filter((_, node) => {
      try { return new URL($(node).attr('href')!, page.url).href === opportunity.sourceUrl && clean($(node).text()) === opportunity.title; } catch { return false; }
    });
    if (!links.length) throw new Error('Original Music title/link did not resolve.');
    let region = links.first().parent();
    for (let depth = 0; depth < 5; depth++) {
      if (/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\s+\d{1,2}:\d{2}\s*[ap]m\b/i.test(clean(region.text()))) break;
      region = region.parent();
    }
    const raw = $.html(region); if (!raw) throw new Error('Original Music card region is unavailable.');
    return [{ pointer, capture: page, rawInput: raw, excerptMethod: 'DOM-serialized original card region around the exact title/link; not a byte-identical HTML substring.' }];
  }
  if (batch.sourceId === 'fsu-onf-dates') {
    const publisherId = opportunity.nativeId.split(':').at(-1)!;
    const row = $('li[data-list-item-id]').filter((_, node) => $(node).attr('data-list-item-id') === publisherId);
    const heading = $('h1,h2,h3,h4,h5,h6').filter((_, node) => /FELLOWSHIP DEADLINES/.test($(node).text())).first();
    if (row.length !== 1) throw new Error('Original ONF row did not resolve.');
    return [{ pointer, capture: page, rawInput: $.html(heading) + '\n' + $.html(row), excerptMethod: 'DOM-serialized publisher cycle heading and exact native list item; unspecified deadline year/time remains unspecified.' }];
  }
  if (batch.sourceId === 'fsu-career-deadlines') {
    const heading = $('h4').filter((_, node) => /^(Spring|Summer|Fall) 20\d{2} Hiring Timeline$/i.test(clean($(node).text())));
    const table = heading.next('div').find('table'); if (heading.length !== 1 || table.length !== 1) throw new Error('Original Career timeline did not resolve.');
    return [{ pointer, capture: page, rawInput: $.html(heading) + '\n' + $.html(table), excerptMethod: 'DOM-serialized original hiring-cycle heading/table; employer and student actions have not been re-labeled by this command.' }];
  }
  if (batch.sourceId === 'fsu-opening-nights') {
    const card = $('main .highlight-card').filter((_, node) => {
      try { return new URL($(node).find('a.highlight-card-link').attr('href')!, page.url).href === opportunity.sourceUrl; } catch { return false; }
    });
    if (card.length !== 1) throw new Error('Original Opening Nights listing card did not resolve.');
    const evidence: CaptureEvidence[] = [{ pointer, capture: page, rawInput: $.html(card), excerptMethod: 'DOM-serialized original listing card; precise event clock/end and ticket inventory are not inferred.' }];
    const milestones = (batch.milestones ?? []).filter(item => item.opportunityNativeId === opportunity.nativeId);
    for (const milestone of milestones) {
      const detail = sourcePage(batch, milestone.captureNativeId), $$ = load(detail.body);
      evidence.push({ pointer: milestone.evidencePointer, capture: detail, rawInput: $$.html($$('main .dr-show-hero-copy')) + '\n' + $$.html($$('main .dr-show-hero-actions')), excerptMethod: 'DOM-serialized captured detail title and ticket-action region. A link is not verified inventory; missing sale timezone stays unknown.' });
    }
    return evidence;
  }
  throw new Error('This file-only inventory does not support an unapproved source.');
}
function organizerFor(batch: CollectionBatch, evidence: CaptureEvidence[]): { value: string | null; basis: string } {
  if (batch.sourceId === 'fsu-calendar-api') {
    const event = obj(JSON.parse(evidence[0].rawInput));
    const filters = obj(event?.filters);
    for (const key of ['organizers', 'groups', 'departments']) {
      const values = event?.[key] ?? filters?.[key];
      if (Array.isArray(values)) {
        const names = values.map(value => typeof value === 'string' ? value : obj(value)?.name ?? obj(value)?.title).filter((value): value is string => typeof value === 'string' && !!value.trim());
        if (names.length) return { value: unique(names).join(' | '), basis: `provisional publisher ${key} metadata; not independently adjudicated organizer authority` };
      }
    }
  }
  if (batch.sourceId === 'fsu-hq-public-export') {
    const unfolded = evidence[0].rawInput.replace(/\r?\n[ \t]/g, '');
    const name = /^ORGANIZER[^:\r\n]*;CN=(?:"([^"]+)"|([^;:\r\n]+))[^:\r\n]*:/im.exec(unfolded);
    if (name) return { value: name[1] || name[2], basis: 'provisional literal ICS organizer CN; not human adjudicated' };
  }
  return { value: null, basis: 'organizer unresolved; native source opportunity namespace is provisional family identity' };
}
function unique(values: string[]) { return [...new Set(values)].sort(); }
function strongEventLinks(opportunity: NormalizedOpportunity, evidence: CaptureEvidence[]): string[] {
  const links: string[] = [];
  const possible = [opportunity.sourceUrl, ...(opportunity.description || '').match(/https:\/\/hq\.fsu\.edu\/rsvp\?id=\d+/g) || []];
  for (const value of possible) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      if (!(/^calendar\.fsu\.edu$/.test(url.hostname) && /^\/event\/[^/]+\/?$/.test(url.pathname) || url.hostname === 'hq.fsu.edu' && url.pathname === '/rsvp' && /^\d+$/.test(url.searchParams.get('id') || '') || url.hostname === 'music.fsu.edu' && /^\/event\/[^/]+\/?$/.test(url.pathname) || url.hostname === 'www.openingnights.fsu.edu' && /^\/show-details\/[^/]+$/.test(url.pathname))) continue;
      for (const name of [...url.searchParams.keys()]) if (name.startsWith('utm_')) url.searchParams.delete(name);
      url.hash = ''; url.pathname = url.pathname.replace(/\/$/, ''); links.push(url.href);
    } catch { /* An unverified link supplies no family evidence. */ }
  }
  return unique(links);
}
function category(opportunity: NormalizedOpportunity): string {
  const text = `${opportunity.title} ${opportunity.description ?? ''} ${opportunity.categories.join(' ')}`;
  const groups: Array<[string, RegExp]> = [
    ['outdoors_recreation', /kayak|hiking|outdoor|camping|paddl|recreation|sports|fitness/i],
    ['film_cinema', /cinema|screening|\bfilm\b|movie/i],
    ['music_performance', /recital|concert|jazz|orchestra|ensemble|music|opera|dance|performance/i],
    ['social_clubs', /\bGBM\b|general body|game night|social|club|student union|homecoming|trivia|fundrais|celebrat|poetry|cultural/i],
    ['career_employer', /career|employer|intern|recruit|resume|graduate.*fair|law school.*fair|hiring/i],
    ['fellowship_scholarship', /fellowship|scholarship|fulbright|rhodes|goldwater|bore(n|d)|gates cambridge|gilman/i],
    ['research_academic', /research|\bUROP\b|defense|dissertation|thesis|grant|academic|seminar|writing|library/i],
    ['speaker_policy', /speaker|lecture|\btalk\b|policy|econom|law|forum|symposium|roundtable/i],
    ['arts_exhibition', /gallery|museum|exhibit|arts|artist/i],
  ];
  return groups.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other_campus_exploration';
}

const batches: Array<{ file: string; fileSha256: string; batch: CollectionBatch; quota: number }> = [];
for (const source of sources) {
  if ((await stat(source.file)).size > 25 * 1024 * 1024) throw new Error('Existing public capture batch exceeds the bounded review-input limit.');
  const raw = await readFile(source.file);
  const batch = validateCollectionBatch(JSON.parse(raw.toString('utf8')));
  if (batch.sourceId !== source.id || batch.status !== 'success' || !batch.observations.paginationComplete) throw new Error('A complete successful existing public capture is required; failure is not an empty review source.');
  for (const page of batch.pages) if (page.httpStatus !== 200 || hash(page.body) !== page.sha256 || Buffer.byteLength(page.body) !== page.byteCount) throw new Error('An original public response failed its stored hash/byte metadata.');
  batches.push({ file: source.file, fileSha256: hash(raw), batch, quota: source.quota });
}
const members: Member[] = [];
for (const source of batches) for (const opportunity of source.batch.opportunities) {
  const evidence = evidenceFor(source.batch, opportunity), organizer = organizerFor(source.batch, evidence);
  members.push({ batch: source.batch, file: source.file, opportunity, identity: `${source.batch.sourceId}:${opportunity.nativeId}`, organizer: organizer.value, organizerBasis: organizer.basis, links: strongEventLinks(opportunity, evidence), category: category(opportunity), evidence });
}

const parents = members.map((_, index) => index);
function find(index: number): number { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; }
function union(a: number, b: number) { const left = find(a), right = find(b); if (left !== right) parents[Math.max(left, right)] = Math.min(left, right); }
const identityIndexes = new Map<string, number>(), linkIndexes = new Map<string, number>(), organizerTitles = new Map<string, number>();
for (const [index, member] of members.entries()) {
  if (identityIndexes.has(member.identity)) union(index, identityIndexes.get(member.identity)!); else identityIndexes.set(member.identity, index);
  for (const link of member.links) { if (linkIndexes.has(link)) union(index, linkIndexes.get(link)!); else linkIndexes.set(link, index); }
  if (member.organizer) {
    const key = clean(member.organizer).toLowerCase() + '|' + clean(member.opportunity.title).toLowerCase();
    if (organizerTitles.has(key)) union(index, organizerTitles.get(key)!); else organizerTitles.set(key, index);
  }
}
const groups = new Map<number, Member[]>();
for (const [index, member] of members.entries()) { const root = find(index); groups.set(root, [...groups.get(root) ?? [], member]); }
const familyFor = new Map(members.map((member, index) => [member.identity, hash(unique(groups.get(find(index))!.map(item => item.identity)).join('\n'))]));
const groupFor = new Map([...groups.values()].map(group => [familyFor.get(group[0].identity)!, group]));
const selected: Member[] = [], selectedFamilies = new Set<string>();
const priority = ['fsu-career-deadlines', 'fsu-music-events', 'fsu-cre-applications', 'fsu-onf-dates', 'fsu-opening-nights', 'fsu-hq-public-export', 'fsu-calendar-api'];
for (const sourceId of priority) {
  const quota = sources.find(source => source.id === sourceId)!.quota;
  const pool = members.filter(member => member.batch.sourceId === sourceId).sort((a, b) => hash(a.identity).localeCompare(hash(b.identity)));
  const categories = unique(pool.map(item => item.category)); let added = 0;
  while (added < quota) {
    let changed = false;
    for (const name of categories) {
      const next = pool.find(item => item.category === name && !selectedFamilies.has(familyFor.get(item.identity)!));
      if (!next) continue;
      selected.push(next); selectedFamilies.add(familyFor.get(next.identity)!); added++; changed = true;
      if (added === quota) break;
    }
    if (!changed) throw new Error(`The existing source cannot supply the requested distinct-family quota: ${sourceId}.`);
  }
}
if (selected.length !== 100 || selectedFamilies.size !== 100) throw new Error('The review inventory did not achieve exactly 100 distinct provisional opportunity families.');

const snapshotId = hash(JSON.stringify({ version: VERSION, batches: batches.map(source => [source.batch.sourceId, source.fileSha256]), selected: selected.map(member => member.identity) }));
const directory = `private/stage2-review/snapshot-${snapshotId.slice(0, 16)}`;
for (const child of ['private/stage2-review', directory, `${directory}/captures`, `${directory}/examples`]) { await mkdir(child, { recursive: true, mode: 0o700 }); await chmod(child, 0o700); }
async function frozenWrite(file: string, value: string) {
  try { await writeFile(file, value, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await readFile(file, 'utf8')) !== value) throw new Error('A frozen review artifact already exists with different content; preserve it and use a new inventory version.'); }
  await chmod(file, 0o600);
}
const captures = new Map<string, { sourceId: string; page: RawPage; path: string }>();
const examples: Array<{ id: string; familyId: string; primarySource: string; category: string; path: string; contentSha256: string; provisionalFamily: boolean; memberCount: number; occurrenceCount: number; actionCount: number; organizer: string | null }> = [];
for (const [index, primary] of selected.entries()) {
  const familyId = familyFor.get(primary.identity)!, familyMembers = groupFor.get(familyId)!;
  const id = `public-review-${String(index + 1).padStart(3, '0')}-${familyId.slice(0, 10)}`;
  const recordMembers = [];
  for (const member of familyMembers) {
    const evidence = [];
    for (const reference of member.evidence) {
      const key = `${member.batch.sourceId}:${reference.capture.sha256}`;
      let capture = captures.get(key);
      if (!capture) {
        const extension = reference.capture.contentType.includes('json') ? 'json' : reference.capture.contentType.includes('calendar') ? 'ics' : 'html';
        const capturePath = `${directory}/captures/${member.batch.sourceId}-${reference.capture.sha256}.${extension}`;
        await frozenWrite(capturePath, reference.capture.body);
        capture = { sourceId: member.batch.sourceId, page: reference.capture, path: capturePath }; captures.set(key, capture);
      }
      evidence.push({ capturePath: capture.path, sourceUrl: reference.capture.url, fetchedAt: reference.capture.fetchedAt, contentType: reference.capture.contentType, bodySha256: reference.capture.sha256, byteCount: reference.capture.byteCount, httpStatus: reference.capture.httpStatus, originalPointer: reference.pointer, excerptMethod: reference.excerptMethod, rawInput: reference.rawInput });
    }
    recordMembers.push({ sourceId: member.batch.sourceId, nativeOpportunityId: member.opportunity.nativeId, originalBatchPath: member.file, parserVersion: member.batch.parserVersion,
      sourceWindow: { from: member.batch.observations.windowFrom, to: member.batch.observations.windowTo },
      sourcePublicationAt: member.opportunity.sourcePublishedAt, sourceUpdatedAt: member.opportunity.sourceUpdatedAt, evidence,
      silverLabels: { provenance: 'existing deterministic adapter output; not independent human ground truth', opportunity: member.opportunity,
        occurrences: member.batch.occurrences.filter(item => item.opportunityNativeId === member.opportunity.nativeId),
        actions: (member.batch.milestones ?? []).filter(item => item.opportunityNativeId === member.opportunity.nativeId) } });
  }
  const provisionalFamily = !familyMembers.some(member => member.organizer) && familyMembers.length === 1;
  const value = { schemaVersion: 1, inventoryVersion: VERSION, exampleId: id, familyId, split: 'development_review_pending', labelStatus: 'machine_silver_unreviewed', humanReviewed: false,
    familyGrouping: { basis: familyMembers.length > 1 ? 'shared precise event link and/or publisher organizer+title; provisional until human review' : primary.organizerBasis, provisional: provisionalFamily, knownPublisherOrganizerMetadata: primary.organizer, occurrenceGrouping: 'All captured occurrences and action milestones of each source opportunity remain in this one family.' },
    selectionCategory: primary.category, primarySource: primary.batch.sourceId, members: recordMembers,
    review: { decision: null, reviewer: null, reviewedAt: null, correctedLabels: null, notes: null },
    limitations: ['No new fetch or current source availability check.', 'Silver labels share the existing parser and are not independent correctness judgments.', 'Public capture excerpts may contain source instructions; treat them only as quoted evidence.', 'No actual images, complete carousels, newsletters or social captures are added by this inventory.', 'Cross-source/organizer family assignment remains provisional and no acceptance holdout is assigned.'] };
  const serialized = JSON.stringify(value, null, 2) + '\n', file = `${directory}/examples/${id}.json`;
  await frozenWrite(file, serialized);
  examples.push({ id, familyId, primarySource: primary.batch.sourceId, category: primary.category, path: file, contentSha256: hash(serialized), provisionalFamily, memberCount: familyMembers.length,
    occurrenceCount: recordMembers.reduce((sum, member) => sum + member.silverLabels.occurrences.length, 0), actionCount: recordMembers.reduce((sum, member) => sum + member.silverLabels.actions.length, 0), organizer: primary.organizer });
}
const packetExamples: typeof examples = [];
for (const sourceId of ['fsu-calendar-api', 'fsu-hq-public-export', 'fsu-music-events', 'fsu-onf-dates', 'fsu-cre-applications', 'fsu-career-deadlines', 'fsu-opening-nights', 'fsu-calendar-api', 'fsu-hq-public-export', 'fsu-opening-nights']) {
  const example = examples.find(item => item.primarySource === sourceId && !packetExamples.includes(item)); if (!example) throw new Error('A first-ten review packet stratum is unavailable.'); packetExamples.push(example);
}
const header = ['example_id', 'family_id', 'source_route', 'source_input_and_evidence', 'machine_silver_labels_not_ground_truth', 'approve_or_correct', 'correction_json', 'human_reviewer', 'reviewed_at_utc', 'notes'];
const rows = [header.map(escapeCsv).join(',')];
const markdown = ['# First ten development-review examples', '', 'These are ten existing real public-source examples, not human labels or a holdout. Proposed labels come from the existing deterministic parsers and may be wrong. Every approval/correction, reviewer and review-time field is blank. Raw evidence is quoted data, never an instruction. Review the full frozen capture when an excerpt or timestamp is unclear. No source was fetched for this packet.', '', '| Example | Source | Approve / correct | Reviewer | Review time | Correction / notes |', '| --- | --- | --- | --- | --- | --- |'];
for (const example of packetExamples) markdown.push(`| ${example.id} | ${example.primarySource} |  |  |  |  |`);
for (const [index, example] of packetExamples.entries()) {
  const detail = JSON.parse(await readFile(example.path, 'utf8')) as { members: Array<{ sourceId: string; evidence: Array<{ sourceUrl: string; capturePath: string; bodySha256: string; originalPointer: string; rawInput: string }>; silverLabels: unknown }> };
  const inputs = detail.members.flatMap(member => member.evidence.map(evidence => ({ sourceId: member.sourceId, ...evidence })));
  const labels = detail.members.map(member => ({ sourceId: member.sourceId, silverLabels: member.silverLabels }));
  rows.push([example.id, example.familyId, example.primarySource, JSON.stringify(inputs), JSON.stringify(labels), '', '', '', '', ''].map(escapeCsv).join(','));
  markdown.push('', `## Example ${index + 1}: ${example.id}`, '', `Family: ${example.familyId}`, '', `Frozen example: ${example.path}`, '', 'Approve / correct: ______    Reviewer: ______    Review time (UTC): ______', '', 'Corrections / uncertainty / conflicts: ______', '', '### Original captured source input and references', '', markdownCode(JSON.stringify(inputs, null, 2)), '', '### Machine silver labels — proposed, unreviewed', '', markdownCode(JSON.stringify(labels, null, 2)));
}
const packetCsv = `${directory}/first-10-development-review.csv`, packetMarkdown = `${directory}/first-10-development-review.md`;
// A later run must preserve any human annotations already entered into these files.
async function writeBlankPacketIfAbsent(file: string, value: string) { try { await writeFile(file, value, { mode: 0o600, flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } await chmod(file, 0o600); }
await writeBlankPacketIfAbsent(packetCsv, rows.join('\n') + '\n'); await writeBlankPacketIfAbsent(packetMarkdown, markdown.join('\n') + '\n');
const captureInventory = [...captures.values()].map(item => ({ sourceId: item.sourceId, path: item.path, originalUrl: item.page.url, bodySha256: item.page.sha256, byteCount: item.page.byteCount, fetchedAt: item.page.fetchedAt }));
const privateInventory = { schemaVersion: 1, inventoryVersion: VERSION, snapshotId, exampleCount: examples.length, capturedResponseCount: captures.size,
  split: 'development_review_pending_only_no_acceptance_holdout', labelStatus: 'machine_silver_unreviewed', captures: captureInventory, examples, humanReviewPacket: { csv: packetCsv, markdown: packetMarkdown, exampleIds: packetExamples.map(example => example.id), humanLabelsCreatedByThisCommand: 0 } };
await frozenWrite(`${directory}/inventory.json`, JSON.stringify(privateInventory, null, 2) + '\n');
const countBy = (values: string[]) => Object.fromEntries(unique(values).map(key => [key, values.filter(value => value === key).length]));
const modes = await Promise.all([directory, `${directory}/captures`, `${directory}/examples`].map(async file => (await stat(file)).mode & 0o777));
const report = { recordedAt: new Date().toISOString(), command: 'node --import tsx scripts/prepare-stage2-real-review.ts', inventoryVersion: VERSION,
  status: 'real_existing_public_capture_inventory_prepared_not_human_labeled_or_holdout_accepted',
  snapshotSha256: snapshotId, privateInventorySha256: hash(await readFile(`${directory}/inventory.json`)),
  reviewUnits: examples.length, distinctProvisionalOpportunityFamilies: selectedFamilies.size, retainedSourceAliasRecords: examples.reduce((sum, item) => sum + item.memberCount, 0),
  provisionalSingleSourceUnknownOrganizerFamilies: examples.filter(item => item.provisionalFamily).length,
  examplesWithPublisherOrganizerMetadata: examples.filter(item => item.organizer).length, distinctPublisherOrganizerMetadataValues: new Set(examples.map(item => item.organizer).filter(Boolean)).size,
  perPrimaryRoute: countBy(examples.map(item => item.primarySource)), perSelectionCategory: countBy(examples.map(item => item.category)),
  capturedResponseCount: captures.size, validatedExistingResponseCount: batches.reduce((sum, source) => sum + source.batch.pages.length, 0),
  copiedCapturedResponseBytes: captureInventory.reduce((sum, item) => sum + item.byteCount, 0),
  inputBatchReferences: batches.map(source => ({ sourceId: source.batch.sourceId, originalPrivateBatchPath: source.file, originalBatchSha256: source.fileSha256, parserVersion: source.batch.parserVersion, captureStartedAt: source.batch.startedAt, captureFinishedAt: source.batch.finishedAt, windowFrom: source.batch.observations.windowFrom, windowTo: source.batch.observations.windowTo, opportunitiesAvailableInBatch: source.batch.opportunities.length, responseHashes: source.batch.pages.map(page => page.sha256) })),
  preservedOccurrenceClaims: examples.reduce((sum, item) => sum + item.occurrenceCount, 0), preservedActionClaims: examples.reduce((sum, item) => sum + item.actionCount, 0),
  privateArtifacts: { directory, inventory: `${directory}/inventory.json`, firstTenMarkdown: packetMarkdown, firstTenCsv: packetCsv, firstTenRoutes: countBy(packetExamples.map(item => item.primarySource)), directoryModesOctal: modes.map(mode => mode.toString(8)), newFileMode: '0600', originalCapturesUnmodified: true, existingHumanPacketAnnotationsPreservedOnRerun: true },
  evidenceBoundaries: { newHttpRequests: 0, credentialReads: 0, databaseReads: 0, databaseWrites: 0, metaAccess: 0, modelCalls: 0, calendarCalls: 0, paidServices: 0,
    actualHumanReviewsCreated: 0, acceptanceHoldoutAssigned: false, sourceInputProvenance: 'Existing successful public JSON/ICS/HTML captures; no source-access renewal or current availability verification.', silverLabelProvenance: 'Existing deterministic adapter output, not independently checked human facts.', actualImageFlyers: 0, actualCompleteCarousels: 0, actualSocialCaptures: 0, actualNegativeSourceCaptures: 0 },
  limitations: ['100 review units share fewer independent captured responses; this is not 100 independent captures or 100 organizers.', 'Organizer and cross-source family assignments are provisional; source-native opportunity grouping keeps all captured occurrences/actions together but does not prove all aliases have been found.', 'Input windows and publication/fetch timestamps remain distinct; older captures cannot establish current access, historical alert timeliness or current ticket availability.', 'No real flyer/carousel/video/newsletter/social/negative corpus or model benchmark is established by this inventory.', 'The proposed silver labels can share parser mistakes; human review and critical-label adjudication are still required.', 'No untouched human-labeled holdout, measured extraction accuracy, recall target or Stage 2 acceptance is claimed.'] };
await writeFile('reports/stage-2-real-review-inventory.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ reviewUnits: report.reviewUnits, sourceRoutes: Object.keys(report.perPrimaryRoute).length, capturedResponses: report.capturedResponseCount, humanReviewsCreated: 0, newHttpRequests: 0, perPrimaryRoute: report.perPrimaryRoute, snapshotSha256: snapshotId, privateDirectory: directory }, null, 2));
