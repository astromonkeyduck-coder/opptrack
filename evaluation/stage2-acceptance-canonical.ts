/** Frozen source-to-canonical comparison only; never repairs actual source predictions. */
import type { ExtractionCandidate,Primitive } from '../lib/extraction/contracts';
const instant=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
function civilDate(at:Primitive|undefined,zone:Primitive|undefined):string|null{
 if(typeof at!=='string'||!instant.test(at)||!Number.isFinite(Date.parse(at))||typeof zone!=='string'||!zone)return null;
 const day=Date.parse(at.slice(0,10)+'T00:00:00Z'),clock=at.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==at.slice(0,10)||!clock||Number(clock[1])>23||Number(clock[2])>59||Number(clock[3]??0)>59)return null;
 try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));const value=(type:string)=>parts.find(part=>part.type===type)?.value;return `${value('year')}-${value('month')}-${value('day')}`;}catch{return null;}
}
/** Source literal civil dates are not silently treated as campus-local dates. */
export function projectCanonicalComparison(candidate:ExtractionCandidate):Record<string,Primitive>{
 const fields={...candidate.fields};
 if(candidate.kind==='event'&&typeof fields.startAt==='string')fields.date=typeof fields.eventLocalDate==='string'?fields.eventLocalDate:civilDate(fields.startAt,fields.timeZone);
 if(candidate.kind==='action'&&typeof fields.occursAt==='string')fields.occursOn=typeof fields.actionLocalDate==='string'?fields.actionLocalDate:civilDate(fields.occursAt,fields.timeZone);
 return fields;
}
