/** Read-only public probes. Full responses are written exclusively below ignored private/. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectSource } from "../lib/collection";

const args=process.argv.slice(2);
const startDate=args.find(a=>a.startsWith("--start="))?.slice(8);
const sourceArg=args.find(a=>a.startsWith("--source="))?.slice(9);
const sources=sourceArg?[sourceArg]:["fsu-calendar-api","fsu-music-events"];
const outputDir=path.resolve("private","stage-1-live");
await mkdir(outputDir,{recursive:true,mode:0o700});
await mkdir("reports",{recursive:true});
const results=[];
for(const sourceId of sources){
  const batch=await collectSource(sourceId,{startDate});
  await writeFile(path.join(outputDir,`${sourceId}.json`),JSON.stringify(batch,null,2),{mode:0o600});
  results.push({sourceId,status:batch.status,reason:batch.reason,startedAt:batch.startedAt,finishedAt:batch.finishedAt,privateCapturePath:`private/stage-1-live/${sourceId}.json`,pages:batch.pages.length,requests:batch.observations.requests,bytes:batch.observations.bytes,nativeRows:batch.observations.nativeRows,opportunities:batch.opportunities.length,occurrences:batch.occurrences.length,paginationComplete:batch.observations.paginationComplete,windowFrom:batch.observations.windowFrom,windowTo:batch.observations.windowTo,warnings:batch.observations.warnings,sourceUrls:batch.pages.map(p=>p.url),bodyHashes:batch.pages.map(p=>p.sha256)});
}
type Attempt={reportedAt:string;requests:number;results:Array<{sourceId:string;status:string;requests:number}>};
const history:Attempt[]=[];
for(const filename of ["reports/stage-1-source-initial-live.json","reports/stage-1-sources-live.json"]){
  try{
    const prior=JSON.parse(await readFile(filename,"utf8"));
    if(Array.isArray(prior.attemptHistory))history.push(...prior.attemptHistory);
    else history.push({reportedAt:prior.reportedAt,requests:prior.results.reduce((sum:number,r:{requests:number})=>sum+r.requests,0),results:prior.results.map((r:{sourceId:string;status:string;requests:number})=>({sourceId:r.sourceId,status:r.status,requests:r.requests}))});
  }catch{/* First execution has no prior report. Raw capture bodies are never copied into reports. */}
}
const reportedAt=new Date().toISOString();
history.push({reportedAt,requests:results.reduce((sum,r)=>sum+r.requests,0),results:results.map(r=>({sourceId:r.sourceId,status:r.status,requests:r.requests}))});
const attemptHistory=[...new Map(history.map(item=>[item.reportedAt,item])).values()];
const report={evidenceClass:"fresh-live-read-only-fetch",mocked:false,reportedAt,providerConnectorsInvoked:0,modelCalls:0,calendarWrites:0,upstreamChargesUsd:0,chargeBasis:"Public GET only; account invoices and tool subscriptions are not measured",totalPublicHttpAttempts:attemptHistory.reduce((sum,item)=>sum+item.requests,0),attemptHistory,results};
await writeFile("reports/stage-1-sources-live.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.status!=="success"))process.exitCode=2;
