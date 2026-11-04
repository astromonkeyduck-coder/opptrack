/** V5 repair: processor section labels can never be source event titles. */
import type { EvidenceSpan, ExtractionCandidate } from './contracts';
import type { ExtractionUnit } from './media-types';
import type { ExtractionContext } from './text';
import { extractMediaCandidates as extractV4Media } from './text-media-v4';
import { extractProseCandidates } from './text-prose-v4';
const processorHeading = /^\[(?:PDF text layer|Visual OCR(?: sparse| adaptive)?)\]$/;
function sourceTitleCandidates(unit: ExtractionUnit, context: ExtractionContext) {
  // Preserve UTF-16 positions and line endings; this view is never persisted or
  // passed to the evidence validator as original media. Only its title span is used.
  const text = unit.text.replace(/[^\r\n]+/g, line => processorHeading.test(line.trim()) ? ' '.repeat(line.length) : line);
  return extractProseCandidates({ ...unit, text }, context).flatMap(candidate => {
    const claim = candidate.claims.find(claim => claim.field === 'title');
    if (typeof candidate.fields.title !== 'string' || !claim?.evidence.length || processorHeading.test(candidate.fields.title)) return [];
    const evidence: EvidenceSpan[] = claim.evidence.map(span => ({ ...span, quote: unit.text.slice(span.start, span.end) }));
    // A substituted heading or multi-section synthetic quote cannot authorize a title.
    if (evidence.some(span => processorHeading.test(span.quote.trim()) || !span.quote.trim())) return [];
    return [{ value: candidate.fields.title, evidence }];
  });
}
export function extractMediaCandidates(unit: ExtractionUnit, context: ExtractionContext = {}): ExtractionCandidate[] {
  const candidates = extractV4Media(unit, context);
  if (unit.method === 'provided-text') return candidates;
  const affected = candidates.filter(candidate => typeof candidate.fields.title === 'string' && processorHeading.test(candidate.fields.title));
  if (!affected.length) return candidates;
  const titles = sourceTitleCandidates(unit, context), distinct = [...new Set(titles.map(title => title.value))];
  for (const candidate of affected) {
    candidate.claims = candidate.claims.filter(claim => claim.field !== 'title');
    candidate.fields.title = null;
    if (distinct.length === 1) {
      const title = titles.find(title => title.value === distinct[0])!;
      candidate.fields.title = title.value;
      candidate.claims.push({ field: 'title', value: title.value, evidence: title.evidence });
    } else candidate.issues.push('native_source_title_scope_requires_review');
    candidate.issues.push('processor_heading_excluded_from_source_title');
  }
  return candidates;
}
