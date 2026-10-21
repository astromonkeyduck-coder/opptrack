/** Production collector and ingestion code with replay HTTP, actual SQL and test Storage. */
import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectInstagram } from '../lib/instagram/collector';
import { ingestInstagramBatch } from '../lib/instagram/ingestion';
import type { SourceLease } from '../lib/ingestion';

const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',sourceId='instagram-clubdownunderfsu';
const sql=async(q:string,p:unknown[]=[]) => (await db.query(q,p)).rows as Record<string,unknown>[];
const scalar=async(q:string,p:unknown[]=[]) => Object.values((await sql(q,p))[0])[0];
const objects=new Map<string,Buffer>();let uploads=0,reuses=0,downloads=0;
const client={storage:{from:(bucket:string)=>{assert.equal(bucket,'captures');return {
 upload:async(path:string,body:Buffer,options:{upsert:boolean})=>{assert.equal(options.upsert,false);if(objects.has(path)){reuses++;return {error:{status:409,code:'ResourceAlreadyExists'}};}objects.set(path,Buffer.from(body));uploads++;return {error:null};},
 download:async(path:string)=>{downloads++;const bytes=objects.get(path);return bytes?{data:new Blob([new Uint8Array(bytes)]),error:null}:{data:null,error:{code:'not_found'}};}
};}},rpc:async(name:string,args:{p_source_id:string;p_lease_token:string;p_batch:unknown})=>{
 assert.equal(name,'complete_instagram_run');try{return {data:await scalar('select public.complete_instagram_run($1,$2,$3::jsonb)',[args.p_source_id,args.p_lease_token,JSON.stringify(args.p_batch)]),error:null};}catch(error){return {data:null,error:{code:(error as {code?:string}).code??'test_sql_error'}};}
}} as unknown as SupabaseClient;
const environment={SOCIAL_COLLECTION_ENABLED:'true',IG_FB_USER_ACCESS_TOKEN:'synthetic-placeholder-token-123456',IG_CALLER_USER_ID:'17800000000000001'};
const provenance={invocationKind:'replay' as const,triggerRunId:'run_synthetic_instagram_replay',scheduleId:'sched_synthetic_instagram_replay',scheduledAt:'2026-10-21T01:00:00Z'};
const parent=(caption='Synthetic concert post, source publication only')=>({id:'18000000000000001',caption,media_type:'CAROUSEL_ALBUM',media_product_type:'FEED',timestamp:'2026-10-20T18:00:00+0000',permalink:'https://www.instagram.com/p/SyntheticReplay/',children:{data:[{id:'18000000000000002',media_type:'IMAGE'},{id:'18000000000000003',media_type:'VIDEO'}]}});
async function fixture(caption?:string,error=false){return collectInstagram(sourceId,{environment,fetch:async(input,options)=>{
 const url=new URL(String(input));assert.equal(url.origin,'https://graph.facebook.com');assert.equal(url.searchParams.has('access_token'),false);assert.equal(options?.redirect,'manual');assert.equal((options?.headers as Record<string,string>).Authorization,`Bearer ${environment.IG_FB_USER_ACCESS_TOKEN}`);
 return Response.json(error?{error:{code:190,error_subcode:463,message:'Fixture expired token'}}:{id:environment.IG_CALLER_USER_ID,business_discovery:{id:'17800000000000009',username:'clubdownunderfsu',media_count:1,media:{data:[parent(caption)]}}},{status:error?400:200});
 }});}
async function lease(){await sql("update public.sources set next_poll_at=date_bin(interval '1 hour',clock_timestamp(),timestamptz '2000-01-01Z'),next_due_at=clock_timestamp()-interval '1 minute',retry_not_before=null,lease_token=null,lease_until=null where id=$1",[sourceId]);return (await sql('select * from public.lease_due_instagram_sources(16,600)'))[0] as unknown as SourceLease;}
const checks:string[]=[];let readOnlyPolicyChecks=0;
async function check(name:string,fn:()=>Promise<void>){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
 for(const filename of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+filename,'utf8'));
 await sql('insert into auth.users(id) values($1)',[owner]);await sql('select public.configure_tracker_owner($1)',[owner]);
 await sql("insert into public.sources(id,owner_id,name,adapter,url,enabled,cadence_seconds,next_due_at,next_poll_at,coverage_note) values($1,$2,'Synthetic replay account','instagram-business-discovery-v1','https://www.instagram.com/clubdownunderfsu/',true,3600,now(),now(),'Replay fixture; not a live fetch')",[sourceId,owner]);
 // Real service-role checks apply to RPCs, table writes and grants below.
 await db.exec('set role service_role');
 let initialId:unknown;
 await check('actual collector → private upload adapter → SQL RPC persists one publication without an event',async()=>{
  const b=await fixture();assert.equal(b.status,'success');await ingestInstagramBatch(await lease(),b,client,provenance);
  assert.equal(await scalar('select count(*)::integer from public.instagram_updates'),1);assert.equal(await scalar('select count(*)::integer from public.opportunities'),0);assert.equal(await scalar('select count(*)::integer from public.occurrences'),0);assert.equal(await scalar('select count(*)::integer from public.captures'),1);assert.equal(objects.size,1);initialId=await scalar('select id from public.instagram_updates');
  const run=(await sql('select * from public.source_runs'))[0];assert.equal(run.invocation_kind,'replay');assert.equal(run.trigger_run_id,provenance.triggerRunId);assert.equal((run.collection_window as Record<string,unknown>).history_complete,false);
 });
 await check('replayed response verifies duplicate object bytes and preserves stable identities/versions',async()=>{
  await ingestInstagramBatch(await lease(),await fixture(),client,provenance);assert.equal(uploads,1);assert.equal(reuses,1);assert.equal(downloads,1);assert.equal(await scalar('select count(*)::integer from public.instagram_update_versions'),1);assert.equal(await scalar('select count(*)::integer from public.captures'),1);assert.equal(await scalar('select id from public.instagram_updates'),initialId);
 });
 await check('caption edit creates one new private projection/version and keeps prior version plus identity',async()=>{
  await ingestInstagramBatch(await lease(),await fixture('Synthetic edited scholarship caption'),client,provenance);assert.equal(uploads,2);assert.equal(await scalar('select count(*)::integer from public.instagram_update_versions'),2);assert.equal(await scalar('select count(*)::integer from public.captures'),2);assert.equal(await scalar('select id from public.instagram_updates'),initialId);
 });
 await check('corrupt duplicate Storage bytes stop ingestion before any run or cursor update',async()=>{
  const l=await lease(),b=await fixture('Synthetic edited scholarship caption'),before=await scalar('select count(*)::integer from public.source_runs'),cursor=await scalar('select cursor from public.sources where id=$1',[sourceId]);const entry=[...objects.entries()][1];objects.set(entry[0],Buffer.from('corrupt fixture bytes'));
  await assert.rejects(()=>ingestInstagramBatch(l,b,client,provenance),/could not be verified|hash differs/);assert.equal(await scalar('select count(*)::integer from public.source_runs'),before);assert.deepEqual(await scalar('select cursor from public.sources where id=$1',[sourceId]),cursor);objects.set(entry[0],entry[1]);
 });
 await check('real collector expired-token result reaches blocked health, preserving prior posts and last success',async()=>{
  const before=(await sql('select cursor,last_success_at from public.sources where id=$1',[sourceId]))[0],b=await fixture(undefined,true);assert.equal(b.status,'blocked');assert.equal(b.failureCategory,'token_expired');await ingestInstagramBatch(await lease(),b,client,provenance);
  const after=(await sql('select cursor,last_success_at,health_status from public.sources where id=$1',[sourceId]))[0];assert.deepEqual(after.cursor,before.cursor);assert.deepEqual(after.last_success_at,before.last_success_at);assert.equal(after.health_status,'blocked');assert.equal(await scalar('select count(*)::integer from public.instagram_updates'),1);
 });
 await db.exec('reset role');
 await check('hosted read-only policy audit script validates against populated local PostgreSQL without changes',async()=>{
  // Storage compatibility metadata is synthetic; the immutable payloads above are in-memory fixtures.
  for(const path of objects.keys())await sql("insert into storage.objects(bucket_id,name) values('captures',$1)",[path]);
  const before=await scalar('select count(*)::integer from public.source_runs');
  const results=await db.exec(await readFile('scripts/hosted-instagram-rls-check.sql','utf8'));
  const audit=results.flatMap(result=>result.rows as Record<string,unknown>[]).find(row=>row.instagram_rls_checks)?.instagram_rls_checks as {failed:number;test_count:number};
  assert.ok(audit);assert.equal(audit.failed,0);readOnlyPolicyChecks=audit.test_count;assert.equal(await scalar('select count(*)::integer from public.source_runs'),before);
 });
 const report={runAt:new Date().toISOString(),passed:checks.length,checks,readOnlyPolicyChecks,fixtureClass:'Replayed synthetic Meta HTTP; production collector/ingestion modules; actual PGlite PostgreSQL; in-memory immutable Storage substitute',uploads,reuses,verifiedDownloads:downloads,privateTestObjects:objects.size,sqlSourceRuns:await scalar('select count(*)::integer from public.source_runs'),postIdentities:await scalar('select count(*)::integer from public.instagram_updates'),contentVersions:await scalar('select count(*)::integer from public.instagram_update_versions'),calendarWrites:0,paidServicesEnabled:0,notTested:['Hosted Supabase Storage/HTTP JWT','Live Meta access/token lifetime','Actual Trigger scheduled execution','Storage upload and SQL cannot roll back as one transaction; safe orphan cleanup remains open']};
 await writeFile('reports/instagram-worker-replay.json',JSON.stringify(report,null,2)+'\n');console.log(`${checks.length} collector/ingestion/SQL replay checks passed.`);
}finally{await db.close();}
