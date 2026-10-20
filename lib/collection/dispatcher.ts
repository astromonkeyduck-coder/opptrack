import { dispatchDueSources, WorkerSetupNeeded, type DispatcherProvenance } from "../ingestion";

/** The same handler is registered with Trigger and can be exercised locally. */
export async function runDispatcherHandler(
  dispatch: typeof dispatchDueSources = dispatchDueSources,
  environment: Record<string,string|undefined> = process.env,
  provenance: DispatcherProvenance = { invocationKind: "local" },
) {
  if(environment.CALENDAR_WRITES_ENABLED && environment.CALENDAR_WRITES_ENABLED !== "false")throw new Error("Stage 1 requires calendar writes disabled");
  const missing:string[]=[];
  if(!environment.SUPABASE_URL&&!environment.NEXT_PUBLIC_SUPABASE_URL)missing.push("SUPABASE_URL");
  if(!environment.SUPABASE_SECRET_KEY)missing.push("SUPABASE_SECRET_KEY");
  if(missing.length)return {status:"setup_needed" as const,missing,missingOwner:false,results:[],provenance};
  try {
    const results=await dispatch(2,undefined,provenance);
    return {status:results.length?"completed" as const:"idle" as const,missing:[],missingOwner:false,results,provenance};
  } catch(error) {
    if(error instanceof WorkerSetupNeeded)return {status:"setup_needed" as const,missing:["tracker_owner"],missingOwner:true,results:[],provenance};
    throw error;
  }
}
