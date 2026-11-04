// Development-only native comparison. Approved facts never enter extraction.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { processMediaAssets } from '../lib/extraction/media-v2';
import { extractCandidates } from '../lib/extraction/text-v4';
import { validateExtractionResult } from '../lib/extraction/contracts';
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const sourcePath = 'private/stage2-dated-flyers/run-2026-11-03T03-38-54.691Z/human-review.json';
const sourceBytes = await readFile(sourcePath);
// Only these two properties are passed from the approved packet; no facts or review text.
const inputs = (JSON.parse(sourceBytes.toString()).cases as Array<{id:string;source:{original:string;sha256:string}}>).map(({id,source}) => ({ id, original: source.original, sha256: source.sha256 }));
const sourceFiles = [...(await readdir('lib/extraction')).filter(p => p.endsWith('.ts')).sort().map(p => `lib/extraction/${p}`), 'lib/calendar/time.ts', 'lib/intake/validation.ts', 'package-lock.json', 'evaluation/stage2-approved-media-mapping-v2.json'];
const implementation = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, digest(await readFile(path))])));
const startedAt = new Date().toISOString(), directory = `private/stage2-media-v4-development/${startedAt.replace(/[:.]/g,'-')}`;
await mkdir(directory,{recursive:true,mode:0o700});
const observations = [];
for (const item of inputs) {
  const bytes = await readFile(item.original); if (digest(bytes) !== item.sha256) throw new Error('Original source changed');
  const start = Date.now();
  const media = await processMediaAssets([{ assetId: item.id, bytes, mimeType: item.original.endsWith('.pdf') ? 'application/pdf' : item.original.endsWith('.png') ? 'image/png' : 'image/jpeg', expectedSha256: item.sha256 }]);
  const candidates = extractCandidates(media.units);
  const result = validateExtractionResult({ version: 'stage2-result-v1', units: media.units, complete: media.complete, candidates, issues: [], stats: { processedAssets: 1, expectedAssets: 1, processedPages: media.units.filter(u => u.status === 'processed').length, engine: media.engine, elapsedMs: Date.now() - start } });
  const output = `${directory}/${item.id}.json`, serialized = JSON.stringify(result,null,2)+'\n';
  await writeFile(output,serialized,{mode:0o600,flag:'wx'});
  observations.push({ id: item.id, originalSha256: item.sha256, originalBytes: bytes.length, output, resultSha256: digest(serialized), pages: result.units.length, complete: result.complete, elapsedMs: result.stats.elapsedMs, engine: result.stats.engine });
  console.log(JSON.stringify({id:item.id,complete:result.complete,pages:result.units.length,elapsedMs:result.stats.elapsedMs}));
}
for (const [path, hash] of Object.entries(implementation)) if (digest(await readFile(path)) !== hash) throw new Error('Implementation changed during comparison');
const report = { version: 'stage2-media-v4-development-probe-v1', startedAt, finishedAt: new Date().toISOString(), sourcePacketSha256: digest(sourceBytes), implementation, observations, candidateLabelsPassedToExtractor: false, modelCalls: 0, networkCalls: 0, calendarCalls: 0, providerChargesUsd: 0, localCpuCostUsd: null, stage2Accepted: false };
await writeFile(`${directory}/manifest.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
await writeFile('reports/stage-2-media-v4-development-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:'reports/stage-2-media-v4-development-probe.json',directory}));
