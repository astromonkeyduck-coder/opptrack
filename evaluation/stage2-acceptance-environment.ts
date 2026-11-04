/** Nonsecret version-only local checks. Never reads source assets or credentials. */
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import type { CandidateFreeze } from './stage2-acceptance-guards';
export type AcceptanceVersions={nodeVersion:string;tesseract:string;pdfinfo:string;pdftotext:string;pdftoppm:string;sharp:string};
export function readAcceptanceVersions():AcceptanceVersions{
 const version=(command:'tesseract'|'pdfinfo'|'pdftotext'|'pdftoppm')=>{
  const result=spawnSync(command,[command==='tesseract'?'--version':'-v'],{encoding:'utf8',timeout:5000,maxBuffer:65536,env:{PATH:process.env.PATH??'/usr/local/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C'} as unknown as NodeJS.ProcessEnv,stdio:['ignore','pipe','pipe']});
  if(result.error||result.status!==0)throw Error('Native version check failed');
  return(result.stdout+'\n'+result.stderr).trim().split(/\r?\n/)[0];
 };
 return{nodeVersion:process.version,tesseract:version('tesseract'),pdfinfo:version('pdfinfo'),pdftotext:version('pdftotext'),pdftoppm:version('pdftoppm'),sharp:sharp.versions.sharp};
}
export function assertAcceptanceEnvironment(freeze:Pick<CandidateFreeze,'environment'>,versions:AcceptanceVersions=readAcceptanceVersions()){
 const expected=freeze.environment;if(expected.nodeVersion!==versions.nodeVersion)throw Error('Actual Node version differs from frozen environment');
 for(const key of ['tesseract','pdfinfo','pdftotext','pdftoppm','sharp']as const)if(expected.nativeTools[key]!==versions[key])throw Error('Actual native tool version differs from frozen environment');
 if(expected.locale!=='C'||expected.timeZone!=='UTC')throw Error('Acceptance runner requires frozen C locale and UTC');
}
