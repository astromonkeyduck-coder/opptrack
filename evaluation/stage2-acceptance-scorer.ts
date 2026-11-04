/** New strict acceptance scorer. Gold is supplied only by the blinded runner after sealing. */
import { extractionUnitId, validateExtractionResult, type ExtractionCandidate, type Primitive } from '../lib/extraction/contracts';
import type { HumanLabels } from './stage2-acceptance-guards';
import type { AcceptancePredictionBody, AcceptanceSourceCase, RelationProposal } from './stage2-acceptance-predictions';
import { isAcceptanceCriticalField } from './stage2-acceptance-critical-fields';
import { projectCanonicalComparison } from './stage2-acceptance-canonical';
import { acceptancePrimitiveEquivalent, matchAcceptanceObservations } from './stage2-acceptance-matcher';
type Kind='event'|'action'|'resource';
type LabeledEntity=HumanLabels['cases'][number]['observations'][number];
export type FieldCounts={labeledNonNull:number;correct:number;wrong:number;unsupported:number;wrongCritical:number;unsupportedCritical:number;nullAbstentions:number;explicitUnknownAbstentions:number;knownMisses:number;unscoredNonNull:number};
const fieldCounts=():FieldCounts=>({labeledNonNull:0,correct:0,wrong:0,unsupported:0,wrongCritical:0,unsupportedCritical:0,nullAbstentions:0,explicitUnknownAbstentions:0,knownMisses:0,unscoredNonNull:0});
const unitCounts=()=>({expected:0,detected:0,strictCorrect:0,detectionRecall:null as number|null,correctUnitRecall:null as number|null});
const byKind=()=>({event:unitCounts(),action:unitCounts(),resource:unitCounts()});
const refKey=(ref:{caseId:string;candidateKey:string})=>ref.caseId+'\0'+ref.candidateKey;
const pairKey=(left:string,right:string)=>[left,right].sort().join('\u0001');
/** One explicit representation alias, frozen in code. No source/canonical date or zone conversion. */
export function projectAcceptanceCandidate(candidate:ExtractionCandidate):ExtractionCandidate{
 const fields:Record<string,Primitive>={};for(const[field,value]of Object.entries(candidate.fields)){const key=field==='price'?'cost':field;if(Object.hasOwn(fields,key))throw Error('Acceptance field alias collision');fields[key]=value;}
 return {...candidate,fields,claims:candidate.claims.map(claim=>({...claim,field:claim.field==='price'?'cost':claim.field}))};
}
function compareFields(expected:LabeledEntity['fields'],actual:Record<string,Primitive>|null,counts:FieldCounts){
 let criticalCorrect=actual!==null;
 for(const[field,label]of Object.entries(expected)){
  const value=actual?.[field]??null;
  if(value===null){counts.nullAbstentions++;if(label.state==='known'){counts.knownMisses++;if(label.critical)criticalCorrect=false;}else if(actual!==null)counts.explicitUnknownAbstentions++;continue;}
  counts.labeledNonNull++;
  if(label.state!=='known'){counts.unsupported++;if(label.critical){counts.unsupportedCritical++;criticalCorrect=false;}}
  else if(acceptancePrimitiveEquivalent(value,label.value,field)){counts.correct++;}
  else{counts.wrong++;if(label.critical){counts.wrongCritical++;criticalCorrect=false;}}
 }
 for(const[field,value]of Object.entries(actual??{}))if(value!==null&&!Object.hasOwn(expected,field)){counts.unscoredNonNull++;criticalCorrect=false;}
 return criticalCorrect;
}
function inspectProcessing(source:AcceptanceSourceCase,result:NonNullable<AcceptancePredictionBody['predictionExtractionResults'][number]['result']>){
 const errors:string[]=[],covered=new Set<string>();
 try{validateExtractionResult(result);}catch{errors.push('invalid_result_or_evidence');return{errors,complete:false};}
 for(const unit of result.units){const key=extractionUnitId(unit),view=source.views.find(item=>item.unitId===key&&item.representation!=='original-text'),asset=source.assets.find(item=>item.assetId===unit.assetId);
  if(!asset||(!view&&(unit.status==='processed'||unit.page!==null))){errors.push('undeclared_unit:'+key);continue;}if(view)covered.add(key);else for(const inputView of source.views.filter(view=>view.unitId.startsWith(unit.assetId+':')&&view.representation!=='original-text'))covered.add(inputView.unitId);
  const expectedHash=asset.kind==='text'?view?.sha256:asset.sha256;
  if(unit.sha256!==expectedHash)errors.push('original_or_transformed_hash_mismatch:'+key);
  if(asset.kind==='text'&&(unit.method!=='provided-text'||unit.status==='processed'&&unit.text!==view?.text))errors.push('source_text_changed:'+key);
  if(asset.kind==='media'&&unit.method==='provided-text')errors.push('media_replaced_by_provided_transcript:'+key);
  if(asset.mimeType==='application/pdf'&&(unit.status==='processed'||unit.expectedPages!==undefined)&&unit.expectedPages!==asset.expectedPages)errors.push('pdf_page_count_mismatch:'+key);
 }
 for(const view of source.views.filter(view=>view.representation!=='original-text'))if(!covered.has(view.unitId))errors.push('missing_asset_or_page:'+view.unitId);
 const media=source.assets.filter(asset=>asset.kind==='media'),processedMedia=new Set(result.units.filter(unit=>unit.status==='processed'&&media.some(asset=>asset.assetId===unit.assetId)).map(unit=>unit.assetId));
 const pages=result.units.filter(unit=>unit.status==='processed'&&media.some(asset=>asset.assetId===unit.assetId)).length;
 if(result.stats.expectedAssets!==media.length||result.stats.processedAssets!==processedMedia.size||result.stats.processedPages!==pages)errors.push('processing_statistics_disagree');
 const complete=errors.length===0&&covered.size===source.views.filter(view=>view.representation!=='original-text').length&&result.units.every(unit=>unit.status==='processed')&&!result.stats.visualWorkUncertain;
 if(result.complete!==complete)errors.push('processing_completeness_disagrees');
 return{errors,complete};
}
export function scoreAcceptanceCandidate(input:{candidateId:string;labels:HumanLabels;predictions:AcceptancePredictionBody}){
 const {candidateId,labels,predictions}=input;for(const entity of [...labels.cases.flatMap(item=>item.observations),...labels.canonicalUnits])for(const[field,label]of Object.entries(entity.fields))if(isAcceptanceCriticalField(field)&&!label.critical)throw Error('Semantic critical field cannot be downgraded');
 const fields=fieldCounts(),canonicalFields=fieldCounts(),sourceObservation=byKind(),canonical=byKind();
 const diagnostics:{caseId:string;code:string;observationId?:string;candidateKey?:string;field?:string}[]=[];
 const matched=new Map<string,{candidate:ExtractionCandidate;canonicalId:string;strict:boolean}>(),candidateCanonical=new Map<string,string>();
 const canonicalCandidates=new Map<string,Array<{key:string;candidate:ExtractionCandidate;strict:boolean}>>();
 let ambiguousMatches=0,extraEntities=0,extraEventActionEntities=0,failedProcessing=0,processingExpectationMismatches=0,processingErrors=0,negativeCases=0,negativeCorrectlyProcessed=0,negativeFalsePositiveUnits=0,expectedBlockedProcessing=0,negativeNotEvaluatedDueExpectedBlocking=0;
 for(const item of labels.cases){
  const row=predictions.predictionExtractionResults.find(row=>row.candidateId===candidateId&&row.caseId===item.caseId),source=predictions.sourceInventory.find(source=>source.caseId===item.caseId);
  if(!row||!source)throw Error('Acceptance scorer received an incomplete prediction/source roster');
  const result=row.result;let processingComplete=false;
  if(row.status==='failed'||!result){if(item.processingExpectation==='blocked')expectedBlockedProcessing++;else failedProcessing++;diagnostics.push({caseId:item.caseId,code:'explicit_processing_failure'});}
  else {const processing=inspectProcessing(source,result);processingComplete=processing.complete;processingErrors+=processing.errors.length;diagnostics.push(...processing.errors.map(code=>({caseId:item.caseId,code})));}
  const actualExpectation=row.status==='failed'?'blocked':processingComplete?'complete':result?.units.every(unit=>unit.status==='blocked')?'blocked':'partial';
  if(actualExpectation==='blocked'&&item.processingExpectation==='blocked'&&row.status==='completed')expectedBlockedProcessing++;
  if(actualExpectation!==item.processingExpectation){processingExpectationMismatches++;diagnostics.push({caseId:item.caseId,code:'processing_expectation_mismatch'});}
  const candidates=(result?.candidates??[]).map(projectAcceptanceCandidate);
  const assignment=matchAcceptanceObservations({caseId:item.caseId,observations:item.observations,candidates,units:result?.units??[]});
  ambiguousMatches+=assignment.ambiguous.length;diagnostics.push(...assignment.ambiguous.map(()=>({caseId:item.caseId,code:'ambiguous_identity_no_forced_match'})));
  if(item.negativeDecision==='no_event_or_action'){if(item.processingExpectation==='blocked')negativeNotEvaluatedDueExpectedBlocking++;else negativeCases++;const count=candidates.filter(row=>row.kind!=='resource').length;negativeFalsePositiveUnits+=count;if(item.processingExpectation!=='blocked'&&processingComplete&&count===0)negativeCorrectlyProcessed++;if(count)diagnostics.push({caseId:item.caseId,code:'event_or_action_on_human_negative'});}
  for(const observation of item.observations){
   const count=sourceObservation[observation.kind];count.expected++;
   const match=assignment.matches.find(match=>match.observationId===observation.id),candidate=match?candidates.find(candidate=>candidate.key===match.candidateKey)!:null;
   if(candidate)count.detected++;
   let evidenceValid=true;
   if(candidate)for(const[field,value]of Object.entries(candidate.fields))if(value!==null&&observation.fields[field]?.state==='known'){
    const label=observation.fields[field],claims=candidate.claims.filter(claim=>claim.field===field);
    const supported=claims.some(claim=>claim.evidence.some(span=>label.evidence.some(proof=>{
     if(proof.type==='text')return proof.unitId===span.unitId&&result?.units.find(unit=>extractionUnitId(unit)===span.unitId)?.sha256===proof.sourceSha256&&span.start<proof.end&&span.end>proof.start;
     const view=source.views.find(view=>view.unitId===span.unitId);return view?.assetSha256===proof.assetSha256&&(view.page??null)===proof.page;
    })));
    if(!supported){evidenceValid=false;processingErrors++;diagnostics.push({caseId:item.caseId,code:'claim_does_not_anchor_human_field_evidence',observationId:observation.id,candidateKey:candidate.key,field});}
   }
   const sourceUnitsComplete=observation.sourceUnitIds.every(id=>result?.units.some(unit=>extractionUnitId(unit)===id&&unit.status==='processed'));
   const strict=compareFields(observation.fields,candidate?.fields??null,fields)&&sourceUnitsComplete&&evidenceValid;
   if(strict)count.strictCorrect++;
   if(!candidate){diagnostics.push({caseId:item.caseId,code:'missed_source_observation',observationId:observation.id});continue;}
   const key=refKey({caseId:item.caseId,candidateKey:candidate.key});matched.set(key,{candidate,canonicalId:observation.canonicalUnitId,strict});candidateCanonical.set(key,observation.canonicalUnitId);
   const group=canonicalCandidates.get(observation.canonicalUnitId)??[];group.push({key,candidate,strict});canonicalCandidates.set(observation.canonicalUnitId,group);
  }
  for(const key of assignment.unmatchedCandidateKeys){const candidate=candidates.find(candidate=>candidate.key===key)!;extraEntities++;if(candidate.kind!=='resource')extraEventActionEntities++;
   fields.unscoredNonNull+=Object.values(candidate.fields).filter(value=>value!==null).length;diagnostics.push({caseId:item.caseId,code:'unmatched_or_ambiguous_extra_entity',candidateKey:key});
  }
 }
 for(const unit of labels.canonicalUnits){
  const count=canonical[unit.kind];count.expected++;const rows=canonicalCandidates.get(unit.id)??[];if(rows.length)count.detected++;
  // No blending of partial candidates into an imagined complete canonical occurrence.
  const evaluations=rows.map(row=>{const score=fieldCounts(),projected=projectCanonicalComparison(row.candidate),applicable=Object.fromEntries(Object.entries(projected).filter(([field])=>Object.hasOwn(unit.fields,field))),correct=compareFields(unit.fields,applicable,score)&&row.strict;return{score,correct};});
  if(evaluations.some(row=>row.correct))count.strictCorrect++;
  // Canonical field metrics report every source representation, not a cherry-picked best one.
  if(!evaluations.length)compareFields(unit.fields,null,canonicalFields);else for(const row of evaluations)for(const key of Object.keys(canonicalFields)as Array<keyof FieldCounts>)canonicalFields[key]+=row.score[key];
 }
 for(const metric of [...Object.values(sourceObservation),...Object.values(canonical)]){metric.detectionRecall=metric.expected?metric.detected/metric.expected:null;metric.correctUnitRecall=metric.expected?metric.strictCorrect/metric.expected:null;}
 const reconciliation=scoreReconciliation(labels,predictions.reconciliation.find(row=>row.candidateId===candidateId)?.relations??[],candidateCanonical);
 const meets=(group:ReturnType<typeof byKind>,kind:Kind)=>group[kind].correctUnitRecall!==null&&group[kind].correctUnitRecall!>=0.95;
 const gates={humanHoldoutAtLeast100:labels.cases.length>=100,sourceEventCorrectRecall:meets(sourceObservation,'event'),sourceActionCorrectRecall:meets(sourceObservation,'action'),canonicalEventCorrectRecall:meets(canonical,'event'),canonicalActionCorrectRecall:meets(canonical,'action'),noWrongCriticalFacts:fields.wrongCritical===0,noUnsupportedCriticalFacts:fields.unsupportedCritical===0,allPredictionFactsLabeled:fields.unscoredNonNull===0,noExtraEntities:extraEntities===0,noAmbiguousMatches:ambiguousMatches===0,processingAndEvidenceValid:failedProcessing===0&&processingErrors===0&&processingExpectationMismatches===0,reviewedNegativeStratumPresent:negativeCases>0,noNegativeEventActions:negativeFalsePositiveUnits===0,negativeCasesFullyProcessed:negativeCorrectlyProcessed===negativeCases,reviewedReconciliationStrataPresent:reconciliation.coverage.duplicateCanonicalGroups>0&&reconciliation.coverage.distinctPerformanceRelations>0&&reconciliation.coverage.nonduplicateRelations>0,reconciliationFullyReviewed:reconciliation.wrongMerges===0&&reconciliation.wrongRelations===0&&reconciliation.retainedDuplicatePairs===0&&reconciliation.unresolvedPairs===0&&reconciliation.unlabeledPairs===0&&reconciliation.missingReviewedPairs===0};
 return{version:'stage2-acceptance-score-v1' as const,candidateId,sourceObservation,canonical,fields,fieldPrecision:fields.labeledNonNull?fields.correct/fields.labeledNonNull:null,fieldPrecisionScope:'human-labeled matched source facts; unscored facts never count correct',allEmittedNonNullFieldCorrectnessLowerBound:fields.labeledNonNull+fields.unscoredNonNull?fields.correct/(fields.labeledNonNull+fields.unscoredNonNull):null,predictionFieldLabelCoverage:fields.labeledNonNull+fields.unscoredNonNull?fields.labeledNonNull/(fields.labeledNonNull+fields.unscoredNonNull):null,canonicalFields,canonicalFieldsAreComparisonDiagnosticsNotAdditionalRuntimeClaims:true,ambiguousMatches,extraEntities,extraEventActionEntities,processing:{failedProcessing,expectedBlockedProcessing,processingErrors,processingExpectationMismatches},negatives:{cases:negativeCases,correctlyProcessed:negativeCorrectlyProcessed,notEvaluatedDueExpectedBlocking:negativeNotEvaluatedDueExpectedBlocking,falsePositiveUnits:negativeFalsePositiveUnits},reconciliation,diagnostics,gates,extractionHoldoutGatesPassed:Object.values(gates).every(Boolean),stage2Accepted:false as const};
}
function scoreReconciliation(labels:HumanLabels,proposals:RelationProposal[],candidateCanonical:Map<string,string>){
 let wrongMerges=0,wrongRelations=0,retainedDuplicatePairs=0,unresolvedPairs=0,unlabeledPairs=0,correctReviewedPairs=0,missingReviewedPairs=0,correctUncertaintyAbstentions=0,correctNonMergeAbstentions=0;
 const seen=new Set<string>(),proposed=new Map<string,RelationProposal['relation']>();
 for(const proposal of proposals){const left=refKey(proposal.left),right=refKey(proposal.right),a=candidateCanonical.get(left),b=candidateCanonical.get(right);proposed.set(pairKey(left,right),proposal.relation);
  if(!a||!b){unlabeledPairs++;continue;}
  const truth=a===b?'same_occurrence':labels.relations.find(row=>pairKey(row.left,row.right)===pairKey(a,b))?.relation;
  if(a!==b&&proposal.relation==='same_occurrence')wrongMerges++;
  if(!truth){unlabeledPairs++;continue;}seen.add(pairKey(a,b));
  if(truth==='unresolved'){if(proposal.relation==='unresolved')correctUncertaintyAbstentions++;else wrongRelations++;continue;}if(proposal.relation==='unresolved'){unresolvedPairs++;continue;}
  if(proposal.relation===truth)correctReviewedPairs++;else wrongRelations++;
 }
 const mapped=[...candidateCanonical];for(let i=0;i<mapped.length;i++)for(let j=i+1;j<mapped.length;j++)if(mapped[i][1]===mapped[j][1]&&proposed.get(pairKey(mapped[i][0],mapped[j][0]))!=='same_occurrence')retainedDuplicatePairs++;
 for(const relation of labels.relations){
  if(seen.has(pairKey(relation.left,relation.right)))continue;
  const represented=new Set(candidateCanonical.values());if(!represented.has(relation.left)||!represented.has(relation.right)){missingReviewedPairs++;continue;}
  // Human truth supplies this pair. Absence of a positive merge suggestion is
  // evaluated as a non-merge outcome, never emitted as discovered ground truth.
  if(relation.relation==='unresolved')correctUncertaintyAbstentions++;else correctNonMergeAbstentions++;
 }
 const coverage={duplicateCanonicalGroups:labels.canonicalUnits.filter(unit=>unit.observationRefs.length>1).length,distinctPerformanceRelations:labels.relations.filter(row=>row.relation==='same_program_distinct_occurrence').length,nonduplicateRelations:labels.relations.filter(row=>row.relation==='different').length,unresolvedHumanRelations:labels.relations.filter(row=>row.relation==='unresolved').length};
 return{wrongMerges,wrongRelations,retainedDuplicatePairs,unresolvedPairs,unlabeledPairs,correctReviewedPairs,missingReviewedPairs,correctUncertaintyAbstentions,correctNonMergeAbstentions,coverage};
}
