/** Synthetic text-transcript diagnostic. Never calls OCR, a provider, database or calendar. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extractCandidates} from '../lib/extraction/text';
import type {ExtractionUnit} from '../lib/extraction/media-types';
import {evaluatePredictions,validateCorpus,validateSplitManifest,type EvaluationCorpus,type Prediction,type SplitManifest} from './stage2-evaluator';

const corpus=JSON.parse(await readFile('evaluation/stage2-cases.json','utf8')) as EvaluationCorpus;
const manifest=JSON.parse(await readFile('evaluation/stage2-split-manifest.json','utf8')) as SplitManifest;
const errors=[...validateCorpus(corpus),...validateSplitManifest(corpus,manifest)];if(errors.length)throw new Error(errors.join('\n'));
const predictions:Prediction[]=corpus.cases.map(item=>{
 const units:ExtractionUnit[]=item.input.units.map(unit=>({assetId:unit.id,page:unit.kind==='pdf_page'?unit.index+1:null,status:unit.status==='available'?'processed':'blocked',method:'provided-text',text:unit.text||'',sha256:unit.status==='available'?createHash('sha256').update(unit.text||'').digest('hex'):null,issues:unit.status==='available'?[]:['input_unavailable']}));
 const candidates=extractCandidates(units,{publishedAt:item.input.publishedAt,timeZone:item.input.timeZone});
 const processedMedia=item.input.units.filter(unit=>unit.status==='available').map(unit=>unit.id);
 const complete=item.input.declaredMedia.every(id=>processedMedia.includes(id));
 return {caseId:item.id,units:candidates.map(candidate=>({key:candidate.key,kind:candidate.kind,fields:candidate.fields,evidenceFields:[...new Set(candidate.claims.map(claim=>claim.field))]})),processedMedia,status:complete?'complete':processedMedia.length?'partial':'blocked',issues:[...new Set(candidates.flatMap(candidate=>candidate.issues))],providerRequests:0,costUsd:0};
});
await mkdir('private/stage2-evaluation',{recursive:true,mode:0o700});
await writeFile('private/stage2-evaluation/rules-predictions.json',JSON.stringify({candidateId:'stage2-rules-v1',predictions},null,2)+'\n',{mode:0o600});
const report=evaluatePredictions(corpus,manifest,predictions,'stage2-rules-v1');
await writeFile('reports/stage-2-rules-diagnostic.json',JSON.stringify({...report,recordedAt:new Date().toISOString(),executionClass:'Synthetic text transcripts only; not real OCR or human-reviewed extraction accuracy',modelOrPromptComparisonRun:false,realMediaProbe:'reports/stage-2-native-media-supplied-probe.json'},null,2)+'\n');
console.log(JSON.stringify({candidateId:'stage2-rules-v1',cases:predictions.length,report:'reports/stage-2-rules-diagnostic.json',humanReviewedAcceptance:'not_evaluated',providerRequests:0}));
