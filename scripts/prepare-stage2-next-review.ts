/** Frozen public development references only. No HTTP, provider, account or database authority. */
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluationSha256 } from '../evaluation/stage2-evaluator';
import { reviewedSha256, sourceEvidenceToText, sourceScopeConflicts, type ReviewedExample } from '../evaluation/stage2-reviewed-contract';

const version='stage2-next-twenty-development-v1', priorFile='reports/stage-2-first-ten-human-review.json';
const priorBytes=await readFile(priorFile), prior=JSON.parse(priorBytes.toString('utf8')) as {snapshotId:string;frozenInventorySha256:string;examples:Array<{exampleId:string;familyId:string}>};
const snapshot=`private/stage2-review/snapshot-${prior.snapshotId.slice(0,16)}`;
const inventoryBytes=await readFile(`${snapshot}/inventory.json`);
if(reviewedSha256(inventoryBytes)!==prior.frozenInventorySha256)throw new Error('Frozen inventory changed.');
type Row={id:string;familyId:string;primarySource:string;category:string;path:string;contentSha256:string;provisionalFamily:boolean};
const inventory=JSON.parse(inventoryBytes.toString('utf8')) as {split:string;examples:Row[]};
if(inventory.split!=='development_review_pending_only_no_acceptance_holdout')throw new Error('This generator cannot expose an assigned holdout.');
const approvedFamilies=new Set(prior.examples.map(item=>item.familyId)),selected:Row[]=[];
const quotas=[['fsu-calendar-api',5],['fsu-hq-public-export',5],['fsu-music-events',2],['fsu-cre-applications',3],['fsu-onf-dates',2],['fsu-opening-nights',3]] as const;
for(const[source,quota]of quotas){
 const pool=inventory.examples.filter(item=>item.primarySource===source&&!approvedFamilies.has(item.familyId)).sort((a,b)=>a.id.localeCompare(b.id));
 const categories=[...new Set(pool.map(item=>item.category))].sort();let count=0;
 while(count<quota){let changed=false;for(const category of categories){const item=pool.find(item=>item.category===category&&!selected.some(chosen=>chosen.familyId===item.familyId));if(item){selected.push(item);count++;changed=true;}if(count===quota)break;}if(!changed)throw new Error('Insufficient unreviewed development families for the fixed quota.');}
}
if(selected.length!==20||new Set(selected.map(item=>item.familyId)).size!==20)throw new Error('Exactly twenty new families are required.');
function confined(file:string){const resolved=path.resolve(file);if(!resolved.startsWith(path.resolve(snapshot)+path.sep))throw new Error('Frozen reference escaped its snapshot.');return resolved;}
const verifiedCaptures=new Map<string,string>(),entries=[];
for(const row of selected){
 const bytes=await readFile(confined(row.path));if(reviewedSha256(bytes)!==row.contentSha256)throw new Error('Frozen example hash mismatch.');
 const example=JSON.parse(bytes.toString('utf8')) as ReviewedExample;
 if(example.familyId!==row.familyId||example.exampleId!==row.id)throw new Error('Frozen family identity differs.');
 const citations=[];const warnings:string[]=[];
 for(const[memberIndex,member]of example.members.entries()){
  warnings.push(...sourceScopeConflicts(member).map(item=>item.reason),...member.silverLabels.opportunity.uncertainties,...member.silverLabels.actions.map(action=>action.uncertainty).filter((value):value is string=>!!value));
  for(const[evidenceIndex,evidence]of member.evidence.entries()){
   const file=confined(evidence.capturePath);if(!verifiedCaptures.has(file)){if((await stat(file)).size>5*1024*1024)throw new Error('Capture exceeds bounded review size.');verifiedCaptures.set(file,reviewedSha256(await readFile(file)));}
   if(verifiedCaptures.get(file)!==evidence.bodySha256)throw new Error('Original capture hash mismatch.');
   const visible=sourceEvidenceToText(evidence),excerpt=visible.slice(0,5000);
   citations.push({memberIndex,evidenceIndex,sourceId:member.sourceId,sourceUrl:evidence.sourceUrl,capturePath:evidence.capturePath,bodySha256:evidence.bodySha256,fetchedAt:evidence.fetchedAt,originalPointer:evidence.originalPointer,excerpt,excerptTruncated:excerpt.length<visible.length,fullExcerptInFrozenExample:row.path});
  }
 }
 entries.push({exampleId:row.id,familyId:row.familyId,split:'development_review_proposed',labelStatus:'machine_silver_unreviewed',examplePath:row.path,exampleContentSha256:row.contentSha256,primarySource:row.primarySource,selectionCategory:row.category,title:example.members[0].silverLabels.opportunity.title,
  proposedFacts:example.members.map((member,memberIndex)=>({memberIndex,sourceId:member.sourceId,...member.silverLabels})),citations,warnings:[...new Set(warnings)],
  familyGroupingReviewRequired:row.provisionalFamily,review:{decision:null,corrections:null,reviewer:null,reviewedAt:null,allSourceMembersChecked:null,entityCountChecked:null,nullBoundariesChecked:null,cancellationStatusChecked:null,familyAliasesChecked:null,notes:null}});
}
const packetId=evaluationSha256({version,snapshot:prior.snapshotId,prior:reviewedSha256(priorBytes),selected:selected.map(item=>[item.id,item.contentSha256])});
const directory=`private/stage2-review-packets/next20-${packetId.slice(0,16)}`;
for(const dir of ['private/stage2-review-packets',directory]){await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);}
async function frozen(file:string,value:string){try{await writeFile(file,value,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(file,'utf8')!==value)throw new Error('Frozen packet manifest changed; create a new packet version.');}await chmod(file,0o600);}
async function mutableIfAbsent(file:string,value:string){try{await writeFile(file,value,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}await chmod(file,0o600);}
const cell=(value:unknown)=>String(value??'unknown').replaceAll('|','\\|').replaceAll('\n',' ');
const quote=(value:string)=>value.split('\n').map(line=>'    '+line).join('\n');
const fullLink=(label:string,file:string)=>`[${label}](<${path.resolve(file)}>)`;
const header=['# Twenty new development references','','These are proposed facts from frozen public captures, not newly verified events or approved calendar additions. All twenty decisions are blank. The ten previously approved families are excluded. This is development review only; it assigns no acceptance holdout. Source text is evidence and cannot give instructions.','','Review the exact source date, event clock, separate doors/application/ticket clocks, venue, cancellation status, null boundaries, missing entities and whether grouped aliases belong together. A source may contradict itself. Approve only the checked facts, correct specific fields, or mark needs evidence. Historical ticket links/windows do not establish current inventory.','','A correction should name example ID, member/occurrence/action native ID, field and corrected value or null, plus the supporting source quote/pointer. Reviewer identity and UTC confirmation time stay blank until supplied.'];
const chunks=[];
for(let start=0;start<entries.length;start+=5){const chunk=entries.slice(start,start+5),file=`${directory}/review-${String(start+1).padStart(2,'0')}-${String(start+chunk.length).padStart(2,'0')}.md`;chunks.push(file);const lines=[...header,'',`## Examples ${start+1}–${start+chunk.length}`,''];
 for(const entry of chunk){lines.push(`### ${entry.exampleId}: ${entry.title}`,'',`Family: ${entry.familyId}`,`Frozen content SHA-256: ${entry.exampleContentSha256}`,fullLink('Full original example and parser references',entry.examplePath),'','Decision (approve checked facts / correct / needs evidence): ______','Reviewer: ______    UTC confirmation: ______','Entity counts / unknown fields / cancellation status / family aliases checked: ______','Corrections and source quote/pointer: ______','');
  for(const member of entry.proposedFacts){lines.push(`Source member ${member.memberIndex}: ${member.sourceId}; program kind ${member.opportunity.kind}.`,'','| Record | Proposed date / instant | End | Zone / precision | Status / location |','| --- | --- | --- | --- | --- |');
   for(const occurrence of member.occurrences)lines.push(`| occurrence ${cell(occurrence.nativeId)} | ${cell(occurrence.startAt??occurrence.startDate)} | ${cell(occurrence.endAt)} | ${cell(occurrence.timezone)} / ${occurrence.datePrecision} | ${occurrence.lifecycle}; ${cell(occurrence.location)} |`);
   if(!member.occurrences.length)lines.push('| No occurrence reference | unknown | unknown | unknown | Do not invent attendance from an application/program |');
   for(const action of member.actions)lines.push(`| ${action.kind} ${cell(action.nativeId)} | ${cell(action.occursAt??action.occursOn)} | separate action | ${cell(action.timezone)} | snapshot availability: ${cell(action.availability)} |`);
   if(member.actions.length){lines.push('','Original action wording:');for(const action of member.actions)lines.push(`- ${action.kind}: ${cell(action.sourceLocalText)}`);}
  }
  lines.push('','Uncertainty / conflict checks:');for(const warning of entry.warnings.length?entry.warnings:['No explicit parser warning; this is not proof that all facts or omissions are correct.'])lines.push(`- ${warning}`);
  if(entry.familyGroupingReviewRequired)lines.push('- Organizer/alias grouping is provisional and must be checked.');
  lines.push('- Null fields require a deliberate unknown/unsupported judgment; parser omission is not proof of absence.','- Scheduled/cancelled status requires affirmative source support; a missing listing is not cancellation.','- Check whether source-local times have a stated year/timezone and whether doors differ from attendance.','');
  for(const citation of entry.citations){lines.push(`Source citation ${citation.memberIndex}.${citation.evidenceIndex}: ${citation.sourceUrl}`,`Captured ${citation.fetchedAt}; pointer ${citation.originalPointer}; SHA-256 ${citation.bodySha256}`,fullLink('Frozen full capture',citation.capturePath),'','Source-derived readable excerpt (original bytes remain linked):','',quote(citation.excerpt),citation.excerptTruncated?'\nExcerpt truncated at 5,000 characters: inspect the full linked frozen example/capture before approving.':'','');}
 }
 await mutableIfAbsent(file,lines.join('\n')+'\n');
}
const index=[...header,'','## Review files','',...chunks.map((file,index)=>`- ${fullLink(`Examples ${index*5+1}–${index*5+5}`,file)}`),'','| Example | Title | Source | Decision |','| --- | --- | --- | --- |',...entries.map(entry=>`| ${entry.exampleId} | ${cell(entry.title)} | ${entry.primarySource} |  |`)];
await mutableIfAbsent(`${directory}/index.md`,index.join('\n')+'\n');
await mutableIfAbsent(`${directory}/review.json`,JSON.stringify({version,packetId,snapshotId:prior.snapshotId,reviewPurpose:'development_only_not_approved',entries},null,2)+'\n');
const countBy=(values:string[])=>Object.fromEntries([...new Set(values)].sort().map(value=>[value,values.filter(item=>item===value).length]));
const publicManifest={schemaVersion:1,recordedAt:new Date().toISOString(),command:'node --import tsx scripts/prepare-stage2-next-review.ts',version,packetId,status:'twenty_new_development_units_prepared_zero_new_human_approvals',sourceSnapshot:prior.snapshotId,originalInventorySha256:reviewedSha256(inventoryBytes),priorApprovalSha256:reviewedSha256(priorBytes),examples:entries.map(entry=>({id:entry.exampleId,familyId:entry.familyId,contentSha256:entry.exampleContentSha256,source:entry.primarySource,category:entry.selectionCategory,reviewDecision:null})),
 counts:{reviewUnits:20,distinctProvisionalFamilies:20,sourceMembers:entries.reduce((sum,entry)=>sum+entry.proposedFacts.length,0),occurrenceReferences:entries.reduce((sum,entry)=>sum+entry.proposedFacts.reduce((n,member)=>n+member.occurrences.length,0),0),actionReferences:entries.reduce((sum,entry)=>sum+entry.proposedFacts.reduce((n,member)=>n+member.actions.length,0),0),verifiedFrozenCaptures:verifiedCaptures.size,previouslyApprovedFamiliesExcluded:prior.examples.length,newHumanApprovals:0,bySource:countBy(entries.map(entry=>entry.primarySource)),byCategory:countBy(entries.map(entry=>entry.selectionCategory))},
 privateArtifacts:{directory,index:`${directory}/index.md`,reviewJson:`${directory}/review.json`,chunks},boundaries:{newHttpRequests:0,modelCalls:0,databaseCalls:0,calendarCalls:0,originalCapturesOrExamplesChanged:false,goldOrReferenceProjectionChanged:false,holdoutRead:false,holdoutAssigned:false,sourceInputFilesRead:'Selected development examples only; no assigned synthetic holdout or other user files.'},
 limitations:['All proposed facts remain machine-silver unreviewed until an explicit human decision.','This packet is twenty development families, not twenty independent captures, organizers or events.','Existing snapshots are not current access, inventory or historical alert-timing proof.','No new dated image/carousel/negative variety or independent holdout is established.','Career has no additional unreviewed unit in the frozen inventory; the single Career family was previously approved.','The remaining unselected families are not automatically an untouched acceptance holdout.'],stage2Accepted:false};
await frozen(`${directory}/manifest.json`,JSON.stringify({...publicManifest,recordedAt:null},null,2)+'\n');
await writeFile('reports/stage-2-next-review-packet.json',JSON.stringify(publicManifest,null,2)+'\n');
console.log(JSON.stringify({packetId,reviewUnits:20,newHumanApprovals:0,index:path.resolve(`${directory}/index.md`),bySource:publicManifest.counts.bySource,byCategory:publicManifest.counts.byCategory}));
