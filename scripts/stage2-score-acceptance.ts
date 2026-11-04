/** Explicit offline predict/one-shot score. Importing this file is not a task or deployment. */
import { readFileSync,realpathSync,mkdirSync,writeFileSync,statSync } from 'node:fs';
import path from 'node:path';
import { digest,verifyFreeze,safeArtifactPath,assertPreGoldAccess,type CandidateFreeze } from '../evaluation/stage2-acceptance-guards';
import { filesystemBlindedIo,filesystemSealedSourceReader } from '../evaluation/stage2-acceptance-files';
import { generateAcceptancePredictionSeal,runFrozenAcceptance } from '../evaluation/stage2-acceptance-runner';
import { loadAcceptanceSources } from '../evaluation/stage2-acceptance-predictions';
import { assertFinalAcceptanceBinding,assertFinalAcceptanceProtocol } from '../evaluation/stage2-acceptance-runner';
import { assertAcceptanceEnvironment } from '../evaluation/stage2-acceptance-environment';
process.env.TZ='UTC';process.env.LANG='C';process.env.LC_ALL='C';
const root=realpathSync(process.cwd());
function bytes(file:string){const real=realpathSync(path.resolve(root,file));if(!real.startsWith(root+path.sep)||file.split('/').some(part=>part==='..'||part.startsWith('.env'))||real.split(path.sep).some(part=>part.startsWith('.env')))throw Error('Acceptance input escaped workspace or references credentials');if(statSync(real).size>64*1024*1024)throw Error('Acceptance input byte limit');return readFileSync(real);}
const json=(file:string)=>JSON.parse(bytes(file).toString('utf8'));
const readCode=(file:string)=>{const resolved=realpathSync(path.resolve(root,safeArtifactPath(file)));safeArtifactPath(path.relative(root,resolved));return bytes(file);};
const[command,...args]=process.argv.slice(2);
try{
 if(command==='source-views'&&args.length===4){
  const[freezePath,ownerPath,exposurePath,output]=args,freeze=verifyFreeze(json(freezePath),readCode);assertFinalAcceptanceBinding(freeze);assertFinalAcceptanceProtocol(JSON.parse(new TextDecoder().decode(readCode('evaluation/stage2-acceptance-protocol-v1.json'))));assertPreGoldAccess(freeze,json(ownerPath),json(exposurePath));assertAcceptanceEnvironment(freeze);
  if(!output.startsWith('private/stage2-acceptance-human-review/')||output.split('/').some(part=>part==='..'||part.startsWith('.env')))throw Error('Source views belong in a new private curator artifact');
  const sources=loadAcceptanceSources(freeze,filesystemSealedSourceReader(root,freeze)),views=sources.flatMap(source=>source.description.views),target=path.resolve(root,output);mkdirSync(path.dirname(target),{recursive:true,mode:0o700});if(!realpathSync(path.dirname(target)).startsWith(root+path.sep))throw Error('Source-view output escaped workspace');writeFileSync(target,JSON.stringify(views,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({sourceCaseCount:sources.length,sourceViewCount:views.length,sourceViewsSha256:digest(JSON.stringify(views,null,2)+'\n'),candidateExtractorCalls:0,goldRead:false,curatorOnly:true,stage2Accepted:false}));
 }else if(command==='predict'&&args.length===4){
  const[freezePath,ownerPath,exposurePath,output]=args,freeze=verifyFreeze(json(freezePath),readCode);
  if(!output.startsWith('private/stage2-acceptance-predictions/')||output.split('/').some(part=>part==='..'||part.startsWith('.env')))throw Error('Prediction output must be a new private acceptance artifact');
  assertAcceptanceEnvironment(freeze);
  const prediction=await generateAcceptancePredictionSeal({freeze,owner:json(ownerPath),exposure:json(exposurePath),readCode,readSource:filesystemSealedSourceReader(root,freeze)});
  const target=path.resolve(root,output);mkdirSync(path.dirname(target),{recursive:true,mode:0o700});if(!realpathSync(path.dirname(target)).startsWith(root+path.sep))throw Error('Prediction output escaped workspace');writeFileSync(target,prediction.bytes,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({predictionSealSha256:prediction.sha256,caseCount:prediction.caseCount,goldRead:false,stage2Accepted:false}));
 }else if(command==='score-once'&&args.length===6){
  const[freezePath,ownerPath,exposurePath,predictionsPath,goldPath,predictionsSha256]=args,freeze=verifyFreeze(json(freezePath),readCode);
  if(!/^[a-f0-9]{64}$/.test(predictionsSha256))throw Error('Exact prediction seal SHA256 required');
  assertAcceptanceEnvironment(freeze);
  const io=filesystemBlindedIo({root,freeze,predictionsPath,goldPath});
  const result=await runFrozenAcceptance({freeze,owner:json(ownerPath),exposure:json(exposurePath),expectedPredictionsSha256:predictionsSha256,io,readSource:filesystemSealedSourceReader(root,freeze)});
  // Receipt contains the complete frozen score. Do not print factual source/gold values.
  console.log(JSON.stringify({freezeSha256:freeze.freezeSha256,predictionsSha256,scoreSha256:digest(JSON.stringify(result)),candidates:result.scores.map(score=>({candidateId:score.candidateId,gates:score.gates,extractionHoldoutGatesPassed:score.extractionHoldoutGatesPassed})),stage2Accepted:false}));
 }else throw Error('Use source-views FREEZE OWNER EXPOSURE NEW_PRIVATE_VIEWS (curator only); predict FREEZE OWNER EXPOSURE NEW_PRIVATE_OUTPUT; or score-once FREEZE OWNER EXPOSURE PREDICTIONS GOLD EXACT_PREDICTION_SHA256. No inference or acceptance is implicit.');
}catch(error){console.error(JSON.stringify({status:'blocked',message:error instanceof Error&&(error.name==='ZodError'||error.name==='SyntaxError')?'Invalid private acceptance metadata; source answers not printed.':error instanceof Error?error.message:'Acceptance operation failed',stage2Accepted:false}));process.exitCode=2;}
