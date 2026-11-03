/** Exact user-approved local model artifacts only. No auth headers, source upload or remote code. */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

export const MODEL_ID='onnx-community/Qwen2.5-0.5B-Instruct';
export const MODEL_REVISION='516c8d04add8a80c5228f32102b57953b8d421a9';
export const MODEL_Q4_SHA256='09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296';
export const LOCAL_MODEL_ROOT=path.resolve('private/stage2-free-model');
export const LOCAL_MODEL_DIRECTORY=path.join(LOCAL_MODEL_ROOT,'model');
const cap=900000000,files=['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','added_tokens.json','onnx/model_q4.onnx'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const acceptedHost=host=>host==='huggingface.co'||host.endsWith('.huggingface.co')||host==='hf.co'||host.endsWith('.hf.co');
let transferred=0;const artifacts=[],startedAt=new Date().toISOString();
async function publicGet(url){
 for(let count=0;count<7;count++){
  const target=new URL(url);if(target.protocol!=='https:'||!acceptedHost(target.hostname)||target.username||target.password)throw new Error('Unexpected public model artifact origin.');
  const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(600000),headers:{'user-agent':'opptrack-bounded-local-development-comparison/1'}});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('Artifact redirect lacks a location.');url=new URL(location,target).href;continue;}
  if(!response.ok)throw new Error(`Public artifact HTTP ${response.status}`);return response;
 }
 throw new Error('Public artifact redirect limit reached.');
}
await mkdir(LOCAL_MODEL_DIRECTORY,{recursive:true,mode:0o700});await chmod(LOCAL_MODEL_ROOT,0o700);await chmod(LOCAL_MODEL_DIRECTORY,0o700);
try{
 for(const file of files){
  const destination=path.join(LOCAL_MODEL_DIRECTORY,file);await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const url=`https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`;
  let existing=null;try{existing=await stat(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){const bytes=await readFile(destination),digest=sha(bytes);if(file==='onnx/model_q4.onnx'&&digest!==MODEL_Q4_SHA256)throw new Error('Existing model hash differs from the approved artifact.');if(artifacts.reduce((sum,item)=>sum+item.bytes,0)+bytes.length>cap)throw new Error('Model assets exceed900MB.');artifacts.push({file,bytes:bytes.length,sha256:digest,reused:true,source:url});continue;}
  const response=await publicGet(url),claimed=Number(response.headers.get('content-length')||0),current=artifacts.reduce((sum,item)=>sum+item.bytes,0);
  if(claimed&&claimed+current>cap)throw new Error('Declared model assets exceed900MB.');
  if(!response.body)throw new Error('Artifact body unavailable.');
  const partial=destination+'.partial',handle=await open(partial,'wx',0o600),digest=createHash('sha256');let bytes=0,lastNotice=0;
  try{for await(const chunk of response.body){bytes+=chunk.length;transferred+=chunk.length;if(current+bytes>cap)throw new Error('Model assets exceed900MB.');digest.update(chunk);await handle.write(chunk);if(bytes-lastNotice>=100000000){console.log(JSON.stringify({stage:'download',file,bytes}));lastNotice=bytes;}}}finally{await handle.close();}
  if(claimed&&claimed!==bytes)throw new Error('Public artifact byte count mismatch.');
  const actual=digest.digest('hex');if(file==='onnx/model_q4.onnx'&&actual!==MODEL_Q4_SHA256)throw new Error('Model hash differs from the approved artifact.');
  await rename(partial,destination);await chmod(destination,0o600);artifacts.push({file,bytes,sha256:actual,reused:false,source:url});console.log(JSON.stringify({stage:'artifact_ready',file,bytes}));
 }
 const report={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),status:'exact_approved_artifacts_ready',modelId:MODEL_ID,revision:MODEL_REVISION,q4ExpectedSha256:MODEL_Q4_SHA256,assets:artifacts,assetBytes:artifacts.reduce((sum,item)=>sum+item.bytes,0),downloadedBytes:transferred,assetByteCap:cap,sourceUploads:0,authorizationHeaders:0,apiCostUsd:0,remoteCodeAllowed:false,productionDependencyInstalled:false};
 await writeFile(path.join(LOCAL_MODEL_ROOT,'artifacts.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({stage:'artifacts_ready',assetBytes:report.assetBytes,files:artifacts.length}));
}catch(error){
 const report={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),status:'artifact_setup_failed',modelId:MODEL_ID,revision:MODEL_REVISION,assetBytes:artifacts.reduce((sum,item)=>sum+item.bytes,0),downloadedBytes:transferred,assets:artifacts,error:String(error?.message||error).slice(0,300),sourceUploads:0,apiCostUsd:0};
 await writeFile(path.join(LOCAL_MODEL_ROOT,'artifacts.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({stage:'artifact_setup_failed',error:report.error}));process.exitCode=1;
}
