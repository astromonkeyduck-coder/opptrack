import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import { sourceIsStale } from '../../lib/intake/presentation';
import watchlist from '../../config/instagram-watchlist.json';
import { AppShell } from '../components/app-shell';
import { INSTAGRAM_ADAPTER, INSTAGRAM_PAGE_SIZE, InstagramCollectionAttention, InstagramPostCard, instagramFeedLink, instagramFilters, type InstagramPostRow, type InstagramSourceRow } from './components';

export const dynamic = 'force-dynamic';

export default async function InstagramWatchlist({ searchParams }: { searchParams: Promise<{ q?: string | string[]; account?: string | string[]; page?: string | string[] }> }) {
  const { supabase } = await requireTrackerSession();
  const ids = watchlist.accounts.map(account => account.source_id);
  const filters = instagramFilters(await searchParams, ids);
  let postsQuery = supabase.from('instagram_updates_current')
    .select('id,source_id,native_id,caption,published_at,permalink,media_type,media_product_type,children,children_complete,first_seen_at,last_seen_at', { count: 'exact' })
    .order('published_at', { ascending: false }).order('id');
  if (filters.q) postsQuery = postsQuery.ilike('caption', `%${filters.q}%`);
  if (filters.account) postsQuery = postsQuery.eq('source_id', filters.account);
  const [postResult, sourceResult] = await Promise.all([
    postsQuery.range((filters.page - 1) * INSTAGRAM_PAGE_SIZE, filters.page * INSTAGRAM_PAGE_SIZE - 1),
    supabase.from('sources').select('id,adapter,enabled,health_status,health_message,last_attempt_at,last_success_at,cadence_seconds,coverage_note,next_due_at').in('id', ids),
  ]);
  const sources = new Map(((sourceResult.data || []) as InstagramSourceRow[]).map(source => [source.id, source]));
  const posts = (postResult.data || []) as InstagramPostRow[];
  const postCount = postResult.count ?? 0;
  const enabled = [...sources.values()].filter(source => source.enabled && source.adapter === INSTAGRAM_ADAPTER);
  const succeeded = enabled.filter(source => source.last_success_at);
  const stale = enabled.filter(source => sourceIsStale(source.last_success_at, source.cadence_seconds));
  const accountBySource = new Map(watchlist.accounts.map(account => [account.source_id, account]));
  const pageLink = (page: number) => instagramFeedLink({ ...filters, page });
  return <AppShell active="instagram">
    <div className="page-heading"><div><p className="kicker">From your accounts</p><h1>Instagram</h1><p className="subtitle">{postResult.error ? 'Post count unavailable' : `${postCount} ${filters.q || filters.account ? 'matching' : 'collected'} posts`}{sourceResult.error ? ' · Account status unavailable' : ` · ${enabled.length} accounts enabled`}</p></div></div>
    <form className="search" role="search" action="/instagram"><label className="form-field">Search captions<input name="q" type="search" defaultValue={filters.q} maxLength={120} placeholder="Concert, research, film…" /></label><label className="form-field">Account<select name="account" defaultValue={filters.account}><option value="">All selected accounts</option>{watchlist.accounts.map(account => <option key={account.source_id} value={account.source_id}>@{account.handle}</option>)}</select></label><button className="button-primary">Search</button></form>
    <p className="feed-limits">Unverified posts · Media unread · Stories manual-only. <Link href="/sources">Collection limits & source health ↗</Link></p>
    {!sourceResult.error && <p className="feed-health">{succeeded.length} accounts have a recorded collection success · {stale.length} stale or awaiting a first success. <Link href="/sources">View sources</Link></p>}
    {!sourceResult.error && <InstagramCollectionAttention sources={enabled} />}
    {sourceResult.error && <p className="notice" role="alert">Source health could not be loaded. This is a data-access failure; monitoring status is unavailable.</p>}
    {postResult.error && <p className="notice" role="alert">Instagram posts could not be loaded. Check the private feed migration and database access. This failure is not an empty collection.</p>}
    <section aria-label="Collected Instagram posts"><div className="list-heading"><h2>Latest posts</h2><span className="small">Page {filters.page}</span></div>
      {!postResult.error && !posts.length && <div className="empty"><h3>{filters.q || filters.account ? 'No matching collected posts' : 'No collected posts yet'}</h3><p>{filters.q || filters.account ? 'Try a broader caption search or another account. Only retained captions are searched; image and video text has not been read.' : 'No production posts are visible yet. Review Sources for the latest attempts and failures; an empty feed alone does not establish successful collection.'}</p></div>}
      <div className="instagram-grid">{posts.map(row => <InstagramPostCard key={row.id} row={row} handle={accountBySource.get(row.source_id)?.handle || row.source_id} />)}</div>
      {!postResult.error && <nav className="pagination" aria-label="Instagram post pages">{filters.page > 1 && <Link href={pageLink(filters.page - 1)}>← Previous posts</Link>}{filters.page * INSTAGRAM_PAGE_SIZE < postCount && <Link href={pageLink(filters.page + 1)}>More posts →</Link>}</nav>}
    </section>
  </AppShell>;
}
