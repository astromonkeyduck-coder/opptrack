import assert from 'node:assert/strict';
import { test } from 'node:test';
import { providedTextUnit } from '../lib/extraction/text-v1';
import { extractMediaCandidates } from '../lib/extraction/text-media-v4';
import { validateExtractionResult } from '../lib/extraction/contracts';
function run(text: string) {
  const unit = { ...providedTextUnit(text), assetId: 'unseen-slide', method: 'ocr' as const };
  const candidates = extractMediaCandidates(unit);
  validateExtractionResult({ version: 'stage2-result-v1', units: [unit], candidates, issues: [], complete: true, stats: { processedAssets: 1, expectedAssets: 1, processedPages: 1, engine: 'test', elapsedMs: 0 } });
  return candidates;
}
test('quoted multi-line title and partial date/clock survive with no year or timezone invention', () => {
  const c = run('Lecture Series\nJune 18\n6:30 - 8:00 PM\n“Reefs and Resilience:\nTools for Tomorrow”\nDana Brooks leads the Coastal Program.\nAdmission is free!\n42 OCEAN HWY 3\nST. MARKS, FL 32355').find(c => c.kind === 'event')!;
  assert.equal(c.fields.title, 'Reefs and Resilience: Tools for Tomorrow');
  assert.equal(c.fields.speaker, 'Dana Brooks');
  assert.equal(c.fields.month, 6); assert.equal(c.fields.day, 18); assert.equal(c.fields.year, null);
  assert.equal(c.fields.startClock, '18:30'); assert.equal(c.fields.endClock, '20:00');
  assert.equal(c.fields.date, null); assert.equal(c.fields.startAt, null); assert.equal(c.fields.timeZone, null); assert.equal(c.fields.status, null);
  assert.equal(c.fields.location, '42 Ocean Hwy 3, St. Marks, FL 32355');
});
test('split ordinal heading and source date range stay a range rather than one timed occurrence', () => {
  const c = run('[PDF text layer]\nrd\n  3 Ocean\n  Science Workshop:\n  Coastal Habitats\n  This workshop brings researchers together to explore new instruments.\n  JUN. 18-19, 2027\n  MIAMI\n  LAB 204\n  Register by June 11').find(c => c.kind === 'event')!;
  assert.equal(c.fields.title, '3rd Ocean Science Workshop: Coastal Habitats');
  assert.equal(c.fields.date, null); assert.equal(c.fields.dateStart, '2027-06-18'); assert.equal(c.fields.dateEndInclusive, '2027-06-19');
  assert.equal(c.fields.datePrecision, 'date_range'); assert.equal(c.fields.startAt, null);
});
test('registration deadline has its own partial identity without borrowing the event year', () => {
  const all = run('Workshop\nJune 18, 2027\nRegister by June 11');
  const c = all.find(c => c.kind === 'action')!;
  assert.equal(c.fields.actionType, 'registration_deadline'); assert.equal(c.fields.month, 6); assert.equal(c.fields.day, 11); assert.equal(c.fields.year, null); assert.equal(c.fields.occursOn, null);
});
test('table campus/national deadlines retain distinct phases and month precision', () => {
  const all = run('[PDF text layer]\n  LANGUAGE STUDY\n  AND CULTURAL IMMERSION\nA fellowship supports language study.\n October 2027       FSU’s Campus Deadline for Applicants\n Early March, 2028  National Deadline for Scholarship Applicants');
  const a = all.filter(c => c.kind === 'action'); assert.equal(a.length, 2);
  assert.deepEqual(a.map(c => [c.fields.actionPhase, c.fields.month, c.fields.year, c.fields.datePrecision]), [['campus',10,2027,'month'],['national',3,2028,'part_of_month']]);
  assert.ok(a.every(c => c.fields.day === null && c.fields.occursAt === null && c.fields.occursOn === null));
});
test('ordinary photo text and student testimonials do not become quoted event titles', () => {
  assert.equal(run('Boat at the dock\nPhoto by Alex').filter(c => c.kind === 'event' || c.kind === 'action').length, 0);
  assert.ok(!run('Scholarships\n“I applied because it changed my life.”').some(c => c.kind === 'event'));
});
test('doors/action clocks and OCR disagreements cannot become an event clock', () => {
  const c = run('Concert\nJune 18, 2027\nDoors: 5 PM–6 PM\nShow: 7 PM–9 PM\nApplications: 1 PM–3 PM').find(c => c.kind === 'event')!;
  assert.equal(c.fields.startClock, '19:00'); assert.equal(c.fields.endClock, '21:00');
  const conflicting = run('Lecture\nJune 18\n7 PM–8 PM\n[Visual OCR adaptive]\nLecture\nJune 19\n8 PM–9 PM').find(c => c.kind === 'event')!;
  assert.equal(conflicting.fields.month, undefined); assert.equal(conflicting.fields.startClock, undefined);
  assert.ok(conflicting.issues.includes('conflicting_media_dates_require_review'));
  const ambiguous = run('Lecture\nJune 18\n11–1 PM').find(c => c.kind === 'event')!;
  assert.equal(ambiguous.fields.startClock, undefined);
  const fullConflict = run('Concert\nJune 18, 2027\n7 PM–8 PM EST\n[Visual OCR adaptive]\nConcert\nJune 18, 2027\n8 PM–9 PM EST').find(c => c.kind === 'event')!;
  assert.equal(fullConflict.fields.startAt, null); assert.equal(fullConflict.fields.endAt, null);
  assert.equal(fullConflict.fields.startLocal, null);
  assert.ok(fullConflict.issues.includes('conflicting_media_clocks_require_review'));
});
test('two-column eligibility retains source layout and quotes the first criterion without column contamination', () => {
  const c = run('[PDF text layer]\nSCHOLARSHIP APPLICATION PROCESS\nEligibility requirements follow.\nELIGIBILITY\n   U.S. citizens at the time of the national        Enrolled in a degree program\n   application deadline                              throughout the award\n   A high school graduate\nCONTACT US').find(c => c.kind === 'resource')!;
  assert.equal(c.fields.eligibility, 'U.S. citizens at the time of the national application deadline');
  assert.match(String(c.fields.eligibilityText), /Enrolled in a degree program/);
});
test('media EST is retained as a fixed offset rather than claiming a geographic time zone', () => {
  const c = run('Concert\nNovember 18, 2027 7 PM–9 PM EST').find(c => c.kind === 'event')!;
  assert.equal(c.fields.timeZone, 'Etc/GMT+5'); assert.equal(c.fields.utcOffset, '-05:00'); assert.equal(c.fields.sourceTimeZoneAbbreviation, 'EST');
});
