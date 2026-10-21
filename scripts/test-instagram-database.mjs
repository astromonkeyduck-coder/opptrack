/** Real PostgreSQL checks using synthetic API metadata; no hosted credentials or requests. */
import { PGlite } from '@electric-sql/pglite';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const checks=[],migration='202610200003_instagram_monitoring.sql';
const sql=async(q,p=[]) => (await db.query(q,p)).rows;
const scalar=async(q,p=[]) => Object.values((await sql(q,p))[0])[0];
const hash=s=>createHash('sha256').update(s).digest('hex');
const count=table=>scalar(`select count(*)::integer from public.${table}`);
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function role(name,uid,fn){await db.exec(`set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);try{return await fn();}finally{await db.exec('reset role');await db.exec('reset request.jwt.claim.sub');}}
async function lease(id='instagram-fixture-00'){
 await sql("update public.sources set next_poll_at=date_bin(interval '1 hour',clock_timestamp(),timestamptz '2000-01-01Z'),next_due_at=clock_timestamp()-interval '1 minute',retry_not_before=null,lease_token=null,lease_until=null where id=$1",[id]);
 const row=(await role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(16,600)'))).find(r=>r.id===id);
 assert.ok(row,'Fixture must acquire its real SQL lease');return row;
}
function batch(changes={}){
 const now=new Date().toISOString();const caption='Synthetic concert metadata — publication is not an event';
 return {outcome:'success',pagination_complete:true,started_at:now,finished_at:now,http_status:200,request_count:1,byte_count:2,
  parser_version:'instagram-synthetic-regression-v1',invocation_kind:'replay',cursor_after:{scope:'latest25_parent_metadata_only',history_complete:false},
  window:{scope:'latest25_parent_metadata_only',history_complete:false},
  captures:[{native_id:'bounded-post-projection',source_url:'https://www.instagram.com/fixture/',content_sha256:hash('{}'),storage_path:owner+'/sources/instagram-synthetic.json',content_type:'application/json',byte_count:2,fetched_at:now,evidence_kind:'sanitized_api_projection'}],
  opportunities:[],occurrences:[],milestones:[],
  updates:[{native_id:'18000000000000001',content_hash:hash(caption),capture_native_id:'bounded-post-projection',caption,published_at:'2026-10-20T18:00:00Z',permalink:'https://www.instagram.com/p/Synthetic123/',media_type:'CAROUSEL_ALBUM',media_product_type:'FEED',children:[{native_id:'18000000000000002',media_type:'IMAGE',position:0},{native_id:'18000000000000003',media_type:'VIDEO',position:1}],children_complete:true,evidence_pointer:'/posts/0'}],...changes};
}
const complete=(l,b)=>role('service_role',null,()=>scalar('select public.complete_instagram_run($1,$2,$3::jsonb)',[l.id,l.lease_token,JSON.stringify(b)]));
const source=async(id='instagram-fixture-00')=>(await sql('select * from public.sources where id=$1',[id]))[0];
async function snapshot(){return {runs:await count('source_runs'),captures:await count('captures'),links:await count('run_captures'),updates:await count('instagram_updates'),versions:await count('instagram_update_versions'),source:await source()};}
try{
 await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
 for(const f of ['202610200001_stage1.sql','202610200002_hourly_cadence.sql'])await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await sql('insert into auth.users(id) values($1),($2)',[owner,other]);await role('service_role',null,()=>sql('select public.configure_tracker_owner($1)',[owner]));
 const oldSources=await scalar('select count(*)::integer from public.sources');
 await db.exec(await readFile('supabase/migrations/'+migration,'utf8'));
 await check('incremental migration preserves existing sources and enables no social routes',async()=>{assert.equal(await count('sources'),oldSources);assert.equal(await scalar("select count(*)::integer from public.sources where enabled and adapter='instagram-business-discovery-v1'"),0);assert.equal(await count('instagram_updates'),0);});
 for(let i=0;i<17;i++)await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_poll_at,next_due_at,health_status,coverage_note) values($1,$2,$1,'instagram-business-discovery-v1','https://www.instagram.com/fixture/',$3,3600,clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour','never_run','Synthetic bounded-window fixture')",['instagram-fixture-'+String(i).padStart(2,'0'),owner,i<16]);
 let social;
 await check('two core leases remain available before 16 overdue social routes; social cannot consume core slots',async()=>{
  const core=await role('service_role',null,()=>sql('select * from public.lease_due_sources(2,600)'));assert.deepEqual(core.map(s=>s.id).sort(),['fsu-calendar-api','fsu-music-events']);
  social=await role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(16,600)'));assert.equal(social.length,16);assert.ok(social.every(s=>s.adapter==='instagram-business-discovery-v1'));assert.ok(social.every(s=>s.id!=='instagram-fixture-16'));assert.equal((await role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(16,600)'))).length,0);
 });
 await check('lease limits and browser access are enforced for both groups',async()=>{
  await assert.rejects(()=>role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(17,600)')),/Invalid lease limits/);
  for(const name of ['anon','authenticated'])await assert.rejects(()=>role(name,owner,()=>sql('select * from public.lease_due_instagram_sources(1,600)')),/permission denied/);
  await assert.rejects(()=>role('service_role',null,()=>sql("select * from tracker_private.lease_due_source_group('instagram',1,600)")),/permission denied/);
 });
 const firstLease=social.find(r=>r.id==='instagram-fixture-00');let first;
 await check('successful bounded post completion atomically stores capture/provenance/current post/version without events',async()=>{
  const payload=batch({trigger_run_id:'run_synthetic_instagram',trigger_schedule_id:'sched_synthetic_instagram',dispatcher_scheduled_at:new Date().toISOString()});
  const result=await complete(firstLease,payload);assert.equal(result.updates,1);assert.equal(result.versions_added,1);first=(await sql('select * from public.instagram_updates'))[0];
  assert.equal(await count('opportunities'),0);assert.equal(await count('occurrences'),0);assert.equal(await count('milestones'),0);
  assert.equal(await count('captures'),1);assert.equal(await count('instagram_update_versions'),1);assert.equal(await scalar('select evidence_kind from public.captures'),'sanitized_api_projection');
  const run=(await sql('select * from public.source_runs where id=$1',[result.run_id]))[0];assert.equal(run.instagram_update_count,1);assert.equal(run.trigger_run_id,'run_synthetic_instagram');assert.equal(run.collection_window.history_complete,false);assert.ok(run.scheduled_poll_at);
  const s=await source();assert.equal(s.health_status,'success');assert.equal(s.lease_token,null);assert.match(s.health_message,/older history, Stories/);assert.deepEqual(s.cursor,payload.cursor_after);
  assert.equal(new Date(s.next_poll_at).getTime(),new Date(firstLease.leased_poll_at).getTime()+3600000);
 });
 await check('unchanged replay reuses identity/capture/version while retaining separate source-run evidence',async()=>{
  const result=await complete(await lease(),batch());assert.equal(result.versions_added,0);assert.equal(await count('instagram_updates'),1);assert.equal(await count('instagram_update_versions'),1);assert.equal(await count('captures'),1);assert.equal(await count('source_runs'),2);assert.equal(await scalar('select id from public.instagram_updates'),first.id);assert.equal(new Date(await scalar('select first_seen_at from public.instagram_updates')).toISOString(),new Date(first.first_seen_at).toISOString());
 });
 await check('caption edits append versions and keep stable identity; search indexes plaintext',async()=>{
  const payload=batch();payload.updates[0].caption='Synthetic scholarship application notice <script>literal text only</script>';payload.updates[0].content_hash=hash(payload.updates[0].caption);payload.updates[0].media_url='https://must-not-persist.invalid/secret';
  const result=await complete(await lease(),payload);assert.equal(result.versions_added,1);assert.equal(await count('instagram_updates'),1);assert.equal(await count('instagram_update_versions'),2);assert.equal(await scalar('select id from public.instagram_updates'),first.id);
  assert.equal(await scalar("select count(*)::integer from public.instagram_updates_current where search_document @@ plainto_tsquery('english','scholarship')"),1);assert.equal(await scalar("select count(*)::integer from public.instagram_update_versions where facts ? 'media_url'"),0);
 });
 await check('owner can select current feed and versions while other signed-in user sees zero rows',async()=>{
  assert.equal(await role('authenticated',owner,()=>count('instagram_updates_current')),1);assert.equal(await role('authenticated',owner,()=>count('instagram_update_versions')),2);
  assert.equal(await role('authenticated',other,()=>count('instagram_updates_current')),0);assert.equal(await role('authenticated',other,()=>count('instagram_update_versions')),0);
  assert.ok((await scalar("select reloptions from pg_class where oid='public.instagram_updates_current'::regclass")).includes('security_invoker=true'));
 });
 await check('anonymous grants deny reads and RLS still denies rows if a grant is accidentally added',async()=>{
  await assert.rejects(()=>role('anon',null,()=>count('instagram_updates_current')),/permission denied/);
  await db.exec('grant select on public.instagram_updates,public.instagram_update_versions to anon');
  assert.equal(await role('anon',null,()=>count('instagram_updates')),0);assert.equal(await role('anon',null,()=>count('instagram_update_versions')),0);
  await db.exec('revoke select on public.instagram_updates,public.instagram_update_versions from anon');
 });
 await check('authenticated clients cannot directly mutate posts/versions or invoke ingestion RPC',async()=>{
  for(const name of ['anon','authenticated']){
   await assert.rejects(()=>role(name,owner,()=>sql('select public.complete_instagram_run($1,$2,$3::jsonb)',['instagram-fixture-00',randomUUID(),JSON.stringify(batch())])),/permission denied/);
   for(const table of ['instagram_updates','instagram_update_versions'])for(const query of [`delete from public.${table}`,`update public.${table} set content_hash=content_hash`,`insert into public.${table}(owner_id) values('${owner}')`])await assert.rejects(()=>role(name,owner,()=>sql(query)),/permission denied/);
  }
 });
 await check('a stale or wrong lease cannot create a run or mutate any existing post',async()=>{
  const before=await snapshot(),wrong={...await source(),lease_token:randomUUID()};await assert.rejects(()=>complete(wrong,batch()),/Invalid or expired source lease/);const after=await snapshot();assert.deepEqual(after,before);
 });
 await check('missing capture evidence rolls back original run/capture/cursor/health writes as one transaction',async()=>{
  const l=await lease(),before=await snapshot(),payload=batch();payload.updates[0].capture_native_id='not-in-run';payload.cursor_after={must:'rollback'};
  await assert.rejects(()=>complete(l,payload),/Instagram capture evidence missing/);assert.deepEqual(await snapshot(),before);
 });
 await check('unordered or secret-bearing children reject the batch and roll back its source state',async()=>{
  for(const mutate of [u=>u.children[1].position=0,u=>u.children[0].media_url='https://signed.invalid/token',u=>u.children[1].native_id=u.children[0].native_id]){
   const l=await lease(),before=await snapshot(),payload=batch();mutate(payload.updates[0]);await assert.rejects(()=>complete(l,payload),/check constraint/);assert.deepEqual(await snapshot(),before);
  }
 });
 await check('Instagram RPC rejects event payloads, raw-response captures, empty success and false full-history claims',async()=>{
  for(const mutate of [b=>b.opportunities=[{native_id:'cannot-be-event'}],b=>b.captures[0].evidence_kind='source_response',b=>b.updates=[],b=>b.window.history_complete=true]){
   const l=await lease(),before=await snapshot(),payload=batch();mutate(payload);await assert.rejects(()=>complete(l,payload),/Instagram/);assert.deepEqual(await snapshot(),before);
  }
 });
 await check('post constraints reject Stories, noncanonical links and children on standalone images',async()=>{
  for(const mutate of [u=>u.media_product_type='STORY',u=>u.permalink='https://www.instagram.com/p/Synthetic123/?access_token=never-store',u=>u.media_type='IMAGE']){
   const l=await lease(),before=await snapshot(),payload=batch();mutate(payload.updates[0]);await assert.rejects(()=>complete(l,payload),/check constraint/);assert.deepEqual(await snapshot(),before);
  }
 });
 await check('standalone image metadata and offset pagination stay separate from occurrence inbox',async()=>{
  const payload=batch();payload.updates[0]={...payload.updates[0],native_id:'18000000000000004',content_hash:hash('standalone synthetic image'),caption:'Synthetic standalone image',permalink:'https://www.instagram.com/p/Synthetic456/',media_type:'IMAGE',children:[],children_complete:true};
  await complete(await lease(),payload);assert.equal(await count('instagram_updates_current'),2);assert.equal(await count('review_inbox'),0);
  const firstPage=await role('authenticated',owner,()=>sql('select id from public.instagram_updates_current order by published_at desc,id limit 1 offset 0'));
  const nextPage=await role('authenticated',owner,()=>sql('select id from public.instagram_updates_current order by published_at desc,id limit 1 offset 1'));
  assert.equal(firstPage.length,1);assert.equal(nextPage.length,1);assert.notEqual(firstPage[0].id,nextPage[0].id);
  assert.equal(await role('authenticated',owner,()=>scalar("select count(*)::integer from public.instagram_updates_current where caption ilike $1 and source_id=$2",['%standalone%','instagram-fixture-00'])),1);
  assert.equal(await role('authenticated',other,()=>scalar("select count(*)::integer from public.instagram_updates_current where caption ilike $1 and source_id=$2",['%standalone%','instagram-fixture-00'])),0);
 });
 await check('partial valid updates remain reviewable without advancing success time/cursor; retry floor is retained',async()=>{
  const l=await lease(),before=await source(),payload=batch({outcome:'partial',pagination_complete:false,error:'Synthetic truncated children',retry_after_seconds:3600,cursor_after:{must:'not-advance'}});payload.updates[0].children_complete=false;payload.updates[0].content_hash=hash('synthetic-incomplete-children');
  const result=await complete(l,payload);assert.equal(result.updates,1);const after=await source();assert.equal(after.health_status,'partial');assert.deepEqual(after.cursor,before.cursor);assert.equal(new Date(after.last_success_at).toISOString(),new Date(before.last_success_at).toISOString());assert.ok(after.retry_not_before);assert.equal(await scalar("select children_complete from public.instagram_updates where native_id='18000000000000001'"),false);
 });
 await check('expired-token failure is stored as blocked and cannot appear as successful empty collection',async()=>{
  const l=await lease(),before=await source();await complete(l,batch({outcome:'blocked',pagination_complete:false,error:'Synthetic expired token; reconnect required',request_count:1,byte_count:32,captures:[],updates:[],cursor_after:null,window:{scope:'latest25_parent_metadata_only',history_complete:false,failure_category:'token_expired'}}));
  const after=await source();assert.equal(after.health_status,'blocked');assert.equal(new Date(after.last_success_at).toISOString(),new Date(before.last_success_at).toISOString());assert.deepEqual(after.cursor,before.cursor);assert.equal(await scalar("select instagram_update_count from public.source_runs order by created_at desc,id desc limit 1"),0);
 });
 await check('out-of-order observations cannot overwrite the current caption or move last-seen backward',async()=>{
  const before=(await sql("select * from public.instagram_updates where native_id='18000000000000001'"))[0],payload=batch({started_at:'2026-10-01T00:00:00Z',finished_at:'2026-10-01T00:00:01Z'});payload.updates[0].caption='Old synthetic snapshot';payload.updates[0].content_hash=hash('old synthetic snapshot');
  await complete(await lease(),payload);const after=(await sql("select * from public.instagram_updates where native_id='18000000000000001'"))[0];assert.equal(after.caption,before.caption);assert.equal(after.content_hash,before.content_hash);assert.equal(new Date(after.last_seen_at).toISOString(),new Date(before.last_seen_at).toISOString());
 });
 await check('core completion still works under migration 003 and creates no social rows',async()=>{
  const core=(await sql("select * from public.sources where id='fsu-calendar-api'"))[0],payload=batch();delete payload.updates;payload.window={};payload.captures[0].evidence_kind='source_response';
  const before=await count('instagram_updates');await role('service_role',null,()=>sql('select public.complete_source_run($1,$2,$3::jsonb)',[core.id,core.lease_token,JSON.stringify(payload)]));assert.equal(await count('instagram_updates'),before);
 });
 await check('migration 004 changes only the Instagram group ceiling and preserves data, active leases and privileges',async()=>{
  const beforeDefinition=await scalar("select pg_get_functiondef('tracker_private.lease_due_source_group(text,integer,integer)'::regprocedure)");
  const beforeSources=await sql('select * from public.sources order by id'),beforePosts=await count('instagram_updates'),beforeVersions=await count('instagram_update_versions');
  await db.exec(await readFile('supabase/migrations/202610200004_instagram_27_accounts.sql','utf8'));
  const afterDefinition=await scalar("select pg_get_functiondef('tracker_private.lease_due_source_group(text,integer,integer)'::regprocedure)");
  assert.equal(afterDefinition,beforeDefinition.replace("case when p_group='instagram' then 16 else 10 end","case when p_group='instagram' then 27 else 10 end"));
  assert.deepEqual(await sql('select * from public.sources order by id'),beforeSources);assert.equal(await count('instagram_updates'),beforePosts);assert.equal(await count('instagram_update_versions'),beforeVersions);
  for(const name of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'tracker_private.lease_due_source_group(text,integer,integer)','EXECUTE')",[name]),false);
 });
 await check('27 explicitly enabled social routes lease independently while both core producers remain unstarved',async()=>{
  for(let i=17;i<28;i++)await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_poll_at,next_due_at,health_status,coverage_note) values($1,$2,$1,'instagram-business-discovery-v1','https://www.instagram.com/fixture/',true,3600,clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days','never_run','Synthetic 27-account expansion fixture')",['instagram-fixture-'+i,owner]);
  await db.exec("update public.sources set next_poll_at=clock_timestamp()-interval '1 hour',next_due_at=clock_timestamp()-interval '1 hour',retry_not_before=null,leased_poll_at=null,lease_token=null,lease_until=null where enabled");
  assert.equal(await scalar("select count(*)::integer from public.sources where enabled and adapter='instagram-business-discovery-v1'"),27);
  const core=await role('service_role',null,()=>sql('select * from public.lease_due_sources(2,600)'));assert.deepEqual(core.map(s=>s.id).sort(),['fsu-calendar-api','fsu-music-events']);
  const social=await role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(27,600)'));assert.equal(social.length,27);assert.equal(new Set(social.map(s=>s.id)).size,27);assert.ok(social.every(s=>s.adapter==='instagram-business-discovery-v1' && s.id!=='instagram-fixture-16'));
  assert.equal((await role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(27,600)'))).length,0);
 });
 await check('expanded group rejects 28-source requests and preserves core/browser limits',async()=>{
  await assert.rejects(()=>role('service_role',null,()=>sql('select * from public.lease_due_instagram_sources(28,600)')),/Invalid lease limits/);
  await assert.rejects(()=>role('service_role',null,()=>sql('select * from public.lease_due_sources(11,600)')),/Invalid lease limits/);
  for(const name of ['anon','authenticated'])await assert.rejects(()=>role(name,owner,()=>sql('select * from public.lease_due_instagram_sources(27,600)')),/permission denied/);
 });
 const report={runAt:new Date().toISOString(),database:'PGlite 0.5.10 actual PostgreSQL WASM',migration,incrementalMigration:'202610200004_instagram_27_accounts.sql',passed:checks.length,checks,
  fixtureClass:'Synthetic metadata, API captures and Trigger IDs; not live provider/schedule proof',calendarWrites:0,paidServicesEnabled:0,
  policy:'Owner-only searchable publication metadata with stable identity, append-only content versions, atomic run/capture/update/cursor/health completion, separate core/social lease budgets',
  notTested:['Hosted migration/HTTP JWT and Storage behavior','Real Meta token lifetime and provider payloads','Distributed workers in separate database sessions','Storage upload rollback; uploaded orphan objects require later safe retention']};
 await writeFile('reports/instagram-database-tests.json',JSON.stringify(report,null,2)+'\n');console.log(`${checks.length} Instagram database checks passed.`);
}finally{await db.close();}
