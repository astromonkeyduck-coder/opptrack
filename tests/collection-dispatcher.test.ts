import assert from "node:assert/strict";
import test from "node:test";
import { runDispatcherHandler } from "../lib/collection/dispatcher";
import type { dispatchDueSources, DispatcherProvenance } from "../lib/ingestion";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkerSetupNeeded } from "../lib/ingestion";
import { AbortTaskRunError } from "@trigger.dev/sdk";
import { dispatcherSchedule, provenanceForTriggerRun, requireReadyDispatcherResult, sourceDispatcher } from "../trigger/source-dispatcher";

const workerEnvironment={SUPABASE_URL:"https://fixture.example.test",SUPABASE_SECRET_KEY:"synthetic-placeholder",CALENDAR_WRITES_ENABLED:"false"};
// Explicit synthetic SDK metadata; these tests do not claim a real Cloud run ID.
const scheduledPayload={scheduleId:"sched_synthetic",timestamp:new Date("2026-10-20T22:00:00Z")};
const runIdentity={id:"run_synthetic",isTest:false,isReplay:false};
const scheduledMetadata={id:"run_synthetic",taskIdentifier:"opportunity-source-dispatcher",isTest:false,schedule:{id:"sched_synthetic"}};

test("Trigger SDK registers the real dispatcher task without claiming cloud execution",()=>{
  assert.equal(sourceDispatcher.id,"opportunity-source-dispatcher");assert.equal(typeof sourceDispatcher.trigger,"function");
});

test("dispatcher has exactly one nominal run per hour and retains the Free minimum window",()=>{
  const [minute,hour,day,month,weekday]=dispatcherSchedule.pattern.split(" ");
  assert.match(minute,/^\d+$/);assert.ok(Number(minute)>=0&&Number(minute)<60);
  assert.deepEqual([hour,day,month,weekday],["*","*","*","*"]);
  const nominalMinutes=Array.from({length:25},(_,index)=>index*60+Number(minute));
  assert.ok(nominalMinutes.slice(1).every((minute,index)=>minute-nominalMinutes[index]>=60));
  assert.equal(dispatcherSchedule.window,"60m");assert.equal(dispatcherSchedule.timezone,"UTC");
  assert.deepEqual(dispatcherSchedule.environments,["DEVELOPMENT","PRODUCTION"]);
});

test("verified scheduler run forwards its actual run ID and nominal scheduled time to persistence",async()=>{
  const provenance=await provenanceForTriggerRun(scheduledPayload,runIdentity,async id=>{assert.equal(id,"run_synthetic");return scheduledMetadata;});
  assert.deepEqual(provenance,{triggerRunId:"run_synthetic",scheduledAt:"2026-10-20T22:00:00.000Z",invocationKind:"scheduled",scheduleId:"sched_synthetic"});
  let calls=0;
  const result=await runDispatcherHandler((async(limit?:number,client?:SupabaseClient,forwarded?:DispatcherProvenance)=>{calls++;assert.equal(limit,3);assert.equal(client,undefined);assert.deepEqual(forwarded,provenance);return [];}) as typeof dispatchDueSources,workerEnvironment,provenance);
  assert.equal(calls,1);assert.equal(result.status,"idle");assert.deepEqual(result.provenance,provenance);
});

test("manual tests, replays and direct API triggers cannot masquerade as scheduled executions",async()=>{
  const mustNotRead=async()=>{throw Error("A known test/replay needs no management request");};
  assert.deepEqual(await provenanceForTriggerRun(scheduledPayload,{...runIdentity,isTest:true},mustNotRead),{triggerRunId:"run_synthetic",invocationKind:"manual"});
  assert.deepEqual(await provenanceForTriggerRun(scheduledPayload,{...runIdentity,isReplay:true},mustNotRead),{triggerRunId:"run_synthetic",invocationKind:"replay"});
  assert.deepEqual(await provenanceForTriggerRun(scheduledPayload,runIdentity,async()=>({...scheduledMetadata,schedule:undefined})),{triggerRunId:"run_synthetic",invocationKind:"manual"});
  assert.deepEqual(await provenanceForTriggerRun(scheduledPayload,runIdentity,async()=>({...scheduledMetadata,schedule:{id:"sched_other"}})),{triggerRunId:"run_synthetic",invocationKind:"manual"});
  const local=await runDispatcherHandler((async()=>[]) as typeof dispatchDueSources,workerEnvironment);
  assert.deepEqual(local.provenance,{invocationKind:"local"});
});

test("unavailable or mismatched run metadata fails closed before source dispatch",async()=>{
  await assert.rejects(provenanceForTriggerRun(scheduledPayload,runIdentity,async()=>{throw Error("Synthetic API failure");}),/provenance could not be verified/);
  await assert.rejects(provenanceForTriggerRun(scheduledPayload,runIdentity,async()=>({...scheduledMetadata,id:"run_other"})),/did not match/);
  await assert.rejects(provenanceForTriggerRun(scheduledPayload,runIdentity,async()=>({...scheduledMetadata,taskIdentifier:"different-task"})),/did not match/);
  await assert.rejects(provenanceForTriggerRun({...scheduledPayload,timestamp:new Date("invalid")},runIdentity,async()=>scheduledMetadata),/timestamp is invalid/);
});

test("dispatcher missing configuration returns setup needed and makes no calls",async()=>{
  const result=await runDispatcherHandler((async()=>{throw Error("must not dispatch");}) as typeof dispatchDueSources,{});
  assert.equal(result.status,"setup_needed");assert.deepEqual(result.missing,["SUPABASE_URL","SUPABASE_SECRET_KEY"]);
  assert.equal(result.missingOwner,false);
});

test("zero-owner setup stays distinct from an established tracker with nothing due",async()=>{
  const missingOwner=await runDispatcherHandler((async()=>{throw new WorkerSetupNeeded();}) as typeof dispatchDueSources,workerEnvironment);
  assert.equal(missingOwner.status,"setup_needed");assert.equal(missingOwner.missingOwner,true);assert.deepEqual(missingOwner.missing,["tracker_owner"]);
  assert.throws(()=>requireReadyDispatcherResult(missingOwner),AbortTaskRunError);
  const missingEnvironment=await runDispatcherHandler((async()=>[]) as typeof dispatchDueSources,{});
  assert.throws(()=>requireReadyDispatcherResult(missingEnvironment),AbortTaskRunError);
  const idle=await runDispatcherHandler((async()=>[]) as typeof dispatchDueSources,workerEnvironment);
  assert.equal(idle.status,"idle");assert.equal(idle.missingOwner,false);assert.equal(requireReadyDispatcherResult(idle),idle);
});

test("dispatcher handler invokes leased-source service once with its bounded batch",async()=>{
  let calls=0;const result=await runDispatcherHandler((async(limit:number)=>{calls++;assert.equal(limit,3);return [{sourceId:"fixture",outcome:"success",opportunities:1,occurrences:1,requests:1}];}) as typeof dispatchDueSources,{SUPABASE_URL:"https://fixture.example.test",SUPABASE_SECRET_KEY:"synthetic-placeholder",CALENDAR_WRITES_ENABLED:"false"});
  assert.equal(calls,1);assert.equal(result.status,"completed");assert.equal(result.results.length,1);
});

test("dispatcher propagates infrastructure errors for durable retry and forbids calendar enablement",async()=>{
  await assert.rejects(runDispatcherHandler((async()=>{throw Error("Synthetic infrastructure failure");}) as typeof dispatchDueSources,{SUPABASE_URL:"https://fixture.example.test",SUPABASE_SECRET_KEY:"synthetic-placeholder"}),/infrastructure failure/);
  await assert.rejects(runDispatcherHandler(undefined,{CALENDAR_WRITES_ENABLED:"true"}),/calendar writes disabled/);
});
