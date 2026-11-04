/** Acceptance-only source/prediction contracts. No gold, networking or application effects. */
import { z } from 'zod';
import { extractionResultSchema, validateExtractionResult, type ExtractionResult } from '../lib/extraction/contracts';
import { digest, stableJson, validatePredictionSeal, type CandidateFreeze, type SourceView } from './stage2-acceptance-guards';
import { transformPublicText } from './stage2-source-only-transform-v3';
const id=z.string().min(1).max(160),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const sourceViewSchema=z.object({caseId:id,unitId:id,sha256:hash,text:z.string().max(2*1024*1024).optional(),representation:z.enum(['original-text','transformed-text','media']).optional(),assetSha256:hash.optional(),page:z.number().int().positive().nullable().optional()}).strict();
const assetSchema=z.object({assetId:id,sha256:hash,mimeType:id,expectedPages:z.number().int().positive().nullable(),kind:z.enum(['text','media'])}).strict();
export const sourceCaseSchema=z.object({caseId:id,assets:z.array(assetSchema).min(1),views:z.array(sourceViewSchema).min(1)}).strict();
export type AcceptanceSourceCase=z.infer<typeof sourceCaseSchema>;
export type AcceptanceReconciliationSource={sourceId:string;unitId:string;start:number;end:number;text:string;sourceUrl:{value:string;origin:'json.url'|'json.localist_url'|'ics.URL'}|null;description:string};
export type SourceOnlyInput={reconciliationSources:AcceptanceReconciliationSource[];description:AcceptanceSourceCase;textUnits:Array<{assetId:string;text:string;sha256:string}>;mediaAssets:Array<{assetId:string;bytes:Uint8Array;mimeType:string;expectedSha256:string}>};
const ref=z.object({caseId:id,candidateKey:id}).strict();
export const relationProposalSchema=z.object({left:ref,right:ref,relation:z.enum(['same_occurrence','same_program_distinct_occurrence','different','unresolved'])}).strict();
export type RelationProposal=z.infer<typeof relationProposalSchema>;
export const predictionBodySchema=z.object({
 version:z.literal('stage2-acceptance-predictions-v1'),
 sourceInventory:z.array(sourceCaseSchema).min(1),sourceInventorySha256:hash,
 frozenSourceViews:z.array(sourceViewSchema).min(1),
 predictionExtractionResults:z.array(z.object({candidateId:id,caseId:id,status:z.enum(['completed','failed']),failure:z.string().max(160).nullable(),result:extractionResultSchema.nullable()}).strict()).min(1),
 reconciliation:z.array(z.object({candidateId:id,relations:z.array(relationProposalSchema)}).strict()).min(1),
}).strict();
export type AcceptancePredictionBody=z.infer<typeof predictionBodySchema>;
export function validateAcceptancePredictions(bytes:Uint8Array,freeze:CandidateFreeze,expectedSources:AcceptanceSourceCase[]) {
 const seal=validatePredictionSeal(bytes,freeze),body=predictionBodySchema.parse(seal.predictions);
 const ordered=(sources:AcceptanceSourceCase[])=>[...sources].sort((a,b)=>a.caseId.localeCompare(b.caseId));
 if(body.sourceInventorySha256!==digest(stableJson(ordered(body.sourceInventory)))||stableJson(ordered(body.sourceInventory))!==stableJson(ordered(expectedSources)))throw Error('Prediction source inventory differs from verified frozen original assets');
 const views=expectedSources.flatMap(item=>item.views);
 if(stableJson(body.frozenSourceViews)!==stableJson(views))throw Error('Prediction source views differ from verified source-only transform');
 const keys=new Set<string>();
 for(const item of body.predictionExtractionResults){const key=item.candidateId+'\0'+item.caseId;if(keys.has(key)||!freeze.caseIds.includes(item.caseId)||!freeze.candidates.some(c=>c.id===item.candidateId))throw Error('Prediction case/candidate roster duplicated or invented');keys.add(key);
  if(item.status==='failed'){if(item.result!==null||!item.failure)throw Error('Failed processing must retain an explicit failure, never an empty success');}
  else {if(!item.result||item.failure!==null)throw Error('Completed processing lacks its extraction result');validateExtractionResult(item.result);
   const source=expectedSources.find(source=>source.caseId===item.caseId)!;
   for(const unit of item.result.units){const asset=source.assets.find(asset=>asset.assetId===unit.assetId),view=source.views.find(view=>view.unitId===`${unit.assetId}:${unit.page??0}`&&view.representation!=='original-text');
    if(!asset||(!view&&unit.status==='processed')||unit.sha256!==(asset.kind==='text'?view?.sha256:asset.sha256))throw Error('Prediction extraction unit is not bound to its original source asset/page');
    if(unit.status==='processed'&&asset.kind==='text'&&(unit.method!=='provided-text'||unit.text!==view?.text))throw Error('Prediction provided text differs from the frozen source-only transform');
    if(asset.kind==='media'&&unit.method==='provided-text')throw Error('Prediction substitutes a transcript for original media');
   }
  }
 }
 if(keys.size!==freeze.caseIds.length*freeze.candidates.length)throw Error('Prediction case/candidate roster incomplete');
 const candidates=new Set<string>();for(const entry of body.reconciliation){if(candidates.has(entry.candidateId)||!freeze.candidates.some(c=>c.id===entry.candidateId))throw Error('Reconciliation candidate roster differs');candidates.add(entry.candidateId);const pairs=new Set<string>();
  for(const proposal of entry.relations){const names=[proposal.left,proposal.right].map(ref=>ref.caseId+'\0'+ref.candidateKey);const pair=[...names].sort().join('\u0001');if(names[0]===names[1]||pairs.has(pair))throw Error('Duplicate/self reconciliation proposal');pairs.add(pair);
   for(const ref of [proposal.left,proposal.right])if(!body.predictionExtractionResults.find(row=>row.candidateId===entry.candidateId&&row.caseId===ref.caseId)?.result?.candidates.some(candidate=>candidate.key===ref.candidateKey))throw Error('Reconciliation references an unknown prediction');
  }
 }
 if(candidates.size!==freeze.candidates.length)throw Error('Reconciliation candidate roster incomplete');return body;
}
/** Reads only hash-verified sealed source records/originals, not annotations or predictions. */
export function loadAcceptanceSources(freeze:CandidateFreeze,readSource:(relativePath:string)=>Uint8Array):SourceOnlyInput[]{
 const base=freeze.sourceCustodyPath.slice(0,freeze.sourceCustodyPath.lastIndexOf('/')+1);
 const read=(file:string)=>{if(!file.startsWith(base)||file.split('/').some(part=>part==='..'||part.startsWith('.env'))||file.includes('\\'))throw Error('Source custody path escaped its sealed directory');return readSource(file);};
 const manifestBytes=read(freeze.sourceCustodyPath);if(digest(manifestBytes)!==freeze.sourceCustodySha256)throw Error('Original source custody changed');
 const manifest=z.object({coreCases:z.array(z.object({blindId:id,sourceRecord:id,sourceRecordSha256:hash,assetHashes:z.array(hash)}).passthrough())}).passthrough().parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
 if(stableJson(manifest.coreCases.map(row=>row.blindId).sort())!==stableJson([...freeze.caseIds].sort()))throw Error('Original source roster changed');
 return manifest.coreCases.map(row=>{
  const recordBytes=read(row.sourceRecord);if(digest(recordBytes)!==row.sourceRecordSha256)throw Error('Original source record changed');
  const record=z.object({blindId:id,humanLabels:z.null(),candidatePredictions:z.null(),goldWasNotUsedToConstructSource:z.literal(true),knownPdfPageCount:z.number().int().positive().optional(),assets:z.array(z.object({path:id,sha256:hash,bytes:z.number().int().nonnegative(),mime:id,captureComplete:z.boolean().optional(),allOriginalPdfPagesRetained:z.boolean().optional(),allPageViews:z.array(z.object({path:id,sha256:hash,bytes:z.number().int().nonnegative(),page:z.number().int().positive()}).passthrough()).optional()}).passthrough()).min(1)}).passthrough().parse(JSON.parse(new TextDecoder().decode(recordBytes)));
  if(record.blindId!==row.blindId||stableJson(record.assets.map(asset=>asset.sha256))!==stableJson(row.assetHashes))throw Error('Source record identity/assets changed');
  const input:SourceOnlyInput={reconciliationSources:[],description:{caseId:row.blindId,assets:[],views:[]},textUnits:[],mediaAssets:[]};
  for(const [index,asset]of record.assets.entries()){
   const body=read(asset.path);if(body.byteLength!==asset.bytes||digest(body)!==asset.sha256||asset.captureComplete===false)throw Error('Original asset missing, incomplete or changed');
   const assetId=`source-${index+1}`,mimeType=asset.mime.split(';')[0],isMedia=mimeType==='application/pdf'||mimeType==='image/png'||mimeType==='image/jpeg';
   if(isMedia){const pages=mimeType==='application/pdf'?record.knownPdfPageCount:null;if(mimeType==='application/pdf'&&(!pages||!asset.allOriginalPdfPagesRetained||asset.allPageViews?.length!==pages))throw Error('Original PDF page inventory incomplete');
    const pageNumbers=new Set<number>();for(const view of asset.allPageViews??[]){const image=read(view.path);if(digest(image)!==view.sha256||image.byteLength!==view.bytes||pageNumbers.has(view.page)||view.page>(pages??0))throw Error('Retained original page view changed');pageNumbers.add(view.page);}
    input.description.assets.push({assetId,sha256:asset.sha256,mimeType,expectedPages:pages??null,kind:'media'});input.mediaAssets.push({assetId,bytes:body,mimeType,expectedSha256:asset.sha256});
    for(const page of pages?Array.from({length:pages},(_,i)=>i+1):[null])input.description.views.push({caseId:row.blindId,unitId:`${assetId}:${page??0}`,sha256:asset.sha256,assetSha256:asset.sha256,page});
   }else{const originalText=new TextDecoder('utf-8',{fatal:true}).decode(body),text=transformPublicText({contentType:mimeType,rawInput:originalText}),sha256=digest(text);
    input.description.assets.push({assetId,sha256:asset.sha256,mimeType,expectedPages:null,kind:'text'});input.textUnits.push({assetId,text,sha256});input.description.views.push({caseId:row.blindId,unitId:`${assetId}:0`,sha256,text,representation:'transformed-text'});if(originalText!==text)input.description.views.push({caseId:row.blindId,unitId:`${assetId}:0`,sha256:asset.sha256,text:originalText,representation:'original-text'});
    const provider=typeof asset.sourceId==='string'?asset.sourceId:typeof record.sourceId==='string'?record.sourceId:typeof record.primarySource==='string'?record.primarySource:null;
    if(provider)input.reconciliationSources.push(...sourceReconciliationContexts({sourceId:provider,unitId:`${assetId}:0`,contentType:mimeType,originalText,transformedText:text}));
   }
  }return input;
 });
}
export function allFrozenSourceViews(sources:AcceptanceSourceCase[]):SourceView[]{return sources.flatMap(row=>row.views);}
export type ValidatedExtractionResult=ExtractionResult;

/** Fixed source-only authority extraction. Requested/feed URLs are intentionally never inputs. */
export function sourceReconciliationContexts(input:{sourceId:string;unitId:string;contentType:string;originalText:string;transformedText:string}):AcceptanceReconciliationSource[]{
 const out:AcceptanceReconciliationSource[]=[];
 if(input.contentType.includes('calendar')){
  if(input.originalText!==input.transformedText)return[];
  for(const match of input.originalText.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g)){const record=match[0],unfolded=record.replace(/\r?\n[ \t]/g,''),urls=[...unfolded.matchAll(/^URL(?:;[^:\r\n]*)?:(.*)$/gm)].map(row=>row[1].trim());
   out.push({sourceId:input.sourceId,unitId:input.unitId,start:match.index!,end:match.index!+record.length,text:record,sourceUrl:urls.length===1?{value:urls[0],origin:'ics.URL'}:null,description:unfolded});
  }
 }else if(input.contentType.includes('json')){
  let record:Record<string,unknown>;try{record=JSON.parse(input.originalText);}catch{return[];}if(!record||typeof record!=='object'||Array.isArray(record)||!((typeof record.id==='string'&&record.id.trim())||(typeof record.id==='number'&&Number.isFinite(record.id)))||!([record.title,record.name].some(value=>typeof value==='string'&&value.trim()))||['events','items','results','data'].some(key=>Array.isArray(record[key])))return[];
  const key=typeof record.url==='string'?'url':typeof record.localist_url==='string'?'localist_url':null,description=typeof record.description_text==='string'?record.description_text:typeof record.description==='string'?record.description:'';
  out.push({sourceId:input.sourceId,unitId:input.unitId,start:0,end:input.transformedText.length,text:input.transformedText,sourceUrl:key?{value:record[key]as string,origin:key==='url'?'json.url':'json.localist_url'}:null,description});
 }return out;
}
