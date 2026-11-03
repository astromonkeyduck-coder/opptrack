/** Fixed public Central Calendar image samples; private read-only Stage 2 evidence. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { processMediaAssets, nativeMediaReadiness, type MediaAsset } from '../lib/extraction/media';

const BATCH='private/stage1-reingestion-live/fsu-calendar-api.json';
const IDS=[54299152068755,54125713843124,54246054417952];
const DIRECTORY='private/stage2-public-flyers';
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const batchBytes=await readFile(BATCH),batch=JSON.parse(batchBytes.toString('utf8'));
if(batch.sourceId!=='fsu-calendar-api'||batch.status!=='success')throw new Error('Expected the retained successful Central Calendar batch');
const events=new Map<number,Record<string,unknown>>();
for(const page of batch.pages){
 if(digest(page.body)!==page.sha256)throw new Error('Original Central response hash changed');
 for(const row of JSON.parse(page.body).events??[])if(IDS.includes(row.event?.id))events.set(row.event.id,row.event);
}
if(events.size!==IDS.length)throw new Error('A fixed image sample is missing from the original capture');
await mkdir(DIRECTORY,{recursive:true,mode:0o700});await chmod(DIRECTORY,0o700);
const observations:Array<Record<string,unknown>>=[],assets:MediaAsset[]=[];let combined=0;
for(const id of IDS){
 const event=events.get(id)!,source=new URL(String(event.photo_url));
 if(source.protocol!=='https:'||source.hostname!=='localist-images.azureedge.net'||source.port||source.username||source.password||source.search||source.hash||!/^\/photos\/\d+\/huge\/[a-f0-9]+\.(?:jpg|png|webp)$/.test(source.pathname))throw new Error('Fixed sample image URL failed the source guard');
 const observedAt=new Date().toISOString();
 try{
  const response=await fetch(source,{redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'});
  const mimeType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!response.ok||!response.body||!mimeType||!['image/jpeg','image/png','image/webp'].includes(mimeType)){
   await response.body?.cancel();observations.push({id,source:source.href,sourceEventUrl:event.localist_url,observedAt,state:'blocked',httpStatus:response.status,mimeType,reason:'Image response unavailable or outside bounded supported MIME; no empty success'});continue;
  }
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size+combined>4194304){await reader.cancel();throw new Error('combined_byte_budget_exceeded');}chunks.push(item.value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks),sha256=digest(bytes);combined+=bytes.length;
  const extension=mimeType==='image/jpeg'?'jpg':mimeType==='image/png'?'png':'webp';
  const file=`${DIRECTORY}/${id}-${sha256.slice(0,12)}.${extension}`;
  await writeFile(file,bytes,{mode:0o600});
  assets.push({assetId:`public-${id}`,bytes,mimeType,expectedSha256:sha256});
  observations.push({id,source:source.href,sourceEventUrl:event.localist_url,originalPublicationAt:event.created_at,observedAt,state:'fetched',httpStatus:response.status,mimeType,bytes:bytes.length,sha256,privatePath:file});
 }catch(error){observations.push({id,source:source.href,sourceEventUrl:event.localist_url,observedAt,state:'failed',reason:error instanceof Error?error.message:'unclassified_fetch_failure'});}
}
const readiness=await nativeMediaReadiness();
const start=Date.now(),result=await processMediaAssets(assets,{maxVisualPages:3});
const privateResult=`${DIRECTORY}/ocr-result.json`;
await writeFile(privateResult,JSON.stringify(result,null,2)+'\n',{mode:0o600});
const report={recordedAt:new Date().toISOString(),command:'node --import tsx scripts/probe-stage2-live-flyers.ts',evidenceClass:'Fresh reads of three fixed public event image references plus local native OCR; not necessarily event flyers or complete slide sets',originalBatch:BATCH,originalBatchSha256:digest(batchBytes),requestedSamples:IDS.length,observations,combinedFetchedBytes:combined,readiness,elapsedNativeMs:Date.now()-start,complete:result.complete&&assets.length===IDS.length,units:result.units.map(unit=>({assetId:unit.assetId,status:unit.status,method:unit.method,attempted:unit.attempted,textCharacters:unit.text.length,wordBoxes:unit.words?.length??0,issues:unit.issues,sha256:unit.sha256})),privateResult,humanLabels:0,stage2PredictionsScored:0,credentialsRead:0,databaseCalls:0,modelCalls:0,calendarCalls:0,paidServices:0,limitations:['Public event image references may be generic artwork or movie posters, not dated opportunity flyers. Visual inspection is required before classification.','One supplied image per event does not establish all-slide/carousel completeness.','OCR execution and retained text are not factual field accuracy or holdout acceptance.','No private hosted upload/Storage or Cloud OCR path is exercised.','Original image bytes and full OCR remain ignored/private; no original media is published.']};
await writeFile('reports/stage-2-public-image-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({fetched:assets.length,requested:IDS.length,bytes:combined,processed:result.units.filter(unit=>unit.status==='processed').length,complete:report.complete,report:'reports/stage-2-public-image-probe.json'}));
process.exitCode=report.complete?0:1;
