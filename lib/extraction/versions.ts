import { SUPPORTED_EXTRACTOR_VERSIONS, type ExtractorVersion } from './contracts';
import type { ExtractionUnit } from './media-types';
import { extractCandidates as extractV1 } from './text-v1';
import { extractCandidates as extractV2 } from './text-v2';
import { extractCandidates as extractV3, type ExtractionContext } from './text';
import { extractCandidates as extractV4 } from './text-v4';
import { extractCandidates as extractV5 } from './text-v5';

/** A job's immutable version selects its implementation; upgrades never rewrite older history. */
export function extractCandidatesForVersion(version: string, units: ExtractionUnit[], context: ExtractionContext = {}) {
  if (version === 'stage2-rules-v1') return extractV1(units, context);
  if (version === 'stage2-rules-v2') return extractV2(units, context);
  if (version === 'stage2-rules-v3') return extractV3(units, context);
  if (version === 'stage2-rules-v4') return extractV4(units, context);
  if (version === 'stage2-rules-v5') return extractV5(units, context);
  throw new Error('Unsupported extractor version');
}

export function isSupportedExtractorVersion(version: unknown): version is ExtractorVersion {
  return typeof version === 'string' && (SUPPORTED_EXTRACTOR_VERSIONS as readonly string[]).includes(version);
}
