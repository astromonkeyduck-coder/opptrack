/** Frozen semantic registry. Partial time and routing facts cannot be downgraded. */
const critical=new Set(['title','date','start','end','location','venue','room','cost','price','eligibility','availability','status','lifecycle','action_type','organizer']);
const semanticTokens=new Set(['date','year','month','day','clock','start','end','doors','deadline','time','timezone','zone','offset','precision','range','phase','status','availability','cost','price','eligibility','url','uri','link','id','title','location','venue','room','building','organizer']);
export function isAcceptanceCriticalField(field:string):boolean{
 const words=field.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
 return critical.has(words.join('_'))||words.some(word=>semanticTokens.has(word))||words.at(-1)==='at'||words.at(-1)==='local'||words.at(-1)==='on';
}
/** Minimum explicit known/unknown contract is code-bound, never supplied by candidate metadata. */
export const ACCEPTANCE_REQUIRED_FIELDS={
 event:['title','date','startAt','endAt','timeZone','status','location','cost','eligibility'],
 action:['title','actionType','occursOn','occursAt','timeZone','availability','eligibility'],
 resource:['title','eligibility'],
} as const;
