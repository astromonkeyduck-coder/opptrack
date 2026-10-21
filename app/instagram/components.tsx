import { cleanSearch, pageNumber, sourceIsStale } from '../../lib/intake/presentation';

export const INSTAGRAM_PAGE_SIZE = 20;
export const INSTAGRAM_ADAPTER = 'instagram-business-discovery-v1';

export type InstagramPostRow = {
  id: string; source_id: string; native_id: string; caption: string | null;
  published_at: string; permalink: string; media_type: string;
  media_product_type: string | null;
  children: { native_id: string; media_type: string; position: number }[];
  children_complete: boolean; first_seen_at: string; last_seen_at: string;
};

export type InstagramSourceRow = {
  id: string; adapter: string; enabled: boolean; health_status: string;
  health_message: string | null; last_attempt_at: string | null;
  last_success_at: string | null; cadence_seconds: number | null;
  coverage_note: string | null; next_due_at: string | null;
};

export function instagramFilters(params: { q?: string | string[]; account?: string | string[]; page?: string | string[] }, allowedSources: string[]) {
  const q = typeof params.q === 'string' ? params.q : '';
  const account = typeof params.account === 'string' ? params.account : '';
  const page = typeof params.page === 'string' ? params.page : undefined;
  return { q: cleanSearch(q), account: allowedSources.includes(account) ? account : '', page: pageNumber(page) };
}

export function instagramFeedLink(filters: { q: string; account: string; page: number }) {
  return `/instagram?${new URLSearchParams({ q: filters.q, account: filters.account, page: String(filters.page) })}`;
}

export function safeInstagramPostUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://www.instagram.com' && !url.username && !url.password && !url.search && !url.hash && /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? `${url.origin}${url.pathname.replace(/\/$/, '')}/` : null;
  } catch { return null; }
}

export function instagramCollectionState(source?: InstagramSourceRow, now = Date.now()) {
  if (!source || !source.enabled) return 'Automatic collection disabled';
  if (source.adapter !== INSTAGRAM_ADAPTER) return 'Enabled source has an unexpected adapter';
  if (!source.last_attempt_at) return 'Enabled · awaiting first collector attempt';
  if (source.health_status !== 'success') return `Enabled · ${source.health_status}${sourceIsStale(source.last_success_at, source.cadence_seconds, now) ? ' · stale or never succeeded' : ''}`;
  if (sourceIsStale(source.last_success_at, source.cadence_seconds, now)) return 'Enabled · stale or never succeeded';
  return 'Enabled · latest bounded collection succeeded';
}

function postTimestamp(value: string) {
  return !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'Unknown';
}

export function InstagramPostCard({ row, handle }: { row: InstagramPostRow; handle: string }) {
  const url = safeInstagramPostUrl(row.permalink);
  return <article className="manual-item">
    <div className="tags"><span>@{handle}</span><span>{row.media_product_type === 'REELS' ? 'Reel' : row.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : row.media_type}</span><span>Unverified post update</span></div>
    <h3>Published {postTimestamp(row.published_at)}</h3>
    <p className="small">Publication time is not an event date. Event details, ticket availability and deadlines have not been extracted or verified.</p>
    <p>{row.caption || 'No caption was returned. This does not establish that the image or video contains no opportunity.'}</p>
    {row.media_type === 'CAROUSEL_ALBUM' && <p className="small">{row.children.length} child IDs retained · {row.children_complete ? 'Child metadata complete in this response' : 'Child metadata incomplete'}. Images, videos and text inside them have not been captured or read.</p>}
    {row.media_type !== 'CAROUSEL_ALBUM' && <p className="small">Media has not been captured or read.</p>}
    <p className="small">First collected: {postTimestamp(row.first_seen_at)} · Last observed: {postTimestamp(row.last_seen_at)}</p>
    {url ? <a href={url} target="_blank" rel="noopener noreferrer">Open original Instagram post ↗</a> : <p className="notice">The stored post link could not be verified as a canonical Instagram link.</p>}
  </article>;
}
