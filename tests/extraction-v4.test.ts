import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCandidates as v4 } from '../lib/extraction/text-v4';
import { extractCandidates as v3 } from '../lib/extraction/text';
import { extractCandidatesForVersion } from '../lib/extraction/versions';
import { providedTextUnit } from '../lib/extraction/text-v1';
import { validateExtractionResult } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';

function run(units: ExtractionUnit[]) {
  const candidates = v4(units);
  validateExtractionResult({ version: 'stage2-result-v1', units, candidates, complete: true, issues: [], stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'v4-composition-test', elapsedMs: 0 } });
  return candidates;
}
test('v4 recognizes explicit compact source instants without changing v3 history', () => {
  const unit = providedTextUnit('Research Forum\nDTSTART:20271108T230000Z\nDTEND:20271109T010000Z');
  const old = extractCandidatesForVersion('stage2-rules-v3', [unit]), current = extractCandidatesForVersion('stage2-rules-v4', [unit]);
  assert.ok(old.every(candidate => candidate.fields.startAt === null));
  assert.equal(current.filter(candidate => candidate.kind === 'event').length, 1); assert.equal(current[0].fields.startAt, '2027-11-08T23:00:00.000Z'); assert.equal(current[0].fields.status, null);
});
test('structured events replace generic prose events/resources while independently timed actions survive', () => {
  const unit = providedTextUnit('Title: Research Forum\nStart: 2027-11-08T18:00:00-05:00\nEnd: 2027-11-08T20:00:00-05:00\nApplication deadline: November 4, 2027 5 PM EST');
  const candidates = run([unit]); assert.equal(candidates.filter(candidate => candidate.kind === 'event').length, 1);
  const action = candidates.find(candidate => candidate.kind === 'action')!; assert.ok(action); assert.equal(action.fields.title, 'Research Forum'); assert.equal(action.fields.occursOn, '2027-11-04');
  assert.ok(!candidates.some(candidate => candidate.kind === 'resource'));
});
test('an action in a multi-event structured unit does not borrow one event title', () => {
  const unit = providedTextUnit('Title: Research Forum\nStart: 2027-11-08T18:00:00-05:00\nEnd: 2027-11-08T20:00:00-05:00\nApplication deadline: November 4, 2027 5 PM EST\nTitle: Campus Concert\nStart: 2027-11-09T18:00:00-05:00');
  const candidates = run([unit]); assert.equal(candidates.filter(candidate => candidate.kind === 'event').length, 2);
  const actions = candidates.filter(candidate => candidate.kind === 'action'); assert.ok(actions.length);
  assert.ok(actions.every(action => action.fields.title === null && !action.claims.some(claim => claim.field === 'title') && action.issues.includes('structured_action_event_title_scope_requires_review')));
});
test('unsupported provided prose retains v3 intervals and explicit fixed timezone without native-media inference', () => {
  const unit = providedTextUnit('Campus Workshop\nNovember 8, 2027 7 PM–9 PM EST');
  const old = v3([unit]), current = run([unit]);
  assert.deepEqual(current.map(candidate => [candidate.fields.title, candidate.fields.startAt, candidate.fields.endAt]), old.map(candidate => [candidate.fields.title, candidate.fields.startAt, candidate.fields.endAt]));
  assert.equal(current[0].fields.timeZone, 'Etc/GMT+5'); assert.equal(current[0].fields.sourceTimeZoneAbbreviation, 'EST');
});
test('only native media units gain partial layout facts and exact quotations from the media path', () => {
  const unit = { ...providedTextUnit('Lecture Series\nJune 18\n6:30 - 8:00 PM\n“Reefs and Resilience:\nTools for Tomorrow”\nDana Brooks leads the Coastal Program.'), assetId: 'poster', method: 'ocr' as const };
  const current = run([unit]).find(candidate => candidate.kind === 'event')!;
  assert.equal(current.fields.title, 'Reefs and Resilience: Tools for Tomorrow'); assert.equal(current.fields.month, 6); assert.equal(current.fields.day, 18); assert.equal(current.fields.year, null); assert.equal(current.fields.startAt, null);
  const provided = run([{ ...unit, method: 'provided-text' as const }]).find(candidate => candidate.kind === 'event')!; assert.equal(provided.fields.month, undefined);
});
test('identical text on independent input pages keeps separate stable candidate identities and warnings', () => {
  const text = 'Campus Workshop\nNovember 8, 2027 7 PM–9 PM EST';
  const units = ['one', 'two'].map(assetId => ({ ...providedTextUnit(text), assetId, issues: ['source_warning_requires_review'] }));
  const candidates = run(units); assert.equal(candidates.length, 2); assert.notEqual(candidates[0].key, candidates[1].key);
  assert.deepEqual(v4(units).map(candidate => candidate.key), candidates.map(candidate => candidate.key)); assert.ok(candidates.every(candidate => candidate.issues.includes('source_warning_requires_review')));
});
test('the combined result has a visible global candidate cap across independent source units', () => {
  const units = Array.from({ length: 31 }, (_, index) => ({ ...providedTextUnit('Title: Research Forum\nStart: 2027-11-08T18:00:00-05:00'), assetId: `source-${index}` }));
  const candidates = run(units); assert.equal(candidates.length, 30); assert.ok(candidates.at(-1)!.issues.includes('candidate_limit_reached_additional_inputs_require_review'));
});
test('valid empty structured calendars do not fall back to invented prose candidates', () => {
  assert.deepEqual(run([providedTextUnit('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')]), []);
});
