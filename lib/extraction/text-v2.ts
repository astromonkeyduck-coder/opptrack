import { createHash } from 'node:crypto';
import { reminderLocalInstant } from '../calendar/time';
import { extractionUnitId, type EvidenceSpan, type ExtractionCandidate, type Primitive } from './contracts';
import type { ExtractionUnit } from './media-types';

export type ExtractionContext = { publishedAt?: string | null; timeZone?: string | null };
type Match = { date: string | null; start: number; end: number; issue?: string };
type Line = { text: string; start: number; end: number };
type TemporalOptions = { exclude?: Line[]; date?: { value: string; evidence: EvidenceSpan[] }; zoneLine?: Line };
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
  else if(h<=12&&hour!=='00')return null; // Only explicit 00:xx is unambiguous below 13.
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function timeZone(text:string,context:ExtractionContext):{zone:string|null;match:RegExpMatchArray|null;conflict:boolean} {
  const matches=[...text.matchAll(/\b(America\/New_York|UTC|Eastern(?:\s+(?:Standard|Daylight))?(?:\s+Time)?|EST|EDT|ET)\b/gi)];
  const zones=new Set(matches.map(match=>match[1].toUpperCase()==='UTC'?'UTC':'America/New_York'));
  const abbreviations=new Set(matches.flatMap(match=>/^(?:EST|EDT)$/i.test(match[1])?[match[1].toUpperCase()]:[])),conflict=zones.size>1||abbreviations.size>1;
  return {zone:conflict?null:matches.length?matches[0][1].toUpperCase()==='UTC'?'UTC':'America/New_York':context.timeZone||null,match:matches[0]??null,conflict};
}
function localInstant(date:string,time:string,zone:string):string|null {
  const local=`${date}T${time}`;
  try {if(zone==='America/New_York')return reminderLocalInstant(local);if(zone==='UTC')return new Date(`${local}:00Z`).toISOString();return null;}catch{return null;}
}
function sourceInstant(value:string):string|null {
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/);
  if(!match||!validDate(Number(match[1]),Number(match[2]),Number(match[3]))||Number(match[4])>23||Number(match[5])>59||Number(match[6]||0)>59||Number(match[9]||0)>14||Number(match[10]||0)>59||(Number(match[9])===14&&Number(match[10])!==0))return null;
  const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
function temporal(candidate:ExtractionCandidate,unit:ExtractionUnit,start:number,end:number,context:ExtractionContext,action:boolean,options:TemporalOptions={}) {
  // Mask only excluded components, preserving UTF-16 positions for exact evidence.
  let text=unit.text.slice(start,end);
  for(const excluded of options.exclude||[]) {
    const from=Math.max(0,excluded.start-start),to=Math.min(text.length,excluded.end-start);
    if(to>from)text=text.slice(0,from)+' '.repeat(to-from)+text.slice(to);
  }
  const explicit=text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/);
  if(explicit&&!options.date){
    const value=sourceInstant(explicit[0]),day=explicit[0].slice(0,10),evidence=span(unit,start+explicit.index!,start+explicit.index!+explicit[0].length);
    if(!value){candidate.issues.push('invalid_date_or_source_instant');return;}
    set(candidate,action?'occursOn':'date',day,evidence);set(candidate,action?'occursAt':'startAt',value,evidence);set(candidate,action?'actionLocal':'startLocal',explicit[0].slice(0,16),evidence);set(candidate,'datePrecision','instant',evidence);
    if(!action){const after=text.slice(explicit.index!+explicit[0].length),finish=after.match(/\bend\s*:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))\b/i),finishValue=finish?sourceInstant(finish[1]):null;if(finish&&finishValue&&Date.parse(finishValue)>Date.parse(value)){const at=start+explicit.index!+explicit[0].length+finish.index!+finish[0].indexOf(finish[1]),endEvidence=span(unit,at,at+finish[1].length);set(candidate,'endAt',finishValue,endEvidence);set(candidate,'endLocal',finish[1].slice(0,16),endEvidence);}else candidate.issues.push(finish?'end_time_conflict_or_overnight_requires_review':'end_time_missing');}
    return;
  }
  const dates=options.date?[]:sourceDates(text,context),first=dates[0];
  for(const date of dates)if(date.issue)candidate.issues.push(date.issue);
  const dateValues=[...new Set(dates.map(d=>d.date).filter(Boolean))];
  if(dateValues.length>1){candidate.issues.push('multiple_dates_require_review');return;}
  const date=options.date?.value||first?.date;
  if(!date)return;
  const dateEvidence=options.date?.evidence||[span(unit,start+first!.start,start+first!.end)];
  set(candidate,action?'occursOn':'date',date,dateEvidence);set(candidate,'datePrecision','date',dateEvidence);
  let zone=timeZone(text,context),zoneEvidence:EvidenceSpan|null=zone.match?span(unit,start+zone.match.index!,start+zone.match.index!+zone.match[0].length):null;
  if(!zone.match&&options.zoneLine){zone=timeZone(options.zoneLine.text,context);zoneEvidence=zone.match?span(unit,options.zoneLine.start+zone.match.index!,options.zoneLine.start+zone.match.index!+zone.match[0].length):null;}
  if(zone.conflict){candidate.issues.push('conflicting_timezones_require_review');return;}
  if(zone.zone&&zoneEvidence)set(candidate,'timeZone',zone.zone,zoneEvidence);
  const range=text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const single=range?null:text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const noon=!range&&!single?text.match(/\bnoon\b/i):null;
  const single24=!range&&!single&&!noon?text.match(/\b((?:1[3-9]|2[0-3]|00)):(\d{2})\b/):null;
  const clockMatch=range||single||noon||single24;
  if(!clockMatch)return;
  const beginning=range?clock(range[1],range[2],range[3]||range[6]):single?clock(single[1],single[2],single[3]):noon?'12:00':clock(single24![1],single24![2],undefined);
  const ending=range?clock(range[4],range[5],range[6]):null;
  const timeEvidence=span(unit,start+clockMatch.index!,start+clockMatch.index!+clockMatch[0].length);
  if(!beginning){candidate.issues.push('ambiguous_time');return;}
  if(range&&!range[3]&&ending&&ending<=beginning){candidate.issues.push('ambiguous_range_meridiem');return;}
  set(candidate,action?'actionLocal':'startLocal',`${date}T${beginning}`,[...dateEvidence,timeEvidence]);
  if(ending&&!action){if(ending>beginning)set(candidate,'endLocal',`${date}T${ending}`,[...dateEvidence,timeEvidence]);else candidate.issues.push('end_time_conflict_or_overnight_requires_review');}
  if(!zone.zone){candidate.issues.push('timezone_missing');return;}
  const instant=localInstant(date,beginning,zone.zone);
  if(!instant){candidate.issues.push('invalid_or_ambiguous_local_time');return;}
  const statedZone=zone.match?.[1].toUpperCase();
  if(statedZone==='EST'||statedZone==='EDT'||statedZone?.includes('STANDARD')||statedZone?.includes('DAYLIGHT')){
    const actual=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'short'}).formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName')?.value;
    const expected=statedZone==='EST'||statedZone.includes('STANDARD')?'EST':'EDT';
    if(actual!==expected){candidate.issues.push('timezone_abbreviation_conflict');return;}
  }
  const evidence=zoneEvidence?[...dateEvidence,timeEvidence,zoneEvidence]:[...dateEvidence,timeEvidence];
  set(candidate,action?'occursAt':'startAt',instant,evidence);set(candidate,'datePrecision','instant',evidence);
  if(ending&&!action&&ending>beginning){const finish=localInstant(date,ending,zone.zone);if(finish&&Date.parse(finish)>Date.parse(instant))set(candidate,'endAt',finish,evidence);else candidate.issues.push('end_time_conflict_or_overnight_requires_review');}
  else if(!action&&!ending)candidate.issues.push('end_time_missing');
}
function lineOffsets(text:string):Line[] {
  const lines:Line[]=[];let offset=0;
  const delimiter=/\n|;|[,.]\s+(?=(?:doors|show|performance|event|concert|bingo|tickets?|applications?|registration|deadline|rsvp)\b)/gi;
  const add=(end:number)=>{const line=text.slice(offset,end),first=line.search(/\S/);if(first>=0)lines.push({text:line.trim(),start:offset+first,end:offset+line.trimEnd().length});};
  for(const match of text.matchAll(delimiter)){add(match.index!);offset=match.index!+match[0].length;}
  add(text.length);return lines;
}
const eventNouns='event|lecture|speaker|concert|recital|screening|film|trip|workshop|meeting|seminar|symposium|performance|audition|fair|exhibition|open house|reading|tournament|volunteer|hike|social|festival|talk|session|bingo';
const eventPattern=new RegExp(`\\b(?:${eventNouns})\\b`,'i');
const clockPattern=/\b(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|(?:1[3-9]|2[0-3]|00):\d{2}|noon)\b/i;
function actionType(text:string):string|null {
  if(/\b(?:no|not|never)\b.{0,28}\b(?:deadline|due|on sale|opens?|closes?)\b|\b(?:may|might|could|if)\b.{0,32}\b(?:open|close|sale|due)\b/i.test(text))return null;
  if(/\b(?:applications?\s+(?:(?:are|is)\s+)?(?:due|close[sd]?|deadline)|apply by|application deadline)\b/i.test(text))return 'application_deadline';
  if(/\bapplication\s+(?:start|opens?)\s*:/i.test(text))return 'application_open';
  if(/\b(?:registration\s+(?:closes?|deadline)|RSVP by)\b/i.test(text))return 'registration_deadline';
  if(/\bregistration\s+opens?\b/i.test(text))return 'registration_open';
  if(/\bwaitlist\s+(?:opens?|open)\b/i.test(text))return 'waitlist_open';
  if(/\b(?:tickets?\s+(?:go(?:es)?\s+on sale|on sale|available|release)|on[- ]sale)\b/i.test(text))return 'ticket_release';
  return null;
}
function actionComponent(line:Line) {return /^(?:tickets?|applications?|apply\b|deadline|registration|rsvp|waitlist)\b/i.test(line.text)||actionType(line.text)!==null;}
function venueOnly(line:Line) {return !/\b(?:concert|performance|screening|lecture|workshop|festival)\b/i.test(line.text)&&/\b(?:hall|auditorium|cinema|building|room|amphitheat(?:er|re))\b(?:\s*\([^)]{1,16}\))?\s*$/i.test(line.text);}
function cancellation(line:Line) {
  if(/\b(?:not|never|no|may|might|could|if|unless|policy|policies|refund)\b/i.test(line.text))return false;
  return /^(?:cancel[le]{1,2}d\s*[:—–-]|status\s*:\s*cancel[le]{1,2}d\b)/i.test(line.text)||new RegExp(`\\b(?:${eventNouns})\\s+(?:is\\s+|has been\\s+)?cancel[le]{1,2}d\\b`,'i').test(line.text);
}
function descriptionStartConflict(structured:Line,lines:Line[]) {
  const known=structured.text.match(/T(\d{2}):(\d{2})/);if(!known)return false;
  return lines.some(line=>line!==structured&&[...line.text.matchAll(/\b(?:starts?|begins?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi)].some(match=>{
    const hour=Number(match[1]),minute=Number(match[2]||0),time=match[3]?clock(match[1],match[2],match[3]):null;
    return minute!==Number(known[2])||(time?time!==`${known[1]}:${known[2]}`:hour>12?hour!==Number(known[1]):hour%12!==Number(known[1])%12);
  }));
}
function clearTime(item:ExtractionCandidate,action:boolean) {
  const fields=action?['occursOn','occursAt','actionLocal','datePrecision']:['date','startAt','endAt','startLocal','endLocal','datePrecision'];
  for(const field of fields){item.fields[field]=null;item.claims=item.claims.filter(claim=>claim.field!==field);}
}
function dateSignatures(text:string) {
  const signatures=sourceDates(text).flatMap(date=>date.date?[date.date.slice(5)]:[]);
  for(const match of text.matchAll(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,'gi')))signatures.push(`${String(months[match[1].toLowerCase()]).padStart(2,'0')}-${String(Number(match[2])).padStart(2,'0')}`);
  return [...new Set(signatures)];
}
type Recurrence = { dates:string[]; rule:Line; evidence:EvidenceSpan[] };
function finiteRecurrence(unit:ExtractionUnit,lines:Line[],context:ExtractionContext):Recurrence|null {
  const weekdayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const rules=lines.filter(line=>/\b(?:every\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|(?:Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays))\b/i.test(line.text)),rule=rules[0];
  if(rules.length!==1||!rule||/\bexcept\b/i.test(rule.text)||!clockPattern.test(rule.text)||!timeZone(rule.text,{}).zone||lines.some(line=>line!==rule&&!/\b(?:except|no meeting|no session)\b/i.test(line.text)&&sourceDates(line.text,context).length))return null;
  let dates:string[]=[];
  const list=rule.text.match(new RegExp(`\\b(Sundays|Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays)\\s+(${monthNames})\\.?\\s+((?:\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,\\s*|\\s+and\\s+))+\\d{1,2}(?:st|nd|rd|th)?)\\s*,\\s*(\\d{4})\\b`,'i'));
  if(list){
    const weekday=weekdayNames.findIndex(day=>list[1].toLowerCase()===`${day.toLowerCase()}s`);
    dates=[...list[3].matchAll(/\d{1,2}/g)].map(match=>validDate(Number(list[4]),months[list[2].toLowerCase()],Number(match[0]))).filter((date):date is string=>!!date);
    if(dates.length!==[...list[3].matchAll(/\d{1,2}/g)].length||dates.some(date=>new Date(`${date}T12:00:00Z`).getUTCDay()!==weekday))return null;
  } else {
    const weekly=rule.text.match(/\bevery\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+from\b/i),bounds=sourceDates(rule.text,context);
    if(!weekly||!/\bthrough\b/i.test(rule.text)||bounds.length!==2||bounds.some(bound=>!bound.date))return null;
    const [first,last]=bounds.map(bound=>bound.date!),start=Date.parse(`${first}T12:00:00Z`),end=Date.parse(`${last}T12:00:00Z`),weekday=weekdayNames.findIndex(day=>day.toLowerCase()===weekly[1].toLowerCase());
    if(end<start||end-start>140*86400000||new Date(start).getUTCDay()!==weekday||new Date(end).getUTCDay()!==weekday)return null;
    for(let at=start;at<=end;at+=7*86400000)dates.push(new Date(at).toISOString().slice(0,10));
  }
  dates=[...new Set(dates)].sort();
  if(!dates.length||dates.length>20)return null;
  const exceptions=lines.filter(line=>/\b(?:except|no meeting|no session)\b/i.test(line.text)),evidence=[span(unit,rule.start,rule.end)];
  for(const exception of exceptions){
    const excluded=sourceDates(exception.text,context);
    if(!excluded.length||excluded.some(date=>!date.date||!dates.includes(date.date)))return null;
    dates=dates.filter(date=>!excluded.some(excludedDate=>excludedDate.date===date));evidence.push(span(unit,exception.start,exception.end));
  }
  if(evidence.length>6||!dates.length)return null;
  // Do not partially materialize an ambiguous DST occurrence or contradictory abbreviation.
  for(const date of dates){const candidate:ExtractionCandidate={key:'',kind:'event',fields:{},claims:[],issues:[]};temporal(candidate,unit,rule.start,rule.end,context,false,{date:{value:date,evidence}});if(!candidate.fields.startAt)return null;}
  return {dates,rule,evidence};
}
/** Conservative supported-pattern baseline. Every output stays quarantined for review. */
export function extractCandidates(units:ExtractionUnit[],context:ExtractionContext={}):ExtractionCandidate[] {
  const candidates:ExtractionCandidate[]=[];const seen=new Set<string>();const counters={event:0,action:0,resource:0};
  const limitIssue=()=>{const last=candidates.at(-1);if(last&&!last.issues.includes('candidate_limit_reached_additional_inputs_require_review'))last.issues.push('candidate_limit_reached_additional_inputs_require_review');};
  const append=(item:ExtractionCandidate,unit:ExtractionUnit)=>{const identity=JSON.stringify([extractionUnitId(unit),item.kind,item.fields]);if(seen.has(identity))return;if(candidates.length>=30){limitIssue();return;}seen.add(identity);item.key=`${item.kind}:${counters[item.kind]++}`;item.issues=[...new Set(item.issues)];candidates.push(item);};
  for(const unit of units) {
    if(candidates.length>=30){limitIssue();break;}
    if(unit.status!=='processed'||!unit.text.trim())continue;
    const lines=lineOffsets(unit.text).filter(line=>!/^\[(PDF text layer|Visual OCR)\]$/.test(line.text));
    const suspicious=lines.some(line=>instruction.test(line.text)),usable=lines.filter(line=>!instruction.test(line.text));
    const actionComponents=usable.filter(actionComponent),actionLines=actionComponents.filter(line=>actionType(line.text)!==null);
    const metadata=/^(?:date|start|end|time|timezone|location|venue|where|doors|tickets?|applications?|apply|deadline|registration|rsvp|waitlist|eligibility|eligible|organizer|host|cost|price|published|posted|https?:|\d{4}-)\b/i;
    let titleLine=usable.find(line=>line.text.length>=4&&line.text.length<=180&&!metadata.test(line.text)&&!venueOnly(line)&&!sourceDates(line.text,context).length&&!/^(?:Theatre|Rock|Classical|Jazz|Dance|Music|Comedy)$/i.test(line.text)&&!/^\b(?:no meeting|no session|except)\b/i.test(line.text));
    if(!titleLine){const line=usable.find(line=>sourceDates(line.text,context)[0]?.start>=4&&!metadata.test(line.text));if(line){const end=sourceDates(line.text,context)[0].start,heading=line.text.slice(0,end).trimEnd();titleLine={text:heading,start:line.start,end:line.start+heading.length};}}
    const title=titleLine?.text;
    const actionItems:Array<{item:ExtractionCandidate;line:Line;window:Line[];type:string}>=[];
    for(const line of actionLines) {
      const type=actionType(line.text)!,at=usable.indexOf(line),next=usable[at+1];
      // An adjacent date-only continuation is permitted; an intervening event/component is not.
      const continuation=next&&!actionComponent(next)&&!eventPattern.test(next.text)&&!/^doors\b/i.test(next.text)&&/^(?:\d{4}-|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b)/i.test(next.text)&&sourceDates(next.text,context).length?next:null;
      const window=continuation?[line,continuation]:[line];
      const item:ExtractionCandidate={key:'',kind:'action',fields:{title:null,actionType:null,occursAt:null,occursOn:null,timeZone:null,datePrecision:null},claims:[],issues:['unreviewed_extraction']};
      set(item,'title',title||line.text,span(unit,titleLine?.start??line.start,titleLine?.end??line.end));set(item,'actionType',type,span(unit,line.start,line.end));
      temporal(item,unit,line.start,continuation?.end??line.end,context,true);
      if(/sold out|available now|still available/i.test(line.text))item.issues.push('ticket_inventory_requires_current_authoritative_check');
      if(suspicious)item.issues.push('source_contains_instruction_like_text');item.issues.push(...unit.issues);actionItems.push({item,line,window,type});
    }
    // Incomplete month/day claims can contradict a nearby full deadline. Never silently select one.
    for(const action of actionItems){const related=actionItems.filter(other=>other.type===action.type),signatures=new Set(related.flatMap(other=>other.window.flatMap(line=>dateSignatures(line.text))));if(signatures.size>1){clearTime(action.item,true);action.item.issues.push('conflicting_action_dates_require_review');}}
    for(const action of actionItems)append(action.item,unit);
    const excluded=usable.filter(line=>actionComponent(line)||actionItems.some(action=>action.window.includes(line))||/\bdoors\b/i.test(line.text)||/^(?:published|posted|updated|no meeting|no session|except)\b/i.test(line.text));
    const eventLines=usable.filter(line=>!excluded.includes(line));
    const eventDates=eventLines.filter(line=>!/^end\s*:/i.test(line.text)).flatMap(line=>sourceDates(line.text,context)),body=usable.map(line=>line.text).join(' '),eventWords=eventPattern.test(body);
    const resourceWords=/\b(?:club|organization|scholarship|fellowship|research (?:program|directory|groups?)|internship|resources?|directory)\b/i.test(body);
    const guide=/\b(?:guide|brochure|directory|how to|what to expect|what.s inside|objectives|helpful resources|sample portfolio|tips for|questions to ask|what is a career fair|before a career fair|after a career fair|during a career fair)\b/i.test(usable.slice(0,4).map(line=>line.text).join(' '));
    const retail=/\b(?:merch(?:andise)?|apparel|shop now|storewide|discount|percent off|\d+% off)\b/i.test(body)&&!/\b(?:attend|join us|performance|workshop|concert|screening|lecture)\b/i.test(body);
    if(!title||retail||(!eventDates.length&&!eventWords&&!resourceWords))continue;
    const recurrenceMention=/\b(?:every\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|weekly|Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays|except|no meeting|no session)\b/i.test(body);
    let recurrence=finiteRecurrence(unit,eventLines.concat(usable.filter(line=>/\b(?:except|no meeting|no session)\b/i.test(line.text))),context);
    let recurrenceOverflow=false;
    if(recurrence&&candidates.length+recurrence.dates.length>30){recurrence=null;recurrenceOverflow=true;}
    const performanceLines=eventLines.filter(line=>/^(?:second|third|additional) performance\s*:/i.test(line.text));
    const datedLines=eventLines.filter(line=>sourceDates(line.text,context).length&&!/^end\s*:/i.test(line.text));
    const separatePerformances=performanceLines.length>0&&performanceLines.length<10&&datedLines.filter(line=>!performanceLines.includes(line)).length===1&&datedLines.every(line=>sourceDates(line.text,context).length===1&&sourceDates(line.text,context)[0].date!==null)&&candidates.length+performanceLines.length+1<=30;
    const occurrencePlans: Array<{line?:Line;date?:{value:string;evidence:EvidenceSpan[]};extra:boolean}> = recurrence?recurrence.dates.map(value=>({line:recurrence!.rule,date:{value,evidence:recurrence!.evidence},extra:false})):separatePerformances?[{extra:false},...performanceLines.map(line=>({line,extra:true}))]:[{extra:false}];
    for(const plan of occurrencePlans){
      const item:ExtractionCandidate={key:'',kind:!eventDates.length&&guide?'resource':eventDates.length||eventWords?'event':'resource',fields:{title:null,date:null,startAt:null,endAt:null,timeZone:null,datePrecision:null,status:null,location:null,price:null,eligibility:null},claims:[],issues:['unreviewed_extraction','headline_rule_requires_review']};
      set(item,'title',title,span(unit,titleLine!.start,titleLine!.end));
      if(item.kind==='event'&&eventLines.length){
        const structured=eventLines.find(line=>/^start\s*:\s*\d{4}-\d{2}-\d{2}T/i.test(line.text));
        const dateLine=plan.line||structured||eventLines.find(line=>!performanceLines.includes(line)&&sourceDates(line.text,context).length);
        if(dateLine){
          const index=usable.indexOf(dateLine);let next:Line|undefined;
          if(structured===dateLine&&/^end\s*:/i.test(usable[index+1]?.text||''))next=usable[index+1];
          if(!clockPattern.test(dateLine.text)&&!recurrence){for(const line of usable.slice(index+1,index+5)){if(actionComponent(line)||sourceDates(line.text,context).length||performanceLines.includes(line))break;if(/\bdoors\b/i.test(line.text))continue;if(clockPattern.test(line.text)){next=line;break;}}}
          const zoneLine=usable.find(line=>/^(?:time\s*zone|timezone)\s*:/i.test(line.text));
          temporal(item,unit,dateLine.start,next?.end??dateLine.end,context,false,{exclude:excluded,date:plan.date,zoneLine});
          if(structured&&eventLines.some(line=>line!==structured&&/\b(?:starts?|begins?)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\b/i.test(line.text))){item.issues.push('structured_and_description_start_require_review');if(descriptionStartConflict(structured,eventLines)){for(const field of ['startAt','endAt','startLocal','endLocal']){item.fields[field]=null;item.claims=item.claims.filter(claim=>claim.field!==field);}const dateClaim=item.claims.find(claim=>claim.field==='date');if(dateClaim)set(item,'datePrecision','date',dateClaim.evidence);item.issues.push('conflicting_event_start_times_require_review');}}
          if(!recurrence&&!separatePerformances&&new Set(eventDates.map(date=>date.date).filter(Boolean)).size>1){clearTime(item,false);item.issues.push('multiple_or_conflicting_dates_require_review');}
          if(recurrence){item.issues.push('finite_recurrence_materialized_requires_review');set(item,'recurrenceDerived',true,recurrence.evidence);}
        }else item.issues.push('date_unknown');
      }
      const cancelled=usable.find(cancellation);
      if(cancelled&&item.kind==='event'){
        const dates=sourceDates(cancelled.text,context),matchesDate=dates.length>0&&dates.every(date=>date.date!==null)&&dates.some(date=>date.date===item.fields.date),global=dates.length===0&&occurrencePlans.length===1;
        if(matchesDate||global)set(item,'status','cancelled',span(unit,cancelled.start,cancelled.end));else item.issues.push('cancellation_scope_requires_review');
      }
      const location=usable.find(line=>/^(?:location|venue|where)\s*:/i.test(line.text))||usable.find(venueOnly);
      if(location){const value=location.text.replace(/^[^:]+:\s*/,'');if(/\b(?:sign in|log in|login)\b|^(?:restricted|members only|requires? (?:membership|login))\b/i.test(value))item.issues.push('location_access_restricted');else if(/^(?:TBA|TBD|to be (?:announced|determined)|unknown)$/i.test(value))item.issues.push('location_unknown');else set(item,'location',value,span(unit,location.start,location.end));}
      const price=usable.find(line=>/\bfree (?:admission|entry|and open to the public)\b|(?:admission|tickets?|cost|price)\s*:\s*(?:\$\d+|free\b)/i.test(line.text));if(price)set(item,'price',price.text,span(unit,price.start,price.end));
      const eligibility=usable.find(line=>/^(?:eligibility|eligible|open to|for FSU students|FSU students only)\b/i.test(line.text));if(eligibility)set(item,'eligibility',eligibility.text,span(unit,eligibility.start,eligibility.end));
      const organizer=usable.find(line=>/^(?:organizer|host|hosted by)\s*:/i.test(line.text));if(organizer)set(item,'organizer',organizer.text.replace(/^[^:]+:\s*/,''),span(unit,organizer.start,organizer.end));
      if(recurrenceMention&&!recurrence)item.issues.push(recurrenceOverflow?'recurrence_expansion_exceeds_candidate_budget':'recurrence_or_exception_requires_review');
      const doors=usable.find(line=>/\bdoors\b/i.test(line.text));
      if(doors&&item.kind==='event'){
        item.issues.push('doors_time_separate_from_event_start');
        const match=doors.text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i),date=item.fields.date;
        if(match&&typeof date==='string'){const dateEvidence=item.claims.find(claim=>claim.field==='date')?.evidence||[],probe:ExtractionCandidate={key:'',kind:'action',fields:{},claims:[],issues:[]};temporal(probe,unit,doors.start,doors.end,context,true,{date:{value:date,evidence:dateEvidence}});for(const [from,to] of [['actionLocal','doorsLocal'],['occursAt','doorsAt']]){const claim=probe.claims.find(claim=>claim.field===from);if(claim)set(item,to,claim.value,claim.evidence);}item.issues.push(...probe.issues);}
        else if(/\b\d{1,2}(?::\d{2})?\b/.test(doors.text))item.issues.push('doors_time_meridiem_unknown');
      }
      if(suspicious)item.issues.push('source_contains_instruction_like_text');item.issues.push(...unit.issues);append(item,unit);
    }
  }
  return candidates;
}
export function providedTextUnit(text:string):ExtractionUnit {return {assetId:'text',page:null,status:'processed',method:'provided-text',sha256:createHash('sha256').update(text).digest('hex'),text,issues:text.trim()?[]:['no_provided_text']};}
