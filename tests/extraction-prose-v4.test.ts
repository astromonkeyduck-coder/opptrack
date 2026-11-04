import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractProseCandidates } from '../lib/extraction/text-prose-v4';
import { providedTextUnit } from '../lib/extraction/text-v1';
import { extractCandidates as v3 } from '../lib/extraction/text';
import { validateExtractionResult } from '../lib/extraction/contracts';

function run(text: string) {
  const unit = providedTextUnit(text), candidates = extractProseCandidates(unit);
  validateExtractionResult({ version: 'stage2-result-v1', units: [unit], candidates, issues: [], complete: true, stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'prose-v4-test', elapsedMs: 0 } });
  return candidates;
}
test('program deadline titles come from their own source line, not footer links', () => {
  const c = run('2027-2028 FELLOWSHIP DEADLINES\nJuly 3rd: Aurora Scholarship Campus intent to participate and pre-application deadline - Funding for graduate study\nAurora Flyer | Aurora Intake Form').find(c => c.kind === 'action')!;
  assert.equal(c.fields.title,'Aurora Scholarship');
});
test('a joint funding/fellowship application is not silently narrowed to one programme', () => {
  const title='Summer Research Funding & Coastal Exchange Fellowship Application';
  const c=run(`${title}\nDescription: Applications for the Coastal Exchange Fellowship are due March 23rd; this application covers both programs.\nApplication deadline: March 25, 2028`).find(c => c.kind === 'action')!;
  assert.equal(c.fields.title,title); assert.ok(c.issues.includes('joint_program_action_scope_requires_review'));
});
test('a recruiting posting notice keeps a supported program/term identity without asserting applications open', () => {
  const all = run('Fall 2028 Hiring Timeline\nStep\nDeadline\nCampus Research opportunities posted in JobBoard |\nJuly 15 |\nStudent application deadline |\nAugust 9 at 11:59 PM |\nSupervisors interview applicants and make offers\nOfficial acceptance from students');
  assert.equal(all.filter(c => c.fields.actionType === 'application_open').length,0);
  const posted=all.find(c => c.fields.actionType === 'opportunity_posted')!;
  assert.equal(posted.fields.title,'Campus Research — Fall 2028'); assert.equal(posted.fields.dateText,'July 15'); assert.equal(posted.fields.occursAt,null); assert.equal(posted.fields.occursOn,null);
  assert.equal(all.find(c => c.fields.actionType === 'application_deadline')?.fields.title,'Campus Research — Fall 2028');
});
test('a timeline does not replace an explicitly named unrelated programme deadline with its own programme', () => {
  const all=run('Fall 2028 Hiring Timeline\nStep\nDeadline\nCampus Research opportunities posted in JobBoard\nJuly 15\nExternal Fellowship applications due August 9\nSupervisors interview applicants and make offers\nOfficial acceptance from students');
  assert.equal(all.find(c => c.fields.actionType === 'application_deadline')?.fields.title,'External Fellowship');
});
test('a source category is replaced by its adjacent literal performance title with exact evidence', () => {
  const text = 'Education\nMarine Sounds: An Evening Ensemble\nNov 9 - Nov 11, 2027\nCampus Auditorium';
  const item = run(text).find(item => item.kind === 'event')!;
  assert.equal(item.fields.title, 'Marine Sounds: An Evening Ensemble'); assert.equal(item.fields.startAt, null);
  const evidence = item.claims.find(claim => claim.field === 'title')!.evidence[0]; assert.equal(text.slice(evidence.start, evidence.end), 'Marine Sounds: An Evening Ensemble');
});
test('a literal event title Education without adjacent title/date structure is retained', () => {
  const item = run('Education\nA concert exploring learning and technology.\nLocation: Theatre Hall').find(item => item.kind === 'event')!; assert.equal(item.fields.title, 'Education');
});
test('hiring process timelines are resources while explicit separately timed action facts remain separate', () => {
  const items = run('Spring 2028 Hiring Timeline\nStep\nDeadline\nStudent application deadline\nNovember 9 at 11:59 PM\nSupervisors interview applicants and make offers\nNovember 11 - December 7\nOfficial acceptance from students\nDecember 9');
  assert.equal(items.filter(item => item.kind === 'event').length, 0); assert.ok(items.some(item => item.kind === 'resource' && item.fields.title === 'Spring 2028 Hiring Timeline'));
  assert.ok(items.every(item => item.kind !== 'resource' || item.fields.startAt === null && item.fields.endAt === null));
});
test('a real workshop about recruiting timelines remains an attendance candidate', () => {
  const item = run('Workshop on Hiring Timelines\nNovember 9, 2027 7 PM–8 PM EST\nApplication deadlines and interview offers will be discussed.').find(item => item.kind === 'event'); assert.ok(item); assert.equal(item.fields.startAt, '2027-11-10T00:00:00.000Z');
});
test('EST and EDT become fixed source zones, never a fabricated regional IANA identity', () => {
  for (const [abbr, date, zone, offset, expected] of [['EST', 'November 10, 2027', 'Etc/GMT+5', '-05:00', '2027-11-10T22:00:00.000Z'], ['EDT', 'July 10, 2027', 'Etc/GMT+4', '-04:00', '2027-07-10T21:00:00.000Z']]) {
    const action = run(`Campus Fellowship\nApplication deadline: ${date} 5 PM ${abbr}`).find(item => item.kind === 'action')!;
    assert.equal(action.fields.timeZone, zone); assert.equal(action.fields.sourceTimeZoneAbbreviation, abbr); assert.equal(action.fields.utcOffset, offset); assert.equal(action.fields.occursAt, expected);
  }
});
test('conflicting seasonal abbreviation instants stay withheld instead of being recomputed', () => {
  const item = run('Campus Workshop\nJuly 10, 2027 7 PM EST').find(item => item.kind === 'event')!; assert.equal(item.fields.startAt, null); assert.equal(item.fields.timeZone, 'Etc/GMT+5'); assert.ok(item.issues.includes('timezone_abbreviation_conflict'));
});
test('exact ISO source instants and literal IANA zones preserve their original meaning', () => {
  const text = 'Campus Workshop\nStart: 2027-07-10T19:00:00-04:00\nEnd: 2027-07-10T21:00:00-04:00';
  const item = run(text).find(item => item.kind === 'event')!, old = v3([providedTextUnit(text)]).find(item => item.kind === 'event')!; assert.equal(item.fields.startAt, old.fields.startAt); assert.equal(item.fields.endAt, old.fields.endAt);
  const named = run('Campus Workshop\nJuly 10, 2027 7 PM America/New_York').find(item => item.kind === 'event')!; assert.equal(named.fields.timeZone, 'America/New_York');
});
test('different action clocks retain their separate explicit source abbreviations', () => {
  const actions = run('Campus Fellowship\nApplication start: July 10, 2027 5 PM EDT\nApplication deadline: November 10, 2027 5 PM EST').filter(item => item.kind === 'action');
  assert.deepEqual(actions.map(item => [item.fields.actionType, item.fields.timeZone, item.fields.occursAt]), [['application_open', 'Etc/GMT+4', '2027-07-10T21:00:00.000Z'], ['application_deadline', 'Etc/GMT+5', '2027-11-10T22:00:00.000Z']]);
});
