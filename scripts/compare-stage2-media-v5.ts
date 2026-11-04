import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractCandidates } from '../lib/extraction/text-v5';
import { extractCandidates as extractV4 } from '../lib/extraction/text-v4';
import { validateExtractionResult, type ExtractionCandidate } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';
import { evaluationSha256 } from '../evaluation/stage2-evaluator';
const hash = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex');
const norm = (v: unknown) => typeof v === 'string' ? v.normalize('NFKC').replace(/\s+/g,' ').trim() : v ?? null;
const packetPath = 'private/stage2-dated-flyers/run-2026-11-03T03-38-54.691Z/human-review.json';
const packetBytes = await readFile(packetPath), packet = JSON.parse(packetBytes.toString());
const mappingPath = 'evaluation/stage2-approved-media-mapping-v2.json', mappingBytes = await readFile(mappingPath), mapping = JSON.parse(mappingBytes.toString());
const probeBytes = await readFile('reports/stage-2-media-v4-development-probe.json'), probe = JSON.parse(probeBytes.toString());
assert.equal(hash(packetBytes), probe.sourcePacketSha256);
for (const path of ['lib/extraction/media-v2.ts','lib/extraction/text-v4.ts','lib/extraction/structured.ts','lib/extraction/text-prose-v4.ts','lib/extraction/text-media-v4.ts']) assert.equal(hash(await readFile(path)), probe.implementation[path], `Frozen native2/v4 dependency changed: ${path}`);
const implementation = Object.fromEntries(await Promise.all(['lib/extraction/text-v5.ts','lib/extraction/text-media-v5.ts','lib/extraction/structured-v5.ts','lib/extraction/contracts.ts','lib/extraction/text-prose-v4.ts','lib/extraction/text-media-v4.ts','lib/extraction/text.ts','lib/extraction/media-v2.ts','package-lock.json'].map(async path => [path,hash(await readFile(path))])));
const approval = JSON.parse(await readFile('reports/stage-2-next25-human-review.json','utf8'));
const overlayRef = approval.privateOverlays.find((o:{path:string}) => o.path.endsWith('media5-overlay.json'));
const overlayBytes = await readFile(overlayRef.path); assert.equal(hash(overlayBytes), overlayRef.sha256);
const overlay = JSON.parse(overlayBytes.toString());
const variants = ['v4-native-v2-recorded','v4-native-v2-fresh','v5-native-v2-text-replay'] as const;
const results: Record<string, unknown[]> = Object.fromEntries(variants.map(v => [v,[]]));
for (const item of packet.cases) {
  const approved = overlay.examples.find((e:{exampleId:string}) => e.exampleId === item.id); assert.ok(approved);
  assert.equal(evaluationSha256(item.facts), approved.proposedFactsSha256);
  const original = await readFile(item.source.original); assert.equal(hash(original), approved.originalSha256);
  const savedBytes = await readFile(item.ocrResult), saved = JSON.parse(savedBytes.toString());
  const currentRef = probe.observations.find((o:{id:string}) => o.id === item.id); assert.ok(currentRef);
  const currentBytes = await readFile(currentRef.output); assert.equal(hash(currentBytes), currentRef.resultSha256);
  const current = JSON.parse(currentBytes.toString());
  for (const variant of variants) {
    const units: ExtractionUnit[] = current.units;
    const candidates: ExtractionCandidate[] = variant === 'v4-native-v2-recorded' ? current.candidates : variant === 'v4-native-v2-fresh' ? extractV4(units) : extractCandidates(units);
    if (variant === 'v4-native-v2-fresh') assert.equal(hash(JSON.stringify(candidates)),hash(JSON.stringify(current.candidates)),'Fresh unchanged v4 must reproduce the recorded native2 baseline');
    validateExtractionResult({version:'stage2-result-v1',units,candidates,complete:true,issues:[],stats:{processedAssets:1,expectedAssets:1,processedPages:units.length,engine:variant,elapsedMs:0}});
    const used = new Set<string>();
    const read = (candidate: ExtractionCandidate | undefined, field: string) => {
      if (candidate && Object.hasOwn(candidate.fields,field)) used.add(`${candidate.key}/${field}`);
      return candidate?.fields[field] ?? null;
    };
    const event = candidates.find(c => c.kind === 'event');
    function resolve(path: string): unknown {
      const [scope, ...parts] = path.split('.');
      if (scope === 'event') {
        const field = parts.join('.');
        if (field.includes('/date.')) { const direct = field.split('/')[0], value = read(event,direct); if (value !== null) return value; const date = read(event,'date'); const index = {year:0,month:1,day:2}[direct as 'year'|'month'|'day']; return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.split('-')[index]) : null; }
        if (field.includes('/')) { const [direct, fallback] = field.split('/'), value = read(event,direct); if (value !== null) return value; const local = read(event,fallback.split('.')[0]); return typeof local === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? local.slice(11) : null; }
        return read(event,field);
      }
      if (scope === 'resource') {
        const page = /^page(\d+)$/.exec(parts[0]), field = parts.at(-1)!;
        return read(candidates.find(c => c.kind === 'resource' && (page ? c.claims.some(claim => claim.evidence.some(s => s.unitId === `${item.id}:${page[1]}`)) : c.fields[field] !== null && c.fields[field] !== undefined)),field);
      }
      if (scope === 'action') return read(candidates.find(c => c.kind === 'action' && c.fields.actionPhase === parts[0]),parts[1]);
      if (scope === 'any') return read(candidates.find(c => c.fields[parts[0]] !== null && c.fields[parts[0]] !== undefined),parts[0]);
      return read(candidates.find(c => c.kind === 'action' && c.fields.actionType === scope),parts[0]);
    }
    const checks = Object.entries(mapping.fields[item.id] as Record<string,string>).map(([field,path]) => ({field,path,expected:item.facts[field],actual:resolve(path)})).map(c => ({...c,matches:norm(c.expected) === norm(c.actual),type:c.expected === null ? 'explicit_unknown' : 'nonnull_fact'}));
    const nonnull = candidates.flatMap(c => Object.entries(c.fields).filter(([,v]) => v !== null).map(([field,value]) => ({candidate:c.key,kind:c.kind,field,value})));
    const unscored = nonnull.filter(f => !used.has(`${f.candidate}/${f.field}`));
    const negative = item.facts.eventCount === 0 && item.facts.actionCount === 0;
    results[variant].push({id:item.id,checks,completeScopedFacts:checks.every(c => c.matches),negative,negativeFalsePositives:negative ? candidates.filter(c => c.kind !== 'resource').length : 0,detectedEvents:candidates.filter(c => c.kind === 'event').length,actionPhases:candidates.filter(c => c.kind === 'action').map(c => ({type:c.fields.actionType,phase:c.fields.actionPhase??null})),unscoredNonnull:unscored,unscoredReferenceFields:Object.keys(item.facts).filter(field => !checks.some(c => c.field === field)),predictionSha256:hash(JSON.stringify(candidates)),candidates});
  }
}
const totals = Object.fromEntries(variants.map(variant => {
  const cases = results[variant] as Array<{checks:Array<{matches:boolean;type:string}>;completeScopedFacts:boolean;negativeFalsePositives:number;unscoredNonnull:unknown[]}>;
  const all = cases.flatMap(c => c.checks), facts = all.filter(c => c.type === 'nonnull_fact'), unknown = all.filter(c => c.type === 'explicit_unknown');
  return [variant,{nonnullFacts:facts.length,matchedNonnullFacts:facts.filter(c => c.matches).length,explicitUnknowns:unknown.length,matchedExplicitUnknowns:unknown.filter(c => c.matches).length,casesAllMappedFactsMatch:cases.filter(c => c.completeScopedFacts).length,negativeEventActionFalsePositives:cases.reduce((n,c) => n+c.negativeFalsePositives,0),unscoredNonnullPredictions:cases.reduce((n,c) => n+c.unscoredNonnull.length,0)}];
}));
const recordedAt = new Date().toISOString(), dir = `private/stage2-media-v5-native-text-replay/${recordedAt.replace(/[:.]/g,'-')}`;
await mkdir(dir,{recursive:true,mode:0o700});
await writeFile(`${dir}/results.json`,JSON.stringify({results},null,2)+'\n',{mode:0o600,flag:'wx'});
const report = {version:'approved-media-v5-native-text-replay-v1',implementation,evidenceClass:'Local parser replay of all retained native2 page units on five human-approved development media sources; original bytes and page outputs hash-verified. No new OCR run, hostedv5 result or independent holdout claim.',recordedAt,mapping:{path:mappingPath,sha256:hash(mappingBytes)},reference:{path:packetPath,sha256:hash(packetBytes),humanApprovedDevelopment:true,independentAdjudication:false,overlaySha256:hash(overlayBytes)},probe:{path:'reports/stage-2-media-v4-development-probe.json',sha256:hash(probeBytes)},totals,results:Object.fromEntries(variants.map(v => [v,results[v].map(c => {const {candidates,...rest}=c as Record<string,unknown>;return rest;})])),privateOutput:`${dir}/results.json`,stage2Accepted:false,holdout:false,modelCalls:0,networkCalls:0,calendarCalls:0,limitations:['Same fixed partial mapping across recordedv4, freshv4 and freshv5 on identical native2 units; old v1 scoped report is preserved. This mapping additionally measures already-approved date-range and partial clock/day/month/phase facts.','No full canonical entity/extra-field adjudication, representative field precision or event/action recall is established. Extra predictions remain unscored, not correct.','This small exposed development set has five examples in three related families. One negative cannot establish false-positive accuracy.']};
await writeFile('reports/stage-2-media-v5-native-text-replay.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:'reports/stage-2-media-v5-native-text-replay.json',totals,stage2Accepted:false}));
process.exitCode = totals['v5-native-v2-text-replay'].matchedNonnullFacts < totals['v5-native-v2-text-replay'].nonnullFacts ? 1 : 0;
