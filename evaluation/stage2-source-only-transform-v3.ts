/** Source-only v3: retain literal structured metadata before description scope. */
import { load } from 'cheerio';
import { transformPublicText as transformV2 } from './stage2-source-only-transform-v2';
export const SOURCE_ONLY_TRANSFORM_VERSION = 'source-only-acceptance-text-v3';
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
function literal(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const $ = load(value); $('script,style,noscript,svg').remove();
  $('br').replaceWith('\n'); $('p,div,li').each((_, node) => { $(node).append('\n'); });
  return $.root().text().replace(/\r\n?/g, '\n').trim() || null;
}
/** No label, expected value, collection-page URL or assumed campus timezone input. */
export function transformPublicText(input: { contentType: string; rawInput: string }): string {
  if (!input.contentType.includes('json')) return transformV2(input);
  if (Buffer.byteLength(input.rawInput) > 2 * 1024 * 1024) throw new Error('source_input_byte_limit');
  const value = record(JSON.parse(input.rawInput));
  if (!value) throw new Error('Expected a frozen public JSON object.');
  const lines: string[] = [];
  // Single-line scalar fields cannot inject a new metadata line. Original raw
  // bytes stay separately retained; whitespace is a presentation transformation.
  const add = (label: string, value: unknown) => {
    const text = literal(value); if (text) lines.push(`${label}: ${text.replace(/\s+/g, ' ')}`);
  };
  add('Title', value.title ?? value.name);
  add('Location', value.location_name ?? value.location); add('Room', value.room_number);
  for (const key of ['ticket_cost', 'price', 'cost']) add('Price', value[key]);
  if (value.free === true) lines.push('Price: Free'); // false is not a known price.
  for (const key of ['eligibility', 'applicant_type_msg']) add('Eligibility', value[key]);
  add('Organizer', value.organizer);
  for (const key of ['timezone', 'time_zone']) add('Timezone', value[key]);
  add('Published status', value.status);
  for (const key of ['url', 'localist_url']) add('URL', value[key]);
  const description = literal(value.description_text ?? value.description ?? value.tag_line);
  if (description) lines.push(`Description: ${description}`);
  if (Array.isArray(value.event_instances)) for (const wrapped of value.event_instances) {
    const instance = record(record(wrapped)?.event_instance);
    if (instance) { add('Start', instance.start); add('End', instance.end); }
  }
  add('Application start', value.startdate); add('Application deadline', value.deadline); add('Published timeline', value.timeline);
  const text = lines.join('\n');
  if (!text.trim() || Buffer.byteLength(text) > 65_536) throw new Error('transformed_text_empty_or_limit');
  return text;
}
