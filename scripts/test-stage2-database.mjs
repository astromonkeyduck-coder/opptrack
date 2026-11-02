/** Actual PostgreSQL/RLS/RPC checks, synthetic inputs only; no credentials or provider calls. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const db=new PGlite(), owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const checks=[],q=async(s,a=[])=>(await db.query(s,a)).rows,scalar=async(s,a=[])=>Object.values((await q(s,a))[0])[0];
const hash=s=>createHash('sha256').update(s).digest('hex');
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function role(name,id,fn){await db.exec('set role '+name);await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role;reset request.jwt.claim.sub');}}
const own=fn=>role('authenticated',owner,fn),worker=fn=>role('service_role',null,fn);
const enqueue=(kind,id,version='stage2-rules-v1')=>own(async()=>(await q('select * from public.extraction_enqueue($1,$2,$3)',[kind,id,version]))[0]);
const claim=(n=1)=>worker(()=>q('select * from public.extraction_claim($1,180)',[n]));
const retry=id=>own(async()=>(await q('select * from public.extraction_retry($1)',[id]))[0]);
const finish=(j,r,state='succeeded',error=null,seconds=0)=>worker(()=>scalar('select public.extraction_finish($1,$2,$3,$4::jsonb,$5,$6)',[j.id,j.lease_token,state,JSON.stringify(r),error,seconds]));
async function input(note='Synthetic concert November 7, 2026',media=[]){return scalar("insert into public.manual_intakes(owner_id,note,media,submission_key) values($1,$2,$3::jsonb,$4) returning id",[owner,note,JSON.stringify(media),randomUUID()]);}
const media=(n=1,type='image/png')=>Array.from({length:n},(_,i)=>({storage_path:`${owner}/manual/${randomUUID()}/${String(i+1).padStart(2,'0')}-${'a'.repeat(64)}.${type==='application/pdf'?'pdf':'png'}`,mime_type:type,byte_count:24}));
async function resetJobs(){await q('delete from public.extraction_attempts');await q('delete from public.extraction_jobs');}
function result(j,{assetStatus='processed',complete=true,pages=1,textOverride,candidates=true}={}){
 const text=textOverride??j.input_snapshot.note??j.input_snapshot.caption??'';
 const units=[{assetId:'text',page:null,status:'processed',text,method:'provided-text',sha256:hash(text),issues:[]}];
 for(const a of j.input_snapshot.media)for(let page=1;page<=(a.mimeType==='application/pdf'?pages:1);page++)units.push({assetId:a.assetId,page:a.mimeType==='application/pdf'?page:null,...(a.mimeType==='application/pdf'?{expectedPages:pages}:{}),status:assetStatus,text:assetStatus==='processed'?'Synthetic flyer':'',method:a.mimeType==='application/pdf'?'pdf-text-and-ocr':'ocr',sha256:assetStatus==='blocked'?null:(a.sha256??'a'.repeat(64)),issues:[]});
 const item=candidates&&text?[{key:'synthetic',kind:'event',fields:{title:text},claims:[{field:'title',value:text,evidence:[{unitId:'text:0',start:0,end:text.length,quote:text}]}],issues:[]}]:[];
 return {version:'stage2-result-v1',units,candidates:item,issues:[],complete,stats:{processedAssets:new Set(units.filter(u=>u.assetId!=='text'&&u.status==='processed').map(u=>u.assetId)).size,expectedAssets:j.input_snapshot.media.length,processedPages:units.filter(u=>u.assetId!=='text'&&u.status==='processed').length,engine:'synthetic-sql-test',elapsedMs:1}};
}
const propose=(kind,a,b,reason='Synthetic explicit cross-link review')=>own(async()=>(await q('select * from public.reconciliation_propose($1,$2,$3,$4)',[kind,a,b,reason]))[0]);
const preview=id=>own(()=>scalar('select public.reconciliation_preview($1)',[id]));
const review=(j,action)=>own(async()=>(await q('select * from public.reconciliation_review($1,$2,$3)',[j.id,action,j.fingerprint]))[0]);
let captureA,captureB,programA,programB,occA,occB,ig;
async function occurrence(source,program,capture,changes={}){return scalar("insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,starts_at,ends_at,date_precision,timezone,status,capture_id,content_sha256) values($1,$2,$3,$4,$5,$6,'instant','America/New_York','scheduled',$7,repeat('d',64)) returning id",[owner,source,program,randomUUID(),changes.start??'2099-11-05T15:00:00Z',changes.end??'2099-11-05T16:00:00Z',capture]);}
try{
 await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
 const migrations=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();for(const f of migrations)await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await q('insert into auth.users(id) values($1),($2)',[owner,other]);await worker(()=>scalar('select public.configure_tracker_owner($1)',[owner]));
 await check('all migrations including CLI-generated Stage 2 schema execute on actual PostgreSQL',async()=>assert.ok(migrations.some(f=>f.endsWith('_stage2_evidence_jobs.sql'))));
 const rpcs={owner:['extraction_enqueue(text,uuid,text)','extraction_retry(uuid)','reconciliation_propose(text,uuid,uuid,text)','reconciliation_preview(uuid)','reconciliation_review(uuid,text,text)'],worker:['extraction_claim(integer,integer)','extraction_finish(uuid,uuid,text,jsonb,text,integer)']};
 await check('RPC grants separate owner and worker; anonymous has no execution and wrappers are invokers',async()=>{
  for(const [who,functions]of Object.entries(rpcs))for(const f of functions){for(const schema of ['public','tracker_private'])for(const r of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[r,schema+'.'+f]),r===(who==='owner'?'authenticated':'service_role'));assert.equal(await scalar('select prosecdef from pg_proc where oid=$1::regprocedure',['public.'+f]),false);assert.equal(await scalar("select proconfig @> array['search_path=\"\"'] from pg_proc where oid=$1::regprocedure",['tracker_private.'+f]),true);}
 });
 const firstInput=await input('Synthetic 🎻 concert tomorrow');let j=await enqueue('manual',firstInput);
 await check('enqueue snapshots owner input idempotently and never treats intake timestamp as publication',async()=>{assert.equal((await enqueue('manual',firstInput)).id,j.id);assert.equal(j.input_snapshot.note,'Synthetic 🎻 concert tomorrow');assert.equal(j.input_snapshot.publishedAt,null);assert.match(j.input_hash,/^[a-f0-9]{64}$/);assert.equal(await scalar('select count(*)::int from tracker_private.calendar_write_commands'),0);});
 await check('unsupported extractor versions cannot enter or strand the private work queue',async()=>{await assert.rejects(()=>enqueue('manual',firstInput,'unsupported-v99'),/unsupported extractor version/);assert.equal(await scalar('select count(*)::int from public.extraction_jobs'),1);});
 await check('owner can read jobs and other users/anonymous cannot read or enqueue owner inputs',async()=>{
  assert.equal(await own(()=>scalar('select count(*)::int from public.extraction_jobs')),1);assert.equal(await role('authenticated',other,()=>scalar('select count(*)::int from public.extraction_jobs')),0);
  await assert.rejects(()=>role('authenticated',other,()=>q('select * from public.extraction_enqueue($1,$2)', ['manual',firstInput])),/Not authorized/);
  await assert.rejects(()=>role('anon',null,()=>q('select * from public.extraction_jobs')),/permission denied/);
 });
 await check('clients and worker cannot directly mutate job or reconciliation tables',async()=>{for(const t of ['extraction_jobs','extraction_attempts','reconciliation_links','reconciliation_history']){assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+t]),true);for(const r of ['anon','authenticated','service_role'])for(const p of ['INSERT','UPDATE','DELETE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[r,'public.'+t,p]),false);}});
 await check('input identity and snapshot cannot be changed even through privileged accidental updates',async()=>{await assert.rejects(()=>q("update public.extraction_jobs set input_snapshot='{}' where id=$1",[j.id]),/immutable/);});
 j=(await claim())[0];
 await check('claim is leased and sequential duplicate claims exclude the active job',async()=>{assert.equal(j.attempts,1);assert.equal(j.state,'processing');assert.match(j.lease_token,/^[a-f0-9-]{36}$/);assert.equal((await claim()).length,0);});
 await check('successful text extraction retains exact UTF16 evidence including supplementary characters',async()=>{const r=result(j);await finish(j,r);assert.equal(await scalar('select state from public.extraction_jobs where id=$1',[j.id]),'succeeded');assert.deepEqual(await scalar('select result from public.extraction_jobs where id=$1',[j.id]),r);});
 await resetJobs();j=(await (async()=>{await enqueue('manual',await input('Synthetic evidence'));return claim();})())[0];
 await check('unsupported claims and changed provided text are rejected without releasing the lease',async()=>{
  const r=result(j);r.candidates[0].claims[0].evidence[0].quote='Fabricated';await assert.rejects(()=>finish(j,r),/Evidence span/);
  const r2=result(j,{textOverride:'Forged retained source'});await assert.rejects(()=>finish(j,r2),/retained input/);
  const r3=result(j);r3.candidates[0].fields.location='Invented room';await assert.rejects(()=>finish(j,r3),/lacks evidence/);
  assert.equal(await scalar('select state from public.extraction_jobs where id=$1',[j.id]),'processing');
 });
 await finish(j,result(j));await resetJobs();
 await check('every supplied image is retained in order and must be accounted for before completion',async()=>{
  const target=await input('Two synthetic slides',media(2));const enqueued=await enqueue('manual',target);assert.deepEqual(enqueued.input_snapshot.media.map(a=>a.assetId),['1','2']);j=(await claim())[0];
  const missing=result(j);missing.units.pop();await assert.rejects(()=>finish(j,missing),/accounted for/);
  const bad=result(j);bad.units[1].sha256='b'.repeat(64);await assert.rejects(()=>finish(j,bad),/hash differs/);
  await finish(j,result(j));assert.equal(await scalar('select visual_pages from public.extraction_attempts where job_id=$1',[j.id]),2);
 });
 await resetJobs();
 await check('partial media and blocked hashes cannot masquerade as successful or complete extraction',async()=>{
  await enqueue('manual',await input('One unavailable slide',media()));j=(await claim())[0];const r=result(j,{assetStatus:'blocked',complete:false});
  await assert.rejects(()=>finish(j,r),/Incomplete media/);await finish(j,r,'partial','media_unavailable',120);
  assert.equal(await scalar('select state from public.extraction_jobs where id=$1',[j.id]),'partial');assert.equal(await scalar('select visual_pages from public.extraction_attempts where job_id=$1',[j.id]),0);
  await assert.rejects(()=>retry(j.id),/retry unavailable/);
 });
 await resetJobs();
 await check('daily new-job cap is two and text work has zero visual-page reservation',async()=>{
  for(let i=0;i<3;i++)await enqueue('manual',await input('Synthetic budget '+i));for(let i=0;i<2;i++){const c=(await claim())[0];assert.equal(c.visual_page_budget,0);await finish(c,result(c));}assert.equal((await claim()).length,0);
 });
 await resetJobs();
 await check('daily 12 visual page cap is shared and blocked PDF pages remain explicitly accounted',async()=>{
  await enqueue('manual',await input('Synthetic PDF',media(1,'application/pdf')));j=(await claim())[0];assert.equal(j.visual_page_budget,12);const missingLast=result(j,{pages:12});missingLast.units.pop();missingLast.stats.processedPages=11;await assert.rejects(()=>finish(j,missingLast),/PDF page sequence/);await finish(j,result(j,{pages:12}));
  await enqueue('manual',await input('Later image',media()));assert.equal((await claim()).length,0);
  const text=await enqueue('manual',await input('Text is still within remaining job count'));const textClaim=(await claim())[0];assert.equal(textClaim.id,text.id);await finish(textClaim,result(textClaim));
 });
 await resetJobs();
 await check('lease expiry is fenced, audited and conservatively charges an unknown visual attempt',async()=>{
  await enqueue('manual',await input('Expired image',media()));j=(await claim())[0];await q("update public.extraction_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id]);await assert.rejects(()=>finish(j,result(j)),/Stale extraction lease/);assert.equal((await claim()).length,0);
  assert.equal(await scalar('select state from public.extraction_attempts where job_id=$1',[j.id]),'expired');assert.equal(await scalar('select visual_pages from public.extraction_attempts where job_id=$1',[j.id]),12);
 });
 await resetJobs();
 await check('explicit retries retain input identity, honor retry floors and stop at three attempts',async()=>{
  const target=await enqueue('manual',await input('Retry fixture'));let previous;
  for(let i=1;i<=3;i++){const c=(await claim())[0];assert.equal(c.id,target.id);assert.equal(c.attempts,i);if(previous)await assert.rejects(()=>finish(previous,result(previous)),/Stale extraction lease/);await finish(c,result(c,{complete:false}),'failed','synthetic_error',180);if(i<3){await assert.rejects(()=>retry(c.id),/retry unavailable/);await q("update public.extraction_jobs set retry_not_before=now()-interval '1 second' where id=$1",[c.id]);await retry(c.id);}previous=c;}
  await q("update public.extraction_jobs set retry_not_before=now()-interval '1 second' where id=$1",[target.id]);await assert.rejects(()=>retry(target.id),/retry unavailable/);assert.equal((await claim()).length,0);
 });
 await resetJobs();
 await check('unknown native visual work conservatively charges the full reservation without inventing pages',async()=>{
  await enqueue('manual',await input('Unknown native work',media()));const c=(await claim())[0];const r=result(c,{assetStatus:'blocked',complete:false});r.stats.visualWorkUncertain=true;
  const bad=structuredClone(r);bad.complete=true;await assert.rejects(()=>finish(c,bad),/Unconfirmed visual work/);
  await finish(c,r,'failed','native_work_unconfirmed');assert.equal(await scalar('select visual_pages from public.extraction_attempts where job_id=$1',[c.id]),12);
  await enqueue('manual',await input('Next visual work',media()));assert.equal((await claim()).length,0);
 });
 await resetJobs();
 await check('blocked pages attempted before a native deadline still consume the daily visual budget',async()=>{
  await enqueue('manual',await input('Deadline after attempted PDF pages',media(1,'application/pdf')));const c=(await claim())[0];const r=result(c,{assetStatus:'blocked',complete:false,pages:12});for(const u of r.units)if(u.assetId!=='text')u.attempted=true;
  await finish(c,r,'partial','native_deadline');assert.equal(await scalar('select visual_pages from public.extraction_attempts where job_id=$1',[c.id]),12);assert.equal(await scalar("select result->'stats'->>'processedPages' from public.extraction_jobs where id=$1",[c.id]),'0');
  await enqueue('manual',await input('No uncharged native retry',media()));assert.equal((await claim()).length,0);
 });
 await resetJobs();
 await check('a blocked multi-page PDF retains every declared page without claiming extraction success',async()=>{
  await enqueue('manual',await input('Blocked PDF pages',media(1,'application/pdf')));const c=(await claim())[0];const r=result(c,{assetStatus:'blocked',complete:false,pages:128});await finish(c,r,'partial','pdf_unavailable');assert.equal(await scalar('select jsonb_array_length(result->\'units\') from public.extraction_jobs where id=$1',[c.id]),129);
 });
 await resetJobs();
 await check('the last expired attempt is made terminal instead of remaining stuck in processing',async()=>{
  const target=await enqueue('manual',await input('Last attempt expiry'));let last;
  for(let i=1;i<=3;i++){last=(await claim())[0];if(i<3){await finish(last,result(last,{complete:false}),'failed','synthetic_error');await q("update public.extraction_jobs set retry_not_before=now()-interval '1 second' where id=$1",[last.id]);await retry(last.id);}}
  await q("update public.extraction_jobs set lease_until=now()-interval '1 second' where id=$1",[target.id]);assert.equal((await claim()).length,0);assert.equal(await scalar('select state from public.extraction_jobs where id=$1',[target.id]),'failed');assert.equal(await scalar('select lease_token from public.extraction_jobs where id=$1',[target.id]),null);await assert.rejects(()=>retry(target.id),/retry unavailable/);
 });
 await resetJobs();
 for(const id of ['stage2-source-a','stage2-source-b'])await q("insert into public.sources(id,owner_id,name,adapter,url,enabled,coverage_note) values($1,$2,$1,'synthetic-stage2','https://calendar.fsu.edu/',false,'Synthetic SQL fixture; never enabled')",[id,owner]);
 for(const [s,n]of [['stage2-source-a','a'],['stage2-source-b','b']]){const cap=await scalar("insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until) values($1,$2,$3,'https://calendar.fsu.edu/',repeat('a',64),'text/plain',2,'synthetic-stage2',now(),now(),now()+interval '1 day') returning id",[owner,s,n]);const p=await scalar("insert into public.opportunities(owner_id,source_id,native_id,title,source_url,capture_id,content_sha256) values($1,$2,$3,'Synthetic recurring event','https://calendar.fsu.edu/',$4,repeat('b',64)) returning id",[owner,s,n,cap]);if(n==='a'){captureA=cap;programA=p;}else{captureB=cap;programB=p;}}
 ig=await scalar("insert into public.instagram_updates(owner_id,source_id,native_id,content_hash,capture_id,caption,published_at,permalink,media_type,children,children_complete,evidence_pointer,first_seen_at,last_seen_at) values($1,'stage2-source-a','18000000000000001',repeat('c',64),$2,'Synthetic caption tomorrow','2026-10-20T18:00Z','https://www.instagram.com/p/Synthetic123/','CAROUSEL_ALBUM','[{\"native_id\":\"18000000000000002\",\"media_type\":\"IMAGE\",\"position\":0},{\"native_id\":\"18000000000000003\",\"media_type\":\"IMAGE\",\"position\":1}]',true,'/posts/0',now(),now()) returning id",[owner,captureA]);
 await check('retained Instagram caption preserves publication context and missing carousel images stay partial',async()=>{
  const queued=await enqueue('instagram',ig);assert.equal(new Date(queued.input_snapshot.publishedAt).toISOString(),'2026-10-20T18:00:00.000Z');assert.equal(queued.input_snapshot.media.length,2);assert.ok(queued.input_snapshot.media.every(m=>m.available===false&&!('storagePath'in m)));
  j=(await claim())[0];await assert.rejects(()=>finish(j,result(j)),/Instagram media bytes/);await finish(j,result(j,{assetStatus:'blocked',complete:false}),'partial','media_unavailable');
 });
 occA=await occurrence('stage2-source-a',programA,captureA);occB=await occurrence('stage2-source-b',programB,captureB);
 await own(()=>scalar('select public.record_review_decision($1,\'save\',1)',[occA]));await own(()=>scalar('select public.record_review_decision($1,\'reject\',1)',[occB]));
 let link=await propose('occurrence',occA,occB);
 await check('reconciliation fingerprints do not depend on caller timezone',async()=>{await db.exec("set timezone='Pacific/Auckland'");assert.equal((await preview(link.id)).currentFingerprint,link.fingerprint);await db.exec("set timezone='UTC'");});
 await check('cross-source proposals are idempotent and surface opposing decisions without mutating either native record',async()=>{assert.equal((await propose('occurrence',occB,occA)).id,link.id);const p=await preview(link.id);assert.equal(p.relatedDecisions.length,2);assert.match(p.warnings.join(' '),/Conflicting/);assert.equal(await scalar('select count(*)::int from public.user_decisions'),2);});
 await check('confirmed relation can be revoked with append-only history and retained source decisions',async()=>{link=await review(link,'confirm');assert.equal(link.state,'confirmed');link=await review(link,'revoke');assert.equal(link.state,'revoked');assert.deepEqual((await q('select action from public.reconciliation_history where link_id=$1 order by created_at,id',[link.id])).map(r=>r.action),['propose','confirm','revoke']);assert.equal(await scalar('select count(*)::int from public.user_decisions'),2);});
 await check('same-source GBMs, different performances and changed source facts cannot be confirmed as aliases',async()=>{
  const same=await occurrence('stage2-source-a',programA,captureA);await assert.rejects(()=>propose('occurrence',occA,same),/Same-source/);
  const later=await occurrence('stage2-source-b',programB,captureB,{start:'2099-11-06T15:00Z',end:'2099-11-06T16:00Z'});const p=await propose('occurrence',occA,later);await assert.rejects(()=>review(p,'confirm'),/Different or unknown/);
  const changedA=await occurrence('stage2-source-a',programA,captureA),changedB=await occurrence('stage2-source-b',programB,captureB);const c=await propose('occurrence',changedA,changedB);await q("update public.occurrences set location='Changed venue' where id=$1",[changedA]);await assert.rejects(()=>review(c,'confirm'),/facts changed/);
 });
 await check('parent title revision and source facts participate in occurrence reconciliation fingerprints',async()=>{
  const a=await occurrence('stage2-source-a',programA,captureA),b=await occurrence('stage2-source-b',programB,captureB),p=await propose('occurrence',a,b);
  const before=await preview(p.id);assert.equal(before.currentFacts.left.opportunity.title,'Synthetic recurring event');
  await q("update public.opportunities set title='Changed parent title',revision=revision+1 where id=$1",[programA]);
  const after=await preview(p.id);assert.notEqual(after.currentFingerprint,p.fingerprint);assert.match(after.warnings.join(' '),/Source facts changed/);await assert.rejects(()=>review(p,'confirm'),/facts changed/);
 });
 const cipher='v1.'+'a'.repeat(16)+'.'+'b'.repeat(22)+'.'+'c'.repeat(32);await own(()=>scalar("select public.calendar_connection_put_scoped($1,null,'https://www.googleapis.com/auth/calendar.events.owned',true)",[cipher]));
 const calendarApprove=async id=>own(async()=>{const p=await scalar("select public.calendar_write_preview('occurrence',$1)",[id]);return scalar("select public.calendar_write_approve('occurrence',$1,$2)",[id,p.fingerprint]);});
 await check('calendar approval for one confirmed alias prevents another alias command without provider calls',async()=>{
  const a=await occurrence('stage2-source-a',programA,captureA),b=await occurrence('stage2-source-b',programB,captureB);const p=await propose('occurrence',a,b);await review(p,'confirm');const command=await calendarApprove(a);assert.equal(command.state,'pending');const aliasPreview=await own(()=>scalar("select public.calendar_write_preview('occurrence',$1)",[b]));assert.equal(aliasPreview.canApprove,false);assert.equal(aliasPreview.blockedReason,'confirmed_alias_approved');assert.equal(aliasPreview.relatedCalendarApprovalId,command.id);await assert.rejects(()=>calendarApprove(b),/approval already exists|future scheduled/);assert.equal(await scalar('select count(*)::int from tracker_private.calendar_write_commands'),1);assert.ok((await preview(p.id)).relatedCalendarApprovals===1);
 });
 await check('relations cannot combine two existing calendar commands; their immutable payloads survive',async()=>{
  const a=await occurrence('stage2-source-a',programA,captureA),b=await occurrence('stage2-source-b',programB,captureB);const ca=await calendarApprove(a),cb=await calendarApprove(b);const p=await propose('occurrence',a,b);await assert.rejects(()=>review(p,'confirm'),/manual review/);for(const before of [ca,cb]){const after=await own(()=>scalar('select public.calendar_write_get($1)',[before.id]));assert.deepEqual(after.payload,before.payload);assert.equal(after.providerEventId,before.providerEventId);assert.equal(Date.parse(after.approvedAt),Date.parse(before.approvedAt));}
 });
 await check('other authenticated users cannot read relation history or private previews',async()=>{assert.equal(await role('authenticated',other,()=>scalar('select count(*)::int from public.reconciliation_links')),0);assert.equal(await role('authenticated',other,()=>scalar('select count(*)::int from public.reconciliation_history')),0);await assert.rejects(()=>role('authenticated',other,()=>scalar('select public.reconciliation_preview($1)',[link.id])),/Not authorized/);});
 await check('extraction leaves normalized fact counts, review decisions and all source enablement unchanged',async()=>{assert.equal(await scalar('select count(*)::int from public.opportunities'),2);assert.equal(await scalar('select count(*)::int from public.user_decisions'),2);assert.equal(await scalar("select count(*)::int from public.sources where id like 'stage2-%' and enabled"),0);});
 const report={recordedAt:new Date().toISOString(),command:'node scripts/test-stage2-database.mjs',engine:'PGlite 0.5.10 actual PostgreSQL WASM',migrations,passed:checks.length,checks,fixtureClass:'Synthetic metadata, text, media hashes, source facts, owner/local SQL claims and encrypted-envelope-shaped string. Actual migrations, SQL/RLS/RPCs; no hosted Auth/Storage/provider emulation.',calendarProviderCalls:0,paidServices:0,limits:{newJobsPerOwnerUtcDay:2,visualPagesPerOwnerUtcDay:12,attemptsPerJob:3,jobResultBytes:524288},notTested:['Hosted migration/RLS','Signed-JWT or Storage HTTP','Independent simultaneous PostgreSQL sessions','Real OCR/PDF correctness','Actual calendar insertion','Human-labeled extraction quality']};
 await writeFile('reports/stage-2-database-tests.json',JSON.stringify(report,null,2)+'\n');console.log(`${checks.length} Stage 2 SQL checks passed; no provider calls.`);
}finally{await db.close();}
