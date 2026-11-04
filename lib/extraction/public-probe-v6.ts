/** Manual fixed-public diagnostic only; never claims or reads private queued work. */
import { publicPdfProbe, type PublicPdfProbeOptions } from './public-probe';
import { processMediaAssets, nativeMediaReadiness } from './media-v2';
import { extractCandidates } from './text-v6';
import { validateExtractionResult } from './contracts';
type ExtractionSummary = { candidates: number; events: number; actions: number; resources: number; processorHeadingTitles: number; sourceUnits: number; evidenceValidated: boolean; engine: string };
export async function publicPdfProbeV6(options: PublicPdfProbeOptions = {}) {
  let extraction: ExtractionSummary | null = null;
  const diagnostic = await publicPdfProbe({ ...options, readiness: options.readiness ?? nativeMediaReadiness, media: async (assets, mediaOptions) => {
    const media = await (options.media ?? processMediaAssets)(assets, mediaOptions);
    const candidates = extractCandidates(media.units);
    validateExtractionResult({ version: 'stage2-result-v1', units: media.units, candidates, complete: media.complete, issues: [], stats: {
      expectedAssets: assets.length, processedAssets: new Set(media.units.filter(unit => unit.status === 'processed').map(unit => unit.assetId)).size,
      processedPages: media.units.filter(unit => unit.status === 'processed').length, elapsedMs: 0, engine: `${media.engine}/stage2-rules-v6/public-diagnostic`,
    } });
    extraction = { candidates: candidates.length, events: candidates.filter(candidate => candidate.kind === 'event').length,
      actions: candidates.filter(candidate => candidate.kind === 'action').length, resources: candidates.filter(candidate => candidate.kind === 'resource').length,
      processorHeadingTitles: candidates.filter(candidate => /^\[(?:PDF text layer|Visual OCR(?: sparse| adaptive)?)\]$/.test(String(candidate.fields.title))).length,
      sourceUnits: media.units.length, evidenceValidated: true, engine: `${media.engine}/stage2-rules-v6/public-diagnostic` };
    return media;
  } });
  return { ...diagnostic, evidenceClass: 'Manual fixed-public-PDF native2/v6 Cloud diagnostic; no private Storage, queued-job quota, scheduled execution or human accuracy proof', extraction: extraction as ExtractionSummary | null,
    privateJobsClaimed: 0, sourceContentsReturned: false, semanticAccuracyEstablished: false };
}
