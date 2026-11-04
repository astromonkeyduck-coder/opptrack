/** Explicit source-only native candidate and one-shot frozen scorer binding. No CLI auto-run. */
import { RESULT_VERSION, validateExtractionResult } from '../lib/extraction/contracts';
import { extractCandidates } from '../lib/extraction/text-v5';
import { MEDIA_LIMITS,processMediaAssets } from '../lib/extraction/media-v2';
import { assertPreGoldAccess,digest,stableJson,validateHumanLabels,verifyFreeze,withBlindedGold,type BlindedIo,type CandidateFreeze,type RequiredFields } from './stage2-acceptance-guards';
import { allFrozenSourceViews,loadAcceptanceSources,validateAcceptancePredictions,type AcceptancePredictionBody,type SourceOnlyInput } from './stage2-acceptance-predictions';
import { ACCEPTANCE_REQUIRED_FIELDS } from './stage2-acceptance-critical-fields';
import { proposeAcceptanceReconciliation } from './stage2-acceptance-reconciliation';
import { scoreAcceptanceCandidate } from './stage2-acceptance-scorer';
export const ACCEPTANCE_NATIVE_CANDIDATE='native-v5-local-deterministic';
export const ACCEPTANCE_BINDING_PATHS={matcher:'evaluation/stage2-acceptance-matcher.ts',scorer:'evaluation/stage2-acceptance-scorer.ts',runner:'evaluation/stage2-acceptance-runner.ts',predictions:'evaluation/stage2-acceptance-predictions.ts',sourceTransform:'evaluation/stage2-source-only-transform-v3.ts'} as const;
export const ACCEPTANCE_REQUIRED_ARTIFACTS:Array<[CandidateFreeze['artifacts'][number]['group'],string]>=[
 ...['lib/extraction/text-v5.ts','lib/extraction/text-prose-v4.ts','lib/extraction/text-media-v4.ts','lib/extraction/text-media-v5.ts','lib/extraction/structured-v5.ts','lib/extraction/text.ts','lib/extraction/contracts.ts','lib/extraction/media-types.ts','lib/calendar/time.ts','lib/intake/validation.ts','lib/collection/types.ts','evaluation/stage2-evaluator.ts','package.json','package-lock.json'].map(path=>['runtime',path]as [CandidateFreeze['artifacts'][number]['group'],string]),
 ['protocol','evaluation/stage2-acceptance-protocol-v1.json'],['media','lib/extraction/media-v2.ts'],['source_transform','evaluation/stage2-reviewed-contract.ts'],['source_transform','evaluation/stage2-source-only-transform-v2.ts'],['source_transform',ACCEPTANCE_BINDING_PATHS.sourceTransform],['matcher',ACCEPTANCE_BINDING_PATHS.matcher],['matcher','evaluation/stage2-acceptance-reconciliation.ts'],['matcher','lib/extraction/reconciliation.ts'],['scorer',ACCEPTANCE_BINDING_PATHS.scorer],['scorer','evaluation/stage2-acceptance-canonical.ts'],['scorer','evaluation/stage2-acceptance-critical-fields.ts'],
 ...['evaluation/stage2-acceptance-guards.ts','evaluation/stage2-acceptance-files.ts',ACCEPTANCE_BINDING_PATHS.runner,ACCEPTANCE_BINDING_PATHS.predictions,'scripts/stage2-acceptance-tool.ts','scripts/stage2-score-acceptance.ts','evaluation/stage2-acceptance-environment.ts'].map(path=>['runner',path]as [CandidateFreeze['artifacts'][number]['group'],string]),
];
export function assertFinalAcceptanceBinding(freeze:CandidateFreeze){
 if(freeze.environment.maximumVisualPages>MEDIA_LIMITS.units||freeze.environment.maximumFileBytes!==MEDIA_LIMITS.bytes)throw Error('Frozen media limits differ from the bound native implementation');
 for(const[group,path]of ACCEPTANCE_REQUIRED_ARTIFACTS)if(!freeze.artifacts.some(artifact=>artifact.group===group&&artifact.path===path))throw Error('Final acceptance implementation is not frozen');
 if(!freeze.artifacts.some(artifact=>artifact.group==='protocol'&&artifact.path==='evaluation/stage2-acceptance-protocol-v1.json'&&artifact.sha256===freeze.protocolSha256))throw Error('The fixed acceptance protocol identity is not bound');
 if(freeze.candidates.length!==1||freeze.candidates[0].id!==ACCEPTANCE_NATIVE_CANDIDATE||freeze.candidates[0].modelInference||freeze.candidates[0].promptIds.length)throw Error('Only the frozen deterministic native candidate is bound; model comparison authorization is consumed');
}
export function assertFinalAcceptanceProtocol(value:unknown):RequiredFields{
 const protocol=value as Record<string,unknown>;
 if(!protocol||protocol.minimumEventRecall!==0.95||protocol.minimumActionRecall!==0.95||protocol.workingHumanHoldoutTarget!==100||protocol.maximumUnsupportedCriticalFacts!==0||protocol.allPredictionFieldsMustBeHumanLabeled!==true)throw Error('Frozen protocol does not match the fixed strict scorer');
 const annotation=protocol.annotation as Record<string,unknown>|undefined,required:RequiredFields={event:[...ACCEPTANCE_REQUIRED_FIELDS.event],action:[...ACCEPTANCE_REQUIRED_FIELDS.action],resource:[...ACCEPTANCE_REQUIRED_FIELDS.resource]};
 for(const[kind,key]of [['event','requiredEventFields'],['action','requiredActionFields'],['resource','requiredResourceFields']]as const){const values=annotation?.[key];if(!Array.isArray(values)||stableJson([...values].sort())!==stableJson([...required[kind]].sort()))throw Error('Frozen protocol cannot remove or downgrade the fixed explicit-field baseline');}
 return required;
}
/** This callback has no gold argument and native execution receives only original source bytes. */
export async function extractAcceptanceSource(input:SourceOnlyInput,freeze:CandidateFreeze){
 const started=Date.now(),media=await processMediaAssets(input.mediaAssets,{maxVisualPages:freeze.environment.maximumVisualPages});
 const units=[...input.textUnits.map(unit=>({assetId:unit.assetId,page:null,method:'provided-text' as const,status:'processed' as const,text:unit.text,sha256:unit.sha256,issues:[]})),...media.units];
 return validateExtractionResult({version:RESULT_VERSION,units,candidates:extractCandidates(units,{}),issues:[],complete:media.complete,stats:{expectedAssets:input.mediaAssets.length,processedAssets:new Set(media.units.filter(unit=>unit.status==='processed').map(unit=>unit.assetId)).size,processedPages:media.units.filter(unit=>unit.status==='processed').length,engine:'native-v5/source-only-text-v3/native-media-v2',elapsedMs:Date.now()-started}});
}
/** Returns bytes to be stored exclusively before scoring. It never opens annotations. */
export async function generateAcceptancePredictionSeal(input:{freeze:unknown;owner:unknown;exposure:unknown;readCode:(path:string)=>Uint8Array;readSource:(path:string)=>Uint8Array}){
 const freeze=verifyFreeze(input.freeze,input.readCode);assertFinalAcceptanceBinding(freeze);assertPreGoldAccess(freeze,input.owner,input.exposure);assertFinalAcceptanceProtocol(JSON.parse(new TextDecoder().decode(input.readCode('evaluation/stage2-acceptance-protocol-v1.json'))));
 const sources=loadAcceptanceSources(freeze,input.readSource),inventory=sources.map(source=>source.description);
 const predictionExtractionResults:AcceptancePredictionBody['predictionExtractionResults']=[];
 for(const source of sources){try{predictionExtractionResults.push({candidateId:ACCEPTANCE_NATIVE_CANDIDATE,caseId:source.description.caseId,status:'completed',failure:null,result:await extractAcceptanceSource(source,freeze)});}catch{predictionExtractionResults.push({candidateId:ACCEPTANCE_NATIVE_CANDIDATE,caseId:source.description.caseId,status:'failed',failure:'source_only_extraction_failed',result:null});}}
 const predictions:AcceptancePredictionBody={version:'stage2-acceptance-predictions-v1',sourceInventory:inventory,sourceInventorySha256:digest(stableJson([...inventory].sort((a,b)=>a.caseId.localeCompare(b.caseId)))),frozenSourceViews:allFrozenSourceViews(inventory),predictionExtractionResults,reconciliation:[{candidateId:ACCEPTANCE_NATIVE_CANDIDATE,relations:proposeAcceptanceReconciliation({sources,predictionExtractionResults,candidateId:ACCEPTANCE_NATIVE_CANDIDATE})}]};
 // Suggestions remain source-only; missing authority/identity is an abstention, never an invented relation.
 const bytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,freezeSha256:freeze.freezeSha256,sourceCustodySha256:freeze.sourceCustodySha256,caseRosterSha256:freeze.caseRosterSha256,candidateIds:freeze.candidates.map(item=>item.id),sourceOnly:true,goldAccessBeforeSeal:false,predictions}));
 validateAcceptancePredictions(bytes,freeze,inventory);return{bytes,sha256:digest(bytes),caseCount:inventory.length,goldRead:false as const};
}
/** The final matcher/scorer callback is fixed here, rather than caller-supplied. */
export async function runFrozenAcceptance(input:{freeze:unknown;owner:unknown;exposure:unknown;expectedPredictionsSha256:string;io:BlindedIo;readSource:(path:string)=>Uint8Array}){
 const freeze=verifyFreeze(input.freeze,input.io.readCode);assertFinalAcceptanceBinding(freeze);assertPreGoldAccess(freeze,input.owner,input.exposure);
 const sources=loadAcceptanceSources(freeze,input.readSource).map(source=>source.description);
 const predictions=input.io.readPredictions();if(digest(predictions)!==input.expectedPredictionsSha256)throw Error('Predictions changed before final validation');validateAcceptancePredictions(predictions,freeze,sources);
 const protocolBytes=input.io.readCode('evaluation/stage2-acceptance-protocol-v1.json'),protocol=JSON.parse(new TextDecoder().decode(protocolBytes));
 const required=assertFinalAcceptanceProtocol(protocol);
 return withBlindedGold({freeze,owner:input.owner,exposure:input.exposure,expectedPredictionsSha256:input.expectedPredictionsSha256,io:input.io,score:(goldBytes,sealedBytes)=>{
  const body=validateAcceptancePredictions(sealedBytes,freeze,sources);
  const labels=validateHumanLabels(JSON.parse(new TextDecoder().decode(goldBytes)),{freezeSha256:freeze.freezeSha256,sourceCustodySha256:freeze.sourceCustodySha256,caseRosterSha256:freeze.caseRosterSha256,caseIds:freeze.caseIds,freezeCreatedAt:freeze.createdAt,required,sourceViews:body.frozenSourceViews});
  return{version:'stage2-frozen-acceptance-run-v1',freezeSha256:freeze.freezeSha256,predictionsSha256:input.expectedPredictionsSha256,scores:freeze.candidates.map(candidate=>scoreAcceptanceCandidate({candidateId:candidate.id,labels,predictions:body})),sourceOnlyPredictions:true,exclusiveCohortReceiptRequired:true,stage2Accepted:false};
 }});
}
