import assert from "node:assert/strict";
import test from "node:test";
import { runDispatcherHandler } from "../lib/collection/dispatcher";
import type { dispatchDueSources } from "../lib/ingestion";
import { sourceDispatcher } from "../trigger/source-dispatcher";

test("Trigger SDK registers the real dispatcher task without claiming cloud execution",()=>{
  assert.equal(sourceDispatcher.id,"opportunity-source-dispatcher");assert.equal(typeof sourceDispatcher.trigger,"function");
});

test("dispatcher missing configuration returns setup needed and makes no calls",async()=>{
  const result=await runDispatcherHandler((async()=>{throw Error("must not dispatch");}) as typeof dispatchDueSources,{});
  assert.equal(result.status,"setup_needed");assert.deepEqual(result.missing,["SUPABASE_URL","SUPABASE_SECRET_KEY"]);
});

test("dispatcher handler invokes leased-source service once with its bounded batch",async()=>{
  let calls=0;const result=await runDispatcherHandler((async(limit:number)=>{calls++;assert.equal(limit,2);return [{sourceId:"fixture",outcome:"success",opportunities:1,occurrences:1,requests:1}];}) as typeof dispatchDueSources,{SUPABASE_URL:"https://fixture.example.test",SUPABASE_SECRET_KEY:"synthetic-placeholder",CALENDAR_WRITES_ENABLED:"false"});
  assert.equal(calls,1);assert.equal(result.status,"completed");assert.equal(result.results.length,1);
});

test("dispatcher propagates infrastructure errors for durable retry and forbids calendar enablement",async()=>{
  await assert.rejects(runDispatcherHandler((async()=>{throw Error("Synthetic infrastructure failure");}) as typeof dispatchDueSources,{SUPABASE_URL:"https://fixture.example.test",SUPABASE_SECRET_KEY:"synthetic-placeholder"}),/infrastructure failure/);
  await assert.rejects(runDispatcherHandler(undefined,{CALENDAR_WRITES_ENABLED:"true"}),/calendar writes disabled/);
});
