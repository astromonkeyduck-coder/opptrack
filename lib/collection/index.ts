import { load } from "cheerio";
import { z } from "zod";
import { CollectionFailure, fetchPage, sha256, stableHash } from "./http";
import type { CollectionBatch, CollectionOptions, NormalizedMilestone, NormalizedOccurrence, NormalizedOpportunity, RawPage } from "./types";
import { collectHq, hqEvidenceUids } from "./hq";
import { collectOfficialDeadlines, assertOfficialDeadlineEvidence, OFFICIAL_DEADLINE_URLS } from "./official-deadlines";
import { collectOfficialTickets, assertOfficialTicketEvidence } from "./official-tickets";

export type { CollectionBatch, CollectionOptions, NormalizedMilestone, NormalizedOccurrence, NormalizedOpportunity, RawPage } from "./types";
export { parseRetryAfter, retryDelaySeconds } from "./http";
export { collectHq } from "./hq";

const nativeId = z.union([z.string().min(1), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const instant = z.string().refine(v => /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)), "Expected an explicit-offset source timestamp");
const nullInstant = instant.nullable().optional();
const nullableText = z.string().nullable().optional();
const localistEvent = z.looseObject({
  id: nativeId, title: z.string().min(1), localist_url: nullableText, url: nullableText,
  description_text: nullableText, description: nullableText, location_name: nullableText, location: z.unknown().optional(),
  room_number: nullableText, timezone: nullableText, created_at: nullInstant, updated_at: nullInstant,
  status: nullableText, event_instances: z.array(z.object({event_instance: z.looseObject({
    id: nativeId, event_id: nativeId.optional(), start: nullInstant, end: nullInstant, all_day: z.boolean().optional(),
  })})).min(1),
});
const localistEnvelope = z.object({
  events: z.array(z.object({ event: localistEvent })),
  page: z.object({ current: z.number().int().positive(), total: z.number().int().nonnegative(), total_items: z.number().int().nonnegative(), next_page: z.number().int().positive().nullable() }),
});

const normalizedBatchSchema = z.object({
  sourceId: z.string().min(1), parserVersion: z.string().min(1), startedAt: instant, finishedAt: instant,
  status: z.enum(["success", "partial", "failed", "blocked", "rate_limited"]), reason: z.string().nullable(), retryAfterSeconds: z.number().nonnegative().nullable(),
  pages: z.array(z.object({ nativeId:z.string().min(1), url:z.url(), contentType:z.string(), body:z.string(), sha256:z.string().regex(/^[a-f0-9]{64}$/), byteCount:z.number().int().nonnegative(), fetchedAt:instant, httpStatus:z.number().int() })),
  opportunities: z.array(z.object({ nativeId:z.string().min(1), title:z.string().min(1), description:z.string().nullable(), sourceUrl:z.url(), kind:z.enum(["event","program"]), campusRelation:z.enum(["campus","fsu_affiliated","unknown"]), categories:z.array(z.string()), sourcePublishedAt:instant.nullable(), sourceUpdatedAt:instant.nullable(), uncertainties:z.array(z.string()), contentSha256:z.string().regex(/^[a-f0-9]{64}$/), captureNativeId:z.string().min(1), evidencePointer:z.string().min(1) })),
  occurrences: z.array(z.object({ nativeId:z.string().min(1), opportunityNativeId:z.string().min(1), startAt:instant.nullable(), endAt:instant.nullable(), startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), timezone:z.string().nullable(), sourceLocalText:z.string().nullable(), datePrecision:z.enum(["instant","date","unknown"]), location:z.string().nullable(), allDay:z.boolean(), lifecycle:z.enum(["scheduled","cancelled","postponed","unknown"]), contentSha256:z.string().regex(/^[a-f0-9]{64}$/), captureNativeId:z.string().min(1), evidencePointer:z.string().min(1) })),
  milestones: z.array(z.object({ nativeId:z.string().min(1), opportunityNativeId:z.string().min(1), occurrenceNativeId:z.string().nullable(), kind:z.enum(["application_deadline","application_open","ticket_release","ticket_link"]), occursAt:instant.nullable(), occursOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), sourceLocalText:z.string().nullable(), timezone:z.string().nullable(), availability:z.string().nullable(), actionUrl:z.url().nullable(), uncertainty:z.string().nullable(), contentSha256:z.string().regex(/^[a-f0-9]{64}$/), captureNativeId:z.string().min(1), evidencePointer:z.string().min(1) })).optional(),
  cursor:z.record(z.string(),z.unknown()).nullable(),
  observations:z.object({requests:z.number().int().nonnegative(),httpStatuses:z.array(z.number().int()),bytes:z.number().int().nonnegative(),nativeRows:z.number().int().nonnegative(),paginationComplete:z.boolean(),windowFrom:z.string().nullable(),windowTo:z.string().nullable(),warnings:z.array(z.string())}),
});

/** Validate before the trusted persistence boundary; source text cannot add action capabilities. */
export function validateCollectionBatch(batch: unknown): CollectionBatch {
  const result = normalizedBatchSchema.parse(batch);
  const milestones = result.milestones ?? [];
  const captureIds = new Set(result.pages.map(p => p.nativeId));
  const eventIds = new Set(result.opportunities.map(o => o.nativeId));
  if (captureIds.size !== result.pages.length || eventIds.size !== result.opportunities.length || new Set(result.occurrences.map(o => o.nativeId)).size !== result.occurrences.length || new Set(milestones.map(o=>o.nativeId)).size !== milestones.length) throw new Error("Duplicate native identity in normalized batch");
  if (result.status === "success" && (!result.observations.paginationComplete || !result.pages.length || result.reason !== null)) throw new Error("Success requires a captured complete response");
  if (result.status !== "success" && (!result.reason || result.cursor !== null || result.observations.paginationComplete)) throw new Error("Incomplete collection must retain its reason without advancing the cursor");
  for(const page of result.pages)if(sha256(page.body)!==page.sha256||Buffer.byteLength(page.body)!==page.byteCount)throw new Error("Private capture content does not match its hash or byte count");
  for (const item of [...result.opportunities, ...result.occurrences, ...milestones]) if (!captureIds.has(item.captureNativeId)) throw new Error("Evidence references an uncaptured response");
  const hqUidsByCapture = new Map<string, string[]>();
  for(const item of [...result.opportunities,...result.occurrences,...milestones]) {
    const page=result.pages.find(p=>p.nativeId===item.captureNativeId)!;
    if(Object.hasOwn(OFFICIAL_DEADLINE_URLS,result.sourceId) && !item.evidencePointer.startsWith("official-deadline:"))throw new Error("Official deadline source requires its own evidence format");
    if(result.sourceId==="fsu-opening-nights" && !item.evidencePointer.startsWith("official-ticket:"))throw new Error("Official ticket source requires its own evidence format");
    if(Object.hasOwn(OFFICIAL_DEADLINE_URLS,result.sourceId)||result.sourceId==="fsu-opening-nights") {
      const {contentSha256,captureNativeId,evidencePointer,...facts}=item;
      if(stableHash(facts)!==contentSha256)throw new Error("Official normalized facts do not match their semantic content hash");
    }
    if(item.evidencePointer.startsWith("/")){
      let value:unknown=JSON.parse(page.body);
      for(const segment of item.evidencePointer.slice(1).split("/"))value=(value as Record<string,unknown>)?.[segment.replace(/~1/g,"/").replace(/~0/g,"~")];
      if(value===undefined)throw new Error("JSON evidence pointer does not resolve in its capture");
    } else if(item.evidencePointer.startsWith("ics-vevent:")) {
      if(result.sourceId!=="fsu-hq-public-export")throw new Error("ICS evidence belongs only to the HQ public export");
      const match=item.evidencePointer.match(/^ics-vevent:(0|[1-9]\d*)$/);
      if(!match)throw new Error("Invalid HQ VEVENT evidence pointer");
      let uids=hqUidsByCapture.get(page.nativeId);
      if(!uids){uids=hqEvidenceUids(page.body);hqUidsByCapture.set(page.nativeId,uids);}
      const index=Number(match[1]);
      if(!Number.isSafeInteger(index)||uids[index]!==item.nativeId)throw new Error("HQ evidence UID does not match the normalized native identity");
    } else if(item.evidencePointer.startsWith("official-deadline:")) {
      if("startAt" in item)throw new Error("Application milestones cannot become attendance occurrences");
      assertOfficialDeadlineEvidence(result.sourceId,item,page);
    } else if(item.evidencePointer.startsWith("official-ticket:")) {
      assertOfficialTicketEvidence(result.sourceId,item,page);
    } else if(!item.evidencePointer.startsWith("music-card:/event/"))throw new Error("Unrecognized evidence pointer format");
  }
  for (const item of result.occurrences) if (!eventIds.has(item.opportunityNativeId)) throw new Error("Occurrence references an unknown opportunity");
  for(const item of milestones) {
    if(!eventIds.has(item.opportunityNativeId))throw new Error("Milestone references an unknown opportunity");
    if(item.occurrenceNativeId && !result.occurrences.some(row=>row.nativeId===item.occurrenceNativeId && row.opportunityNativeId===item.opportunityNativeId))throw new Error("Milestone occurrence must belong to its opportunity");
    if(item.occursOn && new Date(`${item.occursOn}T12:00:00Z`).toISOString().slice(0,10)!==item.occursOn)throw new Error("Milestone date is invalid");
    if(item.actionUrl) { const url=new URL(item.actionUrl);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Milestone action link must be public HTTPS"); }
  }
  return result;
}

function context(sourceId: string, parserVersion: string, options: CollectionOptions) {
  const now = options.now ?? (() => new Date());
  const batch: CollectionBatch = {sourceId, parserVersion, startedAt:now().toISOString(), finishedAt:now().toISOString(), status:"failed", reason:"Collection not complete", retryAfterSeconds:null, pages:[],opportunities:[],occurrences:[],cursor:null,observations:{requests:0,httpStatuses:[],bytes:0,nativeRows:0,paginationComplete:false,windowFrom:null,windowTo:null,warnings:[]}};
  const fetchOptions = {fetch:options.fetch ?? globalThis.fetch, now,maxBytes:options.maxBytes ?? 3_145_728,timeoutMs:options.timeoutMs ?? 25_000};
  const fetchAndCapture = async (url: string, captureId: string) => {
    const fetched = await fetchPage(url,captureId,fetchOptions);
    batch.pages.push(fetched.page); batch.observations.requests+=fetched.requests;batch.observations.httpStatuses.push(fetched.page.httpStatus); batch.observations.bytes+=fetched.page.byteCount;
    return fetched.page;
  };
  const finish = () => {batch.finishedAt=now().toISOString();return validateCollectionBatch(batch);};
  const fail = (error: unknown) => {
    const failure = error instanceof CollectionFailure ? error : new CollectionFailure("Response failed schema or parser validation; no successful empty result");
    batch.observations.requests+=failure.requestCount;
    if(failure.httpStatus!==null)batch.observations.httpStatuses.push(failure.httpStatus);
    batch.status = batch.pages.length && failure.outcome === "failed" ? "partial" : failure.outcome;
    batch.reason=failure.message;batch.retryAfterSeconds=failure.retryAfterSeconds;batch.cursor=null;batch.observations.paginationComplete=false;
    return finish();
  };
  return {batch,fetchAndCapture,finish,fail,now};
}

function plainText(value: string | null | undefined): string | null {
  if (!value) return null;
  const $ = load(value); $("script,style").remove();
  $("p,div,li,br,h1,h2,h3,h4,time").append(" ");
  const text = $.text().replace(/\s+/g," ").trim();
  return text || null;
}

function publicEventUrl(value: string | undefined | null, capturedUrl: string): string {
  try {const url=new URL(value ?? "");if(url.protocol==="https:"&&!url.username&&!url.password)return url.href;}catch{/* Use the actual captured page if a source detail URL is absent. */}
  return capturedUrl;
}

function classifyHtml(body: string) {
  const $=load(body);$("script,style").remove(); const text=$.text().replace(/\s+/g," ");
  if (/\[(?:eventName|eventDates|eventUrlTitle)\]/i.test(text)) throw new CollectionFailure("Source returned an unrendered dynamic template", "blocked");
  if (/you must sign in|please sign in to continue|login required|sign in to continue|access denied|verify you are human|just a moment\.\.\.|service unavailable/i.test(text)) throw new CollectionFailure("Source returned an access or error page with HTTP 200", "blocked");
  return {$,text};
}

/** Localist total_items counts event-occurrence rows, not distinct event IDs. */
export async function collectCentralCalendar(options: CollectionOptions = {}): Promise<CollectionBatch> {
  const ctx=context("fsu-calendar-api","localist-v1",options);const {batch}=ctx;
  try {
    const start=options.startDate ?? new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(ctx.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))) throw new CollectionFailure("Invalid requested date window");
    const days=options.days ?? 7;if(!Number.isInteger(days)||days<1||days>31)throw new CollectionFailure("Collection window must be one to 31 days");
    const end=new Date(`${start}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+days);
    batch.observations.windowFrom=start;batch.observations.windowTo=end.toISOString().slice(0,10);
    const opportunities=new Map<string,NormalizedOpportunity>();const occurrences=new Map<string,NormalizedOccurrence>();const signatures=new Set<string>();
    let pageNumber=1;let expectedTotal:number|null=null;let expectedPages:number|null=null;
    const maxPages=options.maxPages ?? 16;
    for(let visited=0;visited<maxPages;visited++) {
      const url=new URL("https://calendar.fsu.edu/api/2/events");url.search=new URLSearchParams({start,days:String(days),pp:"100",page:String(pageNumber)}).toString();
      const page=await ctx.fetchAndCapture(url.href,`page:${pageNumber}`);
      if(page.contentType.includes("html") || /^\s*</.test(page.body)) {classifyHtml(page.body);throw new CollectionFailure("Calendar API returned HTML instead of a JSON envelope");}
      const envelope=localistEnvelope.parse(JSON.parse(page.body));const meta=envelope.page;
      if(meta.current!==pageNumber)throw new CollectionFailure("Calendar current page differs from the requested page");
      if(expectedTotal!==null&&(meta.total_items!==expectedTotal||meta.total!==expectedPages))throw new CollectionFailure("Calendar pagination totals changed during collection; retry an overlapping window");
      expectedTotal=meta.total_items;expectedPages=meta.total;
      batch.observations.nativeRows+=envelope.events.length;
      if(batch.observations.nativeRows>meta.total_items || (!envelope.events.length&&batch.observations.nativeRows<meta.total_items))throw new CollectionFailure("Calendar page is truncated or disagrees with its declared total");
      const signature=stableHash(envelope.events.map(({event})=>[event.id,event.event_instances.map(i=>i.event_instance.id)]));
      if(envelope.events.length&&signatures.has(signature))throw new CollectionFailure("Calendar repeated a previously captured page");signatures.add(signature);
      envelope.events.forEach(({event}, index)=>{
        const location=plainText(event.location_name) || (typeof event.location==="string"?plainText(event.location):null);
        const locationWithheld=!!location&&/sign in to (?:download|view|see|access)|log\s?in (?:required|to (?:view|see|access))|location (?:is )?(?:private|restricted|withheld)/i.test(location);
        const room=plainText(event.room_number);const locationText=locationWithheld?null:[location,room].filter(Boolean).join(", ")||null;
        const facts={nativeId:event.id,title:plainText(event.title)??event.title,description:plainText(event.description_text??event.description),sourceUrl:publicEventUrl(event.localist_url??event.url,page.url),kind:"event" as const,campusRelation:"fsu_affiliated" as const,categories:[] as string[],sourcePublishedAt:event.created_at??null,sourceUpdatedAt:event.updated_at??null,uncertainties:["Ticket availability and release dates are unverified",...(locationWithheld?["Location withheld by source; sign-in required"]:locationText?[]:["Location is unknown"])]};
        const normalized={...facts,contentSha256:stableHash(facts),captureNativeId:page.nativeId,evidencePointer:`/events/${index}/event`};
        const previous=opportunities.get(event.id);
        if(previous&&previous.contentSha256!==normalized.contentSha256)throw new CollectionFailure("An event changed between pagination rows; retry the collection window");
        if(!previous)opportunities.set(event.id,normalized);
        event.event_instances.forEach(({event_instance:instance},instanceIndex)=>{
          if(instance.event_id&&instance.event_id!==event.id)throw new CollectionFailure("Calendar occurrence references a different native event");
          const allDay=instance.all_day??false;
          const lifecycle=/cancel/i.test(event.status??"")?"cancelled" as const:/postpon/i.test(event.status??"")?"postponed" as const:"scheduled" as const;
          const instanceFacts={nativeId:instance.id,opportunityNativeId:event.id,startAt:allDay?null:instance.start??null,endAt:allDay?null:instance.end??null,startDate:instance.start?.slice(0,10)??null,timezone:event.timezone??null,sourceLocalText:instance.start??null,datePrecision:allDay?"date" as const:instance.start?"instant" as const:"unknown" as const,location:locationText,allDay,lifecycle};
          if(occurrences.has(instance.id))throw new CollectionFailure("Calendar repeated a native occurrence; pagination cannot be trusted");
          occurrences.set(instance.id,{...instanceFacts,contentSha256:stableHash(instanceFacts),captureNativeId:page.nativeId,evidencePointer:`/events/${index}/event/event_instances/${instanceIndex}/event_instance`});
        });
      });
      batch.opportunities=[...opportunities.values()];batch.occurrences=[...occurrences.values()];
      if(meta.next_page===null) {
        if(batch.observations.nativeRows!==meta.total_items || (meta.total_items>0&&pageNumber!==meta.total))throw new CollectionFailure("Terminal calendar page does not match declared totals");
        batch.status="success";batch.reason=null;batch.observations.paginationComplete=true;batch.cursor={windowFrom:start,windowTo:batch.observations.windowTo,completedAt:ctx.now().toISOString()};
        batch.observations.warnings.push("Bounded public central-calendar window only; no complete campus or private HQ coverage", "Ticket availability is unverified; no action milestones inferred");
        return ctx.finish();
      }
      if(meta.next_page!==pageNumber+1 || pageNumber>=meta.total)throw new CollectionFailure("Calendar next_page is invalid or skips a page");
      pageNumber=meta.next_page;
    }
    throw new CollectionFailure("Calendar page limit reached before the terminal page");
  }catch(error){return ctx.fail(error);}
}

const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
const datePattern=/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\s+(\d{1,2}):(\d{2})\s*([ap]m)\b/i;

/** Music's public preview is a proven independent producer, not an exhaustive music calendar. */
export async function collectMusic(options:CollectionOptions={}):Promise<CollectionBatch>{
  const ctx=context("fsu-music-events","music-preview-v1",options);const {batch}=ctx;
  try{
    const page=await ctx.fetchAndCapture("https://music.fsu.edu/events/","preview");const {$}=classifyHtml(page.body);
    const seen=new Map<string,string>();let candidates=0;let undated=0;
    $("a[href]").each((_,element)=>{
      const link=$(element);const title=link.text().replace(/\s+/g," ").trim();if(!title||title==="More details")return;
      let url:URL;try{url=new URL(link.attr("href")!,page.url);}catch{return;}
      if(url.protocol!=="https:"||url.hostname!=="music.fsu.edu"||!url.pathname.startsWith("/event/"))return;
      candidates++;
      let nearby="";let container=link.parent();
      for(let depth=0;depth<5;depth++){
        const readable=container.clone();readable.find("p,div,li,br,h1,h2,h3,h4,time").append(" ");
        nearby=readable.text().replace(/\s+/g," ").trim();
        if(datePattern.test(nearby))break;
        container=container.parent();
      }
      const titleOffset=nearby.indexOf(title);const match=nearby.slice(Math.max(0,titleOffset)+title.length,Math.max(0,titleOffset)+title.length+220).match(datePattern);
      if(!match){undated++;return;}
      const previousDate=seen.get(url.href);
      if(previousDate===match[0])return;
      if(previousDate)throw new CollectionFailure("Music repeats one detail URL with different dates; native occurrence identities are ambiguous");
      seen.set(url.href,match[0]);
      const monthIndex=months.findIndex(m=>m.toLowerCase()===match[1].toLowerCase())+1;
      const startDate=`${match[3]}-${String(monthIndex).padStart(2,"0")}-${match[2].padStart(2,"0")}`;
      if(Number(match[4])<1||Number(match[4])>12||Number(match[5])>59||new Date(`${startDate}T12:00:00Z`).toISOString().slice(0,10)!==startDate)throw new CollectionFailure("Music card has an invalid date");
      const localText=match[0];const facts={nativeId:url.href,title,description:null,sourceUrl:url.href,kind:"event" as const,campusRelation:"fsu_affiliated" as const,categories:["music"],sourcePublishedAt:null,sourceUpdatedAt:null,uncertainties:["Timezone and end time are unverified","Ticket availability and release dates are unverified","Only the Music public preview was collected","One occurrence per native detail URL; multi-performance page semantics are unverified"]};
      batch.opportunities.push({...facts,contentSha256:stableHash(facts),captureNativeId:page.nativeId,evidencePointer:`music-card:${url.pathname}`});
      const occurrenceFacts={nativeId:`${url.href}#preview-occurrence`,opportunityNativeId:url.href,startAt:null,endAt:null,startDate,timezone:null,sourceLocalText:localText,datePrecision:"date" as const,location:null,allDay:false,lifecycle:"unknown" as const};
      batch.occurrences.push({...occurrenceFacts,contentSha256:stableHash(occurrenceFacts),captureNativeId:page.nativeId,evidencePointer:`music-card:${url.pathname}:date`});
    });
    batch.observations.nativeRows=batch.opportunities.length;
    if(!batch.opportunities.length)throw new CollectionFailure("Music preview has no validated dated cards; empty success is not established");
    if(undated)throw new CollectionFailure(`${undated} of ${candidates} Music cards lack a validated date; the preview is partial`);
    batch.status="success";batch.reason=null;batch.observations.paginationComplete=true;batch.cursor={previewCapturedAt:ctx.now().toISOString()};
    batch.observations.warnings.push("Only current Music homepage preview cards; full calendar pagination is unverified", "Local date/time retained without assuming timezone, end, location or ticket availability");
    return ctx.finish();
  }catch(error){return ctx.fail(error);}
}

export async function collectSource(sourceId:string,options:CollectionOptions={}):Promise<CollectionBatch>{
  if(sourceId==="fsu-calendar-api")return collectCentralCalendar(options);
  if(sourceId==="fsu-music-events")return collectMusic(options);
  if(sourceId==="fsu-hq-public-export")return collectHq(options);
  if(Object.hasOwn(OFFICIAL_DEADLINE_URLS,sourceId))return validateCollectionBatch(await collectOfficialDeadlines(sourceId,options));
  if(sourceId==="fsu-opening-nights")return validateCollectionBatch(await collectOfficialTickets(options));
  const ctx=context(sourceId,"unconfigured-v1",options);
  return ctx.fail(new CollectionFailure("Source adapter is not configured in Stage 1; no request was made", "blocked"));
}
