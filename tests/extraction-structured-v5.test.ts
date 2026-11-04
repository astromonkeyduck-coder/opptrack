import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extractStructuredCandidates } from '../lib/extraction/structured-v5';
import { extractCandidatesForVersion } from '../lib/extraction/versions';
import { providedTextUnit } from '../lib/extraction/text-v1';
import { SUPPORTED_EXTRACTOR_VERSIONS, EXTRACTOR_VERSION, validateExtractionResult } from '../lib/extraction/contracts';

function parse(text: string) {
  const source = providedTextUnit(text), candidates = extractStructuredCandidates(source)!;
  assert.ok(candidates);
  validateExtractionResult({ version: 'stage2-result-v1', units: [source], candidates, complete: true, issues: [], stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'synthetic-structured-v5', elapsedMs: 0 } });
  return candidates;
}
const event = 'Title: Synthetic Campus Talk\nStart: 2026-11-20T18:00:00-05:00\nEnd: 2026-11-20T19:00:00-05:00';
test('v5 preserves explicit structured price, eligibility and organizer with exact original evidence', () => {
  const text = `${event}\r\nPrice: Free\r\nEligibility: FSU students\r\nOrganizer: Campus Arts Council 🎭`;
  const result = parse(text)[0];
  assert.equal(result.fields.price, 'Free'); assert.equal(result.fields.eligibility, 'FSU students'); assert.equal(result.fields.organizer, 'Campus Arts Council 🎭');
  assert.equal(result.fields.startAt, '2026-11-20T23:00:00.000Z'); assert.equal(result.fields.endAt, '2026-11-21T00:00:00.000Z');
  for (const field of ['price', 'eligibility', 'organizer']) {
    const claim = result.claims.find(claim => claim.field === field)!; assert.ok(claim);
    for (const span of claim.evidence) { assert.equal(text.slice(span.start, span.end), span.quote); assert.match(span.quote, new RegExp(`^${field}:`, 'i')); }
  }
});
test('each record keeps its own literal cost, eligibility and organizer without global venue or metadata fallback', () => {
  const result = parse(`${event}\nCost: $8–$12\nEligibility: Open to all\nOrganizer: Campus Club One\nLocation: North Hall\nTitle: Synthetic Other Talk\nStart: 2026-11-21T18:00:00-05:00\nPrice: Free for members\nEligibility: Members only\nOrganizer: Campus Club Two`);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(item => [item.fields.price, item.fields.eligibility, item.fields.organizer]), [['$8–$12','Open to all','Campus Club One'], ['Free for members','Members only','Campus Club Two']]);
  assert.equal(result[1].fields.location, null);
  const blank = parse(`${event}\nPrice: Free\nEligibility: Students\nOrganizer: Campus Club\nTitle: Other Talk\nStart: 2026-11-21T18:00:00-05:00`)[1];
  assert.equal(blank.fields.price, null); assert.equal(blank.fields.eligibility, null); assert.equal(blank.fields.organizer, null);
});
test('conflicting prices or aliases, eligibility and organizers abstain rather than select the last value', () => {
  const result = parse(`${event}\nPrice: Free\nCost: $15\nEligibility: Members only\nEligibility: Open to all\nOrganizer: Campus Club One\nOrganizer: Campus Club Two`)[0];
  for (const field of ['price','eligibility','organizer']) { assert.equal(result.fields[field], null); assert.ok(result.issues.includes(`conflicting_structured_${field}_requires_review`)); assert.equal(result.claims.some(claim => claim.field === field), false); }
  const repeated = parse(`${event}\nPrice: Free\nCost: Free\nEligibility: Students\nEligibility: Students`)[0];
  assert.equal(repeated.fields.price, 'Free'); assert.equal(repeated.fields.eligibility, 'Students');
});
test('unknown fields and a false free flag never become known prices or eligibility', () => {
  for (const value of ['TBA','unknown','not specified','false','null','?','pending','coming soon','']) {
    const result = parse(`${event}\nPrice: ${value}\nEligibility: ${value}\nOrganizer: ${value}`)[0];
    for (const field of ['price','eligibility','organizer']) assert.equal(result.fields[field], null);
  }
  const result = parse(`${event}\nFree: false`)[0]; assert.equal(result.fields.price, null); assert.equal(result.claims.some(claim => claim.field === 'price'), false);
  assert.equal(parse(`${event}\nCost: 0`)[0].fields.price, '0', 'Literal zero is preserved without inventing currency or a free flag.');
});
test('unresolved metadata parameter semantics are withheld instead of dropping price or eligibility qualifiers', () => {
  const result = parse(`${event}\nPrice;CURRENCY=USD:10\nEligibility;GROUP=MEMBER:Students\nOrganizer;CN="Campus Arts Council";CN="Other Club":mailto:arts@example.invalid`)[0];
  assert.equal(result.fields.price, null); assert.equal(result.fields.eligibility, null); assert.equal(result.fields.organizer, null);
  assert.ok(result.issues.includes('structured_price_parameters_unsupported_requires_review')); assert.ok(result.issues.includes('structured_eligibility_parameters_unsupported_requires_review'));
  assert.ok(result.issues.includes('structured_organizer_parameters_invalid_requires_review'));
});
test('field-looking metadata in Description remains scoped prose and does not leak into any record', () => {
  const text = `${event}\nDescription: A quoted prior flyer follows.\nPrice: Free\nEligibility: Club members\nOrganizer: Prior Club\nTitle: Synthetic Second Talk\nStart: 2026-11-21T18:00:00-05:00\nDescription: Price: $5; Eligibility: All students; Organizer: Other Club`;
  const result = parse(text); assert.equal(result.length, 2);
  for (const item of result) for (const field of ['price','eligibility','organizer']) assert.equal(item.fields[field], null);
  assert.ok(result[0].issues.includes('structured_metadata_in_description_scope_requires_review'));
});
test('raw calendar metadata respects VEVENT boundaries, folds and explicit organizer CN evidence', () => {
  const text = ['BEGIN:VCALENDAR','PRICE:GLOBAL UNKNOWN','BEGIN:VEVENT','SUMMARY:Synthetic First','DTSTART:20261120T230000Z','PRICE:Free','ELIGIBILITY:FSU students and','  guests','ORGANIZER;CN="Campus Arts Council":mailto:arts@example.invalid','DESCRIPTION:Price: $99\\nEligibility: Nobody','END:VEVENT','BEGIN:VEVENT','SUMMARY:Synthetic Second','DTSTART:20261121T230000Z','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const result = parse(text); assert.equal(result.length, 2);
  assert.equal(result[0].fields.price, 'Free'); assert.equal(result[0].fields.eligibility, 'FSU students and guests'); assert.equal(result[0].fields.organizer, 'Campus Arts Council');
  for (const field of ['price','eligibility','organizer']) assert.equal(result[1].fields[field], null);
  assert.ok(result[0].claims.find(claim => claim.field === 'organizer')!.evidence[0].quote.includes('CN="Campus Arts Council"'));
});
test('v4 keeps the deployed metadata omission while only v5 fixes the exact structured-notes path', () => {
  const source = providedTextUnit(`${event}\nPrice: Free\nEligibility: FSU students\nOrganizer: Campus Club`);
  const old = extractCandidatesForVersion('stage2-rules-v4', [source]).find(item => item.kind === 'event')!;
  const current = extractCandidatesForVersion('stage2-rules-v5', [source]).find(item => item.kind === 'event')!;
  assert.equal(old.fields.price, undefined); assert.equal(old.fields.eligibility, undefined); assert.equal(old.fields.organizer, undefined);
  assert.equal(current.fields.price, 'Free'); assert.equal(current.fields.eligibility, 'FSU students'); assert.equal(current.fields.organizer, 'Campus Club');
  assert.equal(current.fields.startAt, old.fields.startAt); assert.equal(current.fields.endAt, old.fields.endAt); assert.notEqual(current.key, old.key);
  assert.equal(EXTRACTOR_VERSION, 'stage2-rules-v5'); assert.equal(SUPPORTED_EXTRACTOR_VERSIONS.length, 5);
});
test('all four deployed v4 helpers and dual-pass native2 implementation remain byte-identical', async () => {
  for (const [name, expected] of [
    ['structured.ts','93d792d22622fb610a6dcc703220a883c86d51106893a8084713833c65d38c92'],
    ['text-v4.ts','2e3fa233773a86e66f9353ece15323395e1033da07fd8b6e6fe02926de6dc58f'],
    ['text-prose-v4.ts','1b6bf3420e7d2c3fb4faca374b764594ae8b99db277b633841eb0cfd6c2122de'],
    ['text-media-v4.ts','b2ed69f9650633e6e77b0e5f33418d318cc9f8b096cd370c6a6351b83a865b29'],
    ['media-v2.ts','9a87fe48dc066e98d54f504de940635de9915c03fd21978a2cbbd1849ca1744a'],
  ]) assert.equal(createHash('sha256').update(await readFile(new URL(`../lib/extraction/${name}`, import.meta.url))).digest('hex'), expected, name);
});
