/** Manual, bounded read-only access checks. Never activates candidates or changes cloud settings. */
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import candidates from "../config/instagram-candidates.json";
import { graphVersion, preflightHighPriorityInstagramCandidate, probeEnvironmentFilename, type PreflightResult } from "../lib/instagram/business-discovery-preflight";

export const selectedInstagramCandidates = candidates.accounts.filter(account => account.priority === "high");
export const candidateProbeLimits = { accounts: 29, requestsPerAccount: 1, parentPostsPerAccount: 5, childMetadataPerPost: 20, concurrentAccounts: 2, timeoutMsPerAccount: 10_000, responseByteLimitPerAccount: 262_144 } as const;

export async function probeHighPriorityCandidates(environment: Record<string,string|undefined>, dependencies: { fetch?: typeof fetch; now?: () => Date } = {}) {
  if (selectedInstagramCandidates.length !== 29 || new Set(selectedInstagramCandidates.map(account => account.handle)).size !== 29) throw new Error("Candidate selection must retain the approved 29 unique high-priority accounts");
  const now = dependencies.now ?? (() => new Date()), startedAt = now().toISOString();
  const summaries = new Array<PreflightResult["summary"]>(selectedInstagramCandidates.length);
  let next = 0;
  await Promise.all(Array.from({length:candidateProbeLimits.concurrentAccounts},async()=>{
    while(next < selectedInstagramCandidates.length) {
      const index = next++;
      const result = await preflightHighPriorityInstagramCandidate({ target: selectedInstagramCandidates[index].handle, environment }, dependencies);
      summaries[index] = result.summary;
      // Raw response bodies and private sample IDs never enter this public report.
    }
  }));
  const statusCounts:Record<string,number>={};
  for(const summary of summaries) statusCounts[summary.status]=(statusCounts[summary.status]??0)+1;
  return {
    schema_version:1,
    probe:"manual_high_priority_instagram_candidates_v1",
    api_version:graphVersion,
    started_at_utc:startedAt,
    finished_at_utc:now().toISOString(),
    candidate_registry:"config/instagram-candidates.json",
    credential_source:"ignored local probe environment; values omitted",
    limits:candidateProbeLimits,
    counts:{
      selected_accounts:summaries.length,
      accounts_attempted:summaries.filter(summary=>summary.requests>0).length,
      access_samples_proven:summaries.filter(summary=>summary.accessSampleProven).length,
      requests:summaries.reduce((total,summary)=>total+summary.requests,0),
      response_bytes:summaries.reduce((total,summary)=>total+summary.responseBytes,0),
      valid_parent_posts:summaries.reduce((total,summary)=>total+summary.counts.validUniqueMediaRows,0),
      child_metadata_rows:summaries.reduce((total,summary)=>total+summary.counts.children,0),
      status_counts:statusCounts,
    },
    accounts:summaries.map((summary,index)=>({
      handle:selectedInstagramCandidates[index].handle,
      existing_watchlist_source_id:selectedInstagramCandidates[index].existing_watchlist_source_id,
      ...summary,
    })),
    changes:{candidates_activated:0,production_watchlist_modified:false,production_worker_allowlist_modified:false,database_writes:0,cloud_environment_changes:0,paid_services_enabled:false,calendar_writes:0},
    evidence_limits:["Bounded five-parent metadata samples only; no full-history or all-slide content guarantee.","No captions, media URLs, media files, Stories or event extraction requested.","A failed, blocked, rate-limited or empty-unverified response does not mean nothing new.","Affiliation, current activity, alias claims and suitability are separate from API sample access.","Public report omits credentials, caller/account IDs, sample post IDs, permalinks, provider URLs, cursor values and raw error messages."],
  };
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==="--help") {
    console.log("Usage: node --import tsx scripts/probe-instagram-candidates.ts --plan | --run");
    console.log("--plan reads only candidate configuration. --run uses the ignored probe credential file for 29 bounded read-only checks; no activation.");
    return;
  }
  if(args.length===1 && args[0]==="--plan") {
    console.log(JSON.stringify({status:"ready_not_run",selectedAccounts:selectedInstagramCandidates.length,newHighPriorityCandidates:selectedInstagramCandidates.filter(account=>!account.existing_watchlist_source_id).length,limits:candidateProbeLimits,credentialValuesRead:false,networkRequests:0,productionChanges:false}));
    return;
  }
  if(args.length!==1 || args[0]!=="--run")throw new Error("Select --plan or --run; arbitrary targets and limit overrides are not accepted");
  let environment:Record<string,string|undefined>={};
  try { environment=parseEnv(await readFile(probeEnvironmentFilename,"utf8")); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new Error("Private probe environment could not be read"); }
  const report=await probeHighPriorityCandidates(environment);
  const filename="reports/instagram-candidates-high-priority-access.json";
  await writeFile(filename,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({status:"completed_read_only_probe",report:filename,...report.counts,productionChanges:false,credentialValuesLogged:false}));
  process.exitCode=report.counts.status_counts.setup_needed===29?2:report.counts.status_counts.success_sample===29?0:3;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{console.log(JSON.stringify({status:"failed",reasonCodes:["candidate_probe_configuration_or_io_failure"],credentialValuesLogged:false}));process.exitCode=1;});
}
