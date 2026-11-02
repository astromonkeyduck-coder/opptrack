/** Local validation of the exact rollback SQL script, not a hosted service test. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111';
const scalar=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0])[0];
async function counts(){return scalar("select jsonb_build_object('jobs',(select count(*) from public.extraction_jobs),'attempts',(select count(*) from public.extraction_attempts),'intakes',(select count(*) from public.manual_intakes),'sources',(select count(*) from public.sources),'captures',(select count(*) from public.captures),'opportunities',(select count(*) from public.opportunities),'occurrences',(select count(*) from public.occurrences),'decisions',(select count(*) from public.user_decisions),'relations',(select count(*) from public.reconciliation_links),'history',(select count(*) from public.reconciliation_history),'commands',(select count(*) from tracker_private.calendar_write_commands))");}
try{
 await db.exec(await readFile('supabase/tests/bootstrap.sql','utf8'));
 const migrations=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const f of migrations)await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.query('insert into auth.users(id) values($1)',[owner]);await db.query('select public.configure_tracker_owner($1)',[owner]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await db.query("select public.calendar_connection_put_scoped($1,null,'https://www.googleapis.com/auth/calendar.events.owned',true)",['v1.'+'a'.repeat(16)+'.'+'b'.repeat(22)+'.'+'c'.repeat(32)]);
 const before=await counts();const results=await db.exec(await readFile('scripts/hosted-stage2-check.sql','utf8'));
 const audit=results.flatMap(r=>r.rows??[]).find(r=>r.stage2_audit)?.stage2_audit;
 assert.ok(audit&&audit.checks.every(c=>c.passed));assert.deepEqual(await counts(),before);
 const report={recordedAt:new Date().toISOString(),command:'node scripts/test-stage2-hosted-audit.mjs',evidenceClass:'Exact hosted rollback SQL replayed locally in actual PGlite PostgreSQL with synthetic owner/Auth/Storage metadata. Not hosted execution.',audit,allPersistentFixtureRowsRolledBack:true,credentialFilesRead:0,providerCalls:0,paidServices:0,migrations};
 await writeFile('reports/stage-2-hosted-audit-replay.json',JSON.stringify(report,null,2)+'\n');
 console.log(`${audit.passed}/${audit.checks.length} rollback audit checks passed locally; fixture rows completely rolled back. Hosted verification remains separate.`);
}finally{await db.close();}
