/** Version5 composition; v1–v4 text/native implementations remain frozen. */
import { createHash } from 'node:crypto';
import { extractionUnitId, type ExtractionCandidate } from './contracts';
import type { ExtractionUnit } from './media-types';
import { extractStructuredCandidates } from './structured-v5';
import type { ExtractionContext } from './text';
import { extractMediaCandidates } from './text-media-v5';
import { extractProseCandidates } from './text-prose-v4';

function scopedSidecars(unit: ExtractionUnit, events: ExtractionCandidate[], context: ExtractionContext) {
  const titles = [...new Set(events.map(event => event.fields.title).filter((value): value is string => typeof value === 'string' && Boolean(value)))];
  return extractProseCandidates(unit, context).filter(item => item.kind === 'action' || item.kind === 'resource' && typeof item.fields.title === 'string' && /\b(?:directory|guide|resource|handbook)\b/i.test(item.fields.title) && !titles.includes(item.fields.title)).map(item => {
    if (item.kind !== 'action') return item;
    item.claims = item.claims.filter(claim => claim.field !== 'title');
    item.fields.title = null;
    if (titles.length === 1) {
      const claim = events.find(event => event.fields.title === titles[0])?.claims.find(value => value.field === 'title');
      if (claim) { item.fields.title = titles[0]; item.claims.push({ ...claim, evidence: claim.evidence.map(evidence => ({ ...evidence })) }); }
    } else item.issues.push('structured_action_event_title_scope_requires_review');
    return item;
  });
}

export function extractCandidates(units: ExtractionUnit[], context: ExtractionContext = {}): ExtractionCandidate[] {
  const result: ExtractionCandidate[] = []; let overflow = false;
  for (const unit of units) {
    // Native processor section headers are provenance, not source headings.
    // The media5 view preserves those boundaries and original evidence offsets;
    // don't parse concatenated independent OCR passes as structured records.
    const nativeHeaders = unit.method !== 'provided-text' && unit.text.split(/\r\n|\r|\n/).some(line => ['[PDF text layer]','[Visual OCR]','[Visual OCR sparse]','[Visual OCR adaptive]'].includes(line));
    const structured = nativeHeaders ? null : extractStructuredCandidates(unit, context);
    const candidates = structured === null
      ? unit.method === 'provided-text' ? extractProseCandidates(unit, context) : extractMediaCandidates(unit, context)
      : [...structured, ...(structured.length ? scopedSidecars(unit, structured, context) : [])];
    for (const [index, item] of candidates.entries()) {
      if (result.length === 30) { overflow = true; continue; }
      // V3 local counters restart per unit. Include the original unit/page so
      // independent slides/records never share an identity merely by title.
      const key = createHash('sha256').update(JSON.stringify([extractionUnitId(unit), item.kind, item.key, index])).digest('hex').slice(0, 40);
      result.push({ ...item, key: `${item.kind}:v5:${key}`, fields: { ...item.fields }, claims: item.claims.map(claim => ({ ...claim, evidence: claim.evidence.map(evidence => ({ ...evidence })) })), issues: [...new Set([...item.issues, ...unit.issues])].slice(0, 30) });
    }
  }
  if (overflow && result.length) {
    const last = result[result.length - 1];
    last.issues = [...last.issues.filter(issue => issue !== 'candidate_limit_reached_additional_inputs_require_review').slice(0, 29), 'candidate_limit_reached_additional_inputs_require_review'];
  }
  return result;
}
