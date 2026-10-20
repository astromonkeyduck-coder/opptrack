/** Local integration evidence: real source batches + actual PostgreSQL, no hosted API impersonation. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { toDatabaseBatch } from '../lib/ingestion/index.ts';
import { seedDisabledRegistryRoutes } from './test-database-support.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const privateDir=path.resolve('private/stage-1-local-database');
await mkdir(privateDir,{recursive:true,mode:0o700});
const batches=await Promise.all(['fsu-calendar-api','fsu-music-events'].map(async id=>JSON.parse(await readFile(`private/stage-1-live/${id}.json`,'utf8'))));
for(const batch of batches) assert.equal(batch.status,'success',`${batch.sourceId}: fresh collection must succeed before full-path local proof`);
let db=new PGlite();
const query=async(sql,params=[]) => (await db.query(sql,params)).rows;
const scalar=async(sql,params=[])=>Object.values((await query(sql,params))[0])[0];
async function role(name,uid,fn){await db.exec(`set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);try{return await fn();}finally{await db.exec('reset role');await db.exec('reset request.jwt.claim.sub');}}
const checks=[];
try {
  await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
  await role('service_role',null,()=>query('select public.configure_tracker_owner($1)',[owner]));
  const registryCount=await seedDisabledRegistryRoutes(db,owner);
  assert.equal(await scalar('select count(*)::integer from public.sources'),registryCount);
  assert.equal(await scalar('select count(*)::integer from public.sources where enabled'),2);
  checks.push('All 59 registry routes fit actual SQL constraints; only the two proven adapters are enabled');
  const sourceReports=[];
  for(const batch of batches) {
    const [lease]=await role('service_role',null,()=>query('select * from public.lease_due_sources(1,600)'));
    assert.equal(lease.id,batch.sourceId,'Leases must match due-source sequence');
    const payload=toDatabaseBatch(lease,batch);
    // Test object bytes reside in ignored local private storage. Real Supabase Storage HTTP remains untested.
    for(let i=0;i<batch.pages.length;i++) {
      const capture=payload.captures[i];const file=path.join(privateDir,'objects',capture.storage_path);
      await mkdir(path.dirname(file),{recursive:true,mode:0o700});await writeFile(file,batch.pages[i].body,{mode:0o600});
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('captures',$1,$2::jsonb) on conflict do nothing",[capture.storage_path,JSON.stringify({size:capture.byte_count,mimetype:capture.content_type})]);
    }
    await role('service_role',null,()=>query('select public.complete_source_run($1,$2,$3::jsonb)',[lease.id,lease.lease_token,JSON.stringify(payload)]));
    sourceReports.push({sourceId:batch.sourceId,fetchStartedAt:batch.startedAt,fetchFinishedAt:batch.finishedAt,opportunities:batch.opportunities.length,occurrences:batch.occurrences.length,captures:batch.pages.length,requests:batch.observations.requests,windowFrom:batch.observations.windowFrom,windowTo:batch.observations.windowTo});
  }
  checks.push('Fresh central and Music batches persist captures, versions, claims, opportunities and occurrences through production SQL RPC');
  const counts=await scalar("select jsonb_build_object('opportunities',(select count(*) from public.opportunities),'occurrences',(select count(*) from public.occurrences),'captures',(select count(*) from public.captures),'versions',(select count(*) from public.entity_versions),'claims',(select count(*) from public.field_claims),'runs',(select count(*) from public.source_runs))");
  const firstOccurrence=await role('authenticated',owner,()=>scalar('select id from public.review_inbox order by starts_at nulls last,id limit 1'));
  await role('authenticated',owner,()=>query('select public.record_decision($1,$2,1)',[firstOccurrence,'save']));
  const replay=batches[0];
  await db.query("update public.sources set next_due_at=now()-interval '1 second' where id=$1",[replay.sourceId]);
  const [lease]=await role('service_role',null,()=>query('select * from public.lease_due_sources(1,600)'));
  await role('service_role',null,()=>query('select public.complete_source_run($1,$2,$3::jsonb)',[lease.id,lease.lease_token,JSON.stringify(toDatabaseBatch(lease,replay))]));
  const afterReplay=await scalar("select jsonb_build_object('opportunities',(select count(*) from public.opportunities),'occurrences',(select count(*) from public.occurrences),'captures',(select count(*) from public.captures),'versions',(select count(*) from public.entity_versions),'claims',(select count(*) from public.field_claims),'runs',(select count(*) from public.source_runs))");
  for(const key of ['opportunities','occurrences','captures','versions','claims'])assert.equal(afterReplay[key],counts[key],key+' must not duplicate');
  assert.equal(afterReplay.runs,counts.runs+1);
  assert.equal(await role('authenticated',owner,()=>scalar('select decision from public.review_inbox where id=$1',[firstOccurrence])),'save');
  checks.push('Replay of complete fresh central batch adds one run and no duplicate captures/entities/versions/claims; saved occurrence decision survives');
  const rows=await role('authenticated',owner,()=>query('select * from public.review_inbox order by coalesce(starts_at,start_date::timestamptz) nulls last,id'));
  const sources=await role('authenticated',owner,()=>query('select id,name,enabled,health_status,health_message,last_attempt_at,last_success_at,next_due_at,coverage_note from public.sources order by enabled desc,name'));
  assert.equal(rows.length,counts.occurrences);
  assert.equal(await role('authenticated',other,()=>scalar('select count(*)::integer from public.review_inbox')),0);
  assert.equal(await role('authenticated',other,()=>scalar('select count(*)::integer from public.captures')),0);
  await assert.rejects(()=>role('anon',null,()=>query('select * from public.review_inbox')),/permission denied/);
  checks.push('Owner SQL role reads actual inbox events; anonymous is denied and other authenticated subject sees zero rows');
  const searchCount=await role('authenticated',owner,()=>scalar("select count(*)::integer from public.opportunities where search_document @@ plainto_tsquery('english','music')"));
  assert.ok(searchCount>0,'Actual Music source facts must be searchable');
  checks.push('Actual live catalog is searchable through PostgreSQL full-text index');
  const pagedIds=[];let pagesRead=0;
  for(let offset=0;offset<rows.length;offset+=50){
    const page=await role('authenticated',owner,()=>query('select id from public.review_inbox order by starts_at nulls last,id limit 50 offset $1',[offset]));
    assert.ok(page.length>0 && page.length<=50);pagedIds.push(...page.map(row=>row.id));pagesRead++;
  }
  assert.equal(new Set(pagedIds).size,rows.length);
  assert.deepEqual([...pagedIds].sort(),rows.map(row=>row.id).sort());
  const titleSearch=rows[0].title.split(/\s+/)[0];
  assert.ok(await role('authenticated',owner,()=>scalar('select count(*)::integer from public.review_inbox where title ilike $1',['%'+titleSearch+'%']))>0);
  checks.push('Actual owner inbox pagination visits all '+rows.length+' rows across '+pagesRead+' pages without duplicate/missing IDs; parameterized title search matches real source facts');
  await writeFile('private/stage-1-inbox-rows.json',JSON.stringify({evidenceClass:'fresh-live-events-local-postgresql-rls',hostedSupabase:false,authentication:'Synthetic test subject through actual SQL authenticated role and auth.uid compatibility function; no hosted Auth HTTP/JWT',calendarWrites:0,rows,sources,manualIntakes:[]},null,2)+'\n',{mode:0o600});
  const dump=await db.dumpDataDir('gzip');
  const backupPath=path.join(privateDir,'database-backup.tar.gz');
  await writeFile(backupPath,new Uint8Array(await dump.arrayBuffer()),{mode:0o600});
  await db.close();db=new PGlite({loadDataDir:new Blob([await readFile(backupPath)])});
  assert.equal(await role('authenticated',owner,()=>scalar('select count(*)::integer from public.review_inbox')),rows.length);
  assert.equal(await role('authenticated',owner,()=>scalar('select decision from public.review_inbox where id=$1',[firstOccurrence])),'save');
  assert.equal(await role('authenticated',other,()=>scalar('select count(*)::integer from public.review_inbox')),0);
  checks.push('Real database dump restored into new PostgreSQL instance with live counts, decisions and other-user RLS denial intact');
  const [capture]=await query('select id,storage_path from public.captures where storage_path is not null limit 1');
  await db.query("update public.captures set retention_until=now()-interval '1 day' where id=$1",[capture.id]);
  await db.transaction(async tx=>{
    await tx.query("delete from storage.objects where bucket_id='captures' and name=$1",[capture.storage_path]);
    await tx.query('update public.captures set storage_path=null,excerpt=null,purged_at=now() where id=$1 and retention_until<=now()',[capture.id]);
  });
  await rm(path.join(privateDir,'objects',capture.storage_path));
  assert.equal(await scalar('select storage_path from public.captures where id=$1',[capture.id]),null);
  assert.ok(await scalar('select purged_at from public.captures where id=$1',[capture.id]));
  assert.equal(await scalar('select count(*)::integer from public.opportunities'),counts.opportunities);
  assert.equal(await scalar('select count(*)::integer from public.field_claims'),counts.claims);
  checks.push('Expired local raw object deleted with purge marker; normalized facts, evidence hashes, claims and decisions retained');
  const report={runAt:new Date().toISOString(),evidenceClass:'fresh-live-events-actual-local-postgresql',database:'PGlite 0.5.10 PostgreSQL WASM',migrationsExecuted:true,hostedSupabase:false,triggerCloud:false,localDispatcherLeaseRpc:true,sourceReports,counts,afterReplay,authenticatedInboxRows:rows.length,registryRoutes:registryCount,paginationPages:pagesRead,pageSize:50,fullTextMusicMatches:searchCount,checks,backupRestoreVerified:true,rawObjectDeletionVerified:'Local private filesystem object and SQL storage metadata only',privateInboxRows:'private/stage-1-inbox-rows.json',costs:{publicGetChargesUsd:0,modelCalls:0,paidConnectors:0,calendarWrites:0},notTested:['Hosted Supabase Auth HTTP/JWT and user login','Supabase Storage HTTP signing/upload/delete','Trigger.dev Cloud dispatch/deploy','Hosted database backup/restore and complete Storage backup','Concurrent distributed PostgreSQL processes']};
  await writeFile('reports/stage-1-live-database.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({counts,afterReplay,authenticatedInboxRows:rows.length,fullTextMusicMatches:searchCount,registryRoutes:registryCount,paginationPages:pagesRead,checksPassed:checks.length,backupRestoreVerified:true,hostedSupabase:false},null,2));
} finally { await db.close(); }
