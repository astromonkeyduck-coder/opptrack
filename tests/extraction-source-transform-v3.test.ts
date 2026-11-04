import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformPublicText } from '../evaluation/stage2-source-only-transform-v3';
import { extractCandidates } from '../lib/extraction/text-v5';
const prepare = (value: object) => transformPublicText({ contentType: 'application/json', rawInput: JSON.stringify(value) });
const event = { title: 'Field Workshop', description: 'Meet the researchers.', event_instances: [{ event_instance: { start: '2027-06-18T19:00:00-04:00', end: '2027-06-18T20:00:00-04:00' } }] };
const extract = (text: string) => extractCandidates([{ assetId: 'source', page: null, status: 'processed', text, method: 'provided-text', sha256: null, issues: [] }])[0];
test('v3 keeps affirmative metadata before description and passes it to the version5 parser', () => {
  const text = prepare({ ...event, free: true, eligibility: 'FSU students', organizer: 'Field Research Club', timezone: 'America/New_York' });
  assert.ok(text.indexOf('Price: Free') < text.indexOf('Description:'));
  const candidate = extract(text);
  assert.equal(candidate.fields.price, 'Free'); assert.equal(candidate.fields.eligibility, 'FSU students'); assert.equal(candidate.fields.organizer, 'Field Research Club');
  assert.equal(candidate.fields.timeZone, 'America/New_York'); assert.equal(candidate.fields.startAt, '2027-06-18T23:00:00.000Z');
  for (const field of ['price', 'eligibility', 'organizer']) assert.ok(candidate.claims.some(claim => claim.field === field && claim.evidence.every(span => text.slice(span.start, span.end) === span.quote)));
});
test('false free, blank metadata, objects and expected labels never become inferred facts', () => {
  const text = prepare({ ...event, free: false, ticket_cost: '', organizer: { name: 'Not a literal field' }, expected: { price: 'Free', eligibility: 'Anyone' } });
  assert.ok(!text.includes('Not a literal') && !text.includes('Anyone') && !text.includes('Price:'));
  const candidate = extract(text); assert.equal(candidate.fields.price, null); assert.equal(candidate.fields.eligibility, null); assert.equal(candidate.fields.organizer, null);
});
test('conflicting affirmative price fields remain present for parser abstention', () => {
  const candidate = extract(prepare({ ...event, free: true, ticket_cost: '$10' }));
  assert.equal(candidate.fields.price, null); assert.ok(candidate.issues.some(issue => issue.includes('conflicting_structured_price')));
});
test('scalar newlines cannot become other structured metadata fields', () => {
  const text = prepare({ ...event, eligibility: 'FSU students\nPrice: Free' });
  assert.ok(!text.split('\n').some(line => line === 'Price: Free')); assert.equal(extract(text).fields.price, null);
});
test('non-JSON transforms remain byte-identical to v2 including raw ICS parameters', () => {
  const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Workshop\r\nDTSTART;TZID=America/New_York:20270618T190000\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.equal(transformPublicText({ contentType: 'text/calendar', rawInput: text }), text);
  assert.throws(() => prepare({ title: 'x'.repeat(65_537) }), /limit/);
});
