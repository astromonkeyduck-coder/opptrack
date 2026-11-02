// Trigger-only. No Google, delivery, arbitrary URL fetching or model provider capability.
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ownsStoragePath } from '../intake/validation';
import { EXTRACTOR_VERSION, RESULT_VERSION, validateExtractionResult, type ExtractionResult } from './contracts';
import { processMediaAssets, type ExtractionUnit, type MediaAsset } from './media';
import { extractCandidates, providedTextUnit } from './text';

const mediaInput=z.object({assetId:z.string().min(1).max(80),storagePath:z.string().max(1024).optional(),mimeType:z.string().max(100).optional(),byteCount:z.number().int().nonnegative().optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).nullish(),available:z.boolean().optional()}).passthrough();
const snapshotSchema=z.object({kind:z.enum(['manual','instagram']),targetId:z.uuid(),note:z.string().max(5000).nullish(),caption:z.string().max(20000).nullish(),publishedAt:z.string().nullish(),sourceUrl:z.string().max(2048).nullish(),childrenComplete:z.boolean().optional(),media:z.array(mediaInput).max(100)}).passthrough();
const jobSchema=z.object({id:z.uuid(),owner_id:z.uuid(),extractor_version:z.literal(EXTRACTOR_VERSION),lease_token:z.uuid(),visual_page_budget:z.number().int().min(0).max(12),input_snapshot:snapshotSchema}).passthrough();
type Job=z.infer<typeof jobSchema>;
type MediaProcessor=typeof processMediaAssets;
class PreparedExtractionFailure extends Error { constructor(public result:ExtractionResult){super('Extraction validation failed');} }

export function extractionWorkerClient(environment:Record<string,string|undefined>=process.env):SupabaseClient {
  const raw=environment.SUPABASE_URL,key=environment.SUPABASE_SECRET_KEY;
  if(!raw||!key)throw new Error('Extraction worker database setup is missing');
  const base=new URL(raw);
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('Invalid worker database origin');
  return createClient(base.origin,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    const target=new URL(input instanceof Request?input.url:input.toString());
    if(target.origin!==base.origin)throw new Error('Worker request origin changed');
    const signal=AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(15000)]);
    return fetch(input,{...init,signal,redirect:'error'});
  }}});
}
function unavailable(item:z.infer<typeof mediaInput>,issue:string):ExtractionUnit {
  return {assetId:item.assetId,page:null,status:'blocked',text:'',method:item.mimeType==='application/pdf'?'pdf-text-and-ocr':'ocr',sha256:item.sha256??null,issues:[issue]};
}
/** Consumes only immutable private Storage references from the leased SQL snapshot. */
export async function extractLeasedJob(jobValue:unknown,client:SupabaseClient,options:{media?:MediaProcessor;now?:()=>number}={}):Promise<ExtractionResult> {
  const job=jobSchema.parse(jobValue),input=job.input_snapshot,now=options.now??Date.now,started=now();
  const units:ExtractionUnit[]=[providedTextUnit(input.note??input.caption??'')],issues:string[]=[];
  const assets:MediaAsset[]=[];let downloaded=0;
  if(input.media.length>8){issues.push('supplied_media_exceeds_supported_asset_limit');for(const item of input.media)units.push(unavailable(item,'asset_limit_exceeded'));}
  else for(const item of input.media) {
    if(input.kind==='instagram'){units.push(unavailable(item,'instagram_media_not_collected'));continue;}
    if(job.visual_page_budget===0){units.push(unavailable(item,'daily_visual_budget_exhausted'));continue;}
    if(!item.storagePath||!ownsStoragePath(job.owner_id,item.storagePath)||!item.mimeType||!['image/png','image/jpeg','image/webp','application/pdf'].includes(item.mimeType)||!item.byteCount||item.byteCount>4194304){units.push(unavailable(item,'invalid_private_asset_reference'));continue;}
    if(now()-started>90000){units.push(unavailable(item,'download_time_budget_exhausted'));continue;}
    try{
      const file=await client.storage.from('captures').download(item.storagePath);
      if(file.error||!file.data){units.push(unavailable(item,'private_asset_unavailable'));continue;}
      if(file.data.size!==item.byteCount||file.data.size+downloaded>4194304){units.push(unavailable(item,'private_asset_size_mismatch'));continue;}
      const bytes=new Uint8Array(await file.data.arrayBuffer());
      const digest=createHash('sha256').update(bytes).digest('hex');
      if(!item.sha256||digest!==item.sha256){units.push(unavailable(item,'private_asset_hash_mismatch'));continue;}
      downloaded+=bytes.byteLength;assets.push({assetId:item.assetId,bytes,mimeType:item.mimeType,expectedSha256:item.sha256});
    }catch{units.push(unavailable(item,'private_asset_read_failed'));}
  }
  let media:Awaited<ReturnType<MediaProcessor>>;
  try{media=await (options.media??processMediaAssets)(assets,{maxVisualPages:job.visual_page_budget});}
  catch{
    const fallback=failureResult(job,'native_work_unconfirmed',Math.max(0,now()-started));
    if(assets.length)fallback.stats.visualWorkUncertain=true;
    throw new PreparedExtractionFailure(fallback);
  }
  units.push(...media.units);
  const order=new Map(input.media.map((item,index)=>[item.assetId,index+1]));
  units.sort((a,b)=>(a.assetId==='text'?0:order.get(a.assetId)??1000)-(b.assetId==='text'?0:order.get(b.assetId)??1000)||(a.page??0)-(b.page??0));
  if(input.kind==='instagram')issues.push('retained_caption_only_media_and_stories_unavailable');
  if(input.childrenComplete===false)issues.push('source_carousel_manifest_incomplete');
  if(!input.media.length&&!units[0].text.trim()&&input.sourceUrl)issues.push('saved_link_content_not_fetched');
  const complete=input.kind!=='instagram'&&media.complete&&units.every(unit=>unit.status==='processed')&&!issues.some(issue=>['source_carousel_manifest_incomplete','saved_link_content_not_fetched'].includes(issue));
  const result:ExtractionResult={version:RESULT_VERSION,units,candidates:extractCandidates(units,{publishedAt:input.publishedAt}),issues,complete,
    stats:{processedAssets:new Set(units.filter(unit=>unit.assetId!=='text'&&unit.status==='processed').map(unit=>unit.assetId)).size,expectedAssets:input.media.length,processedPages:units.filter(unit=>unit.assetId!=='text'&&unit.status==='processed').length,engine:`${media.engine}/${EXTRACTOR_VERSION}`,elapsedMs:Math.max(0,now()-started)}};
  try{return validateExtractionResult(result);}catch{
    // Failed semantic/result validation must still charge attempted OCR pages.
    const fallback=failureResult(job,'extraction_result_invalid',Math.max(0,now()-started));
    fallback.units=units.map(unit=>unit.assetId==='text'?unit:{assetId:unit.assetId,page:unit.page,...(unit.expectedPages?{expectedPages:unit.expectedPages}:{}),...(unit.attempted!==undefined?{attempted:unit.attempted}:{}),sha256:unit.sha256,method:unit.method,status:unit.status==='blocked'?'blocked':'failed',text:'',issues:['extraction_result_invalid']});
    throw new PreparedExtractionFailure(validateExtractionResult(fallback));
  }
}
function failureResult(job:Job,issue:string,elapsedMs=0):ExtractionResult {
  return {version:RESULT_VERSION,units:[providedTextUnit(job.input_snapshot.note??job.input_snapshot.caption??''),...job.input_snapshot.media.map(item=>unavailable(item,issue))],candidates:[],issues:[issue],complete:false,
    stats:{processedAssets:0,expectedAssets:job.input_snapshot.media.length,processedPages:0,engine:EXTRACTOR_VERSION,elapsedMs}};
}
export async function runExtractionDispatcher(client?:SupabaseClient,options:{enabled?:boolean;media?:MediaProcessor;now?:()=>number;environment?:Record<string,string|undefined>}={}) {
  const environment=options.environment??process.env;
  if(environment.CALENDAR_WRITES_ENABLED&&environment.CALENDAR_WRITES_ENABLED!=='false')throw new Error('Extraction workers cannot enable calendar writes');
  if(!(options.enabled??environment.STAGE2_EXTRACTION_ENABLED==='true'))return {status:'disabled' as const,jobs:[]};
  const db=client??extractionWorkerClient(environment);
  const claim=await db.rpc('extraction_claim',{p_limit:1,p_lease_seconds:300});
  if(claim.error)throw new Error('Extraction queue could not be leased');
  const jobs:Array<{jobId:string;state:string;candidateCount:number;processedPages:number;errorCode:string|null}>=[];
  for(const raw of claim.data??[]) {
    const job=jobSchema.parse(raw);let result:ExtractionResult,errorCode:string|null=null;const started=Date.now();
    try{result=await extractLeasedJob(job,db,options);}
    catch(error){errorCode='extraction_validation_or_processing_failed';result=error instanceof PreparedExtractionFailure?error.result:failureResult(job,errorCode,Date.now()-started);}
    const state=errorCode?'failed':result.complete?'succeeded':result.units.some(unit=>unit.text.trim())?'partial':'blocked';
    if(state!=='succeeded'&&!errorCode)errorCode='incomplete_input_or_media';
    const finished=await db.rpc('extraction_finish',{p_job_id:job.id,p_lease_token:job.lease_token,p_state:state,p_result:result,p_error_code:errorCode,p_retry_after_seconds:60});
    if(finished.error)throw new Error('Extraction completion is unconfirmed; lease recovery is required');
    jobs.push({jobId:job.id,state,candidateCount:result.candidates.length,processedPages:result.stats.processedPages,errorCode});
  }
  return {status:jobs.length?'completed' as const:'idle' as const,jobs};
}
