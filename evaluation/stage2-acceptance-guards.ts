/** New acceptance contracts only. No old labels/scorers, source content or gold I/O. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isAcceptanceCriticalField } from './stage2-acceptance-critical-fields';

export const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stableJson(item)).join(',') + '}';
  const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Non-JSON freeze value');return encoded;
}
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(160),utc=z.string().datetime({offset:true});
const primitive=z.union([z.string().max(6000),z.number().finite(),z.boolean(),z.null()]);
const evidence=z.discriminatedUnion('type',[
  z.object({type:z.literal('text'),unitId:id,sourceSha256:hash,start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(1).max(6000)}).strict(),
  z.object({type:z.literal('visual'),assetSha256:hash,page:z.number().int().positive().nullable(),region:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().positive().max(1),z.number().positive().max(1)]),humanTranscription:z.string().min(1).max(6000)}).strict(),
]);
const field=z.object({state:z.enum(['known','unknown','not_applicable']),value:primitive,critical:z.boolean(),evidence:z.array(evidence).max(20),reason:z.string().max(3000).nullable()}).strict();
const entity=z.object({id,kind:z.enum(['event','action','resource']),fields:z.record(z.string().min(1).max(100),field)}).strict();
const observation=entity.extend({canonicalUnitId:id,sourceUnitIds:z.array(id).min(1)}).strict();
const caseLabel=z.object({caseId:id,entitySetComplete:z.literal(true),allSuppliedAssetsChecked:z.literal(true),allKnownPagesChecked:z.literal(true),processingExpectation:z.enum(['complete','partial','blocked']),negativeDecision:z.enum(['not_negative','no_event_or_action']),observations:z.array(observation),reviewer:id,reviewedAt:utc}).strict();
const canonical=entity.extend({observationRefs:z.array(z.object({caseId:id,observationId:id}).strict()).min(1)}).strict();
export const humanLabelsSchema=z.object({schemaVersion:z.literal(1),protocolId:z.literal('stage2-acceptance-protocol-v1'),freezeSha256:hash,sourceCustodySha256:hash,caseRosterSha256:hash,origin:z.literal('human_direct_source_annotation'),aiGoldProposalsUsed:z.literal(false),candidatePredictionsViewed:z.literal(false),cases:z.array(caseLabel).min(1),canonicalUnits:z.array(canonical),relations:z.array(z.object({left:id,right:id,relation:z.enum(['same_occurrence','same_program_distinct_occurrence','different','unresolved']),evidence:z.array(evidence).min(1),reviewer:id,reviewedAt:utc}).strict())}).strict();
export type HumanLabels=z.infer<typeof humanLabelsSchema>;
export type SourceView={caseId:string;unitId:string;sha256:string;text?:string;assetSha256?:string;page?:number|null};
export type RequiredFields={event:string[];action:string[];resource:string[]};
export function validateHumanLabels(value:unknown,expected:{freezeSha256:string;sourceCustodySha256:string;caseRosterSha256:string;caseIds:string[];freezeCreatedAt:string;required:RequiredFields;sourceViews:SourceView[]}) {
  const labels=humanLabelsSchema.parse(value);
  for(const key of ['freezeSha256','sourceCustodySha256','caseRosterSha256'] as const)if(labels[key]!==expected[key])throw new Error('Human annotation identity mismatch');
  const keys=labels.cases.map(item=>item.caseId);if(new Set(keys).size!==keys.length||stableJson([...keys].sort())!==stableJson([...expected.caseIds].sort()))throw new Error('Human roster is incomplete or duplicated');
  const canon=new Map(labels.canonicalUnits.map(unit=>[unit.id,unit]));if(canon.size!==labels.canonicalUnits.length)throw new Error('Duplicate canonical unit');
  const seen=new Map<string,string>();
  const checkEvidence=(proof:z.infer<typeof evidence>,caseIds:string[])=>{
    if(proof.type==='text'){
      const source=expected.sourceViews.find(view=>caseIds.includes(view.caseId)&&view.unitId===proof.unitId&&view.sha256===proof.sourceSha256);
      if(!source?.text||proof.end<=proof.start||source.text.slice(proof.start,proof.end)!==proof.quote)throw new Error('Human quote differs from frozen source text');
    }else{
      if(proof.region[0]+proof.region[2]>1||proof.region[1]+proof.region[3]>1||!expected.sourceViews.some(view=>caseIds.includes(view.caseId)&&view.assetSha256===proof.assetSha256&&(view.page??null)===proof.page))throw new Error('Human visual evidence differs from source asset/page');
    }
  };
  const checkEntity=(unit:z.infer<typeof entity>,caseIds:string[])=>{
    for(const key of expected.required[unit.kind]){if(!Object.hasOwn(unit.fields,key))throw new Error('Missing explicit field/unknown annotation');if(unit.fields[key].critical!==true)throw new Error('Required critical field cannot be downgraded');}
    for(const[key,label]of Object.entries(unit.fields)){
      if(isAcceptanceCriticalField(key)&&label.critical!==true)throw new Error('Semantic critical field cannot be downgraded');
      if(label.state==='known'&&(label.value===null||!label.evidence.length))throw new Error('Known fact lacks value or evidence');
      if(label.state!=='known'&&(label.value!==null||!label.reason?.trim()))throw new Error('Unknown/not-applicable needs explicit null and reason');
      for(const proof of label.evidence)checkEvidence(proof,caseIds);
    }
  };
  for(const item of labels.cases){
    if(Date.parse(item.reviewedAt)<Date.parse(expected.freezeCreatedAt))throw new Error('Human factual labels predate candidate freeze');
    const local=new Set<string>();
    if(item.negativeDecision==='no_event_or_action'&&item.observations.some(unit=>unit.kind!=='resource'))throw new Error('Negative decision conflicts with listed event/action');
    for(const unit of item.observations){
      if(local.has(unit.id))throw new Error('Duplicate source observation');local.add(unit.id);
      if(!unit.sourceUnitIds.every(sourceId=>expected.sourceViews.some(view=>view.caseId===item.caseId&&view.unitId===sourceId)))throw new Error('Observation names unknown source unit');
      const target=canon.get(unit.canonicalUnitId);if(!target||target.kind!==unit.kind)throw new Error('Observation has missing or wrong-kind canonical association');
      const key=item.caseId+'\u0000'+unit.id;seen.set(key,unit.canonicalUnitId);
      if(!target.observationRefs.some(ref=>ref.caseId===item.caseId&&ref.observationId===unit.id))throw new Error('Canonical association is not reciprocal');
      checkEntity(unit,[item.caseId]);
    }
  }
  const associations=new Set<string>();
  for(const unit of labels.canonicalUnits){
    for(const ref of unit.observationRefs){const key=ref.caseId+'\u0000'+ref.observationId;if(seen.get(key)!==unit.id||associations.has(key))throw new Error('Canonical association duplicates or invents an observation');associations.add(key);}
    checkEntity(unit,unit.observationRefs.map(ref=>ref.caseId));
  }
  const relationPairs=new Set<string>();
  for(const relation of labels.relations){
    const pair=[relation.left,relation.right].sort().join('\u0000');if(relationPairs.has(pair))throw new Error('Duplicate or contradictory unordered human relation pair');relationPairs.add(pair);if(relation.relation==='same_occurrence')throw new Error('Same occurrence aliases must share one human canonical ID');
    const left=canon.get(relation.left),right=canon.get(relation.right);if(!left||!right||left.id===right.id)throw new Error('Relation names unknown/same canonical units');
    if(Date.parse(relation.reviewedAt)<Date.parse(expected.freezeCreatedAt))throw new Error('Human relation labels predate freeze');
    for(const proof of relation.evidence)checkEvidence(proof,[...left.observationRefs,...right.observationRefs].map(ref=>ref.caseId));
  }
  if(associations.size!==seen.size)throw new Error('Unassociated source observation');
  return labels;
}
const nativeTools=z.object({tesseract:z.string(),pdfinfo:z.string(),pdftotext:z.string(),pdftoppm:z.string(),sharp:z.string()}).strict();
export const environmentSchema=z.object({runtime:z.string(),nodeVersion:z.string(),timeZone:z.literal('UTC'),locale:z.string(),nativeTools,maximumVisualPages:z.number().int().positive(),maximumFileBytes:z.number().int().positive(),modelInferenceEnabled:z.literal(false),calendarWritesEnabled:z.literal(false),emailDeliveryEnabled:z.literal(false),modelApiCalls:z.literal(0)}).strict();
const artifact=z.object({group:z.enum(['runtime','media','source_transform','matcher','scorer','protocol','prompts','environment','runner','adjudication']),path:id,sha256:hash}).strict();
export const freezeSchema=z.object({schemaVersion:z.literal(1),protocolId:z.literal('stage2-acceptance-protocol-v1'),protocolSha256:hash,representationRuleRecordSha256:hash,sourceCustodySha256:hash,sourceCustodyPath:z.string().regex(/^private\/stage2-sealed-holdout\/[a-f0-9]{16}\/integrity-manifest\.json$/),caseRosterSha256:hash,caseIds:z.array(id).min(100),artifacts:z.array(artifact).min(1),environment:environmentSchema,environmentSha256:hash,candidates:z.array(z.object({id,modelInference:z.literal(false),promptIds:z.array(id).max(0)}).strict()).min(1),createdAt:utc,freezeSha256:hash}).strict();
export type CandidateFreeze=z.infer<typeof freezeSchema>;
export function safeArtifactPath(file:string) {
  if(file.startsWith('/')||file.includes('\\')||file.split('/').some(part=>part==='..'||part==='.env'||part.startsWith('.env.'))||! /^(?:lib\/|evaluation\/|scripts\/|package(?:-lock)?\.json$|trigger\.config\.ts$|reports\/stage-2-owner-contract-adjudication\.json$)/.test(file))throw new Error('Unsafe or secret-bearing freeze artifact path');
  return file;
}
export function makeFreeze(value:Omit<CandidateFreeze,'freezeSha256'>):CandidateFreeze {
  environmentSchema.parse(value.environment);
  if(new Set(value.caseIds).size!==value.caseIds.length)throw new Error('Duplicate freeze case ID');
  for(const group of ['runtime','media','source_transform','matcher','scorer','protocol','runner','adjudication'])if(!value.artifacts.some(item=>item.group===group))throw new Error('Missing mandatory frozen artifact group');
  const paths=new Set<string>();for(const item of value.artifacts){safeArtifactPath(item.path);const identity=item.group+':'+item.path;if(paths.has(identity))throw new Error('Duplicate freeze artifact role');paths.add(identity);}
  if(value.environmentSha256!==digest(stableJson(value.environment)))throw new Error('Environment fingerprint differs');
  const protocol=value.artifacts.find(item=>item.group==='protocol');if(protocol?.sha256!==value.protocolSha256)throw new Error('Protocol fingerprint differs');
  if(!value.artifacts.some(item=>item.group==='adjudication'&&item.sha256===value.representationRuleRecordSha256))throw new Error('Representation-rule confirmation fingerprint differs');
  return freezeSchema.parse({...value,freezeSha256:digest(stableJson(value))});
}
export function verifyFreeze(value:unknown,readCode:(path:string)=>Uint8Array):CandidateFreeze {
  const freeze=freezeSchema.parse(value),{freezeSha256,...body}=freeze;
  if(makeFreeze(body).freezeSha256!==freezeSha256)throw new Error('Freeze manifest changed');
  for(const item of freeze.artifacts)if(digest(readCode(safeArtifactPath(item.path)))!==item.sha256)throw new Error('Frozen implementation changed');
  return freeze;
}
const confirmation=z.object({reviewer:id,kind:z.literal('human'),reviewedAt:utc,confirmationReference:id}).strict();
export const ownerAdjudicationSchema=z.object({freezeSha256:hash,protocolSha256:hash,representationRuleRecordSha256:hash,approvalScope:z.literal('six_representation_rules_only'),ruleConfirmation:z.object({reviewer:id,kind:z.literal('human'),confirmationRecordedAt:utc,exactHumanReviewTimeKnown:z.boolean(),confirmationReference:id}).strict(),decisions:z.object({S1_status:id,S2_units:id,S3_dates:id,S4_ranges_partials:id,S5_family_exposure:id,S6_corpus_scope:id}).strict(),workingHumanHoldoutTarget:z.literal(100),contractsApproved:z.literal(true),labelsOrGatesSilentlyChanged:z.literal(false)}).strict();
/** Reuses an actual confirmed representation-rule record; grants no future exposure/gold approval. */
export function bindConfirmedRepresentationRules(freeze:CandidateFreeze,recordBytes:Uint8Array,sheetBytes:Uint8Array){
 if(digest(recordBytes)!==freeze.representationRuleRecordSha256)throw new Error('Owner rule-confirmation record changed');
 const record=z.object({version:z.literal('stage2-owner-source-contract-adjudication-v1'),confirmationRecordedAt:utc,exactHumanReviewTimeKnown:z.boolean(),reviewer:id,method:z.literal('explicit_chat_confirmation'),response:z.literal('Confirm the source-backed rules'),reviewSheet:id,reviewSheetSha256:hash,confirmedRuleCount:z.literal(6),scope:z.array(z.string().min(1)).length(6),notApproved:z.array(z.string()).min(1),stage2Accepted:z.literal(false)}).passthrough().parse(JSON.parse(new TextDecoder().decode(recordBytes)));
 if(digest(sheetBytes)!==record.reviewSheetSha256)throw new Error('Confirmed six-rule sheet changed');
 const ids=['S1_status','S2_units','S3_dates','S4_ranges_partials','S5_family_exposure','S6_corpus_scope'];
 return ownerAdjudicationSchema.parse({freezeSha256:freeze.freezeSha256,protocolSha256:freeze.protocolSha256,representationRuleRecordSha256:freeze.representationRuleRecordSha256,approvalScope:'six_representation_rules_only',ruleConfirmation:{reviewer:record.reviewer,kind:'human',confirmationRecordedAt:record.confirmationRecordedAt,exactHumanReviewTimeKnown:record.exactHumanReviewTimeKnown,confirmationReference:'reports/stage-2-owner-contract-adjudication.json'},decisions:Object.fromEntries(ids.map((key,index)=>[key,record.scope[index]])),workingHumanHoldoutTarget:100,contractsApproved:true,labelsOrGatesSilentlyChanged:false});
}
export const exposureSchema=z.object({freezeSha256:hash,sourceCustodySha256:hash,caseRosterSha256:hash,confirmation,allDevelopmentFamiliesChecked:z.literal(true),wholeOrganizerOpportunityMediaFamiliesSeparate:z.literal(true),allPriorExposureResolved:z.literal(true),candidateTuningOnHoldoutCases:z.literal(false),holdoutAnswersExposedBeforeFreeze:z.literal(false),caseIds:z.array(id).min(100),assignment:z.literal('independent_human_holdout')}).strict();
export const predictionSealSchema=z.object({schemaVersion:z.literal(1),freezeSha256:hash,sourceCustodySha256:hash,caseRosterSha256:hash,candidateIds:z.array(id).min(1),sourceOnly:z.literal(true),goldAccessBeforeSeal:z.literal(false),predictions:z.unknown()}).strict();
export function validatePredictionSeal(bytes:Uint8Array,freeze:CandidateFreeze){
 const seal=predictionSealSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
 if(seal.freezeSha256!==freeze.freezeSha256||seal.sourceCustodySha256!==freeze.sourceCustodySha256||seal.caseRosterSha256!==freeze.caseRosterSha256||stableJson([...seal.candidateIds].sort())!==stableJson(freeze.candidates.map(c=>c.id).sort())||new Set(seal.candidateIds).size!==seal.candidateIds.length)throw new Error('Prediction seal does not match frozen cohort/candidates');
 return seal;
}
export function assertPreGoldAccess(freeze:CandidateFreeze,owner:unknown,exposure:unknown) {
  const approval=ownerAdjudicationSchema.parse(owner),review=exposureSchema.parse(exposure);
  if(Date.parse(review.confirmation.reviewedAt)<Date.parse(freeze.createdAt))throw new Error('Family/exposure review predates freeze');
  if(approval.freezeSha256!==freeze.freezeSha256||approval.protocolSha256!==freeze.protocolSha256||approval.representationRuleRecordSha256!==freeze.representationRuleRecordSha256||review.freezeSha256!==freeze.freezeSha256||review.sourceCustodySha256!==freeze.sourceCustodySha256||review.caseRosterSha256!==freeze.caseRosterSha256||stableJson([...review.caseIds].sort())!==stableJson([...freeze.caseIds].sort())||new Set(review.caseIds).size!==review.caseIds.length)throw new Error('Human approval/exposure identity differs from freeze');
}
export type BlindedIo={verifySourceCustody:()=>{sourceCustodySha256:string;caseRosterSha256:string};readCode:(path:string)=>Uint8Array;readPredictions:()=>Uint8Array;claimOnce:(sourceCustodySha256:string,receipt:unknown)=>void;readGold:()=>Uint8Array;finishReceipt:(receipt:unknown)=>void};
/** No gold reader is invoked before immutable code checks, human gates, prediction seal and exclusive cohort claim. */
export async function withBlindedGold<T>(input:{freeze:unknown;owner:unknown;exposure:unknown;expectedPredictionsSha256:string;io:BlindedIo;score:(gold:Uint8Array,predictions:Uint8Array)=>Promise<T>|T}) {
  const freeze=verifyFreeze(input.freeze,input.io.readCode);assertPreGoldAccess(freeze,input.owner,input.exposure);
  const custody=input.io.verifySourceCustody();if(custody.sourceCustodySha256!==freeze.sourceCustodySha256||custody.caseRosterSha256!==freeze.caseRosterSha256)throw new Error('Frozen source custody/roster changed');
  const predictions=input.io.readPredictions();if(digest(predictions)!==input.expectedPredictionsSha256)throw new Error('Predictions changed before gold access');validatePredictionSeal(predictions,freeze);
  const receipt={sourceCustodySha256:freeze.sourceCustodySha256,freezeSha256:freeze.freezeSha256,predictionsSha256:input.expectedPredictionsSha256,state:'claimed_before_gold_read',stage2Accepted:false};
  input.io.claimOnce(freeze.sourceCustodySha256,receipt);
  try{const result=await input.score(input.io.readGold(),predictions);input.io.finishReceipt({...receipt,state:'finished',result});return result;}
  catch(error){input.io.finishReceipt({...receipt,state:'failed_after_claim',error:error instanceof Error&&(error.name==='SyntaxError'||error.name==='ZodError')?'Invalid private acceptance JSON/schema; contents withheld':String(error instanceof Error?error.message:error)});throw error;}
}
