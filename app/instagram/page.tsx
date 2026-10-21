import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import watchlist from '../../config/instagram-watchlist.json';
import { timestamp } from '../inbox/components';
import { signOut } from '../actions';
import { INSTAGRAM_ADAPTER, INSTAGRAM_PAGE_SIZE, InstagramCollectionAttention, InstagramPostCard, instagramCollectionState, instagramCredentialExpiry, instagramFeedLink, instagramFilters, type InstagramPostRow, type InstagramSourceRow } from './components';

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
  const sampled = watchlist.accounts.filter(account => account.posts_access === 'live_sample_proven');
  const blocked = watchlist.accounts.filter(account => account.posts_access === 'blocked');
  const accountBySource = new Map(watchlist.accounts.map(account => [account.source_id, account]));
  const credentialExpiry = instagramCredentialExpiry(watchlist.production_monitoring);
  const pageLink = (page: number) => instagramFeedLink({ ...filters, page });
  return <main className="inbox-shell">
    <header><Link className="wordmark" href="/inbox"><span className="mark" aria-hidden="true">F</span>Opportunity Tracker</Link><nav><Link href="/inbox">Review inbox</Link><Link href="/intake">Add a flyer or link</Link><form action={signOut}><button className="text-button">Sign out</button></form></nav></header>
    <section className="inbox-intro"><p className="eyebrow">Campus discovery · Instagram</p><h1>Instagram post updates</h1><p className="lead">Search collected captions from your selected campus accounts. These posts stay separate from verified event occurrences.</p><p className="approval">{sourceResult.error ? 'Collector configuration unavailable' : `${enabled.length} accounts enabled · ${succeeded.length} have a recorded collector success`} · Calendar writes disabled.</p></section>
    {!sourceResult.error && <InstagramCollectionAttention sources={enabled} />}
    <section className="coverage" aria-label="Instagram collection limits"><strong>Hourly polling · latest 25 posts per account</strong><p>Media unread · Stories manual-only · {blocked.length} account excluded after access probe.</p><p>{credentialExpiry.summary}.</p><details><summary>Coverage and access limits</summary><p>The existing Trigger dispatcher checks enabled accounts hourly, with scheduling jitter and possible retries. Each attempt reads at most 25 recent parent posts and 20 child IDs per carousel. Older history, posts between polls, deleted posts and edits outside that window can be missed.</p><p>Captions and ordered media metadata are retained privately. Images and videos are not downloaded or read; Stories remain manual-only. Publication time is not an event date. No event dates, ticket facts or calendar entries are inferred from these posts.</p><p>{blocked.length} account remains blocked by its access probe ({blocked.map(account => `@${account.handle}`).join(', ')}); a failed read never means “nothing new.” {credentialExpiry.detail} You can <Link href="/intake">privately submit a permitted post link or every flyer slide</Link>.</p></details></section>
    {sourceResult.error && <p className="notice" role="alert">Source health could not be loaded. This is a data-access failure; monitoring status is unavailable.</p>}
    {postResult.error && <p className="notice" role="alert">Instagram posts could not be loaded. Check the private feed migration and database access. This failure is not an empty collection.</p>}
    <form className="search" role="search" action="/instagram"><label>Search post captions<input name="q" type="search" defaultValue={filters.q} maxLength={120} placeholder="Concert, research, film…" /></label><label>Account<select name="account" defaultValue={filters.account}><option value="">All selected accounts</option>{watchlist.accounts.map(account => <option key={account.source_id} value={account.source_id}>@{account.handle}</option>)}</select></label><button>Search posts</button></form>
    <section aria-label="Collected Instagram posts"><div className="list-heading"><h2>Collected posts</h2><span className="small">{postResult.error ? 'Count unavailable' : `${postCount} matching posts`} · Page {filters.page}</span></div>
      {!postResult.error && !posts.length && <div className="empty"><h3>{filters.q || filters.account ? 'No matching collected posts' : 'No collected posts yet'}</h3><p>{filters.q || filters.account ? 'Try a broader caption search or another account. Only retained captions are searched; image and video text has not been read.' : 'No production posts are visible yet. Source attempts and failures are shown below; an empty feed alone does not establish successful collection.'}</p></div>}
      <div className="opportunity-list">{posts.map(row => <InstagramPostCard key={row.id} row={row} handle={accountBySource.get(row.source_id)?.handle || row.source_id} />)}</div>
      {!postResult.error && <nav className="pagination" aria-label="Instagram post pages">{filters.page > 1 && <Link href={pageLink(filters.page - 1)}>← Previous posts</Link>}{filters.page * INSTAGRAM_PAGE_SIZE < postCount && <Link href={pageLink(filters.page + 1)}>More posts →</Link>}</nav>}
    </section>
    <section className="source-health" id="instagram-source-health"><div className="list-heading"><h2>Selected accounts and collector health</h2><span className="small">{watchlist.accounts.length} selected · {sampled.length} access samples proven · {blocked.length} access probes blocked</span></div><p className="small">Attempt and success are separate. Enablement alone does not prove a scheduled run. Stale, partial and failed attempts remain visible.</p>
      {watchlist.accounts.map(account => {
        const source = sources.get(account.source_id);
        return <details key={account.source_id}><summary><span>@{account.handle}</span><span className="small">{sourceResult.error ? 'Collector state unavailable' : instagramCollectionState(source)}</span></summary>
          <p>{account.focus} · <a href={account.profile_url} target="_blank" rel="noopener noreferrer">View profile ↗</a></p>
          {account.posts_access === 'blocked' && <p className="notice">The live API probe returned HTTP {account.access_probe.http_statuses.join(', ')}. Access is not proven; the cause remains unresolved. This does not mean the account has no new posts.</p>}
          <p className="small">Last collector attempt: {sourceResult.error ? 'Unavailable' : timestamp(source?.last_attempt_at || null)}<br />Last collector success: {sourceResult.error ? 'Unavailable' : timestamp(source?.last_success_at || null)}<br />Next nominal due time: {sourceResult.error ? 'Unavailable' : source?.enabled && source.next_due_at ? timestamp(source.next_due_at) : 'Not scheduled'}</p>
          <p>{sourceResult.error ? 'Health query failed; retry after checking database access.' : source?.health_message || source?.coverage_note || 'No collector health record is available. This does not establish a successful or empty collection.'}</p>
          {source?.coverage_note && source.health_message !== source.coverage_note && <p className="small">{source.coverage_note}</p>}
          <p className="small">Stories: manual-only · Media contents: unread · Event details: unverified.</p>
        </details>;
      })}
    </section>
    <footer><span>Bounded post updates. Source health stays visible.</span><span>Calendar writes disabled.</span></footer>
  </main>;
}
