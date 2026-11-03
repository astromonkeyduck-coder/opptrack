/** Isolated local CPU inference worker. IPC is local; outbound fetch is forbidden. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const root=path.resolve(process.argv[2]),send=value=>process.send?.(value);
const cpu=()=>{const value=process.cpuUsage();return(value.user+value.system)/1000;};
globalThis.fetch=async()=>{throw new Error('Network is disabled during local inference.');};
let generator;
try{
 const library=await import(pathToFileURL(path.join(root,'runtime/node_modules/@huggingface/transformers/src/transformers.js')).href);
 if(library.env.version!=='3.8.1')throw new Error('Unexpected inference dependency version.');
 const config=JSON.parse(await readFile(path.join(root,'model/config.json'),'utf8'));
 if(config.auto_map||config.trust_remote_code)throw new Error('Custom model code is forbidden.');
 library.env.allowRemoteModels=false;library.env.allowLocalModels=true;library.env.useBrowserCache=false;library.env.useFSCache=false;library.env.cacheDir=path.join(root,'cache');
 generator=await library.pipeline('text-generation',path.join(root,'model'),{dtype:'q4',device:'cpu',local_files_only:true,session_options:{intraOpNumThreads:1,interOpNumThreads:1,executionMode:'sequential',logSeverityLevel:3}});
 send({type:'ready',cpuMs:cpu(),backend:'onnxruntime-node/cpu',transformersVersion:library.env.version});
}catch(error){send({type:'backend_failed',error:String(error?.message||error).slice(0,500),cpuMs:cpu()});process.exit(1);}
const heartbeat=setInterval(()=>send({type:'heartbeat',cpuMs:cpu()}),1000);heartbeat.unref();
process.on('message',async message=>{
 if(message?.type!=='generate')return;
 const before=cpu(),started=Date.now();
 try{
  const response=await generator(message.messages,{max_new_tokens:384,do_sample:false,num_beams:1,return_full_text:false});
  const generated=response?.[0]?.generated_text;
  const text=typeof generated==='string'?generated:Array.isArray(generated)?generated.at(-1)?.content:null;
  if(typeof text!=='string')throw new Error('Unexpected generation response envelope.');
  send({type:'result',jobId:message.jobId,text,elapsedMs:Date.now()-started,cpuMs:cpu(),generationCpuMs:cpu()-before});
 }catch(error){send({type:'generation_failed',jobId:message.jobId,error:String(error?.message||error).slice(0,500),cpuMs:cpu(),elapsedMs:Date.now()-started});}
});
