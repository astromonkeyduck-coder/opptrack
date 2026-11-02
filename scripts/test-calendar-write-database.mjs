/** Real PostgreSQL roles, locks, RLS, constraints and migrated RPCs; synthetic facts, no provider calls. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const db = new PGlite();
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const checks=[]; const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const scalar=async(sql,args=[])=>Object.values((await query(sql,args))[0])[0];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
async function role(name,id,fn){await db.exec('set role '+name);await query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role;reset request.jwt.claim.sub');}}
const own=fn=>role('authenticated',owner,fn);
const preview=(kind,id)=>own(()=>scalar('select public.calendar_write_preview($1,$2)',[kind,id]));
const approve=(kind,id,fp,start=null,end=null)=>own(()=>scalar('select public.calendar_write_approve($1,$2,$3,$4,$5)',[kind,id,fp,start,end]));
const claim=id=>own(()=>scalar('select public.calendar_write_claim($1)',[id]));
const get=id=>own(()=>scalar('select public.calendar_write_get($1)',[id]));
const finish=(id,lease,state,error=null,retry=0)=>own(()=>scalar('select public.calendar_write_finish($1,$2,$3,$4,$5)',[id,lease,state,error,retry]));
let capture,opportunity,index=0;
const occurrence=async(values={})=>scalar("insert into public.occurrences(owner_id,source_id,opportunity_id,native_id,starts_at,ends_at,start_date,all_day,local_start_text,timezone,date_precision,location,status,capture_id,content_sha256) values($1,'fsu-calendar-api',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,repeat('c',64)) returning id",[owner,opportunity,'occ-'+(++index),values.start===undefined?'2099-11-05T15:00:00Z':values.start,values.end===undefined?'2099-11-05T16:00:00Z':values.end,values.date||null,values.allDay||false,'Published local clock','America/New_York',values.precision||'instant','Synthetic room',values.status||'scheduled',capture]);
const milestone=async()=>scalar("insert into public.milestones(owner_id,source_id,opportunity_id,native_id,kind,occurs_on,availability,uncertainty,capture_id,content_sha256) values($1,'fsu-calendar-api',$2,$3,'ticket_release','2099-11-05','unverified','Source timezone unknown',$4,repeat('d',64)) returning id",[owner,opportunity,'milestone-'+(++index),capture]);
const approved=async(kind,id,start=null,end=null)=>approve(kind,id,(await preview(kind,id)).fingerprint,start,end);
const count=()=>scalar('select count(*)::integer from tracker_private.calendar_write_commands');
const cipher='v1.'+'a'.repeat(16)+'.'+'b'.repeat(22)+'.'+'c'.repeat(32);
try{
  await db.exec(await readFile(new URL('../supabase/tests/bootstrap.sql',import.meta.url),'utf8'));
  const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrations)await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await check('all migrations including CLI-generated approval migration execute on PostgreSQL',async()=>assert.ok(migrations.some(f=>f.endsWith('_approved_calendar_writes.sql'))));
  await query('insert into auth.users(id) values($1),($2)',[owner,other]);
  await role('service_role',null,()=>scalar('select public.configure_tracker_owner($1)',[owner]));
  await own(()=>scalar("select public.calendar_connection_put_scoped($1,null,'https://www.googleapis.com/auth/calendar.events.owned',true)",[cipher]));
  capture=await scalar("insert into public.captures(owner_id,source_id,native_id,source_url,content_sha256,content_type,byte_count,parser_version,first_seen_at,fetched_at,retention_until) values($1,'fsu-calendar-api','calendar-write-fixture','https://calendar.fsu.edu',repeat('a',64),'application/json',2,'synthetic-calendar-write-v1',now(),now(),now()+interval '1 day') returning id",[owner]);
  opportunity=await scalar("insert into public.opportunities(owner_id,source_id,native_id,title,description,source_url,capture_id,content_sha256,uncertainties) values($1,'fsu-calendar-api','calendar-write-fixture','Synthetic campus event','<img src=x onerror=alert(1)> Synthetic fixture','https://calendar.fsu.edu/event/fixture',$2,repeat('b',64),'[\"Eligibility unverified\"]') returning id",[owner,capture]);
  const event=await occurrence(); const action=await milestone();
  const rpcs=[['calendar_write_preview','text,uuid'],['calendar_write_approve','text,uuid,text,timestamp with time zone,timestamp with time zone'],['calendar_write_get','uuid'],['calendar_write_list',''],['calendar_write_claim','uuid'],['calendar_write_finish','uuid,uuid,text,text,integer'],['calendar_connection_put_scoped','text,uuid,text,boolean']];
  await check('anonymous and worker lack execute privilege on every public and private approval RPC',async()=>{
    for(const [name,args] of rpcs)for(const schema of ['public','tracker_private'])for(const roleName of ['anon','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[roleName,`${schema}.${name}(${args})`]),false);
    for(const roleName of ['anon','service_role'])await role(roleName,null,()=>assert.rejects(()=>scalar('select public.calendar_write_preview($1,$2)',['occurrence',event]),/permission denied/));
  });
  await check('other authenticated users and empty sessions cannot preview or approve owner facts',async()=>{
    for(const id of [other,null])await role('authenticated',id,async()=>{
      await assert.rejects(()=>scalar('select public.calendar_write_preview($1,$2)',['occurrence',event]),/Not authorized/);
      await assert.rejects(()=>scalar('select public.calendar_write_approve($1,$2,$3)',['occurrence',event,'a'.repeat(64)]),/Not authorized/);
      await assert.rejects(()=>scalar('select public.calendar_write_list()'),/Not authorized/);
    });
  });
  await check('no role has direct approval table access; private table retains RLS',async()=>{
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='tracker_private.calendar_write_commands'::regclass"),true);
    for(const roleName of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[roleName,'tracker_private.calendar_write_commands',privilege]),false);
  });
  let firstPreview;
  await check('preview exposes current facts health uncertainty and stable fingerprint without creating a command',async()=>{
    firstPreview=await preview('occurrence',event);assert.equal(firstPreview.canApprove,true);assert.equal(firstPreview.targetId,event);assert.match(firstPreview.fingerprint,/^[0-9a-f]{64}$/);assert.equal(firstPreview.existingCommand,null);assert.ok(firstPreview.uncertainties.includes('Eligibility unverified'));assert.equal(await count(),0);assert.equal((await preview('occurrence',event)).fingerprint,firstPreview.fingerprint);
  });
  await check('fingerprints are independent of caller timezone',async()=>{
    await db.exec("set timezone='Pacific/Auckland'");assert.equal((await preview('occurrence',event)).fingerprint,firstPreview.fingerprint);await db.exec("set timezone='UTC'");
  });
  await check('invalid and unknown target kinds or IDs fail closed',async()=>{
    for(const kind of ['organizer','save',null])await assert.rejects(()=>preview(kind,event),/Invalid calendar target/);
    await assert.rejects(()=>preview('occurrence',other),/unavailable/);await assert.rejects(()=>approve(null,event,'x'),/Invalid calendar target/);
  });
  await check('source title change invalidates approval even without a revision bump',async()=>{
    await query("update public.opportunities set title='Changed synthetic title' where id=$1",[opportunity]);
    await assert.rejects(()=>approve('occurrence',event,firstPreview.fingerprint),/facts changed/);assert.equal(await count(),0);
  });
  await check('source time changes invalidate old approval',async()=>{
    const old=await preview('occurrence',event);await query("update public.occurrences set starts_at='2099-11-05T15:30:00Z' where id=$1",[event]);await assert.rejects(()=>approve('occurrence',event,old.fingerprint),/facts changed/);
  });
  await check('revision changes invalidate otherwise identical facts',async()=>{
    const old=await preview('occurrence',event);await query('update public.occurrences set revision=revision+1 where id=$1',[event]);await assert.rejects(()=>approve('occurrence',event,old.fingerprint),/facts changed/);
  });
  let command;
  await check('explicit approval persists one exact immutable payload and deterministic provider ID before any provider call',async()=>{
    command=await approved('occurrence',event);assert.equal(command.state,'pending');assert.equal(command.kind,'occurrence');assert.equal(command.targetId,event);assert.match(command.providerEventId,/^opp[0-9a-f]{64}$/);assert.deepEqual(command.payload.reminders,{useDefault:false});assert.equal(command.payload.extendedProperties.private.opptrackCommandId,command.id);assert.equal(command.payload.extendedProperties.private.opptrackFingerprint,(await preview('occurrence',event)).fingerprint);assert.equal(new Date(command.payload.start.dateTime).toISOString(),'2099-11-05T15:30:00.000Z');assert.equal(command.payload.start.timeZone,'America/New_York');assert.equal(command.payload.location,'Synthetic room');assert.doesNotMatch(command.payload.description,/<img|onerror/);assert.match(command.payload.description,/Source: https:\/\/calendar\.fsu\.edu/);assert.equal(await count(),1);
  });
  await check('duplicate approval returns same identity and payload without additional audit commands',async()=>{
    const again=await approved('occurrence',event);assert.deepEqual(again,command);assert.equal(await count(),1);assert.equal((await preview('occurrence',event)).existingCommand.id,command.id);
  });
  await check('Save and Pass remain separate and do not create additional calendar approvals',async()=>{
    await own(()=>scalar('select public.record_review_decision($1,$2,$3)',[event,'save',2]));await own(()=>scalar('select public.record_review_decision($1,$2,$3)',[event,'reject',2]));assert.equal(await count(),1);
  });
  await check('post-approval source changes do not mutate or replace the approved snapshot on duplicate click',async()=>{
    await query("update public.opportunities set title='Changed after approval' where id=$1",[opportunity]);await query("update public.occurrences set starts_at='2099-11-05T15:45:00Z',revision=revision+1 where id=$1",[event]);const again=await approved('occurrence',event);assert.deepEqual(again,command);assert.deepEqual((await get(command.id)).payload,command.payload);
  });
  await check('approved payload cannot be changed even by an accidental privileged SQL update',async()=>{
    await assert.rejects(()=>query("update tracker_private.calendar_write_commands set payload=payload||'{\"summary\":\"altered\"}' where id=$1",[command.id]),/immutable/);await assert.rejects(()=>query('update tracker_private.calendar_write_commands set target_id=$2 where id=$1',[command.id,other]),/immutable/);
  });
  await check('unknown end, zero duration, all-day, date-only and undated occurrences remain unapproved',async()=>{
    const invalid=[{end:null},{start:'2099-11-05T15:00:00Z',end:'2099-11-05T15:00:00Z'},{allDay:true},{start:null,end:null,date:'2099-11-05',precision:'date'},{start:null,end:null,precision:'unknown'}];
    for(const values of invalid){const id=await occurrence(values);const p=await preview('occurrence',id);assert.equal(p.canApprove,false);assert.equal(p.blockedReason,'unknown_interval');await assert.rejects(()=>approve('occurrence',id,p.fingerprint),/verified start and end/);}
  });
  await check('cancelled postponed unknown-status and past occurrences cannot be approved',async()=>{
    for(const status of ['cancelled','postponed','unknown']){const id=await occurrence({status});const p=await preview('occurrence',id);assert.equal(p.blockedReason,'not_scheduled');await assert.rejects(()=>approve('occurrence',id,p.fingerprint),/future scheduled/);}
    const id=await occurrence({start:'2020-01-01T15:00:00Z',end:'2020-01-01T16:00:00Z'});const p=await preview('occurrence',id);assert.equal(p.blockedReason,'event_started');await assert.rejects(()=>approve('occurrence',id,p.fingerprint),/future scheduled/);
  });
  await check('occurrence source times cannot be replaced with client-selected times',async()=>{
    const id=await occurrence();const p=await preview('occurrence',id);await assert.rejects(()=>approve('occurrence',id,p.fingerprint,'2099-12-01T15:00Z','2099-12-01T16:00Z'),/cannot be overridden/);
  });
  await check('action reminder remains separate from attendance and requires its own chosen future interval',async()=>{
    const p=await preview('milestone',action);assert.equal(p.canApprove,true);assert.equal(p.startsAt,null);assert.ok(p.uncertainties.includes('Source timezone unknown'));await assert.rejects(()=>approve('milestone',action,p.fingerprint),/Choose a future reminder/);
    for(const [start,end] of [['2020-01-01T15:00Z','2020-01-01T16:00Z'],['2099-12-01T15:00Z','2099-12-01T15:00Z'],['2099-12-01T15:00Z','2099-12-03T15:00Z'],['infinity','infinity']])await assert.rejects(()=>approve('milestone',action,p.fingerprint,start,end),/Choose a future reminder/);
    const reminder=await approve('milestone',action,p.fingerprint,'2099-12-01T15:00Z','2099-12-01T15:15Z');assert.equal(reminder.kind,'milestone');assert.match(reminder.payload.summary,/^Reminder: /);assert.notEqual(reminder.providerEventId,command.providerEventId);assert.equal(reminder.payload.location,undefined);assert.equal(await count(),2);
    assert.equal((await approve('milestone',action,p.fingerprint,'2099-12-01T15:00Z','2099-12-01T15:15Z')).id,reminder.id);
    await assert.rejects(()=>approve('milestone',action,p.fingerprint,'2099-12-01T16:00Z','2099-12-01T16:15Z'),/different approved reminder/);
  });
  await check('milestone version facts and uncertainty changes invalidate preview approval',async()=>{
    const id=await milestone();const p=await preview('milestone',id);await query("update public.milestones set uncertainty='New source caveat' where id=$1",[id]);await assert.rejects(()=>approve('milestone',id,p.fingerprint,'2099-12-01T15:00Z','2099-12-01T15:15Z'),/facts changed/);
    await query("insert into public.entity_versions(owner_id,milestone_id,capture_id,content_sha256,facts) values($1,$2,$3,repeat('d',64),'{\"source_local_text\":\"November 5 at 11am\",\"timezone\":null}')",[owner,id,capture]);
    const dated=await preview('milestone',id);assert.equal(dated.sourceLocalText,'November 5 at 11am');
    await query("update public.entity_versions set facts='{\"source_local_text\":\"November 6 at noon\",\"timezone\":null}' where milestone_id=$1",[id]);
    await assert.rejects(()=>approve('milestone',id,dated.fingerprint,'2099-12-01T15:00Z','2099-12-01T15:15Z'),/facts changed/);
  });
  await check('health updates are visible without replacing the current facts fingerprint',async()=>{
    const p=await preview('occurrence',event);await query("update public.sources set health_status='blocked',last_success_at='2026-01-01T00:00Z' where id='fsu-calendar-api'");const next=await preview('occurrence',event);assert.equal(next.sourceHealth,'blocked');assert.equal(next.fingerprint,p.fingerprint);assert.equal(new Date(next.lastSuccessAt).toISOString(),'2026-01-01T00:00:00.000Z');
  });
  let lease;
  await check('claim leases a pending command; an overlapping claim receives no lease or new attempt',async()=>{
    const first=await claim(command.id);lease=first.leaseToken;assert.match(lease,/^[a-f0-9-]{36}$/);assert.equal(first.state,'processing');assert.deepEqual(first.payload,command.payload);const overlapping=await claim(command.id);assert.equal(overlapping.leaseToken,undefined);assert.equal(await scalar('select attempts from tracker_private.calendar_write_commands where id=$1',[command.id]),1);
  });
  await check('other users and worker cannot claim finish get list or directly alter approved commands',async()=>{
    for(const roleName of ['authenticated','service_role','anon'])await role(roleName,roleName==='authenticated'?other:null,async()=>{
      await assert.rejects(()=>scalar('select public.calendar_write_claim($1)',[command.id]),/Not authorized|permission denied/);await assert.rejects(()=>scalar('select public.calendar_write_finish($1,$2,$3)',[command.id,lease,'succeeded']),/Not authorized|permission denied/);await assert.rejects(()=>scalar('select public.calendar_write_get($1)',[command.id]),/Not authorized|permission denied/);await assert.rejects(()=>scalar('select * from tracker_private.calendar_write_commands'),/permission denied/);
    });
  });
  await check('wrong lease and unrecognized states or raw errors cannot mark success',async()=>{
    await assert.rejects(()=>finish(command.id,other,'succeeded'),/lease changed/);await assert.rejects(()=>finish(command.id,lease,'pending'),/Invalid command result/);await assert.rejects(()=>finish(command.id,lease,'failed','Raw provider message <secret>'),/Invalid command result/);await assert.rejects(()=>finish(command.id,lease,'succeeded','network_error'),/Invalid command result/);await assert.rejects(()=>finish(command.id,lease,'failed','rate_limited',86401),/Invalid command result/);
  });
  await check('an uncertain provider response persists explicitly and retry floor prevents early calls',async()=>{
    const result=await finish(command.id,lease,'uncertain','rate_limited',60);assert.equal(result.state,'uncertain');assert.equal(result.lastError,'rate_limited');assert.ok(new Date(result.retryNotBefore)>new Date());const blocked=await claim(command.id);assert.equal(blocked.leaseToken,undefined);assert.equal(blocked.state,'uncertain');
  });
  await check('explicit retry after cooldown uses the original identity and immutable payload',async()=>{
    await query("update tracker_private.calendar_write_commands set retry_not_before=clock_timestamp()-interval '1 second' where id=$1",[command.id]);const retry=await claim(command.id);assert.match(retry.leaseToken,/^[a-f0-9-]{36}$/);assert.notEqual(retry.leaseToken,lease);assert.deepEqual(retry.payload,command.payload);assert.equal(retry.providerEventId,command.providerEventId);await assert.rejects(()=>finish(command.id,lease,'succeeded'),/lease changed/);lease=retry.leaseToken;
  });
  await check('expired leases cannot finish and explicit recovery fences the previous worker',async()=>{
    await query("update tracker_private.calendar_write_commands set lease_until=clock_timestamp()-interval '1 second' where id=$1",[command.id]);await assert.rejects(()=>finish(command.id,lease,'succeeded'),/expired/);const retry=await claim(command.id);assert.notEqual(retry.leaseToken,lease);await assert.rejects(()=>finish(command.id,lease,'succeeded'),/changed/);lease=retry.leaseToken;
  });
  await check('successful delivery is durable and repeated calls cannot acquire a new lease',async()=>{
    const success=await finish(command.id,lease,'succeeded');assert.equal(success.state,'succeeded');assert.equal(success.lastError,null);assert.equal((await claim(command.id)).leaseToken,undefined);await assert.rejects(()=>finish(command.id,lease,'failed','network_error'),/changed/);assert.equal((await get(command.id)).state,'succeeded');
  });
  await check('owner get/list return only durable approved commands and never expose lease secrets',async()=>{
    const listed=await own(()=>scalar('select public.calendar_write_list()'));assert.equal(listed.length,2);assert.ok(listed.every(c=>c.leaseToken===undefined));assert.equal(await get(other),null);
  });
  let revision;
  await check('legacy read-only connection put/get remains compatible and does not grant write scope',async()=>{
    const current=await own(()=>scalar('select public.calendar_connection_get()'));revision=await own(()=>scalar('select public.calendar_connection_put($1,$2)',[cipher,current.revision]));const stored=await own(()=>scalar('select public.calendar_connection_get()'));assert.equal(stored.scope,'https://www.googleapis.com/auth/calendar.events.readonly');assert.equal(stored.revision,revision);assert.equal(stored.authorization_generation,current.authorization_generation);
  });
  await check('explicit scoped connection put permits only owned-event or read-only scope with revision fencing',async()=>{
    const next=await own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3)',[cipher,revision,'https://www.googleapis.com/auth/calendar.events.owned']));assert.notEqual(next,revision);assert.equal((await own(()=>scalar('select public.calendar_connection_get()'))).scope,'https://www.googleapis.com/auth/calendar.events.owned');await assert.rejects(()=>own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3)',[cipher,revision,'https://www.googleapis.com/auth/calendar.events.owned'])),/connection changed/);await assert.rejects(()=>own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3)',[cipher,next,'https://www.googleapis.com/auth/calendar'])),/Unsupported calendar scope/);revision=next;
  });
  await check('old read-only reconnect explicitly downgrades scope without deleting approval history',async()=>{
    await own(()=>scalar('select public.calendar_connection_put($1,$2)',[cipher,revision]));assert.equal((await own(()=>scalar('select public.calendar_connection_get()'))).scope,'https://www.googleapis.com/auth/calendar.events.readonly');assert.equal(await count(),2);
  });
  await check('read-only grants cannot approve even valid occurrences',async()=>{
    const id=await occurrence();const p=await preview('occurrence',id);await assert.rejects(()=>approve('occurrence',id,p.fingerprint),/Reconnect Calendar/);
  });
  await check('new consent rotates destination generation, refresh preserves it and old approvals cannot migrate calendars',async()=>{
    const before=await own(()=>scalar('select public.calendar_connection_get()'));
    await own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3,true)',[cipher,before.revision,'https://www.googleapis.com/auth/calendar.events.owned']));
    const granted=await own(()=>scalar('select public.calendar_connection_get()'));assert.notEqual(granted.authorization_generation,before.authorization_generation);
    const id=await occurrence();const cmd=await approved('occurrence',id);assert.equal(cmd.connectionGeneration,granted.authorization_generation);
    await own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3,false)',[cipher,granted.revision,'https://www.googleapis.com/auth/calendar.events.owned']));
    const refreshed=await own(()=>scalar('select public.calendar_connection_get()'));assert.equal(refreshed.authorization_generation,granted.authorization_generation);
    const active=await claim(cmd.id);await finish(cmd.id,active.leaseToken,'failed','provider_transport');
    const oldPreview=await preview('occurrence',id);
    await own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3,true)',[cipher,refreshed.revision,'https://www.googleapis.com/auth/calendar.events.owned']));
    const reconnected=await own(()=>scalar('select public.calendar_connection_get()'));assert.notEqual(reconnected.authorization_generation,refreshed.authorization_generation);assert.notEqual((await preview('occurrence',id)).fingerprint,oldPreview.fingerprint);
    await assert.rejects(()=>claim(cmd.id),/authorization changed/);await assert.rejects(()=>approved('occurrence',id),/authorization changed/);assert.deepEqual((await get(cmd.id)).payload,cmd.payload);
    const freshId=await occurrence();const fresh=await approved('occurrence',freshId);assert.equal(fresh.connectionGeneration,reconnected.authorization_generation);
    await own(()=>scalar('select public.calendar_connection_put($1,$2)',[cipher,reconnected.revision]));await assert.rejects(()=>claim(fresh.id),/Reconnect Calendar/);
  });
  await check('public approval wrappers are invokers; private definers pin empty search paths',async()=>{
    for(const [name] of rpcs)for(const schema of ['public','tracker_private']){const row=(await query('select prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[schema,name]))[0];assert.equal(row.prosecdef,schema==='tracker_private');assert.ok(row.proconfig.includes('search_path=""'));}
  });
  await check('unsafe source URLs cannot enter a newly approved Google description',async()=>{
    const current=await own(()=>scalar('select public.calendar_connection_get()'));await own(()=>scalar('select public.calendar_connection_put_scoped($1,$2,$3,true)',[cipher,current.revision,'https://www.googleapis.com/auth/calendar.events.owned']));
    const id=await occurrence();await query("update public.opportunities set source_url='https://example.invalid/<b>unsafe</b>' where id=$1",[opportunity]);const p=await preview('occurrence',id);await assert.rejects(()=>approve('occurrence',id,p.fingerprint),/safe HTTPS/);
    await assert.rejects(()=>query('update public.opportunities set source_url=null where id=$1',[opportunity]),/not-null constraint/);
    await query("update public.opportunities set source_url='' where id=$1",[opportunity]);await assert.rejects(()=>approved('occurrence',id),/safe HTTPS/);
    await query("update public.opportunities set source_url='https://calendar.fsu.edu/event/fixture' where id=$1",[opportunity]);
  });
  await check('payload length limits fail before persisting an unexecutable approval',async()=>{
    const id=await occurrence();await query('update public.occurrences set location=repeat(\'x\',2001) where id=$1',[id]);const p=await preview('occurrence',id);assert.equal(p.canApprove,false);assert.equal(p.blockedReason,'payload_too_long');const before=await count();await assert.rejects(()=>approve('occurrence',id,p.fingerprint),/exceed supported lengths/);assert.equal(await count(),before);
  });
  await check('there is no approval dispatcher cron worker grant or provider execution in SQL',async()=>{
    const commandRows=await query('select state,count(*)::integer as count from tracker_private.calendar_write_commands group by state');assert.ok(commandRows.some(r=>r.state==='pending'));assert.equal(await scalar("select has_function_privilege('service_role','public.calendar_write_claim(uuid)','EXECUTE')"),false);
  });
  await check('new private schema usage exposes no pre-existing ingestion function to authenticated users',async()=>{
    const exposed=await query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tracker_private' and has_function_privilege('authenticated',p.oid,'EXECUTE') and p.proname not like 'calendar_%' and p.proname not in ('extraction_enqueue','extraction_retry','reconciliation_propose','reconciliation_preview','reconciliation_review')");assert.deepEqual(exposed,[]);
  });
  await writeFile(new URL('../reports/calendar-write-database-tests.json',import.meta.url),JSON.stringify({run_at:new Date().toISOString(),engine:'PGlite 0.5.10 (PostgreSQL WASM)',migrations,passed:checks.length,checks,fixture_data:'Synthetic records only; real SQL/RLS/roles, no live Google or hosted JWT calls',not_tested:['Hosted Auth HTTP/JWT verification','Independent concurrent PostgreSQL connections','Google OAuth consent or provider writes','Powered-off operation']},null,2)+'\n');
  console.log(`${checks.length} approval-only calendar SQL checks passed.`);
}finally{await db.close();}
