import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
import sharp from 'sharp';
import {privateMediaResponse,privatePreviewMime} from '../lib/intake/private-media';
import {MAX_FILE_BYTES} from '../lib/intake/validation';
import {ExtractionJobResult,type ExtractionJobDetail} from '../app/extractions/components';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const path=`${owner}/manual/33333333-3333-4333-8333-333333333333/01-${'a'.repeat(64)}.png`;
const request=(preview:string|null='image',storagePath=path)=>new Request(`https://tracker.example/api/private-media?path=${encodeURIComponent(storagePath)}${preview===null?'':`&preview=${preview}`}`);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const png=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer();
const jpeg=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).jpeg().toBuffer();
const blob=(bytes:Uint8Array,type:string)=>new Blob([new Uint8Array(bytes)],{type});

test('PNG and JPEG previews return exact original bytes with private safe inline headers',async()=>{
 for(const [bytes,type] of [[png,'image/png'],[jpeg,'image/jpeg']] as const){
  let calls=0;const response=await privateMediaResponse(request(),owner,async selected=>{calls++;assert.equal(selected,path);return{data:blob(bytes,type),error:null};});
  assert.equal(response.status,200);assert.equal(calls,1);assert.equal(response.headers.get('content-type'),type);assert.match(response.headers.get('content-disposition')!,/^inline;/);assert.equal(response.headers.get('content-length'),String(bytes.length));assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; sandbox");assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(digest(new Uint8Array(await response.arrayBuffer())),digest(bytes));
 }
});
test('unsafe MIME/content, mismatches, empty/truncated images and oversize inputs cannot be previewed',async()=>{
 const unsafe=Buffer.from('<svg onload="alert(1)"><script>alert(1)</script></svg>');
 for(const [bytes,type] of [[unsafe,'image/png'],[Buffer.from('<html>private</html>'),'image/jpeg'],[Buffer.from('%PDF-1.7'),'application/pdf'],[png,'image/jpeg'],[jpeg,'image/png'],[png,'image/svg+xml'],[png,'image/webp'],[png.subarray(0,25),'image/png'],[jpeg.subarray(0,jpeg.length-2),'image/jpeg'],[new Uint8Array(),'image/png'],[new Uint8Array(MAX_FILE_BYTES+1),'image/png']] as const){assert.equal(privatePreviewMime(bytes,type),null);const response=await privateMediaResponse(request(),owner,async()=>({data:blob(bytes,type),error:null}));assert.equal(response.status,415);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.doesNotMatch(await response.text(),/alert\(1\)|<svg|<html/);}
});
test('anonymous, other-owner and malformed paths are denied before the private Storage read',async()=>{
 let calls=0;const download=async()=>{calls++;return{data:blob(png,'image/png'),error:null};};
 assert.equal((await privateMediaResponse(request(),null,download)).status,401);
 for(const candidate of [`${other}/manual/private.png`,`${owner}/../private.png`,`${owner}/manual/..%2fprivate.png`,`${owner}\\manual\\private.png`,'https://example.com/image.png'])assert.equal((await privateMediaResponse(request('image',candidate),owner,download)).status,404);
 assert.equal((await privateMediaResponse(request('svg'),owner,download)).status,400);assert.equal(calls,0);
});
test('Storage failures never return an image or leak provider errors',async()=>{
 for(const download of [async()=>({data:null,error:new Error('private provider details')}),async()=>{throw new Error('private provider details');}]){const response=await privateMediaResponse(request(),owner,download);assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/provider details/);assert.match(response.headers.get('cache-control')!,/no-store/);}
});
test('regular private downloads remain unchanged attachments including non-previewable PDF bytes',async()=>{
 const bytes=Buffer.from('%PDF-1.7\nprivate fixture');const response=await privateMediaResponse(request(null),owner,async()=>({data:blob(bytes,'application/pdf'),error:null}));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('content-disposition'),'attachment; filename="private-intake-file"');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(bytes));
});
test('the preview size limit is checked before reading or decoding the Blob body',async()=>{
 class Oversize extends Blob{get size(){return MAX_FILE_BYTES+1;}async arrayBuffer():Promise<ArrayBuffer>{throw new Error('Must not read oversize blob');}}
 const response=await privateMediaResponse(request(),owner,async()=>({data:new Oversize([],{type:'image/png'}),error:null}));assert.equal(response.status,415);
 class Unreadable extends Blob{async arrayBuffer():Promise<ArrayBuffer>{throw new Error('private transport detail');}}
 const unavailable=await privateMediaResponse(request(),owner,async()=>({data:new Unreadable([png],{type:'image/png'}),error:null}));assert.equal(unavailable.status,415);assert.doesNotMatch(await unavailable.text(),/transport detail/);
});
test('original images render only as owner-scoped same-origin lazy previews in collapsed details',()=>{
 const job:ExtractionJobDetail={id:other,owner_id:owner,manual_intake_id:other,instagram_update_id:null,state:'queued',attempts:0,error_code:null,extractor_version:'stage2-rules-v3',created_at:'2026-11-03T00:00:00Z',finished_at:null,retry_not_before:null,result:null,input_snapshot:{media:[{storagePath:path,mimeType:'image/png'},{storagePath:path.replace('.png','.jpg'),mimeType:'image/jpeg'},{storagePath:path.replace('.png','.pdf'),mimeType:'application/pdf'},{storagePath:path.replace('.png','.svg'),mimeType:'image/svg+xml'},{storagePath:`${other}/manual/private.png`,mimeType:'image/png'}]}};
 const $=load(renderToStaticMarkup(createElement(ExtractionJobResult,{job})));assert.equal($('img').length,2);
 $('img').each((_,element)=>{const image=$(element),source=image.attr('src')!;assert.ok(source.startsWith('/api/private-media?preview=image&path='));assert.ok(decodeURIComponent(source).includes(path.slice(0,-4)));assert.equal(image.attr('crossorigin'),undefined);assert.equal(image.attr('loading'),'lazy');assert.equal(image.attr('referrerpolicy'),'no-referrer');assert.equal(image.closest('details').attr('open'),undefined);assert.equal(image.parents('details').length,2);});
 assert.equal($('a').filter((_,element)=>$(element).text().startsWith('Download original file')).length,4);assert.equal($('img[src^="https:"],a[href^="https:"]').length,0);
});
