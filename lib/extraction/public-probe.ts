// Operator-only, fixed public source. This is not a user URL fetch route or a job-budget bypass.
import {createHash} from 'node:crypto';
import {nativeMediaReadiness,processMediaAssets} from './media';
const SOURCE='https://business.fsu.edu/sites/g/files/upcbnu1771/files/Insurance%20Days%20-%20Prep%20for%20Career%20Fair%20Brochure.pdf';
export async function publicPdfProbe(){
 const start=Date.now();let url=SOURCE,requests=0;
 for(let redirect=0;redirect<3;redirect++){
  const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='business.fsu.edu')throw new Error('Public probe redirect left the fixed source');
  requests++;const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('Public probe redirect had no destination');url=new URL(location,url).href;continue;}
  if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('Public PDF probe fetch failed; no empty success');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4194304){await reader.cancel();throw new Error('Public PDF exceeds probe byte budget');}parts.push(part.value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts),sha256=createHash('sha256').update(bytes).digest('hex');
  const result=await processMediaAssets([{assetId:'fixed-public-pdf',bytes,mimeType:'application/pdf',expectedSha256:sha256}],{maxVisualPages:6});
  return {evidenceClass:'Manual fixed-public-PDF native Cloud probe; no private Storage or semantic-accuracy proof',source:SOURCE,requests,bytes:size,sha256,complete:result.complete,elapsedMs:Date.now()-start,readiness:await nativeMediaReadiness(),units:result.units.map(unit=>({page:unit.page,expectedPages:unit.expectedPages,status:unit.status,attempted:unit.attempted,textCharacters:unit.text.length,wordBoxes:unit.words?.length||0,issues:unit.issues})),supabaseCalls:0,calendarCalls:0,modelCalls:0};
 }
 throw new Error('Public PDF exceeded the bounded redirect limit');
}
