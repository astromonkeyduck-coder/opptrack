import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const urls=JSON.parse(await readFile('private/stage2-upload-original-urls.json','utf8'));
if(urls.length!==2)throw new Error('Exactly two known synthetic media links required');
const observations=[];
for(const raw of urls){
 const u=new URL(raw);
 if(u.origin!=='https://luxury-longma-01d2fa.netlify.app'||u.pathname!=='/api/private-media'||u.username||u.password||u.hash)throw new Error('Unexpected known-object origin');
 const r=await fetch(u,{redirect:'manual',credentials:'omit',headers:{accept:'application/octet-stream'},signal:AbortSignal.timeout(15000)});
 const body=Buffer.from(await r.arrayBuffer());
 observations.push({checkedAt:new Date().toISOString(),urlSha256:createHash('sha256').update(u.href).digest('hex'),status:r.status,bytes:body.length,responseBodySha256:createHash('sha256').update(body).digest('hex'),contentType:r.headers.get('content-type'),cacheControl:r.headers.get('cache-control'),anonymousDenied:r.status===401||r.status===403});
}
const report={evidenceClass:'Actual anonymous HTTPS GETs for the two known synthetic original links from the owner UI; no cookies/Authorization/browser-session extraction',jobId:'97818d6c-5368-4413-aa2a-86d6fb7b014f',observations,allDenied:observations.every(x=>x.anonymousDenied),ownerDownloadVerified:false,otherUserSignedJwtVerified:false,credentialsRead:0,calendarCalls:0,modelCalls:0};
await writeFile('reports/stage-2-known-media-anonymous-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({requests:observations.length,statuses:observations.map(x=>x.status),allDenied:report.allDenied}));
process.exitCode=report.allDenied?0:1;
