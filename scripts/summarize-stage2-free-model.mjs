/** Offline telemetry/identity verification only. Never generates another token. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { wilsonInterval } from '../evaluation/stage2-evaluator.ts';
const root=path.resolve('private/stage2-free-model'),hash=value=>createHash('sha256').update(value).digest('hex');
const full=JSON.parse(await readFile(path.join(root,'comparison.json'),'utf8'));
const jobs=JSON.parse(await readFile(path.join(root,'planned-jobs.json'),'utf8')).jobs;
const journal=(await readFile(path.join(root,'generation-journal.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const starts=journal.filter(item=>item.state==='generation_started');
assert.ok(starts.length<=20);assert.equal(starts.length,full.records.length);assert.equal(new Set(starts.map(item=>item.jobId)).size,starts.length);
for(const record of full.records){const job=jobs.find(job=>job.jobId===record.jobId);assert.ok(job);assert.equal(record.inputSha256,job.inputSha256);assert.equal(record.promptSha256,job.promptSha256);if(typeof record.output==='string'&&record.output.length)assert.equal(hash(record.output),record.outputSha256);}
const baselinePath='reports/stage-2-reviewed-development-stage2-rules-v3.json',baselineBytes=await readFile(baselinePath),baseline=JSON.parse(baselineBytes.toString('utf8'));
assert.equal(baseline.input.referenceHash,full.inputs.referenceHash);
const byReason={};for(const record of full.records)if(record.failure)byReason[record.failure]=(byReason[record.failure]??0)+1;
const promptTelemetry=full.prompts.map(prompt=>{
 const runs=full.records.filter(record=>record.promptId===prompt.promptId),planned=jobs.filter(job=>job.promptId===prompt.promptId);
 return{...prompt,labeledPrecisionOfValidatedPredictions:prompt.labeledPredictions?prompt.factsRecovered/prompt.labeledPredictions:null,
  scopedFactRecoveryForAttemptedCases:prompt.scopedFactsExpectedForAttemptedCases?prompt.factsRecovered/prompt.scopedFactsExpectedForAttemptedCases:null,
  scopedEventCompleteness:prompt.events.expected?prompt.events.complete/prompt.events.expected:null,scopedEventWilson95:wilsonInterval(prompt.events.complete,prompt.events.expected),
  scopedActionCompleteness:prompt.actions.expected?prompt.actions.complete/prompt.actions.expected:null,scopedActionWilson95:wilsonInterval(prompt.actions.complete,prompt.actions.expected),
  failedOutputsAreNotSuccessfulEmptyResults:true,rawUnvalidatedClaimPrecisionNotMeasured:true,
  inputMessageBytesForAttemptedGenerations:runs.reduce((sum,record)=>sum+Buffer.byteLength(JSON.stringify(planned.find(job=>job.jobId===record.jobId).messages)),0),
  rawOutputBytes:runs.reduce((sum,record)=>sum+(typeof record.output==='string'?Buffer.byteLength(record.output):0),0),
  wallMs:runs.reduce((sum,record)=>sum+record.elapsedMs,0),knownGenerationCpuMs:runs.reduce((sum,record)=>sum+(record.generationCpuMs??0),0),unmeasuredGenerationCpuRuns:runs.filter(record=>record.generationCpuMs===null).length};
});
const {records,...publicResult}=full;
const report={...publicResult,prompts:promptTelemetry,verification:{generationJournalVerified:true,actualGenerationStarts:starts.length,uniqueJobs:true,maximumOutputTokenCapVerifiedFromRecordedConfig:full.limits.maximumOutputTokens,workerScriptSha256:hash(await readFile('scripts/stage2-free-model-worker.mjs')),runnerScriptSha256:hash(await readFile('scripts/run-stage2-free-model.ts'))},
 failureCounts:byReason,backendReady:full.runtime.readyAt!==null,
 deterministicBaseline:{path:baselinePath,reportSha256:hash(baselineBytes),extractorVersion:baseline.runtime.extractorVersion,referenceHash:baseline.input.referenceHash,measurements:baseline.scopedMeasurements},
 configurationSelectedForProduction:false,selectionReason:'No automatic promotion is authorized; complete semantic/holdout gates remain open. Parse/schema/evidence failures cannot qualify a configuration even when API charges are zero.',
 setupFailureEvidence:['private/stage2-free-model/artifacts-initial-network-failure.json','private/stage2-free-model/npm-cache/_logs/'],
 telemetryLimitations:['Generation counts, raw output bytes, wall time and child CPU telemetry are measured. Actual generated token counts were not separately returned;384 is the enforced maximum_new_tokens setting.','CPU watchdog uses one-second heartbeats plus a hard wall cap; model/runtime initialization is included in the timed attempt. Download/install CPU and local electricity remain unmeasured.','The model artifact byte count excludes isolated npm dependencies/cache. No production dependencies were changed.']};
await writeFile('reports/stage-2-free-local-model-comparison.json',JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(root,'verified-summary.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({report:'reports/stage-2-free-local-model-comparison.json',generations:starts.length,validated:promptTelemetry.reduce((sum,prompt)=>sum+prompt.validated,0),failures:byReason,apiCostUsd:0}));
