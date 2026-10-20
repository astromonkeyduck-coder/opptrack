import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectCentralCalendar, collectMusic, collectSource, parseRetryAfter, retryDelaySeconds, validateCollectionBatch } from "../lib/collection";
import { assertCollectorUrl, stableHash } from "../lib/collection/http";

// Explicitly synthetic HTTP envelopes. The one Stage 0 replay test below labels its live field projection.
const fixedNow=()=>new Date("2026-10-20T12:00:00Z");
const row=(eventId=123,occurrenceId=456)=>({event:{id:eventId,title:"Synthetic fixture concert",description_text:"Synthetic text",localist_url:"https://calendar.fsu.edu/event/synthetic",created_at:"2026-10-01T12:00:00-04:00",updated_at:"2026-10-01T12:00:00-04:00",event_instances:[{event_instance:{id:occurrenceId,event_id:eventId,start:"2026-10-20T18:00:00-04:00",end:null,all_day:false}}]}});
const envelope=(events:unknown[],current=1,total=1,totalItems=events.length,nextPage:number|null=null)=>({events,page:{current,total,total_items:totalItems,next_page:nextPage}});
const fakeFetch=(responses:Array<unknown|Response>)=>{let i=0;return (async()=>{const item=responses[i++];if(item===undefined)throw Error("Unexpected fixture fetch");return item instanceof Response?item:new Response(JSON.stringify(item),{headers:{"content-type":"application/json"}});}) as typeof fetch;};

test("central paginates occurrence rows while preserving one event and separate native occurrences",async()=>{
  const result=await collectCentralCalendar({now:fixedNow,startDate:"2026-10-20",fetch:fakeFetch([envelope([row()],1,2,2,2),envelope([row(123,789)],2,2,2)])});
  assert.equal(result.status,"success");assert.equal(result.pages.length,2);assert.equal(result.opportunities.length,1);assert.deepEqual(result.occurrences.map(o=>o.nativeId),["456","789"]);assert.equal(result.observations.nativeRows,2);assert.equal(result.occurrences[0].location,null);assert.equal(result.occurrences[0].endAt,null);
});

test("live-observed nullable optional external URL does not discard a valid Localist event URL",async()=>{
  const fixture={...row(),event:{...row().event,url:null}};
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([fixture])])});
  assert.equal(result.status,"success");assert.equal(result.opportunities[0].sourceUrl,"https://calendar.fsu.edu/event/synthetic");
});

test("a source withholding one location does not block its public event or invent a venue",async()=>{
  const fixture={...row(),event:{...row().event,location_name:"Sign in to download the location",room_number:"Masked room"}};
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([fixture])])});
  assert.equal(result.status,"success");assert.equal(result.occurrences[0].location,null);assert.ok(result.opportunities[0].uncertainties.includes("Location withheld by source; sign-in required"));
});

test("Stage 0 live public field projection replays without claiming a lossless source capture",async()=>{
  const projection=JSON.parse(await readFile(new URL("../reports/probes/parser-samples.json",import.meta.url),"utf8"));
  assert.equal(projection.synthetic,false);assert.equal(projection.lossless_response,false);
  const body=envelope(projection.observed_records);
  const one=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([body])});const two=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([body])});
  assert.equal(one.status,"success");assert.equal(one.opportunities.length,1);assert.equal(one.occurrences.length,2);
  assert.deepEqual(one.opportunities.map(o=>o.contentSha256),two.opportunities.map(o=>o.contentSha256));assert.deepEqual(one.occurrences.map(o=>o.contentSha256),two.occurrences.map(o=>o.contentSha256));
});

test("successful zero event window requires an actual captured complete metadata envelope",async()=>{
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([],1,0,0)])});assert.equal(result.status,"success");assert.equal(result.pages.length,1);assert.equal(result.opportunities.length,0);assert.ok(result.cursor);
});

test("HTTP 200 login wall remains blocked",async()=>{
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([new Response("<h1>Please sign in to continue</h1>",{headers:{"content-type":"text/html"}})])});assert.equal(result.status,"blocked");assert.equal(result.cursor,null);assert.match(result.reason!,/access or error/);
});

test("malformed array cannot become nothing new",async()=>{
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([{events:[],error:"Synthetic error"}])});assert.equal(result.status,"partial");assert.equal(result.observations.paginationComplete,false);assert.equal(result.cursor,null);
});

test("truncated terminal page and changed totals remain partial",async()=>{
  const truncated=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([row()],1,2,2)])});assert.equal(truncated.status,"partial");
  const changed=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([row()],1,2,2,2),envelope([row(123,789)],2,2,3)])});assert.equal(changed.status,"partial");assert.match(changed.reason!,/totals changed/);assert.equal(changed.cursor,null);
});

test("repeated occurrence, skipped page and page cap fail closed",async()=>{
  const repeated=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([row()],1,2,2,2),envelope([row()],2,2,2)])});assert.equal(repeated.status,"partial");
  const skipped=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([row()],1,3,3,3)])});assert.equal(skipped.status,"partial");
  const capped=await collectCentralCalendar({now:fixedNow,maxPages:1,fetch:fakeFetch([envelope([row()],1,2,2,2)])});assert.equal(capped.status,"partial");assert.match(capped.reason!,/page limit/);
});

test("occurrence move retains native ID but changes factual version",async()=>{
  const original=row();const moved=structuredClone(original);moved.event.event_instances[0].event_instance.start="2026-10-21T18:00:00-04:00";
  const one=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([original])])});const two=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([moved])])});
  assert.equal(one.occurrences[0].nativeId,two.occurrences[0].nativeId);assert.notEqual(one.occurrences[0].contentSha256,two.occurrences[0].contentSha256);assert.equal(one.opportunities[0].contentSha256,two.opportunities[0].contentSha256);
});

test("changing attendance counters adds no factual event or occurrence version",async()=>{
  const original={...row(),event:{...row().event,detail_views:10,going_count:1}};
  const changed={...row(),event:{...row().event,detail_views:19,going_count:5}};
  const one=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([original])])});
  const two=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([changed])])});
  assert.notEqual(one.pages[0].sha256,two.pages[0].sha256);
  assert.equal(one.opportunities[0].contentSha256,two.opportunities[0].contentSha256);
  assert.equal(one.occurrences[0].contentSha256,two.occurrences[0].contentSha256);
});

test("HTTP 429 retains Retry-After and does not invent empty success",async()=>{
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([new Response("Synthetic rate limit",{status:429,headers:{"retry-after":"120"}})])});assert.equal(result.status,"rate_limited");assert.equal(result.retryAfterSeconds,120);assert.equal(result.cursor,null);
  assert.equal(result.observations.requests,1);assert.deepEqual(result.observations.httpStatuses,[429]);assert.equal(parseRetryAfter("172800"),172800);
  assert.equal(parseRetryAfter("Tue, 20 Oct 2026 12:02:00 GMT",fixedNow()),120);assert.equal(parseRetryAfter("bad",fixedNow()),null);assert.equal(retryDelaySeconds(1,300,()=>0),300);assert.equal(retryDelaySeconds(1,null,()=>0),30);assert.equal(retryDelaySeconds(1,null,()=>1),60);
});

test("collector redirects outside exact public source allowlist are blocked",async()=>{
  for(const url of ["http://calendar.fsu.edu/api/2/events","https://127.0.0.1/api/2/events","https://calendar.fsu.edu.evil.test/api/2/events","https://calendar.fsu.edu/admin","https://music.fsu.edu/events/?x=y@evil.test"]) {
    if(url.startsWith("https://music.fsu.edu/"))assert.equal(assertCollectorUrl(url).hostname,"music.fsu.edu");else assert.throws(()=>assertCollectorUrl(url));
  }
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([new Response(null,{status:302,headers:{location:"http://169.254.169.254/latest/meta-data"}})])});assert.equal(result.status,"blocked");
});

test("response byte limit and transport failure retain a failed state",async()=>{
  const oversized=await collectCentralCalendar({now:fixedNow,maxBytes:8,fetch:fakeFetch([new Response("synthetic oversized body",{headers:{"content-type":"application/json"}})])});assert.equal(oversized.status,"failed");
  const network=await collectCentralCalendar({now:fixedNow,fetch:(async()=>{throw new Error("Synthetic failure");}) as typeof fetch});assert.equal(network.status,"failed");assert.equal(network.observations.paginationComplete,false);
  assert.equal(network.observations.requests,1);
});

test("Music dated cards preserve local time while timezone/end/location/tickets stay unknown",async()=>{
  const html="<html><body><a href='/login'>Login</a><article><h2><a href='/event/synthetic-recital/'>Synthetic recital</a></h2><p>October 20, 2026 7:30 pm</p><a href='/event/synthetic-recital/'>More details</a></article></body></html>";
  const result=await collectMusic({now:fixedNow,fetch:fakeFetch([new Response(html,{headers:{"content-type":"text/html"}})])});assert.equal(result.status,"success");assert.equal(result.occurrences[0].timezone,null);assert.equal(result.occurrences[0].startAt,null);assert.equal(result.occurrences[0].startDate,"2026-10-20");assert.equal(result.occurrences[0].sourceLocalText,"October 20, 2026 7:30 pm");assert.equal(result.occurrences[0].endAt,null);assert.equal(result.occurrences[0].location,null);
});

test("Music changed parser markup cannot imply successful zero",async()=>{
  const result=await collectMusic({now:fixedNow,fetch:fakeFetch([new Response("<h1>Music</h1><article>Event layout changed</article>")])});assert.equal(result.status,"partial");assert.equal(result.cursor,null);
});

test("Music reschedule preserves identity and ambiguous multi-date URL stays partial",async()=>{
  const html=(date:string)=>`<article><h2><a href='/event/synthetic-recital/'>Synthetic recital</a></h2><p>${date}</p></article>`;
  const one=await collectMusic({now:fixedNow,fetch:fakeFetch([new Response(html("October 20, 2026 7:30 pm"))])});
  const two=await collectMusic({now:fixedNow,fetch:fakeFetch([new Response(html("October 21, 2026 8:30 pm"))])});
  assert.equal(one.occurrences[0].nativeId,two.occurrences[0].nativeId);assert.notEqual(one.occurrences[0].contentSha256,two.occurrences[0].contentSha256);
  const ambiguous=await collectMusic({now:fixedNow,fetch:fakeFetch([new Response(html("October 20, 2026 7:30 pm")+html("October 21, 2026 8:30 pm"))])});assert.equal(ambiguous.status,"partial");assert.match(ambiguous.reason!,/identities are ambiguous/);
});

test("unconfigured source performs zero upstream requests",async()=>{
  const result=await collectSource("instagram-unconfigured",{fetch:(async()=>{throw Error("must not fetch");}) as typeof fetch});assert.equal(result.status,"blocked");assert.equal(result.pages.length,0);assert.equal(result.observations.requests,0);
});

test("normalized boundary rejects evidence/cursor tampering and hash is object-order stable",async()=>{
  const result=await collectCentralCalendar({now:fixedNow,fetch:fakeFetch([envelope([row()])])});
  const missingEvidence=structuredClone(result);missingEvidence.opportunities[0].captureNativeId="uncaptured";assert.throws(()=>validateCollectionBatch(missingEvidence));
  const fakePointer=structuredClone(result);fakePointer.opportunities[0].evidencePointer="/events/999/event";assert.throws(()=>validateCollectionBatch(fakePointer));
  const tamperedBody=structuredClone(result);tamperedBody.pages[0].body="tampered";assert.throws(()=>validateCollectionBatch(tamperedBody));
  const partial=structuredClone(result);partial.status="partial";partial.reason="Synthetic partial";assert.throws(()=>validateCollectionBatch(partial));
  assert.equal(stableHash({a:1,b:2}),stableHash({b:2,a:1}));
});
