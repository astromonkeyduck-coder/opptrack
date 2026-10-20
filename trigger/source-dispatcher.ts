import { AbortTaskRunError, runs, schedules, type Context } from "@trigger.dev/sdk";
import { runDispatcherHandler } from "../lib/collection/dispatcher";
import type { DispatcherProvenance } from "../lib/ingestion";

// Free-created schedules require hourly cadence and a minimum 60-minute window.
// payload.timestamp is the nominal cron time; the actual start can be later.
export const dispatcherSchedule={
  pattern:"0 * * * *",
  window:"60m" as const,
  timezone:"UTC",
  environments:["DEVELOPMENT","PRODUCTION"] as Array<"DEVELOPMENT"|"PRODUCTION">,
};

type RunIdentity=Pick<Context["run"],"id"|"isTest"|"isReplay">;
type ScheduledPayload=Parameters<Parameters<typeof schedules.task>[0]["run"]>[0];
type RunMetadata={id:string;taskIdentifier:string;isTest:boolean;schedule?:{id:string}};
type RetrieveRunMetadata=(id:string)=>Promise<RunMetadata>;

/** A scheduler-shaped payload alone cannot establish that a Cloud schedule ran. */
export async function provenanceForTriggerRun(
  payload:Pick<ScheduledPayload,"scheduleId"|"timestamp">,
  run:RunIdentity,
  retrieve:RetrieveRunMetadata=async id=>runs.retrieve(id),
):Promise<DispatcherProvenance>{
  if(run.isTest)return {triggerRunId:run.id,invocationKind:"manual"};
  if(run.isReplay)return {triggerRunId:run.id,invocationKind:"replay"};
  let remote:RunMetadata;
  try{remote=await retrieve(run.id);}
  catch{throw new Error("Trigger run provenance could not be verified; source dispatch was not started");}
  if(remote.id!==run.id||remote.taskIdentifier!=="opportunity-source-dispatcher")throw new Error("Trigger run metadata did not match this dispatcher invocation");
  if(remote.isTest||!remote.schedule?.id||remote.schedule.id!==payload.scheduleId)return {triggerRunId:run.id,invocationKind:"manual"};
  if(!(payload.timestamp instanceof Date)||!Number.isFinite(payload.timestamp.getTime()))throw new Error("Scheduled dispatcher timestamp is invalid");
  return {triggerRunId:run.id,scheduledAt:payload.timestamp.toISOString(),invocationKind:"scheduled",scheduleId:remote.schedule.id};
}

/** Missing setup is visible as a failed Cloud run and does not waste retries. */
export function requireReadyDispatcherResult(result:Awaited<ReturnType<typeof runDispatcherHandler>>) {
  if(result.status==="setup_needed")throw new AbortTaskRunError(result.missingOwner?"Tracker owner setup is required before collection can run":"Worker environment setup is required before collection can run");
  return result;
}

/** One durable dispatcher. SQL atomically leases only enabled, due sources. */
export const sourceDispatcher=schedules.task({
  id:"opportunity-source-dispatcher",
  cron:dispatcherSchedule,
  queue:{name:"opportunity-source-dispatcher",concurrencyLimit:1},
  maxDuration:300,
  // Collection HTTP failures persist their own Retry-After/backoff in SQL. Only
  // infrastructure exceptions reach SDK retries, after the ten-minute lease expires.
  retry:{maxAttempts:3,factor:2,minTimeoutInMs:600_000,maxTimeoutInMs:900_000,randomize:true},
  run:async(payload,{ctx})=>requireReadyDispatcherResult(await runDispatcherHandler(undefined,undefined,await provenanceForTriggerRun(payload,ctx.run))),
});
