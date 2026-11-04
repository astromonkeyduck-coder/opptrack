/** Explicit offline freeze/check/annotation validation. Never extracts, generates, scores or sends. */
import { readFileSync,realpathSync,writeFileSync,mkdirSync,statSync } from 'node:fs';
import path from 'node:path';
import { assertPreGoldAccess,bindConfirmedRepresentationRules,digest,environmentSchema,makeFreeze,safeArtifactPath,stableJson,validateHumanLabels,validatePredictionSeal,verifyFreeze,type CandidateFreeze,type RequiredFields,type SourceView } from '../evaluation/stage2-acceptance-guards';
import { assertAcceptanceEnvironment } from '../evaluation/stage2-acceptance-environment';
import { assertFinalAcceptanceBinding,assertFinalAcceptanceProtocol } from '../evaluation/stage2-acceptance-runner';
import { loadAcceptanceSources } from '../evaluation/stage2-acceptance-predictions';
import { filesystemSealedSourceReader } from '../evaluation/stage2-acceptance-files';
const root=realpathSync(process.cwd());
function existing(file:string){const resolved=realpathSync(path.resolve(root,file));if(!resolved.startsWith(root+path.sep))throw new Error('Input escaped workspace');if(resolved.split(path.sep).some(part=>part==='.env'||part.startsWith('.env.')))throw new Error('Credential files are not freeze inputs');if(statSync(resolved).size>64*1024*1024)throw new Error('Acceptance input byte limit');return resolved;}
const bytes=(file:string)=>readFileSync(existing(file));
const json=(file:string)=>JSON.parse(bytes(file).toString('utf8'));
const codeBytes=(file:string)=>{const resolved=existing(safeArtifactPath(file));safeArtifactPath(path.relative(root,resolved));return readFileSync(resolved);};
function checkCustody(freeze:CandidateFreeze){
 if(digest(filesystemSealedSourceReader(root,freeze)(freeze.sourceCustodyPath))!==freeze.sourceCustodySha256)throw new Error('Source custody changed');
 if(digest(stableJson([...freeze.caseIds].sort()))!==freeze.caseRosterSha256)throw new Error('Roster changed');
}
function checkedFreeze(file:string){const freeze=verifyFreeze(json(file),codeBytes);checkCustody(freeze);return freeze;}
const [command,...args]=process.argv.slice(2);
try{
 if(command==='freeze'&&args.length===2){
  const rawTemplate=json(args[0]);if(rawTemplate.templateOnly!==false||rawTemplate.finalScorerMatcherBindingReady!==true)throw new Error('Template is not a freeze: final acceptance scorer/matcher binding and environment verification must be completed first');
  const {templateOnly,finalScorerMatcherBindingReady,confirmedRepresentationRuleRecordSha256,disqualifiedDevelopmentPrompts,...templateBody}=rawTemplate;
  const template=templateBody as Omit<CandidateFreeze,'freezeSha256'|'createdAt'|'protocolSha256'|'sourceCustodySha256'|'caseRosterSha256'|'environmentSha256'|'representationRuleRecordSha256'>;
  const environment=environmentSchema.parse(template.environment);
  const artifacts=template.artifacts.map(item=>({...item,sha256:digest(codeBytes(item.path))}));
  for(const file of ['evaluation/stage2-acceptance-guards.ts','evaluation/stage2-acceptance-files.ts','scripts/stage2-acceptance-tool.ts','evaluation/stage2-acceptance-predictions.ts','evaluation/stage2-acceptance-runner.ts','scripts/stage2-score-acceptance.ts','evaluation/stage2-acceptance-environment.ts'])if(!artifacts.some(item=>item.group==='runner'&&item.path===file))artifacts.push({group:'runner',path:file,sha256:digest(codeBytes(file))});
  const protocol=artifacts.find(item=>item.group==='protocol');if(!protocol)throw new Error('Protocol artifact required');
  const protocolValue=json(protocol.path);assertFinalAcceptanceProtocol(protocolValue);const rulePath='reports/stage-2-owner-contract-adjudication.json';const ruleHash=digest(bytes(rulePath));if(confirmedRepresentationRuleRecordSha256!==ruleHash)throw new Error('Template rule-approval hash differs from confirmed record');if(protocolValue.representationRuleConfirmation?.recordSha256!==ruleHash)throw new Error('Protocol does not bind the confirmed rule record');
  if(!artifacts.some(item=>item.group==='adjudication'&&item.path===rulePath))artifacts.push({group:'adjudication',path:rulePath,sha256:ruleHash});
  const freeze=makeFreeze({...template,artifacts,environment,environmentSha256:digest(stableJson(environment)),protocolSha256:protocol.sha256,representationRuleRecordSha256:ruleHash,sourceCustodySha256:digest(filesystemSealedSourceReader(root,template)(template.sourceCustodyPath)),caseRosterSha256:digest(stableJson([...template.caseIds].sort())),createdAt:new Date().toISOString()});
  assertFinalAcceptanceBinding(freeze);assertAcceptanceEnvironment(freeze);
  const target=path.resolve(root,args[1]);if(!target.startsWith(root+path.sep)||!args[1].startsWith('evaluation/')||!realpathSync(path.dirname(target)).startsWith(root+path.sep)||args[1].split('/').some(part=>part==='.env'||part.startsWith('.env.')))throw new Error('Freeze output must be a new evaluation artifact');
  writeFileSync(target,JSON.stringify(freeze,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({freezeSha256:freeze.freezeSha256,caseCount:freeze.caseIds.length,candidateCount:freeze.candidates.length,humanAdjudicationStillRequired:true,goldRead:false}));
 }else if(command==='bind-confirmed-rules'&&args.length===2){
  const f=checkedFreeze(args[0]),recordPath='reports/stage-2-owner-contract-adjudication.json',record=json(recordPath);
  const binding=bindConfirmedRepresentationRules(f,bytes(recordPath),bytes(record.reviewSheet));
  const target=path.resolve(root,args[1]);if(!args[1].startsWith('private/stage2-acceptance-human-review/')||!target.startsWith(root+path.sep))throw new Error('Rule binding belongs in the private human-review directory');
  mkdirSync(path.dirname(target),{recursive:true,mode:0o700});if(!realpathSync(path.dirname(target)).startsWith(root+path.sep))throw new Error('Rule binding escaped workspace');
  writeFileSync(target,JSON.stringify(binding,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({representationRulesBound:6,repeatConfirmationNeeded:false,futureHoldoutFamilyReviewApproved:false,factualLabelsApproved:false,goldRead:false}));
 }else if(command==='check-freeze'&&args.length===1){const f=checkedFreeze(args[0]);console.log(JSON.stringify({freezeVerified:true,caseCount:f.caseIds.length,goldRead:false}));}
 else if(command==='check-pre-gold'&&args.length===4){const f=checkedFreeze(args[0]);assertPreGoldAccess(f,json(args[1]),json(args[2]));const predictions=bytes(args[3]);validatePredictionSeal(predictions,f);console.log(JSON.stringify({preGoldGuardsPassed:true,predictionsSha256:digest(predictions),goldRead:false,cohortClaimAndOneScoringRunStillRequired:true}));}
 else if(command==='validate-human-review'&&args.length===5){
  const f=checkedFreeze(args[0]);assertPreGoldAccess(f,json(args[1]),json(args[2]));
  const protocol=json(f.artifacts.find(item=>item.group==='protocol')!.path);
  const required:RequiredFields={event:protocol.annotation.requiredEventFields,action:protocol.annotation.requiredActionFields,resource:protocol.annotation.requiredResourceFields};
  // Run only in the independent annotator/curator process after freeze; no answers are printed.
  const verifiedViews=loadAcceptanceSources(f,filesystemSealedSourceReader(root,f)).flatMap(source=>source.description.views);if(stableJson(json(args[4]))!==stableJson(verifiedViews))throw new Error('Curator source views differ from verified original custody and frozen transform');
  const labels=validateHumanLabels(json(args[3]),{freezeSha256:f.freezeSha256,sourceCustodySha256:f.sourceCustodySha256,caseRosterSha256:f.caseRosterSha256,caseIds:f.caseIds,freezeCreatedAt:f.createdAt,required,sourceViews:verifiedViews as SourceView[]});
  console.log(JSON.stringify({structurallyValidatedHumanCases:labels.cases.length,semanticTruthAutomaticallyEstablished:false,sourceQuotesOrAnswersDisclosed:false,holdoutScored:false}));
 }else throw new Error('Use freeze TEMPLATE OUTPUT; check-freeze FREEZE; bind-confirmed-rules FREEZE PRIVATE-OUTPUT; check-pre-gold FREEZE OWNER EXPOSURE PREDICTIONS; or validate-human-review FREEZE OWNER EXPOSURE ANNOTATIONS SOURCE_VIEWS. No inference/scoring command is implicit.');
}catch(error){console.error(JSON.stringify({status:'blocked',message:error instanceof Error&&(error.name==='ZodError'||error.name==='SyntaxError')?'Invalid acceptance metadata/annotation schema; no source answers printed.':error instanceof Error?error.message:'Acceptance check failed',stage2Accepted:false}));process.exitCode=2;}
