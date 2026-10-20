import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const commands = [
  ['npm', ['test']],
  ['npm', ['run','test:db']],
  ['npm', ['run','prove:live']],
  ['node', ['--import','tsx','scripts/prove-dispatcher-replay.ts']],
  ['npm', ['run','evidence:inbox']],
  ['npm', ['run','typecheck']],
  ['npm', ['run','build']],
  ['make', ['check']],
  ['git', ['diff','--check']],
];
const results=[];
for (const [command,args] of commands) {
  console.log(`Running: ${command} ${args.join(' ')}`);
  const result=spawnSync(command,args,{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  results.push({command:[command,...args].join(' '),exitCode:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message??null});
  console.log(`Result: ${result.status===0?'PASS':'FAIL'}`);
}
writeFileSync('reports/stage-1-verification.json',JSON.stringify({runAt:new Date().toISOString(),results,pass:results.every(r=>r.exitCode===0),boundaries:'Local checks; raw live responses are private. Hosted Auth/Storage/Trigger/Netlify are not verified by this script.'},null,2)+'\n');
process.exitCode=results.every(r=>r.exitCode===0)?0:1;
