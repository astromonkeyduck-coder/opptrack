/** Independent deterministic v3 diagnostic on exactly the newly approved20 development references. */
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { evaluationSha256, validateCorpus, wilsonInterval, type EvaluationCorpus, type Prediction } from '../evaluation/stage2-evaluator';
import { prepareReviewedReference, reviewedSha256, REVIEWED_PREPARATION_VERSION, SOURCE_TRANSFORM_VERSION, scoreReviewedScope, validateReviewedPrediction, type ApprovedReference, type ReviewedExample } from '../evaluation/stage2-reviewed-contract';

const approvalPath='reports/stage-2-next25-human-review.json',approvalBytes=await readFile(approvalPath),approval=JSON.parse(approvalBytes.toString('utf8'));
const overlayReference=approval.privateOverlays.find((item:{path:string})=>item.path.endsWith('/inventory20-overlay.json'));
if(!overlayReference||approval.counts.newInventoryDevelopmentExamples!==20)throw new Error('The exact twenty-reference approval is required.');
const overlayBytes=await readFile(overlayReference.path);if(reviewedSha256(overlayBytes)!==overlayReference.sha256)throw new Error('Approval overlay hash mismatch.');
const overlay=JSON.parse(overlayBytes.toString('utf8'));
const packetManifest=JSON.parse(await readFile('reports/stage-2-next-review-packet.json','utf8'));
const packet=JSON.parse(await readFile(packetManifest.privateArtifacts.reviewJson,'utf8'));
if(overlay.packetId!==packet.packetId||overlay.examples.length!==20||packet.entries.length!==20||JSON.stringify(overlay.examples.map((item:{exampleId:string})=>item.exampleId))!==JSON.stringify(packet.entries.map((item:{exampleId:string})=>item.exampleId)))throw new Error('Approved packet identities differ.');
const oldComparisonPath='reports/stage-2-reviewed-development-comparison.json',oldComparisonHash=reviewedSha256(await readFile(oldComparisonPath));
const oldManifestPath='evaluation/stage2-reviewed-development-v3-manifest.json',oldManifestHash=reviewedSha256(await readFile(oldManifestPath));
const oldApproval=JSON.parse(await readFile('reports/stage-2-first-ten-human-review.json','utf8'));
const previous=new Set(oldApproval.examples.map((item:{exampleId:string})=>item.exampleId));
const runtimePath='lib/extraction/text.ts',registryPath='lib/extraction/versions.ts';
const runtimeSha256=reviewedSha256(await readFile(runtimePath)),registrySha256=reviewedSha256(await readFile(registryPath));
const {extractCandidatesForVersion}=await import('../lib/extraction/versions');
const captures=new Map<string,string>(),prepared:Array<ReturnType<typeof prepareReviewedReference>>=[];
for(const item of overlay.examples){
 if(previous.has(item.exampleId))throw new Error('Old ten must not be counted as new development results.');
 const entry=packet.entries.find((entry:{exampleId:string})=>entry.exampleId===item.exampleId);
 if(!entry||evaluationSha256(entry.proposedFacts)!==item.proposedFactsSha256||entry.review.decision!=='approve_no_corrections'||entry.familyId!==item.familyId)throw new Error('Approved reference facts changed.');
 if(!entry.examplePath.startsWith('private/stage2-review/snapshot-861858544d6817c5/examples/'))throw new Error('Unexpected reference source.');
 const exampleBytes=await readFile(entry.examplePath);if(reviewedSha256(exampleBytes)!==item.exampleContentSha256)throw new Error('Original frozen example changed.');
 const example=JSON.parse(exampleBytes.toString('utf8')) as ReviewedExample;
 const originalProposals=example.members.map((member,memberIndex)=>({memberIndex,sourceId:member.sourceId,...member.silverLabels}));
 if(evaluationSha256(originalProposals)!==item.proposedFactsSha256)throw new Error('Packet approval does not match the original parser reference facts.');
 for(const member of example.members)for(const evidence of member.evidence){
  if(!evidence.capturePath.startsWith('private/stage2-review/snapshot-861858544d6817c5/captures/'))throw new Error('Unexpected capture source.');
  let hash=captures.get(evidence.capturePath);if(!hash){hash=reviewedSha256(await readFile(evidence.capturePath));captures.set(evidence.capturePath,hash);}if(hash!==evidence.bodySha256)throw new Error('Original capture hash mismatch.');
 }
 const reference:ApprovedReference={exampleId:item.exampleId,familyId:item.familyId,examplePath:entry.examplePath,exampleContentSha256:item.exampleContentSha256,originalLabelsSha256:evaluationSha256(example.members.map(member=>({sourceId:member.sourceId,silverLabels:member.silverLabels}))),primarySource:entry.primarySource,decision:'approve_no_corrections',split:'development',reviewer:'project_owner',reviewMethod:approval.reviewMethod,adjudicated:false};
 prepared.push(prepareReviewedReference(example,reference,approval.confirmationRecordedAt));
}
const corpus:EvaluationCorpus={schemaVersion:1,corpusVersion:'stage2-next20-approved-development-v1',provenanceNotice:'Twenty newly owner-approved development references, using the unchanged partial canonical mapping/source transform. No new factual adjudication or holdout.',targetVariedHumanLabeledExamples:100,recallTarget:0.95,minimumHumanReviewedHoldout:40,cases:prepared.map(item=>item.item)};
const errors=validateCorpus(corpus);if(errors.length)throw new Error(errors.join('\n'));
const projectionHash=evaluationSha256({corpus,scopes:prepared.map(item=>item.scopeNotes),preparationVersion:REVIEWED_PREPARATION_VERSION,sourceTransform:SOURCE_TRANSFORM_VERSION});
const results=prepared.map(item=>{
 const started=performance.now();let prediction:Prediction,candidates:unknown[]=[],error:string|null=null;
 try{candidates=extractCandidatesForVersion('stage2-rules-v3',item.input.units,{publishedAt:item.input.publishedAt,timeZone:item.input.timeZone});prediction=validateReviewedPrediction(item.input,candidates as Parameters<typeof validateReviewedPrediction>[1]);}
 catch(failure){error=String(failure instanceof Error?failure.message:failure).slice(0,250);prediction={caseId:item.item.id,units:[],processedMedia:[],status:'blocked',issues:['runtime_validation_failed'],providerRequests:0,costUsd:0};}
 return{caseId:item.item.id,prediction,candidates,error,elapsedMs:performance.now()-started,score:scoreReviewedScope(item.item,prediction)};
});
if(reviewedSha256(await readFile(runtimePath))!==runtimeSha256||reviewedSha256(await readFile(registryPath))!==registrySha256)throw new Error('Runtime changed during evaluation.');
if(reviewedSha256(await readFile(oldComparisonPath))!==oldComparisonHash||reviewedSha256(await readFile(oldManifestPath))!==oldManifestHash)throw new Error('Original ten-case comparison/reference changed during this run.');
const fields={expected:0,correct:0,missed:0,labeledPredicted:0,wrongOrUnsupported:0,totalPredictedNonnullFields:0,unscoredMatchedFields:0,unscoredExtraUnitFields:0};
const units={event:{expected:0,complete:0,missed:0},action:{expected:0,complete:0,missed:0}};
for(const result of results){const score=result.score;for(const key of ['expected','correct','missed','labeledPredicted','wrongOrUnsupported']as const)fields[key]+=score.fields[key];fields.totalPredictedNonnullFields+=score.totalPredictedNonnullFields;fields.unscoredMatchedFields+=score.fields.unscoredPredicted;fields.unscoredExtraUnitFields+=score.extraPredictedUnitsUnscored.reduce((sum,unit)=>sum+unit.nonnullFields.length,0);for(const kind of ['event','action']as const){units[kind].expected+=score.units[kind].expected;units[kind].complete+=score.units[kind].correct;units[kind].missed+=score.units[kind].missed;}}
const directory='private/stage2-reviewed/next20-approved-v1';await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
const recordedAt=new Date().toISOString(),runFile=path.join(directory,`v3-${projectionHash.slice(0,16)}-${recordedAt.replace(/[:.]/g,'-')}.json`);
await writeFile(runFile,JSON.stringify({recordedAt,projectionHash,corpus,inputs:prepared.map(item=>item.input),scopes:prepared.map(item=>({caseId:item.item.id,scopeNotes:item.scopeNotes})),results},null,2)+'\n',{flag:'wx',mode:0o600});
const report={schemaVersion:1,recordedAt,status:'newly_approved_twenty_development_partial_scope_diagnostic_not_acceptance',datasetVersion:corpus.corpusVersion,preparationContract:REVIEWED_PREPARATION_VERSION,sourceTransform:SOURCE_TRANSFORM_VERSION,projectionHash,
 approval:{path:approvalPath,sha256:reviewedSha256(approvalBytes),reviewId:approval.reviewId,confirmationRecordedAt:approval.confirmationRecordedAt,exactReviewTimeKnown:false,adjudicated:false,overlaySha256:overlayReference.sha256},
 inputs:{reviewedDevelopmentExamples:20,sourceMembers:prepared.reduce((sum,item)=>sum+new Set(item.input.references.map(reference=>reference.memberIndex)).size,0),retainedSourceTextUnits:prepared.reduce((sum,item)=>sum+item.input.units.length,0),verifiedOriginalCaptures:captures.size,allDevelopment:true,holdoutReadOrScored:false,oldTenRepeated:false},
 runtime:{version:'stage2-rules-v3',file:runtimePath,sha256:runtimeSha256,registryFile:registryPath,registrySha256,sourceOnlyInputs:true,quotesValidated:true,elapsedMs:results.reduce((sum,item)=>sum+item.elapsedMs,0),validationFailures:results.filter(item=>item.error).map(item=>({caseId:item.caseId,error:item.error}))},
 scopedMeasurements:{fields:{...fields,unscoredTotal:fields.unscoredMatchedFields+fields.unscoredExtraUnitFields,labeledPrecision:fields.labeledPredicted?fields.correct/fields.labeledPredicted:null,labeledFactRecovery:fields.expected?fields.correct/fields.expected:null,predictionLabelCoverage:fields.totalPredictedNonnullFields?fields.labeledPredicted/fields.totalPredictedNonnullFields:null},
  strictScopedUnits:{event:{...units.event,completeness:units.event.expected?units.event.complete/units.event.expected:null,wilson95:wilsonInterval(units.event.complete,units.event.expected)},action:{...units.action,completeness:units.action.expected?units.action.complete/units.action.expected:null,wilson95:wilsonInterval(units.action.complete,units.action.expected)}},casesAllScopedFactsMatch:results.filter(item=>item.score.passed).length,cases:20,extraPredictedUnitsUnscored:results.reduce((sum,item)=>sum+item.score.extraPredictedUnitsUnscored.length,0)},
 needsReview:{scopeNotes:prepared.reduce((sum,item)=>sum+item.scopeNotes.length,0),exhaustiveEntitySets:false,canonicalNullBoundaryAdjudication:false,semanticallyEquivalentVenueNamesAdjudicated:false},
 cases:results.map((item,index)=>({caseId:item.caseId,primarySource:packet.entries.find((entry:{exampleId:string})=>entry.exampleId===item.caseId).primarySource,score:item.score,scopeNotes:prepared[index].scopeNotes,error:item.error})),
 preservation:{oldTenComparisonSha256:oldComparisonHash,oldTenManifestSha256:oldManifestHash,oldTenFilesChanged:false,originalFactsOrSourcesChanged:false,privateRun:runFile},
 boundaries:{newModelCalls:0,approvedModelGenerationBudgetConsumed:true,httpRequests:0,databaseCalls:0,calendarCalls:0,newHumanApprovals:0},
 limitations:['Single-owner-approved inherited source references, not independent adjudication or a representative holdout.','Only the existing fixed nonnull canonical scope is scored; null boundaries, venue equivalence, extra entities and source conflicts remain explicit review work.','Strict scoped completeness is not title-only detection recall; missing scheduled status remains a failure without inventing it.','Inputs are source-derived JSON/ICS/HTML text, not OCR. Five separately approved actual-media examples are excluded from this diagnostic.','Existing provisional family grouping is preserved without new organizer/alias adjudication.','Wilson intervals describe binomial arithmetic on scoped units; within-family dependence is not cluster-adjusted, so they do not establish independent-source uncertainty or campus coverage.','A schema/evidence validation failure is a failed attempt, never a successful empty result.'],stage2Accepted:false,completeFactualAccuracyEstablished:false};
await writeFile('reports/stage-2-next20-reviewed-development.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:'reports/stage-2-next20-reviewed-development.json',cases:20,correct:fields.correct,labeledPredicted:fields.labeledPredicted,totalPredicted:fields.totalPredictedNonnullFields,unscored:report.scopedMeasurements.fields.unscoredTotal,recovered:fields.correct,expected:fields.expected,units,casesComplete:report.scopedMeasurements.casesAllScopedFactsMatch,validationFailures:report.runtime.validationFailures.length,modelCalls:0}));
process.exitCode=results.every(item=>item.score.passed)?0:1;
