/** Frozen source-only preparation for future acceptance inputs, never gold labels. */
import { load } from 'cheerio';
import { sourceEvidenceToText } from './stage2-reviewed-contract';
export const SOURCE_ONLY_TRANSFORM_VERSION = 'source-only-acceptance-text-v2';
export function transformPublicText(input: {contentType:string;rawInput:string}): string {
  if (Buffer.byteLength(input.rawInput) > 2 * 1024 * 1024) throw new Error('source_input_byte_limit');
  let text: string;
  if (input.contentType.includes('calendar')) {
    // Retain property parameters, component boundaries and exact source offsets.
    // The historical development-v1 flattening remains unchanged for comparisons.
    text = input.rawInput;
  } else if (input.contentType.includes('json')) text = sourceEvidenceToText(input);
  else if (input.contentType.includes('html')) {
    const $ = load(input.rawInput);
    $('script,style,noscript,svg,nav,footer,header,[hidden],[aria-hidden="true"]').remove();
    const main = $('main').first(), article = $('article').first();
    const root = main.length ? main : article.length ? article : $('body');
    root.find('br').replaceWith('\n');
    root.find('td,th').each((_,node) => { $(node).append(' | '); });
    root.find('h1,h2,h3,h4,h5,h6,p,div,li,tr,section,article').each((_,node) => { $(node).prepend('\n').append('\n'); });
    text = root.text().split('\n').map(line => line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
  } else if (input.contentType.startsWith('text/plain')) text = input.rawInput;
  else throw new Error('unsupported_source_text_type');
  if (!text.trim() || Buffer.byteLength(text) > 65_536) throw new Error('transformed_text_empty_or_limit');
  return text;
}
