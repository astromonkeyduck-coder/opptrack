/** Actual downloaded public flyer bytes through the response helper; local Storage/auth substitutes only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {privateMediaResponse} from '../lib/intake/private-media';
const review=JSON.parse(await readFile('reports/stage-2-dated-media-review.json','utf8'));
const owner='11111111-1111-4111-8111-111111111111',results=[];
for(const [index,input] of review.uploadReady.entries()){
 const bytes=await readFile(input.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sha256);
 const path=`${owner}/manual/22222222-2222-4222-8222-222222222222/0${index+1}-${input.sha256}.png`;
 const response=await privateMediaResponse(new Request(`https://tracker.example/api/private-media?preview=image&path=${encodeURIComponent(path)}`),owner,async selected=>{assert.equal(selected,path);return{data:new Blob([bytes],{type:'image/png'}),error:null};});
 const body=new Uint8Array(await response.arrayBuffer()),responseSha256=createHash('sha256').update(body).digest('hex');assert.equal(response.status,200);assert.equal(responseSha256,input.sha256);assert.equal(body.length,bytes.length);
 results.push({sourcePath:input.path,bytes:bytes.length,originalSha256:input.sha256,responseSha256,status:response.status,headers:Object.fromEntries(response.headers.entries()),exactBytes:true});
}
await writeFile('reports/stage-2-private-preview-local.json',JSON.stringify({recordedAt:new Date().toISOString(),command:'node --import tsx scripts/probe-stage2-private-preview-local.ts',evidenceClass:'Actual freshly downloaded public flyer bytes through local HTTP response helper with synthetic owner and in-memory Storage substitute',results,hostedRequests:0,realAuthSessions:0,modelCalls:0,calendarCalls:0,limitations:['This proves exact local response-helper bytes and headers, not a hosted owner download, signed-user isolation or browser rendering.','Root must verify the deployed authenticated route separately.']},null,2)+'\n');
console.log(JSON.stringify({checked:results.length,exactBytes:results.every(result=>result.exactBytes),report:'reports/stage-2-private-preview-local.json'}));
