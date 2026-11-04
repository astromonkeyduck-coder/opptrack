import { z } from 'zod';
import type { ExtractionUnit } from './media-types';

export const SUPPORTED_EXTRACTOR_VERSIONS = ['stage2-rules-v1', 'stage2-rules-v2', 'stage2-rules-v3', 'stage2-rules-v4', 'stage2-rules-v5'] as const;
export type ExtractorVersion = typeof SUPPORTED_EXTRACTOR_VERSIONS[number];
export const EXTRACTOR_VERSION = 'stage2-rules-v5' satisfies ExtractorVersion;
export const RESULT_VERSION = 'stage2-result-v1';
export type Primitive = string | number | boolean | null;
export type EvidenceSpan = { unitId: string; start: number; end: number; quote: string };
export type ExtractedClaim = { field: string; value: Primitive; evidence: EvidenceSpan[] };
export type ExtractionCandidate = { key: string; kind: 'event' | 'action' | 'resource'; fields: Record<string, Primitive>; claims: ExtractedClaim[]; issues: string[] };
export type ExtractionResult = {
  version: typeof RESULT_VERSION; units: ExtractionUnit[]; candidates: ExtractionCandidate[]; issues: string[]; complete: boolean;
  stats: { processedAssets: number; expectedAssets: number; processedPages: number; engine: string; elapsedMs: number; visualWorkUncertain?: boolean };
};
export function extractionUnitId(unit: Pick<ExtractionUnit, 'assetId' | 'page'>) { return `${unit.assetId}:${unit.page ?? 0}`; }
const primitive = z.union([z.string().max(3000), z.number().finite(), z.boolean(), z.null()]);
const evidence = z.object({ unitId: z.string().min(1).max(100), start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1).max(3000) }).strict();
const unit = z.object({
  assetId: z.string().min(1).max(80), page: z.number().int().min(1).max(128).nullable(),
  expectedPages: z.number().int().min(1).max(128).optional(),
  attempted: z.boolean().optional(),
  status: z.enum(['processed','failed','blocked']), text: z.string().max(65536),
  method: z.enum(['ocr','pdf-text-and-ocr','provided-text']), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  issues: z.array(z.string().max(160)).max(30),
  words: z.array(z.object({ text: z.string().max(300), x:z.number().nonnegative(), y:z.number().nonnegative(), width:z.number().nonnegative(), height:z.number().nonnegative() }).strict()).max(10000).optional(),
}).strict();
const candidate = z.object({ key:z.string().min(1).max(100), kind:z.enum(['event','action','resource']), fields:z.record(z.string().max(64),primitive),
  claims:z.array(z.object({field:z.string().max(64),value:primitive,evidence:z.array(evidence).min(1).max(8)}).strict()).max(40), issues:z.array(z.string().max(160)).max(30),
}).strict();
export const extractionResultSchema = z.object({ version:z.literal(RESULT_VERSION), units:z.array(unit).max(1025), candidates:z.array(candidate).max(30), issues:z.array(z.string().max(160)).max(50), complete:z.boolean(),
  stats:z.object({processedAssets:z.number().int().min(0).max(8),expectedAssets:z.number().int().min(0).max(100),processedPages:z.number().int().min(0).max(12),engine:z.string().max(100),elapsedMs:z.number().nonnegative().max(300000),visualWorkUncertain:z.boolean().optional()}).strict(),
}).strict();

/** Structural validation is separate from evidence support and factual accuracy. */
export function validateExtractionResult(value: unknown): ExtractionResult {
  if (Buffer.byteLength(JSON.stringify(value),'utf8') > 512 * 1024) throw new Error('Extraction result exceeds the private result limit');
  const result = extractionResultSchema.parse(value);
  const units = new Map<string, typeof result.units[number]>();
  for (const item of result.units) { const id=extractionUnitId(item); if(units.has(id)) throw new Error('Duplicate extraction unit'); if(item.status==='processed'&&!item.sha256)throw new Error('Processed input lacks its original hash'); units.set(id,item); }
  const keys=new Set<string>();
  for(const item of result.candidates) {
    if(keys.has(item.key)) throw new Error('Duplicate extraction candidate'); keys.add(item.key);
    if(Object.keys(item.fields).length>40)throw new Error('Too many candidate fields');
    for(const claim of item.claims) {
      if(!(claim.field in item.fields)||JSON.stringify(item.fields[claim.field])!==JSON.stringify(claim.value))throw new Error('Claim differs from its field');
      for(const span of claim.evidence) {
        const source=units.get(span.unitId);
        if(!source || source.status!=='processed' || span.end<=span.start || source.text.slice(span.start,span.end)!==span.quote)throw new Error('Extraction evidence is not an exact retained text span');
      }
    }
    for(const [field,value] of Object.entries(item.fields)) {
      if(value!==null && !item.claims.some(claim=>claim.field===field))throw new Error('A non-null field lacks evidence');
    }
  }
  if(result.complete && result.units.some(item=>item.status!=='processed')) throw new Error('Incomplete media cannot be successful extraction');
  return result as ExtractionResult;
}
