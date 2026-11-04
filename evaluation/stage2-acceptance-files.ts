/** Filesystem custody adapter. Construction never opens gold or predictions. */
import { mkdirSync,readFileSync,realpathSync,statSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { digest,stableJson,safeArtifactPath,type BlindedIo,type CandidateFreeze } from './stage2-acceptance-guards';
/** Rejects symlink escapes before opening any original-source bytes. */
export function filesystemSealedSourceReader(rootPath:string,freeze:Pick<CandidateFreeze,'sourceCustodyPath'>){
 if(!/^private\/stage2-sealed-holdout\/[a-f0-9]{16}\/integrity-manifest\.json$/.test(freeze.sourceCustodyPath))throw new Error('Unsafe original source custody manifest path');
 const root=realpathSync(rootPath),declared=path.dirname(path.resolve(root,freeze.sourceCustodyPath)),sealed=realpathSync(declared);
 if(sealed!==declared||!sealed.startsWith(root+path.sep))throw new Error('Sealed custody directory must not redirect to another directory');
 return(file:string)=>{
  if(path.isAbsolute(file)||file.split(/[\\/]/).some(part=>part==='..'||part.startsWith('.env')))throw new Error('Unsafe sealed source path');
  const target=realpathSync(path.resolve(root,file));if(target.split(path.sep).some(part=>part.startsWith('.env')))throw new Error('Resolved source credential path is forbidden before read');if(!target.startsWith(sealed+path.sep))throw new Error('Original source symlink escaped sealed custody before read');
  if(statSync(target).size>64*1024*1024)throw new Error('Original source input exceeds bounded file size');return readFileSync(target);
 };
}
export function filesystemBlindedIo(options:{root:string;freeze:CandidateFreeze;predictionsPath:string;goldPath:string}):BlindedIo {
  const root=realpathSync(options.root);
  if(!/^private\/stage2-acceptance-predictions\//.test(options.predictionsPath)||!/^private\/stage2-acceptance-human-review\//.test(options.goldPath))throw new Error('Use dedicated private prediction/annotation paths');
  function existing(file:string){
    if(path.isAbsolute(file)||file.split(/[\\/]/).some(part=>part==='..'||part==='.env'||part.startsWith('.env.')))throw new Error('Unsafe private custody path');
    const actual=realpathSync(path.resolve(root,file));if(!actual.startsWith(root+path.sep)||actual.split(path.sep).some(part=>part==='.env'||part.startsWith('.env.')))throw new Error('Custody file escaped workspace or resolved to credentials');
    if(statSync(actual).size>64*1024*1024)throw new Error('Acceptance input exceeds bounded file size');return actual;
  }
  const read=(file:string)=>readFileSync(existing(file));
  const folder=path.join(root,'private','stage2-acceptance-runs',options.freeze.sourceCustodySha256);
  return {
    readCode:file=>{const target=existing(safeArtifactPath(file));safeArtifactPath(path.relative(root,target));return readFileSync(target);},
    verifySourceCustody:()=>{
      const bytes=filesystemSealedSourceReader(root,options.freeze)(options.freeze.sourceCustodyPath),manifest=JSON.parse(bytes.toString('utf8')) as {coreCases:Array<{blindId:string}>};
      if(!Array.isArray(manifest.coreCases)||manifest.coreCases.some(item=>typeof item.blindId!=='string'))throw new Error('Source custody roster missing');
      const ids=manifest.coreCases.map(item=>item.blindId);if(new Set(ids).size!==ids.length)throw new Error('Source custody roster duplicated');
      return {sourceCustodySha256:digest(bytes),caseRosterSha256:digest(stableJson(ids.sort()))};
    },
    readPredictions:()=>read(options.predictionsPath),
    claimOnce:(cohort,receipt)=>{
      if(cohort!==options.freeze.sourceCustodySha256)throw new Error('Source cohort differs');
      mkdirSync(folder,{recursive:true,mode:0o700});if(!realpathSync(folder).startsWith(root+path.sep))throw new Error('Receipt directory escaped workspace');
      // File identity is keyed by source custody, not a candidate ID or a new timestamp.
      writeFileSync(path.join(folder,'claim.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    },
    readGold:()=>read(options.goldPath),
    finishReceipt:receipt=>writeFileSync(path.join(folder,'result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600}),
  };
}
