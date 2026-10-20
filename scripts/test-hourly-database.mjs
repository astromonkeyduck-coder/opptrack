/** Actual PostgreSQL regression tests. All scheduling inputs/events below are synthetic. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const checks=[];
const sql=async(q,p=[]) => (await db.query(q,p)).rows;
const scalar=async(q,p=[]) => Object.values((await sql(q,p))[0])[0];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function role(name,uid,fn){await db.exec(`set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);try{return await fn();}finally{await db.exec('reset role');await db.exec('reset request.jwt.claim.sub');}}
const hash=s=>createHash('sha256').update(s).digest('hex');
function batch(changes={}){
 const now=new Date().toISOString();return {outcome:'success',pagination_complete:true,started_at:now,finished_at:now,http_status:200,request_count:1,byte_count:2,parser_version:'hourly-regression-v1',cursor_after:{unchanged:'stable'},window:{},captures:[{native_id:'empty-page',source_url:'https://calendar.fsu.edu/api/2/events',content_sha256:hash('{}'),storage_path:owner+'/sources/synthetic-empty.raw',content_type:'application/json',byte_count:2,fetched_at:now}],opportunities:[],occurrences:[],milestones:[],...changes};
}
async function fixtureLease(sourceId,slot,startedAt=slot){
 const token=randomUUID();await sql("update public.sources set enabled=true,next_poll_at=$2,next_due_at=$2,retry_not_before=null,leased_poll_at=$2,last_attempt_at=$3,lease_token=$4,lease_until=clock_timestamp()+interval '10 minutes' where id=$1",[sourceId,slot,startedAt,token]);return {sourceId,token};
}
async function complete(lease,payload){return role('service_role',null,()=>scalar('select public.complete_source_run($1,$2,$3::jsonb)',[lease.sourceId,lease.token,JSON.stringify(payload)]));}
async function source(id){return (await sql('select * from public.sources where id=$1',[id]))[0];}
const iso=x=>new Date(x).toISOString();
try{
 await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/202610200001_stage1.sql','utf8'));
 await sql('insert into auth.users(id) values($1)',[owner]);await role('service_role',null,()=>sql('select public.configure_tracker_owner($1)',[owner]));
 // Existing rows, decisions and an in-flight lease are created under historical 0001.
 const eventBatch=batch({opportunities:[{native_id:'existing-event',title:'Existing synthetic event',description:'SQL regression fixture',source_url:'https://calendar.fsu.edu/event/example',capture_native_id:'empty-page',content_sha256:hash('event')}],occurrences:[{native_id:'existing-instance',opportunity_native_id:'existing-event',starts_at:'2026-10-20T23:00:00Z',date_precision:'instant',status:'scheduled',capture_native_id:'empty-page',content_sha256:hash('instance')}]});
 const initialLease=(await role('service_role',null,()=>sql("select * from public.lease_due_sources(2,600)"))).find(row=>row.id==='fsu-calendar-api');
 await role('service_role',null,()=>sql('select public.complete_source_run($1,$2,$3::jsonb)',['fsu-calendar-api',initialLease.lease_token,JSON.stringify(eventBatch)]));
 const occurrence=await scalar('select id from public.occurrences');await role('authenticated',owner,()=>sql('select public.record_decision($1,$2,1)',[occurrence,'save']));
 const inflightToken=randomUUID();
 await sql("update public.sources set lease_token=$1,lease_until=clock_timestamp()+interval '10 minutes',last_attempt_at=clock_timestamp()-interval '2 minutes',next_due_at=clock_timestamp()+interval '17 minutes',cursor='{\"preserved\":true}'::jsonb where id='fsu-calendar-api'",[inflightToken]);
 await db.exec("update public.sources set lease_token=null,lease_until=null,consecutive_failures=2,health_status='rate_limited',next_due_at=clock_timestamp()+interval '2 hours' where id='fsu-music-events'");
 const beforeCentral=await source('fsu-calendar-api'),beforeMusic=await source('fsu-music-events');
 await db.exec(await readFile('supabase/migrations/202610200002_hourly_cadence.sql','utf8'));
 await check('incremental migration preserves active lease/token/effective due time, cursors and decisions',async()=>{const after=await source('fsu-calendar-api');assert.equal(after.lease_token,beforeCentral.lease_token);assert.equal(iso(after.lease_until),iso(beforeCentral.lease_until));assert.equal(iso(after.next_due_at),iso(beforeCentral.next_due_at));assert.deepEqual(after.cursor,{preserved:true});assert.equal(await scalar('select action from public.user_decisions'),'save');assert.equal(await scalar('select count(*)::integer from public.opportunities'),1);assert.ok(after.leased_poll_at);});
 await check('incremental migration preserves an outstanding failed-run Retry-After floor',async()=>{const after=await source('fsu-music-events');assert.equal(iso(after.retry_not_before),iso(beforeMusic.next_due_at));assert.equal(iso(after.next_due_at),iso(beforeMusic.next_due_at));assert.equal(after.consecutive_failures,2);});
 await db.exec("update public.sources set lease_token=null,lease_until=null,leased_poll_at=null,enabled=false");
 await check('two hourly polls with later then earlier dispatch jitter retain exact consecutive UTC slots',async()=>{
   for(const [slot,start,finish,next] of [['2026-10-20T12:00:00Z','2026-10-20T12:58:00Z','2026-10-20T12:58:05Z','2026-10-20T13:00:00Z'],['2026-10-20T13:00:00Z','2026-10-20T13:00:01Z','2026-10-20T13:00:04Z','2026-10-20T14:00:00Z']]){
     const lease=await fixtureLease('fsu-calendar-api',slot,start);await complete(lease,batch({started_at:start,finished_at:finish,dispatcher_scheduled_at:slot,invocation_kind:'scheduled',trigger_run_id:'run_synthetic_regression',trigger_schedule_id:'sched_synthetic_regression'}));const row=await source('fsu-calendar-api');assert.equal(iso(row.next_poll_at),iso(next));assert.equal(iso(row.next_due_at),iso(next));assert.equal(row.retry_not_before,null);
   }
 });
 await check('processing across the next UTC boundary leaves that next nominal slot due',async()=>{const lease=await fixtureLease('fsu-calendar-api','2026-10-20T12:00:00Z','2026-10-20T12:58:59Z');await complete(lease,batch({started_at:'2026-10-20T12:58:59Z',finished_at:'2026-10-20T13:01:00Z'}));assert.equal(iso((await source('fsu-calendar-api')).next_due_at),'2026-10-20T13:00:00.000Z');assert.equal(await scalar("select next_due_at<=timestamptz '2026-10-20 13:00:02Z' from public.sources where id='fsu-calendar-api'"),true);});
 await check('Music follows six-hour UTC phases despite dispatch delay, including midnight rollover',async()=>{for(const [slot,finish,next] of [['2026-10-20T00:00:00Z','2026-10-20T00:58:05Z','2026-10-20T06:00:00Z'],['2026-10-20T06:00:00Z','2026-10-20T06:02:03Z','2026-10-20T12:00:00Z'],['2026-10-20T18:00:00Z','2026-10-20T19:01:00Z','2026-10-21T00:00:00Z']]){await complete(await fixtureLease('fsu-music-events',slot),batch({started_at:slot,finished_at:finish}));assert.equal(iso((await source('fsu-music-events')).next_due_at),iso(next));}});
 await check('failed collection keeps its nominal poll due while an independent retry floor prevents early lease',async()=>{
   await db.exec("update public.sources set enabled=false where id<>'fsu-calendar-api'");
   const slot=await scalar("select date_bin(interval '1 hour',now(),timestamptz '2000-01-01Z')");const lease=await fixtureLease('fsu-calendar-api',slot);
   const cursorBefore=(await source('fsu-calendar-api')).cursor;
   await complete(lease,batch({outcome:'rate_limited',pagination_complete:false,error:'Synthetic HTTP 429',retry_after_seconds:7200,captures:[],opportunities:[],occurrences:[]}));
   const row=await source('fsu-calendar-api');assert.equal(iso(row.next_poll_at),iso(slot));assert.ok(new Date(row.retry_not_before).getTime()>=Date.now()+7190000);assert.deepEqual(row.cursor,cursorBefore);assert.equal((await role('service_role',null,()=>sql('select * from public.lease_due_sources(2,600)'))).length,0);
 });
 await check('outage recovery coalesces ten missed source hours into the latest slot without burst catch-up',async()=>{
   await db.exec("update public.sources set enabled=false where id<>'fsu-calendar-api'");
   await db.exec("update public.sources set next_poll_at=date_bin(interval '1 hour',now(),timestamptz '2000-01-01Z')-interval '10 hours',next_due_at=now()-interval '10 hours',retry_not_before=null,lease_token=null,lease_until=null where id='fsu-calendar-api'");
   const [lease]=await role('service_role',null,()=>sql('select * from public.lease_due_sources(1,600)'));assert.equal(iso(lease.leased_poll_at),iso(await scalar("select date_bin(interval '1 hour',$1::timestamptz,timestamptz '2000-01-01Z')",[lease.last_attempt_at])));
   await complete({sourceId:lease.id,token:lease.lease_token},batch({finished_at:'2026-10-01T00:00:01Z',started_at:'2026-10-01T00:00:00Z',invocation_kind:'replay'}));
   assert.equal(iso((await source(lease.id)).next_poll_at),iso(new Date(new Date(lease.leased_poll_at).getTime()+3600000)));
   assert.equal((await role('service_role',null,()=>sql('select * from public.lease_due_sources(1,600)'))).length,0);
 });
 await check('delayed Music recovery selects the latest six-hour phase rather than replaying missed windows',async()=>{
   await db.exec("update public.sources set enabled=false where id<>'fsu-music-events'");
   await db.exec("update public.sources set enabled=true,next_poll_at=now()-interval '2 days',next_due_at=now()-interval '2 days',retry_not_before=null,lease_token=null,lease_until=null where id='fsu-music-events'");
   const [lease]=await role('service_role',null,()=>sql('select * from public.lease_due_sources(1,600)'));assert.equal(iso(lease.leased_poll_at),iso(await scalar("select date_bin(interval '6 hours',$1::timestamptz,timestamptz '2000-01-01Z')",[lease.last_attempt_at])));await complete({sourceId:lease.id,token:lease.lease_token},batch());assert.equal((await role('service_role',null,()=>sql('select * from public.lease_due_sources(1,600)'))).length,0);
 });
 await check('expired lease recovery keeps the previous nominal slot in its failed-run evidence',async()=>{
   await db.exec("update public.sources set enabled=false where id<>'fsu-calendar-api'");const slot=await scalar("select date_bin(interval '1 hour',now(),timestamptz '2000-01-01Z')-interval '1 hour'");const old=await fixtureLease('fsu-calendar-api',slot);await db.exec("update public.sources set lease_until=now()-interval '1 second' where id='fsu-calendar-api'");await assert.rejects(()=>complete(old,batch()),/expired source lease/);const [lease]=await role('service_role',null,()=>sql('select * from public.lease_due_sources(1,600)'));assert.notEqual(lease.lease_token,old.token);assert.equal(iso(await scalar("select scheduled_poll_at from public.source_runs where parser_version='lease-recovery-v2' order by created_at desc limit 1")),iso(slot));assert.equal(lease.health_status,'failed');
 });
 await check('actual run metadata is retained without treating synthetic fixture provenance as Cloud evidence',async()=>{const rows=await sql("select * from public.source_runs where trigger_run_id='run_synthetic_regression'");assert.equal(rows.length,2);for(const row of rows){assert.equal(row.invocation_kind,'scheduled');assert.equal(row.trigger_schedule_id,'sched_synthetic_regression');assert.ok(row.dispatcher_scheduled_at);assert.ok(row.scheduled_poll_at);}});
 await check('historical ingestion implementation and scheduling internals are not callable by browser/service roles',async()=>{for(const name of ['anon','authenticated','service_role'])await assert.rejects(()=>role(name,owner,()=>sql("select tracker_private.complete_source_run('fsu-calendar-api',null,'{}')")),/permission denied/);await assert.rejects(()=>role('authenticated',owner,()=>sql('select * from public.lease_due_sources(1,600)')),/permission denied/);});
 await check('invalid provenance rolls back the entire original ingestion transaction',async()=>{const slot=await scalar("select date_bin(interval '1 hour',now(),timestamptz '2000-01-01Z')");const lease=await fixtureLease('fsu-calendar-api',slot);const count=await scalar('select count(*)::integer from public.source_runs');const cursor=(await source('fsu-calendar-api')).cursor;await assert.rejects(()=>complete(lease,batch({invocation_kind:'invented',cursor_after:{must:'rollback'}})),/check constraint/);assert.equal(await scalar('select count(*)::integer from public.source_runs'),count);assert.deepEqual((await source('fsu-calendar-api')).cursor,cursor);assert.equal((await source('fsu-calendar-api')).lease_token,lease.token);});
 const report={runAt:new Date().toISOString(),database:'PGlite 0.5.10 actual PostgreSQL WASM',migrations:['202610200001_stage1.sql','202610200002_hourly_cadence.sql'],passed:checks.length,checks,fixtureClass:'Synthetic events, times and Trigger IDs; not Cloud schedule/run evidence',policy:'Central hourly and Music six-hourly on UTC slots; effective due=max(nominal poll due,retry floor); missed source slots coalesce; processing completion cannot shift the grid',calendarWrites:0,paidServicesEnabled:0,notTested:['Trigger Free spreading execution in Cloud','Hosted migration application','Live Supabase HTTP and distributed concurrency','A real scheduled Trigger run ID; synthetic IDs above are test-only']};
 await writeFile('reports/stage-1-hourly-database-tests.json',JSON.stringify(report,null,2)+'\n');console.log(`${checks.length} hourly database checks passed; Cloud execution remains unverified.`);
}finally{await db.close();}
