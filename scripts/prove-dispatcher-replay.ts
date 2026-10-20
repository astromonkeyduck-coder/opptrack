/** Exact production handler/service/collectors against replay HTTP and actual local SQL.
 * This is not Trigger Cloud, hosted Auth, or Supabase Storage HTTP evidence.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDispatcherHandler } from "../lib/collection/dispatcher";
import type { CollectionBatch } from "../lib/collection";
import { dispatchDueSources } from "../lib/ingestion";

const owner="11111111-1111-4111-8111-111111111111";
const db=new PGlite();
const objectDir=path.resolve("private/stage-1-dispatcher-replay",String(Date.now()));
const sourceIds=["fsu-calendar-api","fsu-music-events"];
const batches=await Promise.all(sourceIds.map(async id=>JSON.parse(await readFile(`private/stage-1-live/${id}.json`,"utf8")) as CollectionBatch));
for(const batch of batches)assert.equal(batch.status,"success");
const responsePages=new Map(batches.flatMap(batch=>batch.pages.map(page=>[page.url,page] as const)));
const expectedEvents=batches.reduce((sum,batch)=>sum+batch.opportunities.length,0);
const expectedOccurrences=batches.reduce((sum,batch)=>sum+batch.occurrences.length,0);
const actualFetch=globalThis.fetch;
let replayFetches=0;let uploads=0;let duplicates=0;let rpcCalls=0;

async function serviceQuery(sql:string,parameters:unknown[]=[]) {
  await db.exec("set role service_role");
  try{return await db.query(sql,parameters);}finally{await db.exec("reset role");}
}
async function counts(){
  const result=await db.query<{opportunities:number;occurrences:number;captures:number;versions:number;runs:number}>("select (select count(*)::integer from public.opportunities) opportunities,(select count(*)::integer from public.occurrences) occurrences,(select count(*)::integer from public.captures) captures,(select count(*)::integer from public.entity_versions) versions,(select count(*)::integer from public.source_runs) runs");
  return result.rows[0];
}
// These adapters invoke actual SQL/filesystem operations; no hosted APIs are impersonated.
const client={
  rpc:async(name:string,parameters:Record<string,unknown>)=>{
    rpcCalls++;
    try {
      if(name==="lease_due_sources")return {data:(await serviceQuery("select * from public.lease_due_sources($1,$2)",[parameters.p_limit,parameters.p_lease_seconds])).rows,error:null};
      if(name==="complete_source_run")return {data:((await serviceQuery("select public.complete_source_run($1,$2,$3::jsonb)",[parameters.p_source_id,parameters.p_lease_token,JSON.stringify(parameters.p_batch)])).rows[0] as {complete_source_run?:unknown})?.complete_source_run,error:null};
      throw Error("Unexpected RPC in local dispatcher proof");
    }catch(error){return {data:null,error:{code:(error as {code?:string}).code??"local_test_sql"}};}
  },
  from:(table:string)=>{
    assert.equal(table,"tracker_members");
    return {select:(columns:string)=>{
      assert.equal(columns,"user_id");
      return {limit:async(limit:number)=>{
        assert.equal(limit,1);
        return {data:(await serviceQuery("select user_id from public.tracker_members limit $1",[limit])).rows,error:null};
      }};
    }};
  },
  storage:{from:(bucket:string)=>{
    assert.equal(bucket,"captures");
    return {
      upload:async(objectPath:string,bytes:Uint8Array,options:{contentType:string;upsert:boolean})=>{
        assert.ok(objectPath.startsWith(owner+"/sources/"));assert.equal(options.upsert,false);
        const digest=createHash("sha256").update(bytes).digest("hex");assert.ok(objectPath.endsWith(`/${digest}.raw`));
        const filename=path.join(objectDir,objectPath);await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
        try{await writeFile(filename,bytes,{flag:"wx",mode:0o600});uploads++;}
        catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;assert.equal(createHash("sha256").update(await readFile(filename)).digest("hex"),digest);duplicates++;return {data:null,error:{statusCode:"409",code:"ResourceAlreadyExists",message:"The resource already exists"}};}
        await db.query("insert into storage.objects(bucket_id,name,metadata) values('captures',$1,$2::jsonb) on conflict do nothing",[objectPath,JSON.stringify({size:bytes.byteLength,mimetype:options.contentType})]);
        return {data:{path:objectPath},error:null};
      },
      download:async(objectPath:string)=>{
        assert.ok(objectPath.startsWith(owner+"/sources/"));
        return {data:new Blob([await readFile(path.join(objectDir,objectPath))]),error:null};
      },
    };
  }},
} as unknown as SupabaseClient;

try {
  await db.exec(await readFile("supabase/tests/bootstrap.sql","utf8"));
  for(const filename of (await readdir("supabase/migrations")).filter(name=>name.endsWith(".sql")).sort())await db.exec(await readFile("supabase/migrations/"+filename,"utf8"));
  const execute=()=>runDispatcherHandler((limit,_unused,provenance)=>dispatchDueSources(limit,client,provenance),{SUPABASE_URL:"local-test-adapter",SUPABASE_SECRET_KEY:"synthetic-presence-only",CALENDAR_WRITES_ENABLED:"false"},{invocationKind:"replay"});
  const unconfigured=await execute();
  assert.equal(unconfigured.status,"setup_needed");assert.equal(unconfigured.missingOwner,true);assert.equal(replayFetches,0);
  await db.query("insert into auth.users(id) values($1)",[owner]);
  await serviceQuery("select public.configure_tracker_owner($1)",[owner]);
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const url=input instanceof Request?input.url:String(input);
    const captured=responsePages.get(url);
    assert.ok(captured,"Only the exact saved fresh source windows may be replayed; no network call is permitted");
    replayFetches++;
    return new Response(captured.body,{status:captured.httpStatus,headers:{"content-type":captured.contentType}});
  }) as typeof fetch;
  const first=await execute();assert.equal(first.status,"completed");assert.equal(first.results.length,2);
  for(const result of first.results){
    assert.equal(result.outcome,"success");
    if(!("sourceRunId" in result))throw Error("Successful collection must return its SQL source run ID");
    assert.match(result.sourceRunId??"",/^[a-f0-9-]{36}$/);
    const persisted=await db.query<{source_id:string;invocation_kind:string;trigger_run_id:string|null}>("select source_id,invocation_kind,trigger_run_id from public.source_runs where id=$1",[result.sourceRunId]);
    assert.equal(persisted.rows[0]?.source_id,result.sourceId);assert.equal(persisted.rows[0]?.invocation_kind,"replay");assert.equal(persisted.rows[0]?.trigger_run_id,null);
  }
  const beforeReplay=await counts();assert.equal(beforeReplay.opportunities,expectedEvents);assert.equal(beforeReplay.occurrences,expectedOccurrences);
  const selected=(await db.query<{id:string}>("select id from public.occurrences order by id limit 1")).rows[0].id;
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  try{await db.query("select public.record_decision($1,'save',1)",[selected]);}finally{await db.exec("reset role; reset request.jwt.claim.sub");}
  const idle=await execute();assert.equal(idle.status,"idle");assert.equal(idle.missingOwner,false);
  await db.exec("update public.sources set next_poll_at=tracker_private.poll_slot_at(cadence_seconds,now()),retry_not_before=null,next_due_at=now()-interval '1 second' where enabled");
  const second=await execute();assert.equal(second.status,"completed");assert.equal(second.results.length,2);
  for(const result of second.results)assert.equal(result.outcome,"success");
  const afterReplay=await counts();
  for(const key of ["opportunities","occurrences","captures","versions"] as const)assert.equal(afterReplay[key],beforeReplay[key]);
  assert.equal(afterReplay.runs,beforeReplay.runs+2);
  assert.equal((await db.query<{decision:string}>("select decision from public.review_inbox where id=$1",[selected])).rows[0].decision,"save");
  const report={runAt:new Date().toISOString(),evidenceClass:"production-trigger-handler-local-sql-with-explicit-http-storage-replay-adapters",hostedSupabase:false,triggerCloud:false,mockedBoundaries:["Source fetch returns previously captured fresh HTTP bodies; zero network requests","Storage client uses private local files and actual storage metadata SQL","Auth identity uses test SQL role; no hosted JWT"],realBoundaries:["Trigger runDispatcherHandler function","Production dispatchDueSources and source collectors with runtime schema validation","Production ingestCollectedBatch translation/upload/RPC ordering","Actual PostgreSQL migration, leasing, source-run transaction, versions, claims and decisions"],sourceCaptureTimes:batches.map(batch=>({sourceId:batch.sourceId,startedAt:batch.startedAt,finishedAt:batch.finishedAt})),beforeReplay,afterReplay,replayHttpResponses:replayFetches,objectsUploaded:uploads,confirmedExistingObjectReuses:duplicates,rpcCalls,zeroOwnerSetupNeededVerified:true,configuredOwnerIdleVerified:true,localSqlSourceRunIds:first.results.map(result=>"sourceRunId" in result?result.sourceRunId:null),sourceRunIdCorrelationVerified:true,invocationKind:"replay",savedDecisionPreserved:true,calendarWrites:0,paidConnectors:0,modelCalls:0,networkRequests:0};
  await writeFile("reports/stage-1-source-dispatcher-replay.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}finally{globalThis.fetch=actualFetch;await db.close();}
