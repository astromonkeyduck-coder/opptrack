/** Synthetic malformed metadata/credential alias only. No real source, gold or token is read. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,writeFileSync,symlinkSync,rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd();
test('acceptance CLIs redact malformed JSON snippets and reject resolved credential aliases before reading',()=>{
 const directory=mkdtempSync(path.join(root,'private','stage2-SYNTHETIC-cli-'));try{
  const malformed=path.join(directory,'malformed.json'),credential=path.join(directory,'.env.synthetic'),alias=path.join(directory,'alias.json'),fragment='SYNTHETIC_PRIVATE_NOT_A_REAL_TOKEN';writeFileSync(malformed,fragment);writeFileSync(credential,fragment);symlinkSync(credential,alias);
  for(const script of ['scripts/stage2-acceptance-tool.ts','scripts/stage2-score-acceptance.ts'])for(const file of [malformed,alias]){
   const args=script.endsWith('acceptance-tool.ts')?['freeze',path.relative(root,file),'evaluation/SYNTHETIC-NEVER-WRITTEN.json']:['source-views',path.relative(root,file),'SYNTHETIC-OWNER','SYNTHETIC-EXPOSURE','SYNTHETIC-OUTPUT'];
   const result=spawnSync(process.execPath,['--import','tsx',script,...args],{cwd:root,encoding:'utf8',timeout:20000});assert.equal(result.status,2);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(fragment),false);const error=JSON.parse(result.stderr.trim());assert.equal(error.stage2Accepted,false);assert.equal(error.status,'blocked');if(file===alias)assert.match(error.message,/credential/i);else assert.match(error.message,/Invalid .*metadata/i);
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
