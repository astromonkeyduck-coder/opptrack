import { createHash } from 'node:crypto';
import { reminderLocalInstant } from '../calendar/time';
import { extractionUnitId, type EvidenceSpan, type ExtractionCandidate, type Primitive } from './contracts';
import type { ExtractionUnit } from './media-types';

export type ExtractionContext = { publishedAt?: string | null; timeZone?: string | null };
type Match = { date: string | null; start: number; end: number; issue?: string };
const months: Record<string,number> = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
const monthNames='January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const instruction=/\b(?:ignore (?:all |the )?(?:previous|system)|system prompt|developer message|reveal (?:the )?(?:key|token|secret)|enable calendar writes|send (?:the )?credentials)\b/i;
function validDate(year:number,month:number,day:number) {
  if(year<1900||year>2200)return null;
  const value=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}
function publishedDay(context:ExtractionContext):string|null {
  if(!context.publishedAt||!context.timeZone||!Number.isFinite(Date.parse(context.publishedAt)))return null;
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:context.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(context.publishedAt));}catch{return null;}
}
export function sourceDates(text:string,context:ExtractionContext={}):Match[] {
  const found:Match[]=[];
  for(const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const date=validDate(Number(match[1]),Number(match[2]),Number(match[3]));
    found.push({date,start:match.index!,end:match.index!+match[0].length,...(!date?{issue:'invalid_date'}:{})});
  }
  const pattern=new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,'gi');
  for(const match of text.matchAll(pattern)) {
    const date=match[3]?validDate(Number(match[3]),months[match[1].toLowerCase()],Number(match[2])):null;
    found.push({date,start:match.index!,end:match.index!+match[0].length,...(!match[3]?{issue:'year_missing'}:!date?{issue:'invalid_date'}:{})});
  }
  for(const match of text.matchAll(/\b(today|tomorrow|tonight)\b/gi)) {
    const anchor=publishedDay(context.timeZone?context:{...context,timeZone:timeZone(text,context).zone});
    const date=anchor?new Date(Date.parse(`${anchor}T12:00:00Z`)+(match[1].toLowerCase()==='tomorrow'?86400000:0)).toISOString().slice(0,10):null;
    found.push({date,start:match.index!,end:match.index!+match[0].length,...(!date?{issue:'relative_date_without_original_publication_context'}:{})});
  }
  return found.sort((a,b)=>a.start-b.start);
}
function span(unit:ExtractionUnit,start:number,end:number):EvidenceSpan {return {unitId:extractionUnitId(unit),start,end,quote:unit.text.slice(start,end)};}
function set(candidate:ExtractionCandidate,field:string,value:Primitive,evidence:EvidenceSpan|EvidenceSpan[]) {
  candidate.fields[field]=value;
  candidate.claims=candidate.claims.filter(claim=>claim.field!==field);
  if(value!==null) candidate.claims.push({field,value,evidence:Array.isArray(evidence)?evidence:[evidence]});
}
function clock(hour:string,minute:string|undefined,meridiem:string|undefined) {
  let h=Number(hour); const m=Number(minute||'0');
  if(m>59||h>23||h<0)return null;
  if(meridiem){if(h<1||h>12)return null;h=h%12+(/^p/i.test(meridiem)?12:0);}
  else if(h<=12)return null; // Do not silently choose AM/PM.
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function timeZone(text:string,context:ExtractionContext):{zone:string|null;match:RegExpMatchArray|null} {
  const match=text.match(/\b(America\/New_York|UTC|Eastern(?:\s+(?:Standard|Daylight))?(?:\s+Time)?|EST|EDT|ET)\b/i);
  return {zone:match?match[1].toUpperCase()==='UTC'?'UTC':'America/New_York':context.timeZone||null,match};
}
function localInstant(date:string,time:string,zone:string):string|null {
  const local=`${date}T${time}`;
  try {if(zone==='America/New_York')return reminderLocalInstant(local);if(zone==='UTC')return new Date(`${local}:00Z`).toISOString();return null;}catch{return null;}
}
function temporal(candidate:ExtractionCandidate,unit:ExtractionUnit,start:number,end:number,context:ExtractionContext,action:boolean) {
  // Keep offsets stable while excluding doors clocks from event-start inference.
  const text=unit.text.slice(start,end).replace(/^.*\bdoors\b.*$/gim,line=>' '.repeat(line.length)),dates=sourceDates(text,context),first=dates[0];
  for(const date of dates)if(date.issue)candidate.issues.push(date.issue);
  const dateValues=[...new Set(dates.map(d=>d.date).filter(Boolean))];
  if(dateValues.length>1){candidate.issues.push('multiple_dates_require_review');return;}
  if(!first?.date)return;
  const dateEvidence=span(unit,start+first.start,start+first.end);
  set(candidate,action?'occursOn':'date',first.date,dateEvidence);
  set(candidate,'datePrecision','date',dateEvidence);
  const zone=timeZone(text,context);
  if(zone.zone&&zone.match)set(candidate,'timeZone',zone.zone,span(unit,start+zone.match.index!,start+zone.match.index!+zone.match[0].length));
  const range=text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const single=range?null:text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const clockMatch=range||single;
  if(!clockMatch)return;
  const beginning=range?clock(range[1],range[2],range[3]||range[6]):clock(single![1],single![2],single![3]);
  const ending=range?clock(range[4],range[5],range[6]):null;
  const timeEvidence=span(unit,start+clockMatch.index!,start+clockMatch.index!+clockMatch[0].length);
  if(!beginning){candidate.issues.push('ambiguous_time');return;}
  if(range&&!range[3]&&ending&&ending<=beginning){candidate.issues.push('ambiguous_range_meridiem');return;}
  set(candidate,action?'actionLocal':'startLocal',`${first.date}T${beginning}`,[dateEvidence,timeEvidence]);
  if(ending&&!action)set(candidate,'endLocal',`${first.date}T${ending}`,[dateEvidence,timeEvidence]);
  if(!zone.zone){candidate.issues.push('timezone_missing');return;}
  const instant=localInstant(first.date,beginning,zone.zone);
  if(!instant){candidate.issues.push('invalid_or_ambiguous_local_time');return;}
  const statedZone=zone.match?.[1].toUpperCase();
  if(statedZone==='EST'||statedZone==='EDT'||statedZone?.includes('STANDARD')||statedZone?.includes('DAYLIGHT')){
    const actual=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'short'}).formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName')?.value;
    const expected=statedZone==='EST'||statedZone.includes('STANDARD')?'EST':'EDT';
    if(actual!==expected){candidate.issues.push('timezone_abbreviation_conflict');return;}
  }
  const zoneEvidence=zone.match?span(unit,start+zone.match.index!,start+zone.match.index!+zone.match[0].length):null;
  const evidence=zoneEvidence?[dateEvidence,timeEvidence,zoneEvidence]:[dateEvidence,timeEvidence];
  set(candidate,action?'occursAt':'startAt',instant,evidence);
  // Context zone is recorded as context, never forged as a literal source timezone claim.
  set(candidate,'datePrecision','instant',evidence);
  if(ending&&!action){const finish=localInstant(first.date,ending,zone.zone);if(finish&&Date.parse(finish)>Date.parse(instant))set(candidate,'endAt',finish,evidence);else candidate.issues.push('end_time_conflict_or_overnight_requires_review');}
  else if(!action)candidate.issues.push('end_time_missing');
}
function lineOffsets(text:string) {
  let offset=0;return text.split('\n').map(line=>{const start=offset;offset+=line.length+1;return {text:line.trim(),start:start+line.search(/\S|$/),end:start+line.trimEnd().length};}).filter(line=>line.text);
}
/** Conservative supported-pattern baseline. Every output stays quarantined for review. */
export function extractCandidates(units:ExtractionUnit[],context:ExtractionContext={}):ExtractionCandidate[] {
  const candidates:ExtractionCandidate[]=[]; const seen=new Set<string>(); const counters={event:0,action:0,resource:0};
  for(const unit of units) {
    if(unit.status!=='processed'||!unit.text.trim())continue;
    const lines=lineOffsets(unit.text).filter(line=>!/^\[(PDF text layer|Visual OCR)\]$/.test(line.text));
    const suspicious=lines.some(line=>instruction.test(line.text));
    const usable=lines.filter(line=>!instruction.test(line.text));
    let titleLine=usable.find(line=>line.text.length>=4&&line.text.length<=180&&!/^(date|time|location|venue|doors|tickets?|applications?|deadline|registration|rsvp|https?:|\d{4}-)/i.test(line.text)&&!sourceDates(line.text,context).length);
    if(!titleLine){const line=usable.find(line=>sourceDates(line.text,context)[0]?.start>=4&&!/^(date|time|applications?|deadline|tickets?|registration)\b/i.test(line.text));if(line){const end=sourceDates(line.text,context)[0].start;const heading=line.text.slice(0,end).trimEnd();titleLine={text:heading,start:line.start,end:line.start+heading.length};}}
    const title=titleLine?.text;
    const actionLines=usable.filter(line=>/\b(?:applications? (?:due|close|deadline)|apply by|application deadline|tickets? (?:on sale|available|release)|on[- ]sale|registration (?:opens?|closes?)|RSVP by|waitlist (?:opens?|open))\b/i.test(line.text));
    for(const line of actionLines) {
      const item:ExtractionCandidate={key:'',kind:'action',fields:{title:null,actionType:null,occursAt:null,occursOn:null,timeZone:null,datePrecision:null},claims:[],issues:['unreviewed_extraction']};
      const type=/application|apply by/i.test(line.text)?'application_deadline':/registration.*clos|RSVP by/i.test(line.text)?'registration_deadline':/registration/i.test(line.text)?'registration_open':/waitlist/i.test(line.text)?'waitlist_open':'ticket_release';
      set(item,'title',title||line.text,span(unit,titleLine?.start??line.start,titleLine?.end??line.end));
      set(item,'actionType',type,span(unit,line.start,line.end));
      temporal(item,unit,line.start,line.end,context,true);
      if(/sold out|available now|still available/i.test(line.text))item.issues.push('ticket_inventory_requires_current_authoritative_check');
      if(suspicious)item.issues.push('source_contains_instruction_like_text');
      item.issues.push(...unit.issues);
      const identity=JSON.stringify([extractionUnitId(unit),item.kind,item.fields]);if(seen.has(identity))continue;seen.add(identity);item.key=`action:${counters.action++}`;candidates.push(item);
    }
    const eventLines=usable.filter(line=>!actionLines.includes(line));
    const eventDates=eventLines.flatMap(line=>sourceDates(line.text,context));
    const eventWords=/\b(?:lecture|speaker|concert|recital|screening|film|trip|workshop|meeting|seminar|symposium|performance|audition|fair|exhibition|open house|reading|tournament|volunteer|hike|social|festival|talk|session|event)\b/i.test(usable.map(l=>l.text).join(' '));
    const resourceWords=/\b(?:club|organization|scholarship|fellowship|research program|internship|resource)\b/i.test(usable.map(l=>l.text).join(' '));
    if(!title||(!eventDates.length&&!eventWords&&!resourceWords))continue;
    const guide=!eventDates.length&&/\b(?:guide|brochure|how to|what to expect|what.s inside|objectives|helpful resources|sample portfolio|tips for|questions to ask|what is a career fair|before a career fair|after a career fair|during a career fair)\b/i.test(usable.slice(0,4).map(l=>l.text).join(' '));
    const item:ExtractionCandidate={key:'',kind:!guide&&(eventDates.length||eventWords)?'event':'resource',fields:{title:null,date:null,startAt:null,endAt:null,timeZone:null,datePrecision:null,status:null,location:null,price:null,eligibility:null},claims:[],issues:['unreviewed_extraction','headline_rule_requires_review']};
    set(item,'title',title,span(unit,titleLine!.start,titleLine!.end));
    if(item.kind==='event'&&eventLines.length){
      // Action-line dates are excluded, including when an event and application share a flyer.
      const dateLine=eventLines.find(line=>sourceDates(line.text,context).length);
      if(dateLine){
        const next=eventLines.slice(eventLines.indexOf(dateLine)+1,eventLines.indexOf(dateLine)+5).find(line=>! /\bdoors\b/i.test(line.text)&&/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(line.text));
        const until=next?next.end:dateLine.end;
        temporal(item,unit,dateLine.start,until,context,false);
        if(eventDates.map(d=>d.date).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).length>1){
          item.issues.push('multiple_or_conflicting_dates_require_review');
          for(const field of ['date','startAt','endAt','datePrecision','startLocal','endLocal']){item.fields[field]=null;item.claims=item.claims.filter(claim=>claim.field!==field);}
        }
      }
      else item.issues.push('date_unknown');
    }
    const cancelled=usable.find(line=>/\b(?:event|meeting|performance|concert|trip|session) (?:is |has been )?cancel[le]{1,2}d\b|^cancel[le]{1,2}d\b/i.test(line.text)&&!/\b(?:not|never) cancel/i.test(line.text));
    if(cancelled)set(item,'status','cancelled',span(unit,cancelled.start,cancelled.end));
    const location=usable.find(line=>/^(?:location|venue|where)\s*:/i.test(line.text));
    if(location)set(item,'location',location.text.replace(/^[^:]+:\s*/,''),span(unit,location.start,location.end));
    const price=usable.find(line=>/\bfree (?:admission|entry|and open to the public)\b|(?:admission|tickets?|cost|price)\s*:\s*\$\d+/i.test(line.text));
    if(price)set(item,'price',price.text,span(unit,price.start,price.end));
    const eligibility=usable.find(line=>/^(?:eligibility|eligible|open to|for FSU students|FSU students only)\b/i.test(line.text));
    if(eligibility)set(item,'eligibility',eligibility.text,span(unit,eligibility.start,eligibility.end));
    const organizer=usable.find(line=>/^(?:organizer|host|hosted by)\s*:/i.test(line.text));
    if(organizer)set(item,'organizer',organizer.text.replace(/^[^:]+:\s*/,''),span(unit,organizer.start,organizer.end));
    if(/\bevery\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|\bweekly\b|\bexcept\b/i.test(unit.text))item.issues.push('recurrence_or_exception_requires_review');
    const doors=usable.find(line=>/\bdoors\b/i.test(line.text));
    if(doors){
      item.issues.push('doors_time_separate_from_event_start');
      const match=doors.text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i),date=item.fields.date,zone=timeZone(doors.text,context);
      if(match&&typeof date==='string'){
        const time=clock(match[1],match[2],match[3]),dateEvidence=item.claims.find(claim=>claim.field==='date')?.evidence||[];
        if(time){const e=span(unit,doors.start,doors.end);set(item,'doorsLocal',`${date}T${time}`,[...dateEvidence,e]);if(zone.zone){const value=localInstant(date,time,zone.zone);if(value)set(item,'doorsAt',value,[...dateEvidence,e]);}}
      }
    }
    if(suspicious)item.issues.push('source_contains_instruction_like_text');
    item.issues.push(...unit.issues);
    const identity=JSON.stringify([extractionUnitId(unit),item.kind,item.fields]);if(!seen.has(identity)){seen.add(identity);item.key=`${item.kind}:${counters[item.kind]++}`;candidates.push(item);}
    if(candidates.length>=30)break;
  }
  return candidates.slice(0,30).map(item=>({...item,issues:[...new Set(item.issues)]}));
}
export function providedTextUnit(text:string):ExtractionUnit {return {assetId:'text',page:null,status:'processed',method:'provided-text',sha256:createHash('sha256').update(text).digest('hex'),text,issues:text.trim()?[]:['no_provided_text']};}
