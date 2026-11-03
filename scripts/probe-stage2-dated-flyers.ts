/** Fixed official public media only. Local evidence preparation, no hosted writes or model calls. */
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {processMediaAssets,nativeMediaReadiness} from '../lib/extraction/media';
import {extractCandidatesForVersion} from '../lib/extraction/versions';
import {validateExtractionResult} from '../lib/extraction/contracts';

const sources=[
 {id:'ornl-workshop',family:'engineering-ornl-nov2026',kind:'official-event-pdf',page:'https://eng.famu.fsu.edu/event/2nd-neutron-nexus-workshop-engineering-materials',url:'https://eng.famu.fsu.edu/sites/default/files/2026-10/ORNL%20Neutron%20Nexus%20Fa2026%20Workshop%20Fliers%20%283%29%20%281%29.pdf'},
 {id:'marine-kim-miller',family:'marine-lecture-series-2026',kind:'official-event-flyer',page:'https://marinelab.fsu.edu/outreach-and-education/lectures/',url:'https://marinelab.fsu.edu/media/6795/kim-miller-lecture-flyer.jpg?mode=max&width=800&rnd=134362689490000000'},
 {id:'marine-rescheduled',family:'marine-lecture-series-2026',kind:'official-rescheduled-flyer',page:'https://marinelab.fsu.edu/outreach-and-education/lectures/',url:'https://marinelab.fsu.edu/media/6408/chris-peters_rescheduledpost.png?width=500&height=500'},
 {id:'boren-process',family:'onf-boren-2026',kind:'official-application-process-pdf',page:'https://onf.fsu.edu/',url:'https://onf.fsu.edu/sites/g/files/upcbnu666/files/Boren%20Flyer%2025.pdf'},
 {id:'marine-boat-negative',family:'marine-research-photo-negative',kind:'official-photo-negative',page:'https://marinelab.fsu.edu/outreach-and-education/lectures/',url:'https://marinelab.fsu.edu/media/1632/fsu-rv-wide-large.jpg?mode=max&width=600&rnd=132315884890000000'},
] as const;
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const runId=new Date().toISOString().replaceAll(':','-'),folder=`private/stage2-dated-flyers/run-${runId}`;
await mkdir(folder,{recursive:true,mode:0o700});
const observations:Array<Record<string,unknown>>=[];
const readiness=await nativeMediaReadiness();
for(const source of sources){
 const startedAt=new Date().toISOString();
 try{
  const response=await fetch(source.url,{redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'}),mime=response.headers.get('content-type')?.split(';')[0].toLowerCase().trim();
  if(!response.ok||!response.body||!mime||!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime)){await response.body?.cancel();observations.push({...source,startedAt,state:'blocked',httpStatus:response.status,mime,location:response.headers.get('location'),reason:'Non-success or unsupported media; not an empty success'});continue;}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>4194304){await reader.cancel();throw new Error('fixed_asset_over_four_MiB');}chunks.push(value.value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks),sha256=digest(bytes),extension=mime==='application/pdf'?'pdf':mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp',original=`${folder}/${source.id}-${sha256.slice(0,12)}.${extension}`;
  await writeFile(original,bytes,{mode:0o600});
  const nativeStart=Date.now(),result=await processMediaAssets([{assetId:source.id,bytes,mimeType:mime,expectedSha256:sha256}]);
  const candidates=extractCandidatesForVersion('stage2-rules-v3',result.units,{});
  validateExtractionResult({version:'stage2-result-v1',units:result.units,candidates,issues:[],complete:result.complete,stats:{processedAssets:1,expectedAssets:1,processedPages:result.units.filter(unit=>unit.status==='processed').length,engine:result.engine,elapsedMs:Date.now()-nativeStart}});
  const privateResult=`${folder}/${source.id}-ocr-and-predictions.json`;
  await writeFile(privateResult,JSON.stringify({source,original,sha256,result,candidates},null,2)+'\n',{mode:0o600});
  observations.push({...source,startedAt,finishedAt:new Date().toISOString(),state:'processed',httpStatus:response.status,mime,bytes:bytes.length,sha256,original,originalPublicationAt:null,publicationStatus:'unknown_not_inferred_from_fetch_or_filename',privateResult,complete:result.complete,engine:result.engine,elapsedNativeMs:Date.now()-nativeStart,units:result.units.map(({assetId,page,expectedPages,status,attempted,sha256,text,issues,words})=>({assetId,page,expectedPages,status,attempted,sha256,textCharacters:text.length,wordBoxes:words?.length??0,issues})),unreviewedCandidateCount:candidates.length,unreviewedInstantCount:candidates.filter(candidate=>candidate.fields.startAt||candidate.fields.occursAt).length});
  console.log(JSON.stringify({id:source.id,bytes:bytes.length,units:result.units.length,complete:result.complete,candidates:candidates.length,original,privateResult}));
 }catch(error){observations.push({...source,startedAt,finishedAt:new Date().toISOString(),state:'failed',reason:error instanceof Error?error.message:'unclassified_failure'});console.log(JSON.stringify({id:source.id,state:'failed'}));}
}
const report={recordedAt:new Date().toISOString(),command:'node --import tsx scripts/probe-stage2-dated-flyers.ts',evidenceClass:'Fresh fixed official public FSU media plus local all-page OCR and unreviewed v3 predictions; no human accuracy claim',runId,privateDirectory:folder,readiness,observations,httpRequests:sources.length,successfulMediaReads:observations.filter(value=>value.state==='processed').length,combinedFetchedBytes:observations.reduce((total,value)=>total+Number(value.bytes||0),0),humanReviewedLabels:0,holdoutInputsRead:0,frozenExamplesModified:0,credentialFilesRead:0,databaseCalls:0,calendarCalls:0,modelCalls:0,paidServices:0,limitations:['Each fixed asset is a separate bounded local native invocation; this diagnostic does not spend or bypass hosted SQL owner quotas.','Public original media and full OCR/predictions stay ignored/private; extracted candidates are not factual labels.','Original publication times remain unknown; fetch time and filenames are never event-year anchors.','A multi-page PDF is not an Instagram carousel and proves no Stories, social media-byte access or complete slide set.','Human review, representative negatives/conflicts and an independent holdout remain outstanding.']};
await writeFile(`${folder}/probe-report.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});
await writeFile('reports/stage-2-dated-media-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:'reports/stage-2-dated-media-probe.json',directory:folder,successful:report.successfulMediaReads,requested:sources.length}));
process.exitCode=report.successfulMediaReads===sources.length&&observations.every(value=>value.complete===true)?0:1;
