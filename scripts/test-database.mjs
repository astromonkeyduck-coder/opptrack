import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { seedDisabledRegistryRoutes } from './test-database-support.mjs';
const db = new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const checks=[];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function sql(query,params=[]) { return (await db.query(query,params)).rows; }
async function scalar(query,params=[]) { return Object.values((await sql(query,params))[0])[0]; }
async function role(name,uid,fn) {
  await db.exec(`set role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
  try { return await fn(); } finally { await db.exec('reset role'); await db.exec("reset request.jwt.claim.sub"); }
}
async function denied(fn) { await assert.rejects(fn,/permission denied|Not authorized|row-level security|foreign key|not present/i); }
const hash=(s)=>createHash('sha256').update(s).digest('hex');
function batch(title='Source event', changes={}) {
  const facts={native_id:'e1',title,description:'Direct source facts',source_url:'https://calendar.fsu.edu/event/test',categories:['Arts'],uncertainties:['Tickets unverified'],capture_native_id:'page:1',content_sha256:hash(title),claims:[{field:'title',value:title,evidence_pointer:'/events/0/event/title'}]};
  return {outcome:'success',pagination_complete:true,started_at:new Date(Date.now()-1000).toISOString(),finished_at:new Date().toISOString(),http_status:200,request_count:1,byte_count:42,parser_version:'test-v1',cursor_after:{window:'complete'},window:{from:'2026-10-20',to:'2026-10-27'},captures:[{native_id:'page:1',source_url:'https://calendar.fsu.edu/api/2/events',content_sha256:hash(title+' raw'),storage_path:owner+'/sources/'+hash(title)+'raw.json',content_type:'application/json',byte_count:42,fetched_at:new Date().toISOString()}],opportunities:[facts],occurrences:[{native_id:'instance:1',opportunity_native_id:'e1',starts_at:'2026-10-21T23:00:00Z',ends_at:null,start_date:null,timezone:'America/New_York',date_precision:'instant',location:null,status:'scheduled',capture_native_id:'page:1',content_sha256:hash('instance stable'),claims:[{field:'start',value:'2026-10-21T23:00:00Z',evidence_pointer:'/events/0/event/event_instances/0'}]}],milestones:[],...changes};
}
async function lease() {
  await db.exec("update public.sources set next_due_at=now()-interval '1 second',next_poll_at=now()-interval '1 second',retry_not_before=null where id='fsu-calendar-api'");
  return role('service_role',null,async()=> (await sql("select * from public.lease_due_sources(1,300) where id='fsu-calendar-api'"))[0]);
}
async function commit(lease,payload) { return role('service_role',null,()=>scalar('select public.complete_source_run($1,$2,$3::jsonb)',['fsu-calendar-api',lease.lease_token,JSON.stringify(payload)])); }
try {
  await db.exec(await readFile(new URL('../supabase/tests/bootstrap.sql',import.meta.url),'utf8'));
  const migrationFiles=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrationFiles) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await check('all migrations execute on actual PostgreSQL (PGlite WASM)',async()=>assert.ok(migrationFiles.length));
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
  await check('unconfigured authenticated account cannot claim first-owner membership',()=>role('authenticated',owner,async()=>{ assert.equal(await scalar('select public.is_tracker_member()'),false); await denied(()=>db.query('select public.configure_tracker_owner($1)',[owner])); }));
  await role('service_role',null,()=>db.query('select public.configure_tracker_owner($1)',[owner]));
  await check('single-owner setup is idempotent and refuses replacement',async()=>{ await role('service_role',null,()=>db.query('select public.configure_tracker_owner($1)',[owner])); await assert.rejects(()=>role('service_role',null,()=>db.query('select public.configure_tracker_owner($1)',[other])),/Owner already configured/); });
  await check('migration source IDs align with registry; seeded catalog has exactly 59 routes and two enabled adapters',async()=>{
    const registryCount=await seedDisabledRegistryRoutes(db,owner);
    assert.equal(registryCount,59);
    assert.equal(await scalar('select count(*)::integer from public.sources'),registryCount);
    assert.equal(await scalar('select count(*)::integer from public.sources where enabled'),2);
    assert.equal(await scalar("select cadence_seconds from public.sources where id='fsu-calendar-api'"),3600);
    assert.equal(await scalar("select cadence_seconds from public.sources where id='fsu-music-events'"),21600);
  });
  await db.exec("update public.sources set enabled=false where id<>'fsu-calendar-api'");
  const firstLease=await lease();
  await check('lease is exclusive and service-only',async()=>{assert.ok(firstLease.lease_token); assert.equal(await role('service_role',null,()=>scalar('select count(*)::integer from public.lease_due_sources(2,300)')),0); await denied(()=>role('authenticated',owner,()=>db.exec('select * from public.lease_due_sources(2,300)')));});
  await commit(firstLease,batch());
  const occurrenceId=await scalar('select id from public.occurrences');
  await check('success atomically persists capture, run, entities, evidence and cursor',async()=>{ for(const table of ['source_runs','captures','opportunities','occurrences','entity_versions','field_claims','run_captures']) assert.ok(await scalar(`select count(*)::integer from public.${table}`)>0,table); assert.deepEqual(await scalar("select cursor from public.sources where id='fsu-calendar-api'"),{window:'complete'}); });
  await check('anonymous denied database/view/function access',()=>role('anon',null,async()=>{await denied(()=>sql('select * from public.opportunities'));await denied(()=>sql('select * from public.review_inbox'));await denied(()=>sql('select public.record_decision($1,$2,$3)',[occurrenceId,'save',1]));}));
  await check('owner reads facts and security-invoker inbox',()=>role('authenticated',owner,async()=>{assert.equal(await scalar('select count(*)::integer from public.review_inbox'),1);assert.equal(await scalar('select source_cadence_seconds from public.review_inbox'),3600);assert.equal(await scalar('select count(*)::integer from public.opportunities'),1);}));
  await check('another authenticated user cannot read facts, runs, claims, decisions or intake',()=>role('authenticated',other,async()=>{ for(const table of ['opportunities','occurrences','captures','source_runs','sources','entity_versions','field_claims','user_decisions','manual_intakes','review_inbox']) assert.equal(await scalar(`select count(*)::integer from public.${table}`),0,table);await denied(()=>sql('select public.record_decision($1,$2,$3)',[occurrenceId,'save',1]));await denied(()=>sql("select public.submit_manual_intake(null,'no', '[]')"));}));
  await check('owner cannot forge source facts/health/direct decisions',()=>role('authenticated',owner,async()=>{await denied(()=>sql("update public.sources set health_status='success'"));await denied(()=>sql("update public.opportunities set title='forged'"));await denied(()=>sql('insert into public.user_decisions(owner_id,occurrence_id,action,target_revision) values($1,$2,$3,1)',[owner,occurrenceId,'save']));}));
  await check('save works, calendar approval action is rejected, stale revision is rejected',()=>role('authenticated',owner,async()=>{await sql('select public.record_decision($1,$2,$3)',[occurrenceId,'save',1]);await assert.rejects(()=>sql('select public.record_decision($1,$2,$3)',[occurrenceId,'approve',1]),/Only save/);await assert.rejects(()=>sql('select public.record_decision($1,$2,$3)',[occurrenceId,'reject',999]),/Occurrence changed/);}));
  await commit(await lease(),batch());
  await check('unchanged replay creates observations but no duplicate entities/versions; decision survives',async()=>{assert.equal(await scalar('select count(*)::integer from public.captures'),1);assert.equal(await scalar('select count(*)::integer from public.entity_versions'),2);assert.equal(await scalar('select count(*)::integer from public.occurrences'),1);assert.equal(await scalar('select count(*)::integer from public.source_runs'),2);assert.equal(await scalar('select count(*)::integer from public.run_captures'),2);assert.equal(await role('authenticated',owner,()=>scalar('select decision from public.review_inbox')),'save');});
  await check('fresh replay of purged identical raw capture restores private path without duplicate versions',async()=>{
    await db.exec("update public.captures set storage_path=null,purged_at=now(),retention_until=now()-interval '1 day'");
    await commit(await lease(),batch());
    assert.equal(await scalar('select count(*)::integer from public.captures'),1);
    assert.equal(await scalar('select count(*)::integer from public.entity_versions'),2);
    assert.ok(await scalar('select storage_path from public.captures'));
    assert.equal(await scalar('select purged_at from public.captures'),null);
    assert.ok(await scalar('select retention_until>now() from public.captures'));
  });
  await commit(await lease(),batch('Changed source title'));
  await check('new content version preserves stable occurrence and user decision',async()=>{assert.equal(await scalar('select count(*)::integer from public.entity_versions'),3);assert.equal(await scalar('select revision from public.opportunities'),2);assert.equal(await role('authenticated',owner,()=>scalar('select decision from public.review_inbox')),'save');});
  await check('cross-owner relationship is rejected even with service privileges',async()=>{await denied(()=>sql('insert into public.user_decisions(owner_id,occurrence_id,action,target_revision) values($1,$2,$3,1)',[other,occurrenceId,'save']));});
  const lastSuccess=await scalar("select last_success_at::text from public.sources where id='fsu-calendar-api'");
  await commit(await lease(),batch('partial',{outcome:'partial',pagination_complete:false,error:'Truncated pagination',cursor_after:{window:'must-not-advance'},opportunities:[],occurrences:[]}));
  await check('partial keeps cursor/last-success, records failure and retry',async()=>{assert.deepEqual(await scalar("select cursor from public.sources where id='fsu-calendar-api'"),{window:'complete'});assert.equal(await scalar("select last_success_at::text from public.sources where id='fsu-calendar-api'"),lastSuccess);assert.equal(await scalar("select health_status from public.sources where id='fsu-calendar-api'"),'partial');assert.equal(await scalar("select consecutive_failures from public.sources where id='fsu-calendar-api'"),1);});
  const invalidLease=await lease();
  const runsBefore=await scalar('select count(*)::integer from public.source_runs');
  await check('malformed normalized payload rolls back captures, run and cursor transaction',async()=>{await assert.rejects(()=>commit(invalidLease,batch('invalid',{occurrences:[{native_id:'bad',opportunity_native_id:'missing',capture_native_id:'page:1'}]})),/parent\/capture/);assert.equal(await scalar('select count(*)::integer from public.source_runs'),runsBefore);assert.equal(await scalar("select count(*)::integer from public.captures where content_sha256=$1",[hash('invalid raw')]),0);});
  await check('success cannot represent truncated pagination or an unevidenced empty response',async()=>{await assert.rejects(()=>commit(invalidLease,batch('bad',{pagination_complete:false})),/complete pagination/);await assert.rejects(()=>commit(invalidLease,batch('bad',{captures:[],opportunities:[],occurrences:[]})),/capture evidence/);});
  await commit(invalidLease,batch('empty',{opportunities:[],occurrences:[]}));
  await check('valid zero-event capture persists as evidenced success',async()=>assert.equal(await scalar("select count(*)::integer from public.source_runs where outcome='success' and opportunity_count=0"),1));
  const retryLease=await lease();
  await commit(retryLease,batch('network',{outcome:'rate_limited',pagination_complete:false,error:'HTTP 429',http_status:429,retry_after_seconds:7200,captures:[],opportunities:[],occurrences:[]}));
  await check('Retry-After is honored and failed collection is not empty success',async()=>{assert.ok(await scalar("select extract(epoch from next_due_at-now())::integer from public.sources where id='fsu-calendar-api'")>=7190);assert.equal(await scalar("select outcome from public.source_runs order by created_at desc,id desc limit 1"),'rate_limited');});
  const expired=await lease();
  await db.exec("update public.sources set lease_until=now()-interval '1 second' where id='fsu-calendar-api'");
  await check('expired lease cannot commit; recovery records abandoned attempt',async()=>{await assert.rejects(()=>commit(expired,batch()),/expired source lease/); const recovered=await lease();assert.notEqual(recovered.lease_token,expired.lease_token);assert.equal(await scalar("select count(*)::integer from public.source_runs where parser_version='lease-recovery-v3'"),1);assert.equal(recovered.health_status,'failed');});
  await check('private storage bucket forbids public access and preserves MIME/size limits',async()=>{const b=(await sql("select * from storage.buckets where id='captures'"))[0];assert.equal(b.public,false);assert.equal(Number(b.file_size_limit),5242880);assert.ok(b.allowed_mime_types.includes('image/png'));assert.equal(await role('anon',null,()=>scalar('select count(*)::integer from storage.objects')),0);});
  const mediaPath=owner+'/intake/slide-1.png';
  await check('storage RLS permits owner prefix and denies other prefixes/traversal',()=>role('authenticated',owner,async()=>{await sql("insert into storage.objects(bucket_id,name) values('captures',$1)",[mediaPath]);await denied(()=>sql("insert into storage.objects(bucket_id,name) values('captures',$1)",[other+'/bad.png']));await denied(()=>sql("insert into storage.objects(bucket_id,name) values('captures',$1)",[owner+'/../bad.png']));assert.equal(await scalar('select count(*)::integer from storage.objects'),1);}));
  await check('other authenticated user cannot read/upload/delete owner storage',()=>role('authenticated',other,async()=>{assert.equal(await scalar('select count(*)::integer from storage.objects'),0);await denied(()=>sql("insert into storage.objects(bucket_id,name) values('captures',$1)",[other+'/bad.png']));assert.equal((await sql('delete from storage.objects returning id')).length,0);}));
  await check('manual intake retains all supplied slides privately, dedupes submission keys, and rejects forged media',()=>role('authenticated',owner,async()=>{const key='33333333-3333-4333-8333-333333333333';const media=JSON.stringify([{storage_path:mediaPath,mime_type:'image/png',byte_count:10}]);const one=await scalar("select public.submit_manual_intake($1,$2,$3::jsonb,$4)",['https://fsu.edu/example','User note',media,key]);const two=await scalar("select public.submit_manual_intake($1,$2,$3::jsonb,$4)",['https://fsu.edu/example','User note',media,key]);assert.equal(one,two);assert.equal(await scalar('select count(*)::integer from public.manual_intakes'),1);await assert.rejects(()=>sql("select public.submit_manual_intake(null,'forged',$1::jsonb)",[JSON.stringify([{storage_path:other+'/fake.png',mime_type:'image/png',byte_count:10}])]),/Invalid private media/);await assert.rejects(()=>sql("select public.submit_manual_intake(null,'missing',$1::jsonb)",[JSON.stringify([{storage_path:owner+'/missing.png',mime_type:'image/png',byte_count:10}])]),/object missing/);}));
  await check('manual SQL boundary rejects oversized files/total, excess slides, long notes, credential URLs and absent MIME',()=>role('authenticated',owner,async()=>{
    const base={storage_path:mediaPath,mime_type:'image/png',byte_count:10};
    for(const media of [Array(9).fill(base),[{...base,byte_count:5242881}],Array(5).fill({...base,byte_count:5242880}),[{storage_path:mediaPath,byte_count:10}]]) await assert.rejects(()=>sql("select public.submit_manual_intake(null,'boundary',$1::jsonb)",[JSON.stringify(media)]),/Invalid media|Invalid private|exceeds 20/);
    await assert.rejects(()=>sql("select public.submit_manual_intake(null,$1,'[]')",['x'.repeat(5001)]),/check constraint/);
    await assert.rejects(()=>sql("select public.submit_manual_intake($1,'bad URL','[]')",['https://user:password@example.edu/flyer']),/check constraint/);
  }));
  await check('retention planner is service-only, skips active shared references and recent objects, and finds aged orphans',async()=>{
    await denied(()=>role('authenticated',owner,()=>sql('select * from public.purge_candidates(100)')));
    const shared=owner+'/sources/shared.raw';const orphan=owner+'/sources/orphan.raw';const recent=owner+'/sources/recent.raw';const unknown=other+'/sources/orphan.raw';
    for(const name of [shared,orphan,unknown]) await sql("insert into storage.objects(bucket_id,name,created_at) values('captures',$1,now()-interval '40 days')",[name]);
    await sql("insert into storage.objects(bucket_id,name) values('captures',$1)",[recent]);
    for(const [native,retention] of [['shared-expired',-1],['shared-current',1]]) await sql("insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,storage_path,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until) values($1,'fsu-calendar-api',$2,'https://calendar.fsu.edu',$3,$4,'application/json',10,'test-v1',now(),now(),now()+make_interval(days=>$5))",[owner,native,hash(native),shared,retention]);
    let candidates=await role('service_role',null,()=>sql('select * from public.purge_candidates(100)'));
    assert.equal(candidates.some(c=>c.storage_path===shared),false,'active reference must protect shared object');
    assert.equal(candidates.some(c=>c.storage_path===mediaPath),false,'active manual intake must protect media');
    assert.equal(candidates.some(c=>c.storage_path===orphan && c.candidate_reason==='aged_orphan_review'),true);
    assert.equal(candidates.some(c=>c.storage_path===recent || c.storage_path===unknown),false);
    await sql("update public.captures set retention_until=now()-interval '1 day' where native_id='shared-current'");
    await sql("update public.manual_intakes set retention_until=now()-interval '1 day'");
    candidates=await role('service_role',null,()=>sql('select * from public.purge_candidates(100)'));
    assert.equal(candidates.some(c=>c.storage_path===shared && c.candidate_reason==='expired_capture'),true);
    assert.equal(candidates.some(c=>c.storage_path===mediaPath && c.candidate_reason==='expired_manual_media'),true);
    assert.equal((await role('service_role',null,()=>sql('select * from public.purge_candidates(1)'))).length,1);
    assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1',[orphan]),1,'planning must not delete objects');
  });
  await check('owner can delete private object under policy; database records retain no public URL',()=>role('authenticated',owner,async()=>{assert.equal((await sql('delete from storage.objects where name=$1 returning id',[mediaPath])).length,1);assert.equal(await scalar('select count(*)::integer from storage.objects where name=$1',[mediaPath]),0);}));
  await check('calendar and delivery execution tables/functions are absent',async()=>{assert.equal(await scalar("select count(*)::integer from information_schema.tables where table_schema='public' and table_name in ('outbox','calendar_links','integration_connections')"),0);});
  await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
  await writeFile(new URL('../reports/stage-1-database-tests.json',import.meta.url),JSON.stringify({run_at:new Date().toISOString(),engine:'PGlite 0.5.10 (actual PostgreSQL WASM)',migrations:migrationFiles,passed:checks.length,checks,not_tested:['Hosted Supabase Auth HTTP/JWT verification','Supabase Storage HTTP upload/signing service','Hosted database backup/restore','Concurrent worker processes against hosted PostgreSQL'],fixture_data:'Synthetic SQL records only; not live event ingestion evidence'},null,2)+'\n');
  console.log(`${checks.length} database checks passed. Auth/Storage HTTP services and hosted infrastructure remain untested.`);
} finally { await db.close(); }
