/** Conservative v4 repairs around the frozen v3 provided-text implementation. */
import { extractionUnitId, type EvidenceSpan, type ExtractionCandidate, type Primitive } from './contracts';
import type { ExtractionUnit } from './media-types';
import { extractCandidates as extractV3, type ExtractionContext } from './text';

function put(item: ExtractionCandidate, field: string, value: Primitive, evidence: EvidenceSpan[]) {
  item.fields[field] = value; item.claims = item.claims.filter(claim => claim.field !== field);
  if (value !== null) item.claims.push({ field, value, evidence });
}
function heading(unit: ExtractionUnit) {
  const lines = [...unit.text.matchAll(/[^\r\n]+/g)].flatMap(match => {
    const leading = match[0].search(/\S/); return leading < 0 ? [] : [{ text: match[0].trim(), start: match.index! + leading, end: match.index! + match[0].trimEnd().length }];
  });
  const categories = /^(?:education|theat(?:re|er)|music|dance|film|concerts?|speakers?|special events|arts|performances?|literary arts)$/i;
  const explicitDate = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}\b[^\n]{0,30}\b20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/i;
  const matches = lines.flatMap((line, index) => {
    const title = lines[index + 1], date = lines[index + 2];
    if (!categories.test(line.text) || !title || !date || title.text.length > 240 || categories.test(title.text) || explicitDate.test(title.text) || !explicitDate.test(date.text) || /^(?:https?:|location:|tickets?:|learn more|description:)/i.test(title.text)) return [];
    return [{ category: line.text, title, evidence: { unitId: extractionUnitId(unit), start: title.start, end: title.end, quote: unit.text.slice(title.start, title.end) } }];
  });
  return { lines, matches };
}
function timelineResource(unit: ExtractionUnit, firstLine: string) {
  if (!/\b(?:hiring|recruit(?:ing|ment)|application|internship)\b.{0,50}\b(?:timeline|schedule|process)\b/i.test(firstLine) || /\b(?:workshop|fair|session|seminar|webinar|lecture|talk|event)\b/i.test(firstLine)) return false;
  const markers = [/\b(?:step|stage|process)\b/i, /\bdeadline\b/i, /\b(?:applications?|applicants?)\b/i, /\b(?:interviews?|offers?|onboarding|acceptance|hired?|hiring)\b/i];
  return markers.filter(pattern => pattern.test(unit.text.slice(firstLine.length))).length >= 3;
}
function fixedSourceZone(item: ExtractionCandidate) {
  const zone = item.claims.find(claim => claim.field === 'timeZone');
  if (zone?.value !== 'America/New_York') return;
  const abbreviations = zone.evidence.map(evidence => evidence.quote.trim().toUpperCase());
  if (!abbreviations.length || abbreviations.some(value => !['EST', 'EDT'].includes(value)) || new Set(abbreviations).size !== 1) return;
  const abbreviation = abbreviations[0], offset = abbreviation === 'EST' ? '-05:00' : '-04:00';
  // EST/EDT supplies a fixed source offset, not a unique geographical IANA zone.
  put(item, 'timeZone', abbreviation === 'EST' ? 'Etc/GMT+5' : 'Etc/GMT+4', zone.evidence);
  put(item, 'sourceTimeZoneAbbreviation', abbreviation, zone.evidence);
  put(item, 'utcOffset', offset, zone.evidence);
  item.issues.push('source_abbreviation_retained_as_fixed_offset_not_geographic_zone');
  for (const [localField, instantField] of [['startLocal', 'startAt'], ['endLocal', 'endAt'], ['actionLocal', 'occursAt'], ['doorsLocal', 'doorsAt']]) {
    const local = item.fields[localField], instant = item.fields[instantField];
    if (typeof local !== 'string' || typeof instant !== 'string') continue;
    const instantClaim = item.claims.find(claim => claim.field === instantField);
    const explicit = instantClaim?.evidence.some(evidence => [...evidence.quote.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/g)].some(match => Date.parse(match[0]) === Date.parse(instant)));
    if (explicit) continue; // Never alter a supported literal ISO source instant.
    if (Date.parse(`${local}${offset}`) !== Date.parse(instant)) {
      put(item, instantField, null, []); item.issues.push('source_timezone_instant_conflict_requires_review');
      if (instantField === 'startAt' || instantField === 'occursAt') {
        const date = item.claims.find(claim => claim.field === (instantField === 'startAt' ? 'date' : 'occursOn'));
        if (date) put(item, 'datePrecision', 'date', date.evidence);
      }
    }
  }
}

export function extractProseCandidates(unit: ExtractionUnit, context: ExtractionContext = {}): ExtractionCandidate[] {
  const candidates = extractV3([unit], context), source = heading(unit);
  const recruiting = source.lines.length > 0 && timelineResource(unit, source.lines[0].text);
  for (const item of candidates) {
    if (source.matches.length === 1 && item.fields.title === source.matches[0].category) put(item, 'title', source.matches[0].title.text, [source.matches[0].evidence]);
    else if (source.matches.length > 1 && source.matches.some(match => match.category === item.fields.title)) {
      put(item, 'title', null, []); item.issues.push('prose_multiple_heading_title_scope_requires_review');
    }
    if (recruiting && item.kind === 'event') {
      item.kind = 'resource';
      for (const field of ['date','startAt','endAt','startLocal','endLocal','doorsAt','doorsLocal','status','timeZone','datePrecision','dateStart','dateEndInclusive']) if (field in item.fields) put(item, field, null, []);
      item.issues.push('recruiting_timeline_is_resource_not_attendance');
    }
    fixedSourceZone(item); item.issues = [...new Set(item.issues)].slice(0, 30);
  }
  for (const item of candidates.filter(c => c.kind === 'action')) {
    const top = source.lines[0]?.text || '';
    if (/(?:&|\band\b)/i.test(top) && [...top.matchAll(/\b(?:Funding|Fellowship|Scholarship|Award|Grant|Program)\b/gi)].length > 1) {
      // A shared application heading may cover several programmes. One name
      // mentioned in its paragraph does not narrow the application scope.
      item.issues.push('joint_program_action_scope_requires_review');
      continue;
    }
    const actionLines = item.claims.filter(c => c.field === 'actionType').flatMap(c => c.evidence.map(e => {
      const start = unit.text.lastIndexOf('\n', e.start) + 1, next = unit.text.indexOf('\n', e.end);
      return { start, text: unit.text.slice(start, next < 0 ? unit.text.length : next) };
    }));
    const programs = actionLines.flatMap(line => [...line.text.matchAll(/\b([A-Z][A-Za-z’'-]*(?: [A-Z][A-Za-z’'-]*){0,4} (?:Scholarship|Fellowship|Grant|Award|Program|Funding))\b/g)].map(m => ({value:m[1],start:line.start+m.index!,end:line.start+m.index!+m[1].length})));
    if (new Set(programs.map(p => p.value)).size > 1) item.issues.push('joint_program_action_scope_requires_review');
    if (new Set(programs.map(p => p.value)).size === 1) {
      const p = programs[0]; put(item,'title',p.value,[{unitId:extractionUnitId(unit),start:p.start,end:p.end,quote:unit.text.slice(p.start,p.end)}]);
    }
  }
  if (recruiting) {
    const posted = source.lines.flatMap((line,index) => {
      const match = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,3}) (?:experiences|positions|opportunities) (?:are )?posted\b/.exec(line.text);
      return match ? [{line,index,match}] : [];
    });
    const term = /\b(?:Spring|Summer|Fall|Winter) 20\d{2}\b/.exec(source.lines[0].text);
    if (posted.length === 1 && term) {
      const {line,index,match} = posted[0], termLine = source.lines[0];
      const refs: EvidenceSpan[] = [{unitId:extractionUnitId(unit),start:line.start,end:line.start+match[1].length,quote:match[1]}, {unitId:extractionUnitId(unit),start:termLine.start+term.index!,end:termLine.start+term.index!+term[0].length,quote:term[0]}];
      const title = `${match[1]} — ${term[0]}`;
      for (const item of candidates.filter(c => c.kind === 'action')) if (item.fields.title === source.lines[0].text || item.fields.title === match[1] || item.fields.title === null) put(item,'title',title,refs);
      // A posting date establishes availability of a listing, not application opening.
      const notice: ExtractionCandidate = {key:`${extractionUnitId(unit)}:posting`,kind:'action',fields:{occursAt:null,occursOn:null,timeZone:null},claims:[],issues:['unreviewed_extraction','posting_date_is_not_application_open','year_or_clock_not_inferred']};
      put(notice,'title',title,refs);
      put(notice,'actionType','opportunity_posted',[{unitId:extractionUnitId(unit),start:line.start,end:line.end,quote:unit.text.slice(line.start,line.end)}]);
      const date = source.lines[index+1], text = date?.text.replace(/\s*\|\s*$/,'').trim();
      if (date && text && /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?$/i.test(text)) put(notice,'dateText',text,[{unitId:extractionUnitId(unit),start:date.start,end:date.start+text.length,quote:unit.text.slice(date.start,date.start+text.length)}]);
      candidates.push(notice);
    }
  }
  return candidates;
}
