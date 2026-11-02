// Operator-only fixed public source; separate bounded diagnostic compute outside private-job quota. No user-controlled URL.
import {createHash} from 'node:crypto';
import {nativeMediaReadiness,processMediaAssets} from './media';
// November 2 live GET: business.fsu.edu returned 301 to this exact official FSU asset.
export const PUBLIC_PDF_SOURCE='https://wertheim.fsu.edu/sites/g/files/upcbnu1771/files/Insurance%20Days%20-%20Prep%20for%20Career%20Fair%20Brochure.pdf';
export const PUBLIC_PDF_LEGACY_SOURCE='https://business.fsu.edu/sites/g/files/upcbnu1771/files/Insurance%20Days%20-%20Prep%20for%20Career%20Fair%20Brochure.pdf';
const SOURCE=PUBLIC_PDF_SOURCE;
// Dependencies are internal server/test injection; the URL is never caller-controlled.
export type PublicPdfProbeOptions={fetch?:typeof fetch;media?:typeof processMediaAssets;readiness?:typeof nativeMediaReadiness};
export async function publicPdfProbe(options:PublicPdfProbeOptions={}){
 const start=Date.now();let url=SOURCE,requests=0;
 for(let redirect=0;redirect<3;redirect++){
  const target=new URL(url);if(target.href!==SOURCE)throw new Error('Public probe redirect left the fixed source');
  requests++;const response=await (options.fetch||fetch)(target,{redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('Public probe redirect had no destination');url=new URL(location,url).href;continue;}
  if(!response.ok||!response.body||!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')){await response.body?.cancel();throw new Error('Public PDF probe fetch failed; no empty success');}
  const declaredLength=response.headers.get('content-length');if(declaredLength&&/^\d+$/.test(declaredLength)&&Number(declaredLength)>4194304){await response.body.cancel();throw new Error('Public PDF exceeds probe byte budget');}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4194304){await reader.cancel();throw new Error('Public PDF exceeds probe byte budget');}parts.push(part.value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts),sha256=createHash('sha256').update(bytes).digest('hex');
  const result=await (options.media||processMediaAssets)([{assetId:'fixed-public-pdf',bytes,mimeType:'application/pdf',expectedSha256:sha256}],{maxVisualPages:6});
  return {evidenceClass:'Manual fixed-public-PDF native Cloud probe; no private Storage or semantic-accuracy proof',source:SOURCE,originalSource:PUBLIC_PDF_LEGACY_SOURCE,requests,bytes:size,sha256,complete:result.complete,elapsedMs:Date.now()-start,readiness:await (options.readiness||nativeMediaReadiness)(),units:result.units.map(unit=>({page:unit.page,expectedPages:unit.expectedPages,status:unit.status,attempted:unit.attempted,textCharacters:unit.text.length,wordBoxes:unit.words?.length||0,issues:unit.issues})),supabaseCalls:0,calendarCalls:0,modelCalls:0};
 }
 throw new Error('Public PDF exceeded the bounded redirect limit');
}
