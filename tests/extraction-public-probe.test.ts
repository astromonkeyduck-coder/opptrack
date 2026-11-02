import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { PUBLIC_PDF_SOURCE, PUBLIC_PDF_LEGACY_SOURCE, publicPdfProbe, type PublicPdfProbeOptions } from '../lib/extraction/public-probe';

// Injected HTTP/native fixtures are guard tests, not live collection or Cloud OCR evidence.
const bytes=Buffer.from('%PDF-SYNTHETIC FIXTURE, not a real document');
const hash=createHash('sha256').update(bytes).digest('hex');
const ready:NonNullable<PublicPdfProbeOptions['readiness']>=async()=>({engine:'fixture-engine',ready:true,tools:{tesseract:{available:true,version:'synthetic'},pdfinfo:{available:true,version:'synthetic'},pdftotext:{available:true,version:'synthetic'},pdftoppm:{available:true,version:'synthetic'}}});
const native:NonNullable<PublicPdfProbeOptions['media']>=async(assets,options)=>{
 assert.equal(assets.length,1);assert.equal(assets[0].assetId,'fixed-public-pdf');assert.equal(assets[0].mimeType,'application/pdf');
 assert.equal(assets[0].expectedSha256,hash);assert.ok(Buffer.from(assets[0].bytes).equals(bytes));assert.equal(options?.maxVisualPages,6);
 return {engine:'fixture-engine',complete:true,units:[{assetId:'fixed-public-pdf',page:1,expectedPages:1,status:'processed',attempted:true,text:'Synthetic native text',method:'pdf-text-and-ocr',sha256:hash,issues:[]}]};
};
const noMedia:NonNullable<PublicPdfProbeOptions['media']>=async()=>{throw new Error('Invalid source must not reach native processing');};

test('public PDF probe starts at the observed exact official canonical asset with manual redirects',async()=>{
 let requests=0;
 const result=await publicPdfProbe({readiness:ready,media:native,fetch:async(input,init)=>{
  requests++;assert.equal(String(input),PUBLIC_PDF_SOURCE);assert.equal(new URL(String(input)).hostname,'wertheim.fsu.edu');
  assert.equal(init?.redirect,'manual');assert.equal(init?.cache,'no-store');assert.ok(init?.signal instanceof AbortSignal);assert.equal(init?.headers,undefined);
  return new Response(bytes,{headers:{'content-type':'application/pdf'}});
 }});
 assert.equal(requests,1);assert.equal(result.requests,1);assert.equal(result.source,PUBLIC_PDF_SOURCE);assert.equal(result.originalSource,PUBLIC_PDF_LEGACY_SOURCE);
 assert.equal(result.sha256,hash);assert.equal(result.bytes,bytes.length);assert.equal(result.complete,true);assert.equal(result.calendarCalls,0);assert.equal(result.supabaseCalls,0);
});

test('redirects cannot expand the fixed asset to another host, path, scheme, port, credentials or query',async()=>{
 const destinations=[PUBLIC_PDF_LEGACY_SOURCE,PUBLIC_PDF_SOURCE.replace('wertheim.fsu.edu','business.fsu.edu.evil.invalid'),PUBLIC_PDF_SOURCE.replace('https:','http:'),PUBLIC_PDF_SOURCE.replace('wertheim.fsu.edu','wertheim.fsu.edu:444'),PUBLIC_PDF_SOURCE.replace('https://','https://user:pass@'),`${PUBLIC_PDF_SOURCE}?next=http://169.254.169.254/latest/meta-data`,`${PUBLIC_PDF_SOURCE}#different-fragment`,'/another-public-file.pdf','https://127.0.0.1/private'];
 for(const location of destinations){
  let requests=0;
  await assert.rejects(publicPdfProbe({media:noMedia,readiness:ready,fetch:async()=>{requests++;return new Response('redirect fixture',{status:301,headers:{location}});}}),/redirect left the fixed source/);
  assert.equal(requests,1);
 }
});

test('fixed-asset self-redirect loops are bounded without native processing',async()=>{
 let requests=0;
 await assert.rejects(publicPdfProbe({media:noMedia,readiness:ready,fetch:async()=>{requests++;return new Response(null,{status:302,headers:{location:PUBLIC_PDF_SOURCE}});}}),/bounded redirect limit/);
 assert.equal(requests,3);
});

test('a redirect without a destination fails before a second request',async()=>{
 let requests=0;
 await assert.rejects(publicPdfProbe({media:noMedia,readiness:ready,fetch:async()=>{requests++;return new Response(null,{status:302});}}),/had no destination/);
 assert.equal(requests,1);
});

test('HTTP failures and HTML login walls cannot become empty PDF/native success',async()=>{
 for(const response of [new Response('login wall',{headers:{'content-type':'text/html'}}),new Response('blocked',{status:403}),new Response('unavailable',{status:500}),new Response(null,{headers:{'content-type':'application/pdf'}})])await assert.rejects(publicPdfProbe({media:noMedia,readiness:ready,fetch:async()=>response}),/fetch failed; no empty success/);
});

test('advertised and chunked response sizes enforce the existing four-MiB budget',async()=>{
 const tooLarge=4*1024*1024+1;
 for(const response of [new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(tooLarge)}}),new Response(Buffer.alloc(tooLarge),{headers:{'content-type':'application/pdf'}})])await assert.rejects(publicPdfProbe({media:noMedia,readiness:ready,fetch:async()=>response}),/exceeds probe byte budget/);
});

test('partial native output remains visibly partial without returning full private OCR text',async()=>{
 const result=await publicPdfProbe({readiness:ready,fetch:async()=>new Response(bytes,{headers:{'content-type':'application/pdf'}}),media:async assets=>({engine:'fixture-engine',complete:false,units:[{assetId:assets[0].assetId,page:null,status:'blocked',attempted:false,text:'',method:'pdf-text-and-ocr',sha256:hash,issues:['native_tool_unavailable:pdfinfo']}]})});
 assert.equal(result.complete,false);assert.equal(result.units[0].status,'blocked');assert.ok(result.units[0].issues.includes('native_tool_unavailable:pdfinfo'));assert.equal('text' in result.units[0],false);
});
