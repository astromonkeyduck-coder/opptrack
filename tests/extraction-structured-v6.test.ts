import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extractStructuredCandidates } from '../lib/extraction/structured-v6';
import { extractStructuredCandidates as structuredV5 } from '../lib/extraction/structured-v5';
import { providedTextUnit } from '../lib/extraction/text-v1';
import { EXTRACTOR_VERSION, SUPPORTED_EXTRACTOR_VERSIONS, validateExtractionResult } from '../lib/extraction/contracts';

const body = 'Title: Synthetic Summer Workshop\nStart: 2027-06-18T16:00:00\nEnd: 2027-06-18T18:00:00';
function parse(text: string) {
  const unit = providedTextUnit(text), candidates = extractStructuredCandidates(unit)!;
  assert.ok(candidates);
  validateExtractionResult({ version: 'stage2-result-v1', units: [unit], candidates, complete: true, issues: [], stats: { processedAssets: 0, expectedAssets: 0, processedPages: 0, engine: 'synthetic-structured-v6', elapsedMs: 0 } });
  return candidates;
}
test('v6 withholds zone-derived instants from malformed or unsupported TIMEZONE parameters, preserving literal dates', () => {
  for (const zone of ['Timezone;BAD:America/New_York','Timezone;BAD/TYPE:America/New_York','Timezone;VALUE=DATE:America/New_York','Timezone;VALUE=DATE-TIME:America/New_York','Timezone;LANGUAGE=en:America/New_York']) {
    const text = `${body}\n${zone}`, item = parse(text)[0];
    assert.equal(item.fields.date, '2027-06-18'); assert.equal(item.fields.datePrecision, 'date'); assert.equal(item.fields.startLocal, '2027-06-18T16:00');
    assert.equal(item.fields.startAt, null); assert.equal(item.fields.endAt, null); assert.equal(item.fields.timeZone, null);
    assert.ok(item.issues.some(issue => /^structured_timezone_parameters_(?:invalid|unsupported)_requires_review$/.test(issue)));
    assert.equal(item.claims.some(claim => claim.field === 'timeZone' || claim.field === 'startAt' || claim.field === 'endAt'), false);
  }
});
test('bare explicit timezone is still valid and exact evidence supports the derived interval', () => {
  const text = `${body}\nTimezone: America/New_York`, item = parse(text)[0];
  assert.equal(item.fields.startAt, '2027-06-18T20:00:00.000Z'); assert.equal(item.fields.endAt, '2027-06-18T22:00:00.000Z'); assert.equal(item.fields.timeZone, 'America/New_York');
  const evidence = item.claims.find(claim => claim.field === 'startAt')!.evidence;
  assert.ok(evidence.some(span => span.quote === 'Timezone: America/New_York'));
});
test('unusable zone metadata cannot invalidate independent numeric-offset or UTC instants', () => {
  for (const suffix of ['-04:00','Z']) {
    const text = `Title: Synthetic Explicit Clock\nStart: 2027-06-18T16:00:00${suffix}\nEnd: 2027-06-18T18:00:00${suffix}\nTimezone;VALUE=DATE:America/New_York\nDescription: The event starts at 3 PM`;
    const item = parse(text)[0];
    // Numeric-offset clock conflicts remain a separate source disagreement; UTC
    // has no known source-local zone after the invalid field is discarded.
    if (suffix === 'Z') { assert.equal(item.fields.startAt, '2027-06-18T16:00:00.000Z'); assert.equal(item.fields.endAt, '2027-06-18T18:00:00.000Z'); }
    else assert.ok(item.issues.includes('conflicting_event_start_times_require_review'));
    const clean = parse(text.replace('\nDescription: The event starts at 3 PM',''))[0];
    assert.equal(clean.fields.startAt, suffix === 'Z' ? '2027-06-18T16:00:00.000Z' : '2027-06-18T20:00:00.000Z');
    assert.equal(clean.fields.endAt, suffix === 'Z' ? '2027-06-18T18:00:00.000Z' : '2027-06-18T22:00:00.000Z');
  }
});
test('conflicting source zones leave dates and local range reviewable without selecting either zone', () => {
  const item = parse(`${body}\nTimezone: America/New_York\nTimezone: Europe/London`)[0];
  assert.equal(item.fields.date, '2027-06-18'); assert.equal(item.fields.startAt, null); assert.equal(item.fields.endAt, null); assert.equal(item.fields.timeZone, null);
  assert.ok(item.issues.includes('conflicting_structured_timezones_require_review'));
  const backwards = parse(`${body.replace('T18:00:00','T15:00:00')}\nTimezone;VALUE=DATE:America/New_York`)[0];
  assert.equal(backwards.fields.date, '2027-06-18'); assert.equal(backwards.fields.startAt, null); assert.equal(backwards.fields.endAt, null);
  assert.ok(backwards.issues.includes('end_time_conflict_or_overnight_requires_review'));
});
test('date-only ICS boundaries remain dates and unsupported DTSTART type parameters stay unresolved', () => {
  const calendar = ['BEGIN:VCALENDAR','BEGIN:VEVENT','SUMMARY:Synthetic Exhibition','DTSTART;VALUE=DATE:20270618','DTEND;VALUE=DATE:20270620','TIMEZONE;VALUE=DATE:America/New_York','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const item = parse(calendar)[0]; assert.equal(item.fields.date, '2027-06-18'); assert.equal(item.fields.endDateExclusive, '2027-06-20'); assert.equal(item.fields.startAt, null); assert.equal(item.fields.timeZone, null);
  const invalid = parse(`${body.replace('Start:', 'Start;VALUE=DATE:')}\nTimezone: America/New_York`)[0];
  assert.equal(invalid.fields.startAt, null); assert.equal(invalid.fields.endAt, null); assert.ok(invalid.issues.includes('invalid_date_or_source_instant'));
});
test('historical v5 malformed-zone interpretation stays selectable and byte-identical', async () => {
  const source = providedTextUnit(`${body}\nTimezone;BAD:America/New_York`);
  assert.equal(structuredV5(source)![0].fields.startAt, '2027-06-18T20:00:00.000Z');
  assert.equal(parse(source.text)[0].fields.startAt, null);
  assert.equal(EXTRACTOR_VERSION, 'stage2-rules-v6'); assert.equal(SUPPORTED_EXTRACTOR_VERSIONS.length,6);
  for (const [name, expected] of [['text-v5.ts','8a5547e5e7f62bddad3477df9d4e4cf5047ac82c60806556e37c2e4bd2d70215'],['structured-v5.ts','17c2605a9ec824456b2e87ddebf57762155032a83a4dfc367f7a4642650e5fc8'],['text-media-v5.ts','f094183ebf4475132bd949389954e74da93a8f949305380663cdb9f9bf3dd8e1'],['package.json','c244a4dc99fc4971c255d93721f2e956f4189b0a0220584296643a61140d4dc7']]) {
    const file = name === 'package.json' ? new URL('../package.json',import.meta.url) : new URL(`../lib/extraction/${name}`,import.meta.url);
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),expected,name);
  }
});
