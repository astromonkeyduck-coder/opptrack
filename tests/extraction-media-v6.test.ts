/** Synthetic native text only. No source, label, native executable or provider I/O. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { extractMediaCandidates } from '../lib/extraction/text-media-v6';
import { validateExtractionResult } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';

function run(text: string, method: ExtractionUnit['method'] = 'ocr') {
  const unit: ExtractionUnit = { assetId: 'synthetic-native-page', page: method === 'pdf-text-and-ocr' ? 1 : null, status: 'processed', method, text, sha256: createHash('sha256').update(text).digest('hex'), issues: [] };
  const before = JSON.stringify(unit), candidates = extractMediaCandidates(unit);
  validateExtractionResult({ version: 'stage2-result-v1', units: [unit], candidates, issues: [], complete: true, stats: { expectedAssets: 1, processedAssets: 1, processedPages: 1, elapsedMs: 0, engine: 'synthetic-native-v6' } });
  assert.equal(JSON.stringify(unit), before);
  for (const candidate of candidates) for (const claim of candidate.claims) for (const span of claim.evidence) assert.equal(span.quote, text.slice(span.start, span.end));
  return candidates;
}
const facts = 'November 18, 2027\n7 PM–9 PM EST';
const pair = (sparse: string, adaptive: string) => `[Visual OCR sparse]\n${sparse}\n\n[Visual OCR adaptive]\n${adaptive}`;
const event = (text: string) => { const result = run(text).find(candidate => candidate.kind === 'event'); assert.ok(result); return result; };

test('conflicting native view titles remain unknown instead of selecting the first source heading', () => {
  const candidate = event(pair(`Campus Concert\n${facts}`, `Campus Film Night\n${facts}`));
  assert.equal(candidate.fields.title, null);
  assert.ok(candidate.issues.includes('conflicting_native_pass_title_requires_review'));
  assert.equal(candidate.claims.some(claim => claim.field === 'title'), false);
  assert.equal(candidate.fields.startAt, '2027-11-19T00:00:00.000Z');
});
test('a clock line cannot become a title when the first view lost its actual headline', () => {
  const candidate = event(pair(`Date: November 18, 2027\n7 PM–9 PM EST`, `Campus Film Night\n${facts}`));
  assert.equal(candidate.fields.title, 'Campus Film Night');
  const title = candidate.claims.find(claim => claim.field === 'title')!;
  assert.ok(title.evidence.every(span => span.quote === 'Campus Film Night'));
  assert.ok(title.evidence.every(span => span.start > pair(`Date: November 18, 2027\n7 PM–9 PM EST`, `Campus Film Night\n${facts}`).indexOf('[Visual OCR adaptive]')));
  assert.equal(event(pair(`Date: November 18, 2027\n7 PM–9 PM EST`, `Date: November 18, 2027\n7 PM–9 PM EST`)).fields.title, null);
});
test('contradictory prices and eligibility across native views are not known first-view facts', () => {
  const candidate = event(pair(`Campus Concert\n${facts}\nPrice: Free\nEligibility: All students`, `Campus Concert\n${facts}\nPrice: $12\nEligibility: Members only`));
  for (const field of ['price','eligibility']) {
    assert.equal(candidate.fields[field], null);
    assert.ok(candidate.issues.includes(`conflicting_native_pass_${field}_requires_review`));
    assert.equal(candidate.claims.some(claim => claim.field === field), false);
  }
  assert.equal(candidate.fields.title, 'Campus Concert');
});
test('whole-unit conflicting dates/clocks remain withheld after pass-scoped title repair', () => {
  for (const second of ['November 19, 2027\n7 PM–9 PM EST','November 18, 2027\n8 PM–10 PM EST']) {
    const candidate = event(pair(`Campus Concert\n${facts}`, `Campus Concert\n${second}`));
    assert.equal(candidate.fields.startAt, null); assert.equal(candidate.fields.endAt, null);
    assert.ok(candidate.issues.some(issue => /conflicting_media_(?:dates|clocks)/.test(issue)));
  }
});
test('PDF layer and two OCR views corroborate one record with original CRLF and Unicode evidence', () => {
  const source = 'Title: Campus Concert 🎭\r\nPrice: Free\r\nEligibility: FSU students\r\nStart: 2027-11-18T19:00:00-05:00\r\nEnd: 2027-11-18T21:00:00-05:00';
  const candidates = run(`[PDF text layer]\r\n${source}\r\n[Visual OCR]\r\n[Visual OCR sparse]\r\n${source}\r\n[Visual OCR adaptive]\r\n${source}`, 'pdf-text-and-ocr');
  const events = candidates.filter(candidate => candidate.kind === 'event'); assert.equal(events.length, 1);
  assert.equal(events[0].fields.title, 'Campus Concert 🎭'); assert.equal(events[0].fields.price, 'Free'); assert.equal(events[0].fields.eligibility, 'FSU students');
  assert.ok(events[0].claims.find(claim => claim.field === 'title')!.evidence.length >= 3);
});
test('within-record conflict and explicit unknown price cannot be filled from a clean second view', () => {
  const source = 'Title: Campus Concert\nStart: 2027-11-18T19:00:00-05:00\nEnd: 2027-11-18T21:00:00-05:00';
  for (const price of ['Price: Free\nCost: $12','Price: TBD']) {
    const candidate = event(pair(`${source}\n${price}`, `${source}\nPrice: Free`));
    assert.equal(candidate.fields.price, null);
    assert.ok(candidate.issues.includes('conflicting_native_pass_price_requires_review'));
  }
  const prose = event(pair(`Campus Concert\n${facts}\nPrice: TBD`, `Campus Concert\n${facts}\nPrice: Free`));
  assert.equal(prose.fields.price, null); assert.ok(prose.issues.includes('conflicting_native_pass_price_requires_review'));
});
test('different action-type readings do not manufacture two approval-ready reminders', () => {
  const candidates = run(pair('Campus Concert\nApplication deadline: November 20, 2027', 'Campus Concert\nRegistration deadline: November 20, 2027'));
  const actions = candidates.filter(candidate => candidate.kind === 'action');
  assert.equal(actions.length, 1); assert.equal(actions[0].fields.actionType, null);
  assert.ok(actions[0].issues.includes('conflicting_native_pass_actionType_requires_review'));
  assert.ok(actions[0].issues.includes('native_pass_action_type_scope_requires_review'));
  assert.equal(actions[0].fields.occursOn, '2027-11-20');
});
test('organizer, zone, status and venue disagreements all withhold the disputed facts', () => {
  const common = 'Title: Campus Concert\nStart: 2027-11-18T19:00:00\nEnd: 2027-11-18T21:00:00';
  const candidate = event(pair(`${common}\nTimezone: America/New_York\nStatus: CONFIRMED\nLocation: North Hall\nOrganizer: Campus Arts Council`, `${common}\nTimezone: America/Chicago\nStatus: CANCELLED\nLocation: South Hall\nOrganizer: Campus Film Club`));
  for (const field of ['organizer','timeZone','status','location','startAt','endAt']) {
    assert.equal(candidate.fields[field], null);
    assert.ok(candidate.issues.includes(`conflicting_native_pass_${field}_requires_review`));
  }
});
test('multiple records in one view do not lend a title or price to an ordinal neighbor', () => {
  const first = 'Title: First Concert\nPrice: Free\nStart: 2027-11-18T19:00:00-05:00\nEnd: 2027-11-18T21:00:00-05:00';
  const second = 'Title: Second Concert\nPrice: $12\nStart: 2027-11-19T19:00:00-05:00\nEnd: 2027-11-19T21:00:00-05:00';
  const candidates = run(pair(`${first}\n${second}`, `${first}\n${second}`));
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.equal(candidate.fields.title, null); assert.equal(candidate.fields.price ?? null, null);
    assert.ok(candidate.issues.includes('native_pass_record_scope_requires_review'));
  }
});
test('a descriptive resource headline does not invent an umbrella name for distinct program notices', () => {
  const source = 'DISCOVER CULTURAL STUDY OPPORTUNITIES\nThis scholarship brochure describes available support.\nExample Scholarships support undergraduate study.\nExample Fellowships support graduate study.';
  const candidates = run(`[PDF text layer]\n${source}\n[Visual OCR]\n[Visual OCR sparse]\n${source}\n[Visual OCR adaptive]\n${source}`, 'pdf-text-and-ocr');
  const resource = candidates.find(candidate => candidate.kind === 'resource'); assert.ok(resource);
  assert.equal(resource.fields.title, null); assert.equal(resource.fields.sourceHeading, 'DISCOVER CULTURAL STUDY OPPORTUNITIES');
  assert.ok(resource.issues.includes('native_resource_program_title_scope_requires_review'));
});
test('ordinary native negative photo stays empty rather than acquiring a processor-heading event', () => {
  assert.equal(run(pair('Boat at the dock\nPhoto by Alex','Boat at the dock\nPhoto by Alex')).length, 0);
});
test('publisher logos are neither conflicting occurrence titles nor evidence for a room-city venue', () => {
  const layer = 'nd\n2 Example\nResearch Workshop:\nAdvanced\nMaterials\nThis workshop brings researchers together to discuss practical methods and current work.\nNovember 16-17, 2028\nRIVERTON\nRSC 2040';
  const ocr = 'PINE HILL\nNational Laboratory\nThis workshop brings researchers together to discuss practical methods and current work.\nNovember 16-17, 2028\nRIVERTON\nRSC 2040';
  const candidate = run(`[PDF text layer]\n${layer}\n[Visual OCR]\n[Visual OCR sparse]\n${ocr}\n[Visual OCR adaptive]\n${ocr}`, 'pdf-text-and-ocr').find(candidate => candidate.kind === 'event')!;
  assert.equal(candidate.fields.title, '2nd Example Research Workshop: Advanced Materials');
  assert.equal(candidate.fields.location, 'RSC 2040, Riverton');
  assert.ok(candidate.issues.includes('native_publisher_logo_not_a_venue_requires_review'));
  assert.ok(candidate.claims.find(claim => claim.field === 'location')!.evidence.every(span => !span.quote.includes('PINE HILL')));
});
test('a standalone quoted display title can corroborate a dated view that retained only its series heading', () => {
  const sparse = `Lecture Series\n${facts}\nAdmission is free!`;
  const adaptive = 'Lecture Series\n“Mapping Rivers — New Methods\nfor Field Research”\nThis presentation explains current field research methods and describes how practical observations contribute to a broader scientific understanding of landscapes.';
  const candidate = event(pair(sparse, adaptive));
  assert.equal(candidate.fields.title, 'Mapping Rivers — New Methods for Field Research');
  assert.equal(candidate.fields.date, '2027-11-18');
  const claim = candidate.claims.find(claim => claim.field === 'title')!;
  assert.ok(claim.evidence.every(span => span.quote.includes('Mapping Rivers')));
});
test('missing OCR criteria and contact headings do not contradict explicit process and eligibility text', () => {
  const introduction = 'This scholarship brochure contains guidance and application requirements.';
  const layer = `2030 INTERNAL EXAMPLE APPLICATION PROCESS\n${introduction}\nELIGIBILITY\n  U.S. citizens at the national       Enrolled in an accredited program\n  application deadline\nCONTACT THE OFFICE OF FELLOWSHIPS`;
  const sparse = `OFFICE OF NATIONAL\nFELLOWSHIPS\nEXAMPLE AWARDS\n${introduction}\nELIGIBILITY\ne\nCONTACT THE OFFICE OF\nNATIONAL FELLOWSHIPS`;
  const adaptive = `xx yy 2030 INTERNAL EXAMPLE APPLICATION PROCESS\n${introduction}\nELIGIBILITY\nCONTACT THE OFFICE OF\nNATIONAL FELLOWSHIPS`;
  const resource = run(`[PDF text layer]\n${layer}\n[Visual OCR]\n[Visual OCR sparse]\n${sparse}\n[Visual OCR adaptive]\n${adaptive}`, 'pdf-text-and-ocr').find(candidate => candidate.kind === 'resource')!;
  assert.equal(resource.fields.title, '2030 INTERNAL EXAMPLE APPLICATION PROCESS');
  assert.equal(resource.fields.eligibility, 'U.S. citizens at the national application deadline');
  assert.ok(resource.issues.includes('native_eligibility_heading_or_bullet_not_a_criterion_requires_review'));
});
