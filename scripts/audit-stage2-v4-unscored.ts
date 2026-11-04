/** Source-backed engineering checks of old-development unscored critical facts. */
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { reviewedSha256 } from '../evaluation/stage2-reviewed-contract';
import type { ExtractionCandidate, EvidenceSpan, Primitive } from '../lib/extraction/contracts';
import type { ExtractionUnit } from '../lib/extraction/media-types';

const currentFile = 'reports/stage-2-reviewed-v4-same-contract-comparison.json';
const critical = new Set(['title','startAt','endAt','date','datePrecision','timeZone','status','doorsAt','occursAt','occursOn','actionType','availability','eligibility','location','cost']);
const category = /^(?:education|theat(?:re|er)|music|dance|film|concerts?|speakers?|special events|arts|performances?|literary arts)$/i;
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
type Row = { scope: string; caseId: string; kind: string; field: string; value: Primitive; predictionKey: string; evidence: EvidenceSpan[]; classification: string; unsupported: boolean; requiresHumanAdjudication: true };
type SourceInput = { caseId: string; units: ExtractionUnit[] };
async function audit(reportFile: string) {
  const bytes = await readFile(reportFile), report = JSON.parse(bytes.toString('utf8'));
  assert.equal(report.input.cases, 30); assert.equal(report.input.allDevelopment, true); assert.equal(report.input.holdoutReadOrScored, false);
  if (!report.privateRun.path.startsWith('private/stage2-reviewed/v4-same-contract-comparison/run-')) throw new Error('Only the approved development comparison run may be inspected.');
  const privateBytes = await readFile(report.privateRun.path); assert.equal(reviewedSha256(privateBytes), report.privateRun.sha256);
  const run = JSON.parse(privateBytes.toString('utf8'));
  for (const group of run.groups) assert.ok(group.corpus.cases.every((item: { split: string }) => item.split === 'development'));
  const inputs = new Map<string, SourceInput>(run.groups.flatMap((group: { inputs: SourceInput[] }) => group.inputs.map(input => [input.caseId, input])));
  const rows: Row[] = [], entities: Array<{ caseId: string; predictionKey: string; kind: string; title: Primitive; classification: string; unsupportedAttendance: boolean; requiresHumanAdjudication: true }> = [];
  for (const result of run.results.filter((result: { version: string }) => result.version === 'stage2-rules-v4')) {
    const input = inputs.get(result.caseId)!; assert.ok(input);
    const selected = [
      ...result.score.unscoredFields.filter((field: { field: string }) => critical.has(field.field)).map((field: object) => ({ ...field, scope: 'matched_unscored' })),
      ...result.score.extraPredictedUnitsUnscored.flatMap((item: { key: string; kind: string; nonnullFields: string[] }) => item.nonnullFields.filter(field => critical.has(field)).map(field => ({ key: item.key, kind: item.kind, field, scope: 'extra_unit_unscored' }))),
    ];
    for (const field of selected) {
      const index = result.prediction.units.findIndex((item: { key: string; kind: string }) => item.key === field.key && item.kind === field.kind);
      assert.ok(index >= 0); const candidate = result.candidates[index] as ExtractionCandidate, value = result.prediction.units[index].fields[field.field] as Primitive;
      const evidence = candidate.claims.filter(claim => claim.field === field.field || field.field === 'cost' && claim.field === 'price').flatMap(claim => claim.evidence);
      assert.ok(evidence.length);
      for (const span of evidence) { const unit = input.units.find(unit => `${unit.assetId}:${unit.page ?? 0}` === span.unitId); assert.ok(unit); assert.equal(unit.text.slice(span.start, span.end), span.quote); }
      let classification = 'source_surface_support_requires_semantic_review', unsupported = false;
      const quotes = evidence.map(span => span.quote), quote = quotes.join(' ');
      if (field.field === 'title' && typeof value === 'string' && category.test(value)) { classification = 'unsupported_category_heading_as_opportunity_title'; unsupported = true; }
      else if (field.field === 'timeZone' && value === 'America/New_York' && quotes.every(value => /^(?:EST|EDT)$/i.test(value.trim()))) { classification = 'unsupported_geographic_zone_inferred_from_fixed_source_abbreviation'; unsupported = true; }
      else if (field.field === 'timeZone' && (value === 'Etc/GMT+5' && quotes.every(value => /^EST$/i.test(value.trim())) || value === 'Etc/GMT+4' && quotes.every(value => /^EDT$/i.test(value.trim())))) classification = 'explicit_source_abbreviation_retained_as_fixed_offset';
      else if (typeof value === 'string' && quotes.some(quote => normalized(quote).includes(normalized(value)))) classification = 'literal_source_surface_supported_entity_scope_unadjudicated';
      else if (field.field === 'title' && typeof value === 'string' && value.split(/\s+[—–-]\s+/).length === 2 && value.split(/\s+[—–-]\s+/).every(part => quotes.some(quote => normalized(quote) === normalized(part)))) classification = 'literal_source_program_and_term_title_composition_supported';
      else if (field.field === 'datePrecision' && value === 'date' && /\b20\d{2}\b/.test(quote)) classification = 'explicit_year_date_precision_source_supported';
      else if (field.field === 'datePrecision' && value === 'instant' && /\b20\d{2}\b/.test(quote) && /\b(?:AM|PM)\b/i.test(quote) && /\b(?:EST|EDT|UTC)\b/.test(quote)) classification = 'explicit_date_clock_and_source_offset_precision_supported';
      else if (field.field === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const source = quote.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i);
        if (source) { const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(source[1].slice(0, 3).toLowerCase()) + 1; assert.equal(value, `${source[3]}-${String(month).padStart(2,'0')}-${source[2].padStart(2,'0')}`); classification = 'explicit_source_calendar_date_normalization_supported'; }
      } else if (field.field === 'actionType' && value === 'application_deadline' && /\bapplication\s+deadline\b/i.test(quote)) classification = 'explicit_source_application_deadline_type_supported';
      else if (field.field === 'actionType' && value === 'opportunity_posted' && /\b(?:experiences|positions|opportunities)\s+(?:are\s+)?posted\b/i.test(quote)) classification = 'explicit_opportunity_posted_notice_not_application_open';
      rows.push({ scope: field.scope, caseId: result.caseId, kind: field.kind, field: field.field, value, predictionKey: field.key, evidence, classification, unsupported, requiresHumanAdjudication: true });
    }
    for (const extra of result.score.extraPredictedUnitsUnscored) {
      const index = result.prediction.units.findIndex((item: { key: string; kind: string }) => item.key === extra.key && item.kind === extra.kind), item = result.candidates[index] as ExtractionCandidate;
      const title = item.fields.title;
      const process = typeof title === 'string' && /\b(?:hiring|recruit(?:ing|ment)|application|internship)\b.{0,50}\b(?:timeline|schedule|process)\b/i.test(title);
      const unsupportedAttendance = extra.kind === 'event' && process;
      const classification = unsupportedAttendance ? 'unsupported_attendance_entity_from_recruiting_process_timeline' : process && extra.kind === 'resource' ? 'recruiting_process_retained_as_resource_not_attendance' : extra.kind === 'action' && item.fields.actionType === 'opportunity_posted' ? 'posting_notice_is_not_an_application_opening' : extra.kind === 'action' && item.issues.includes('conflicting_action_dates_require_review') ? 'conflicting_source_action_variant_no_supported_timed_fact_asserted' : extra.kind === 'resource' ? 'source_program_or_link_resource_mapping_requires_adjudication' : 'source_event_detail_entity_and_duplicate_scope_require_adjudication';
      entities.push({ caseId: result.caseId, predictionKey: extra.key, kind: extra.kind, title: title ?? null, classification, unsupportedAttendance, requiresHumanAdjudication: true });
    }
  }
  const counts = rows.reduce<Record<string, number>>((counts, row) => { counts[row.classification] = (counts[row.classification] || 0) + 1; return counts; }, {});
  return { reportFile, reportSha256: reviewedSha256(bytes), privateRun: report.privateRun, rows, entities, summary: { criticalUnscoredFieldsChecked: rows.length, exactEvidenceSpansChecked: rows.reduce((sum, row) => sum + row.evidence.length, 0), confirmedUnsupportedCriticalFields: rows.filter(row => row.unsupported).length, unsupportedAttendanceEntities: entities.filter(row => row.unsupportedAttendance).length, extraEntityScopesChecked: entities.length, classifications: counts, unresolvedSurfaceSemanticChecks: rows.filter(row => row.classification === 'source_surface_support_requires_semantic_review').length } };
}
const current = await audit(currentFile);
const histories = (await readdir('reports')).filter(file => /^stage-2-reviewed-v4-comparison-history-[a-f0-9]+\.json$/.test(file)).sort();
const history = [];
for (const file of histories) history.push(await audit('reports/' + file));
const recordedAt = new Date().toISOString(), directory = 'private/stage2-reviewed/v4-critical-audit';
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
const privatePath = `${directory}/audit-${recordedAt.replace(/[:.]/g, '-')}.json`, privateBytes = JSON.stringify({ recordedAt, current, history }, null, 2) + '\n';
await writeFile(privatePath, privateBytes, { flag: 'wx', mode: 0o600 });
const publicReport = { schemaVersion: 1, recordedAt, sourceSha256: reviewedSha256(await readFile(import.meta.filename)), command: 'node --import tsx scripts/audit-stage2-v4-unscored.ts', evidenceClass: 'Source-backed engineering audit of the existing30 development predictions and old-contract unscored critical fields; not independent human annotation, factual-accuracy scoring or holdout acceptance.', current: { report: currentFile, sha256: current.reportSha256, ...current.summary }, history: history.map(item => ({ report: item.reportFile, sha256: item.reportSha256, ...item.summary })), privateAudit: { path: privatePath, sha256: reviewedSha256(privateBytes), containsEveryCheckedFieldQuoteAndEntityScope: true, mode: '0600' }, interpretation: ['Exact quote identity is checked for every selected field but alone does not prove semantic correctness.', 'Initial source-backed findings exposed category headings used as titles, a recruiting timeline emitted as attendance and geographical IANA precision inferred from EST/EDT. Generic v4 prose repairs are regression-tested without altering frozen references.', 'Source-supported surface facts and unscored entity/duplicate scopes still require human adjudication. This audit does not promote them into gold or change the comparison scorer.', 'Known scored field failures and strict-completeness gaps remain visible in the unchanged-contract comparison. A zero count in this narrow engineering audit does not pass Stage2.'], boundaries: { holdoutRead: false, sourceOrReferenceChanged: false, newHumanLabels: 0, providerCalls: 0, calendarCalls: 0, modelCalls: 0 }, stage2Accepted: false, independentHumanReview: false };
await writeFile('reports/stage-2-v4-unscored-critical-audit.json', JSON.stringify(publicReport, null, 2) + '\n');
console.log(JSON.stringify({ report: 'reports/stage-2-v4-unscored-critical-audit.json', current: current.summary, historicalUnsupported: history.map(item => ({ fields: item.summary.confirmedUnsupportedCriticalFields, entities: item.summary.unsupportedAttendanceEntities })), humanLabelsAdded: 0, stage2Accepted: false }));
process.exitCode = current.summary.confirmedUnsupportedCriticalFields || current.summary.unsupportedAttendanceEntities ? 1 : 0;
