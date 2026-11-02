/** Fresh public collection + production ingestion + real migrated local PostgreSQL.
 * Storage below is explicitly an immutable in-memory substitute, not hosted HTTP.
 * Run: node --import tsx scripts/test-stage1-reingestion.mjs --fetch-live
 * Repeat without --fetch-live to replay the private captures from that attempt.
 */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { collectSource } from '../lib/collection/index.ts';
import { ingestCollectedBatch } from '../lib/ingestion/index.ts';

const sourceIds=['fsu-calendar-api','fsu-music-events'];
const live=process.argv.includes('--fetch-live');
const privateDir='private/stage1-reingestion-live';
const owner='11111111-1111-4111-8111-111111111111';
let db;
const checks=[];
const objects=new Map();
let uploads=0,reused=0,verifiedDownloads=0;
const query=async(q,p=[]) => (await db.query(q,p)).rows;
const scalar=async(q,p=[]) => Object.values((await query(q,p))[0])[0];
async function role(name,id,fn){
  await db.exec(`set role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
  try{return await fn();}finally{await db.exec('reset role; reset request.jwt.claim.sub');}
}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const client={
  storage:{from(bucket){assert.equal(bucket,'captures');return {
    async upload(path,body,options){assert.equal(options.upsert,false);if(objects.has(path)){reused++;return {data:null,error:{statusCode:'409',message:'The resource already exists'}};}objects.set(path,Buffer.from(body));uploads++;return {data:{path},error:null};},
    async download(path){verifiedDownloads++;return objects.has(path)?{data:new Blob([objects.get(path)]),error:null}:{data:null,error:{statusCode:'404',message:'Missing fixture object'}};},
  };}},
  async rpc(name,args){assert.equal(name,'complete_source_run');try{return {data:await role('service_role',null,()=>scalar('select public.complete_source_run($1,$2,$3::jsonb)',[args.p_source_id,args.p_lease_token,JSON.stringify(args.p_batch)])),error:null};}catch(e){return {data:null,error:{code:e.code||'fixture_sql_error'}};}},
};
async function lease(id){
  await query('update public.sources set enabled=(id=$1) where adapter in (\'localist-v1\',\'music-v1\',\'hq-ics-v1\')',[id]);
  await query("update public.sources set next_due_at=now()-interval '1 hour',next_poll_at=now()-interval '1 hour',retry_not_before=null where id=$1",[id]);
  const [row]=await role('service_role',null,()=>query('select * from public.lease_due_sources(1,600)'));
  assert.equal(row?.id,id);return row;
}
async function counts(id){return scalar("select jsonb_build_object('captures',(select count(*) from public.captures where source_id=$1),'opportunities',(select count(*) from public.opportunities where source_id=$1),'occurrences',(select count(*) from public.occurrences where source_id=$1),'versions',(select count(*) from public.entity_versions v join public.captures c on c.id=v.capture_id where c.source_id=$1),'claims',(select count(*) from public.field_claims f join public.captures c on c.id=f.capture_id where c.source_id=$1),'decisions',(select count(*) from public.user_decisions d join public.occurrences o on o.id=d.occurrence_id where o.source_id=$1))",[id]);}
const batches=[];
const sourceReports=[];
try{
  await mkdir(privateDir,{recursive:true,mode:0o700});
  for(const id of sourceIds){
    const file=`${privateDir}/${id}.json`;
    const batch=live?await collectSource(id,{startDate:'2026-11-02',days:7}):JSON.parse(await readFile(file,'utf8'));
    if(live)await writeFile(file,JSON.stringify(batch,null,2)+'\n',{mode:0o600});
    batches.push(batch);
    sourceReports.push({sourceId:id,fetchStartedAt:batch.startedAt,fetchFinishedAt:batch.finishedAt,outcome:batch.status,reason:batch.reason,requests:batch.observations.requests,responseBytes:batch.observations.bytes,captures:batch.pages.length,nativeRows:batch.observations.nativeRows,opportunities:batch.opportunities.length,occurrences:batch.occurrences.length,paginationComplete:batch.observations.paginationComplete,windowFrom:batch.observations.windowFrom,windowTo:batch.observations.windowTo,bodyHashes:batch.pages.map(p=>p.sha256),privateCapture:file});
  }
  let prior=[];
  try{const previous=JSON.parse(await readFile('reports/stage-1-reingestion-live-fetch.json','utf8'));prior=previous.attemptHistory??[{recordedAt:previous.recordedAt,evidenceClass:previous.evidenceClass,sources:previous.sources}];}catch{/* First run. */}
  const attempt={recordedAt:new Date().toISOString(),evidenceClass:live?'fresh-live-read-only-public-fetch':'private-capture-replay-no-new-http',publicHttpAttemptsThisCommand:live?sourceReports.reduce((n,s)=>n+s.requests,0):0,sources:sourceReports};
  await writeFile('reports/stage-1-reingestion-live-fetch.json',JSON.stringify({...attempt,attemptHistory:[...prior,attempt],calendarWrites:0,paidConnectors:0,modelCalls:0},null,2)+'\n');
  for(const batch of batches){assert.equal(batch.status,'success',`${batch.sourceId}: failed collection is not an empty success`);assert.ok(batch.observations.paginationComplete);assert.ok(batch.occurrences.length>=2,'At least two real occurrences required for opposite decisions');}
  db=new PGlite();
  await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
  const migrations=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrations)await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  await query('insert into auth.users(id) values($1)',[owner]);
  await role('service_role',null,()=>query('select public.configure_tracker_owner($1)',[owner]));
  const provenance={invocationKind:'replay',triggerRunId:'run_synthetic_stage1_reingestion'};
  const summaries=[];
  for(const batch of batches){
    await check(`${batch.sourceId}: captured real public facts enter production ingestion and actual SQL`,async()=>{
      await ingestCollectedBatch(await lease(batch.sourceId),batch,client,provenance);
      assert.equal(await scalar('select count(*)::integer from public.occurrences where source_id=$1',[batch.sourceId]),batch.occurrences.length);
    });
    const occurrenceRows=await query('select id,native_id,revision from public.occurrences where source_id=$1 order by native_id,id',[batch.sourceId]);
    const [one,two]=occurrenceRows;
    const decisions=[];
    await check(`${batch.sourceId}: opposite occurrence decisions are recorded through the owner RPC`,async()=>{
      for(const [row,action] of [[one,'save'],[two,'reject']])decisions.push(await role('authenticated',owner,()=>scalar('select public.record_review_decision($1,$2,$3)',[row.id,action,row.revision])));
    });
    const baseline=await counts(batch.sourceId),runCount=await scalar('select count(*)::integer from public.source_runs where source_id=$1',[batch.sourceId]);
    await check(`${batch.sourceId}: three repeated complete collections preserve UUIDs, versions and evidence`,async()=>{
      for(let n=0;n<3;n++)await ingestCollectedBatch(await lease(batch.sourceId),batch,client,provenance);
      assert.deepEqual(await counts(batch.sourceId),baseline);
      assert.deepEqual(await query('select id,native_id,revision from public.occurrences where source_id=$1 order by native_id,id',[batch.sourceId]),occurrenceRows);
      assert.equal(await scalar('select count(*)::integer from public.source_runs where source_id=$1',[batch.sourceId]),runCount+3);
    });
    await check(`${batch.sourceId}: saved and passed choices survive while other occurrences stay undecided`,async()=>{
      const rows=await role('authenticated',owner,()=>query('select id,decision from public.review_inbox where source_id=$1',[batch.sourceId]));
      assert.equal(rows.find(r=>r.id===one.id).decision,'save');assert.equal(rows.find(r=>r.id===two.id).decision,'reject');
      assert.equal(rows.filter(r=>r.decision===null).length,rows.length-2);
      for(const decision of decisions)assert.equal(await scalar('select count(*)::integer from public.user_decisions where id=$1',[decision.decision_id]),1);
    });
    summaries.push({sourceId:batch.sourceId,initialAndReplayRuns:runCount+3,...baseline});
  }
  await check('core immutable Storage retries verify existing response bytes instead of overwriting',async()=>{assert.ok(uploads>0);assert.equal(reused,verifiedDownloads);assert.ok(reused>0);assert.equal(objects.size,uploads);});
  let audit;
  await check('the rollback-only hosted audit executes unchanged against populated real local PostgreSQL',async()=>{
    const before=await scalar("select jsonb_build_object('sources',(select count(*) from public.sources),'decisions',(select count(*) from public.user_decisions),'runs',(select count(*) from public.source_runs),'commands',(select count(*) from tracker_private.calendar_write_commands))");
    const result=await db.exec(await readFile('scripts/hosted-stage1-reingestion-check.sql','utf8'));
    audit=result.flatMap(r=>r.rows).find(r=>r.stage1_reingestion_audit)?.stage1_reingestion_audit;
    assert.ok(audit);assert.equal(audit.passed,14);
    assert.deepEqual(await scalar("select jsonb_build_object('sources',(select count(*) from public.sources),'decisions',(select count(*) from public.user_decisions),'runs',(select count(*) from public.source_runs),'commands',(select count(*) from tracker_private.calendar_write_commands))"),before);
  });
  const report={recordedAt:new Date().toISOString(),command:`node --import tsx scripts/test-stage1-reingestion.mjs${live?' --fetch-live':''}`,
    evidenceClass:'Real public captures replayed through production ingestion and actual PGlite PostgreSQL; synthetic rollback audit separate',
    database:'PGlite 0.5.10 PostgreSQL WASM; test Auth/Storage compatibility shell',freshPublicFetchesThisCommand:live,publicHttpAttemptsThisCommand:live?sourceReports.reduce((n,s)=>n+s.requests,0):0,
    migrations,passed:checks.length,checks,sourceReports,summaries,storage:{implementation:'in-memory immutable substitute',uploads,reuses:reused,verifiedDownloads,hostedHttpTested:false},
    syntheticRollbackAudit:audit,calendarProviderCalls:0,calendarCommands:await scalar('select count(*)::integer from tracker_private.calendar_write_commands'),
    paidConnectors:0,modelCalls:0,limitations:['No signed-JWT or hosted Storage HTTP proof','No independent simultaneous PostgreSQL sessions; sequential lease fencing and expiry recovery only','Synthetic change/failure cases are SQL fixtures, not altered live source evidence','No Trigger Cloud or laptop-off proof','No real user decisions changed; local owner is synthetic']};
  await writeFile('reports/stage-1-reingestion-recovery.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,syntheticSqlChecks:audit.passed,sourceSummaries:summaries,uploads,reused,verifiedDownloads,calendarProviderCalls:0},null,2));
}finally{if(db)await db.close();}
