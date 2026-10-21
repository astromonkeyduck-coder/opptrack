import assert from "node:assert/strict";
import test from "node:test";
import { collectSource, validateCollectionBatch } from "../lib/collection";
import { collectHq, hqEvidenceUids, HQ_EXPORT_URL, HQ_SOURCE_ID } from "../lib/collection/hq";
import { assertCollectorUrl } from "../lib/collection/http";
import { manualCalendarDraft } from "../lib/review/calendar-draft";

// Every HTTP body in this suite is synthetic. Fresh live payloads stay in ignored private/.
const now = () => new Date("2026-10-21T18:00:00Z");
const event = (changes: Record<string, string | null> = {}) => {
  const fields: Record<string, string | null> = { UID: "synthetic-one@hq.invalid", SUMMARY: "Synthetic campus meeting", DTSTART: "20261022T220000Z", DTEND: "20261022T230000Z", CREATED: "20261001T120000Z", "LAST-MODIFIED": "20261002T120000Z", DTSTAMP: "20261021T010000Z", SEQUENCE: "1", LOCATION: "Synthetic venue", URL: "https://hq.fsu.edu/rsvp?id=999999" , ...changes };
  return ["BEGIN:VEVENT", ...Object.entries(fields).filter(([, value]) => value !== null).map(([key, value]) => `${key}:${value}`), "END:VEVENT"].join("\r\n");
};
const calendar = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:SYNTHETIC-TEST", ...events, "END:VCALENDAR", ""].join("\r\n");
const fixtureFetch = (body: string, headers: Record<string, string> = {"content-type":"text/calendar"}) => (async () => new Response(body, {headers})) as typeof fetch;
const collect = (body: string) => collectHq({now, fetch: fixtureFetch(body)});

test("HQ exact public URLs are allowed; unrelated CampusGroups paths, hosts and protocols are blocked", () => {
  assert.equal(assertCollectorUrl(HQ_EXPORT_URL).hostname, "hq.fsu.edu");
  assert.equal(assertCollectorUrl("https://static-prod-us-east-1.campusgroups.com:443/ical/floridastate/ical_floridastate.ics").hostname, "static-prod-us-east-1.campusgroups.com");
  for (const url of ["https://hq.fsu.edu/admin", "https://static-prod-us-east-1.campusgroups.com/ical/another.ics", "http://hq.fsu.edu/ical/floridastate/ical_floridastate.ics", "https://hq.fsu.edu.evil.test/ical/floridastate/ical_floridastate.ics"]) assert.throws(() => assertCollectorUrl(url));
});

test("HQ public redirect is counted and UID facts resolve to captured event evidence", async () => {
  let attempts = 0;
  const fetcher = (async () => ++attempts === 1 ? new Response(null,{status:302,headers:{location:"https://static-prod-us-east-1.campusgroups.com:443/ical/floridastate/ical_floridastate.ics"}}) : new Response(calendar(event()),{headers:{"content-type":"text/calendar"}})) as typeof fetch;
  const result = await collectSource(HQ_SOURCE_ID, { now, fetch: fetcher });
  assert.equal(result.status,"success"); assert.equal(result.observations.requests,2); assert.equal(result.opportunities.length,1);
  assert.equal(result.opportunities[0].nativeId,"synthetic-one@hq.invalid"); assert.equal(result.occurrences[0].nativeId,result.opportunities[0].nativeId);
  assert.equal(result.occurrences[0].startAt,"2026-10-22T22:00:00.000Z"); assert.equal(result.occurrences[0].timezone,"UTC");
  assert.equal(result.opportunities[0].evidencePointer,"ics-vevent:0"); assert.deepEqual(hqEvidenceUids(result.pages[0].body),["synthetic-one@hq.invalid"]);
});

test("HQ rescheduling keeps UID/occurrence identity while changing factual content", async () => {
  const one = await collect(calendar(event())); const two = await collect(calendar(event({DTSTART:"20261023T220000Z",DTEND:"20261023T230000Z"})));
  assert.equal(one.status,"success"); assert.equal(two.status,"success");
  assert.equal(one.occurrences[0].nativeId,two.occurrences[0].nativeId); assert.notEqual(one.occurrences[0].contentSha256,two.occurrences[0].contentSha256);
  assert.equal(one.opportunities[0].contentSha256,two.opportunities[0].contentSha256);
});

test("changing export DTSTAMP/SEQUENCE does not create semantic event versions", async () => {
  const one = await collect(calendar(event())); const two = await collect(calendar(event({DTSTAMP:"20261021T020000Z",SEQUENCE:"2"})));
  assert.notEqual(one.pages[0].sha256,two.pages[0].sha256); assert.equal(one.opportunities[0].contentSha256,two.opportunities[0].contentSha256); assert.equal(one.occurrences[0].contentSha256,two.occurrences[0].contentSha256);
});

test("rolling UTC window includes ongoing events, filters historical/far-future only after validation", async () => {
  const result = await collect(calendar(event(), event({UID:"past",DTSTART:"20261001T120000Z",DTEND:"20261001T140000Z"}), event({UID:"ongoing",DTSTART:"20261020T120000Z",DTEND:"20261022T140000Z"}), event({UID:"future",DTSTART:"20270201T120000Z",DTEND:"20270201T140000Z"})));
  assert.equal(result.status,"success"); assert.equal(result.observations.nativeRows,4); assert.equal(result.occurrences.length,2);
  assert.deepEqual(result.cursor && [result.cursor.totalNativeRows,result.cursor.emittedRows,result.cursor.skippedOutsideWindow],[4,2,2]);
  assert.deepEqual(result.opportunities.map(row=>row.nativeId),["synthetic-one@hq.invalid","ongoing"]);
  assert.equal(result.observations.windowFrom,"2026-10-21T18:00:00.000Z"); assert.equal(result.observations.windowTo,"2027-01-19T18:00:00.000Z");
});

test("malformed out-of-window rows cannot be hidden by the date filter", async () => {
  const result = await collect(calendar(event({UID:"invalid-past",DTSTART:"20260230T120000Z",DTEND:"20260230T140000Z"})));
  assert.equal(result.status,"partial"); assert.equal(result.cursor,null); assert.equal(result.occurrences.length,0); assert.match(result.reason!,/impossible calendar date/);
});

test("date-only and floating/TZID facts retain source precision without inventing instants", async () => {
  const allDay = event({UID:"date",DTSTART:null,DTEND:null,"DTSTART;VALUE=DATE":"20261022","DTEND;VALUE=DATE":"20261024"});
  const floating = event({UID:"floating",DTSTART:"20261022T090000",DTEND:"20261022T100000"});
  const zoned = event({UID:"zoned",DTSTART:null,DTEND:null,"DTSTART;TZID=America/New_York":"20261022T090000","DTEND;TZID=America/New_York":"20261022T100000"});
  const result = await collect(calendar(allDay,floating,zoned)); assert.equal(result.status,"success");
  assert.equal(result.occurrences[0].allDay,true); assert.equal(result.occurrences[0].startAt,null); assert.match(result.occurrences[0].sourceLocalText!,/2026-10-24 \(exclusive end\)/);
  assert.equal(result.occurrences[1].timezone,null); assert.equal(result.occurrences[1].startAt,null); assert.match(result.occurrences[1].sourceLocalText!,/floating/);
  assert.equal(result.occurrences[2].timezone,"America/New_York"); assert.equal(result.occurrences[2].startAt,null); assert.ok(result.opportunities[2].uncertainties.includes("Source local time retained; timezone conversion is unverified"));
});

test("folded lines, escaped text, quoted parameters and legacy summary encoding are parsed", async () => {
  const body = event({SUMMARY:null,"SUMMARY;ENCODING=QUOTED-PRINTABLE":"Synthetic=20caf=C3=A9\\,\\;",DESCRIPTION:"Synthetic long\\nline\\,\\;\\\\\r\n continuation","ORGANIZER;CN=\"Synthetic: Club; Team\"":"mailto:noreply@hq.invalid"});
  const result = await collect(calendar(body)); assert.equal(result.status,"success"); assert.equal(result.opportunities[0].title,"Synthetic café,;"); assert.equal(result.opportunities[0].description,"Synthetic long line,;\\continuation");
});

test("explicit cancellation is retained; disappearance never creates a cancellation", async () => {
  const cancelled = await collect(calendar(event({STATUS:"CANCELLED"}))); assert.equal(cancelled.status,"success"); assert.equal(cancelled.occurrences[0].lifecycle,"cancelled");
  const empty = await collect(calendar()); assert.equal(empty.status,"success"); assert.equal(empty.occurrences.length,0); assert.ok(empty.pages.length); assert.ok(empty.observations.warnings.some(w=>w.includes("never infer cancellation")));
});

test("unsupported recurrence and components fail partial without an emitted subset", async () => {
  for (const name of ["RRULE","RDATE","EXDATE","RECURRENCE-ID"]) {
    const result = await collect(calendar(event(),event({UID:"recurring",[name]:"FREQ=WEEKLY"})));
    assert.equal(result.status,"partial"); assert.equal(result.observations.paginationComplete,false); assert.equal(result.cursor,null); assert.equal(result.occurrences.length,0);
  }
  const nested = await collect(calendar(event().replace("END:VEVENT","BEGIN:VALARM\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VEVENT"))); assert.equal(nested.status,"partial");
});

test("malformed/duplicate UID, singleton/date/end mismatch and incomplete envelope cannot be success", async () => {
  const invalidBodies = [calendar(event(),event()),calendar(event({UID:null})),calendar(event()).replace("END:VCALENDAR", ""),calendar(event({DTEND:"20261022T230000"})),calendar(event({SUMMARY:"Synthetic\r\nSUMMARY:duplicate"})),calendar(event({DTSTART:"20261022T250000Z"}))];
  for (const body of invalidBodies) {const result=await collect(body); assert.equal(result.status,"partial"); assert.equal(result.cursor,null); assert.equal(result.opportunities.length,0);}
});

test("HQ HTTP200 access pages, external redirects, Retry-After and capture limits retain failure", async () => {
  const html = await collectHq({now,fetch:fixtureFetch("<h1>Please sign in to continue</h1>",{"content-type":"text/html"})}); assert.equal(html.status,"blocked");
  const external = await collectHq({now,fetch:(async()=>new Response(null,{status:302,headers:{location:"https://evil.invalid/export.ics"}})) as typeof fetch}); assert.equal(external.status,"blocked"); assert.equal(external.observations.requests,1);
  const limited = await collectHq({now,fetch:(async()=>new Response("Synthetic limit",{status:429,headers:{"retry-after":"400"}})) as typeof fetch}); assert.equal(limited.status,"rate_limited"); assert.equal(limited.retryAfterSeconds,400); assert.equal(limited.observations.requests,1);
  const oversize = await collectHq({now,maxBytes:8,fetch:fixtureFetch(calendar(event()))}); assert.equal(oversize.status,"failed"); assert.equal(oversize.pages.length,0);
});

test("HQ evidence validator rejects missing indexes, wrong UID and forged capture bodies", async () => {
  const good=await collect(calendar(event())); assert.equal(good.status,"success");
  const wrongIndex=structuredClone(good); wrongIndex.occurrences[0].evidencePointer="ics-vevent:999"; assert.throws(()=>validateCollectionBatch(wrongIndex));
  const wrongUid=structuredClone(good); wrongUid.occurrences[0].nativeId="unrelated"; assert.throws(()=>validateCollectionBatch(wrongUid));
  const wrongBody=structuredClone(good); wrongBody.pages[0].body="forged"; assert.throws(()=>validateCollectionBatch(wrongBody));
});

test("withheld locations and unsafe source links remain uncertain without fetching targets", async () => {
  const result=await collect(calendar(event({LOCATION:"Sign in to view the location",URL:"http://127.0.0.1/private",STATUS:"TENTATIVE"})));
  assert.equal(result.status,"success"); assert.equal(result.occurrences[0].location,null); assert.equal(result.occurrences[0].lifecycle,"unknown"); assert.equal(result.opportunities[0].sourceUrl,HQ_EXPORT_URL); assert.ok(result.opportunities[0].uncertainties.some(value=>value.includes("withheld")));
});

test("old export timestamp is disclosed, while valid zero-window captures stay evidenced", async () => {
  const result=await collect(calendar(event({DTSTART:"20260101T000000Z",DTEND:"20260101T010000Z",DTSTAMP:"20261001T000000Z"})));
  assert.equal(result.status,"success"); assert.equal(result.occurrences.length,0); assert.equal(result.observations.nativeRows,1); assert.ok(result.observations.warnings.some(value=>value.includes("older than 72 hours")));
});


test("conflicting source end stays unknown with evidence; no overnight correction is invented", async () => {
  const result=await collect(calendar(event({DTEND:"20261021T210000Z"})));
  assert.equal(result.status,"success"); assert.equal(result.occurrences[0].endAt,null); assert.match(result.occurrences[0].sourceLocalText!,/conflicting source end/);
  assert.ok(result.opportunities[0].uncertainties.some(value=>value.includes("conflicting end withheld"))); assert.equal(result.cursor?.temporalEndConflicts,1); assert.ok(result.observations.warnings.some(value=>value.includes("1 source DTEND")));
  const occurrence=result.occurrences[0];
  const draft=manualCalendarDraft({id:occurrence.nativeId,title:result.opportunities[0].title,starts_at:occurrence.startAt,ends_at:occurrence.endAt,start_date:occurrence.startDate,date_precision:occurrence.datePrecision,timezone:occurrence.timezone,local_start_text:occurrence.sourceLocalText,all_day:occurrence.allDay,status:occurrence.lifecycle});
  assert.equal(draft.ready,false);
});


test("previously retained UIDs reconcile moves beyond90days, into the past and explicit cancellation", async () => {
  const future=event({UID:"known-future",DTSTART:"20270601T120000Z",DTEND:"20270601T130000Z"});
  const past=event({UID:"known-past",DTSTART:"20260901T120000Z",DTEND:"20260901T130000Z"});
  const cancelled=event({UID:"known-cancelled",DTSTART:"20260902T120000Z",DTEND:"20260902T130000Z",STATUS:"CANCELLED"});
  const untracked=event({UID:"untracked",DTSTART:"20270602T120000Z",DTEND:"20270602T130000Z"});
  const result=await collectHq({now,fetch:fixtureFetch(calendar(future,past,cancelled,untracked)),retainedNativeIds:new Set(["known-future","known-past","known-cancelled"])});
  assert.equal(result.status,"success"); assert.deepEqual(result.occurrences.map(row=>row.nativeId),["known-future","known-past","known-cancelled"]);
  assert.equal(result.occurrences[0].startAt,"2027-06-01T12:00:00.000Z"); assert.equal(result.occurrences[1].startAt,"2026-09-01T12:00:00.000Z"); assert.equal(result.occurrences[2].lifecycle,"cancelled");
  assert.equal(result.cursor?.retainedOutsideWindow,3); assert.equal(result.cursor?.skippedOutsideWindow,1); assert.ok(result.observations.warnings.some(value=>value.includes("3 previously retained")));
});

test("retained UID disappearance stays an evidenced gap and never emits a fabricated cancellation", async () => {
  const result=await collectHq({now,fetch:fixtureFetch(calendar()),retainedNativeIds:new Set(["known-but-absent"])});
  assert.equal(result.status,"success"); assert.equal(result.occurrences.length,0); assert.equal(result.cursor?.retainedMissingFromExport,1);
  assert.ok(result.observations.warnings.some(value=>value.includes("absent")&&value.includes("no deletion or cancellation")));
});

test("retained identity input is bounded and validated before any network request", async () => {
  let calls=0; const fetcher=(async()=>{calls++;return new Response(calendar());}) as typeof fetch;
  const invalidSets=[new Set(Array.from({length:10_001},(_,index)=>`id-${index}`)),new Set(["x".repeat(1001)]),new Set([""]),new Set(["bad\nUID"]),new Set([123])];
  for (const retained of invalidSets) {
    const result=await collectHq({now,fetch:fetcher,retainedNativeIds:retained as ReadonlySet<string>});
    assert.equal(result.status,"failed"); assert.equal(result.observations.requests,0); assert.match(result.reason!,/reconciliation bounds/);
  }
  assert.equal(calls,0);
});
