import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import watchlist from '../../config/instagram-watchlist.json';
import { timestamp } from '../inbox/components';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';

type WatchSource = {
  id: string; adapter: string; enabled: boolean; health_status: string;
  health_message: string | null; last_attempt_at: string | null;
  last_success_at: string | null; coverage_note: string | null;
};

export default async function InstagramWatchlist() {
  const { supabase } = await requireTrackerSession();
  const ids = watchlist.accounts.map(account => account.source_id);
  const result = await supabase.from('sources')
    .select('id,adapter,enabled,health_status,health_message,last_attempt_at,last_success_at,coverage_note')
    .in('id', ids);
  const sources = new Map(((result.data || []) as WatchSource[]).map(source => [source.id, source]));
  const sampled = watchlist.accounts.filter(account => account.posts_access === 'live_sample_proven');
  const blocked = watchlist.accounts.filter(account => account.posts_access === 'blocked');
  const unverified = watchlist.accounts.length - sampled.length - blocked.length;
  const parentPosts = sampled.reduce((total, account) => total + (account.live_sample?.parent_posts || 0), 0);
  const carouselChildren = sampled.reduce((total, account) => total + (account.live_sample?.carousel_children || 0), 0);
  return <main className="inbox-shell">
    <header><Link className="wordmark" href="/inbox"><span className="mark" aria-hidden="true">F</span>Opportunity Tracker</Link><nav><Link href="/inbox">Review inbox</Link><Link href="/intake">Add a flyer or link</Link><form action={signOut}><button className="text-button">Sign out</button></form></nav></header>
    <section className="inbox-intro"><p className="eyebrow">Campus discovery · Instagram</p><h1>Your selected accounts</h1><p className="lead">{watchlist.accounts.length} accounts you selected for opportunity monitoring. Keep their access requirements and collection health in view.</p><p className="approval">Automatic collection is not configured · Calendar writes disabled.</p></section>
    <section className="coverage" aria-label="Instagram access limits"><strong>{sampled.length} live account samples proven · {blocked.length} blocked · monitoring not operational</strong><p>{sampled.length ? <>Fresh Meta Business Discovery reads returned {parentPosts} parent posts and {carouselChildren} carousel child IDs across {sampled.length} accounts. </> : 'No live target sample is proven. '}{blocked.length > 0 && <>{blocked.length} account probe{blocked.length === 1 ? ' was' : 's were'} blocked; the cause remains unresolved. </>}{unverified > 0 && <>{unverified} accounts remain unverified. </>}Bounded samples do not establish full pagination, downloaded media or continuing collection.</p><p>The Meta app remains Unpublished; no production worker token or scheduled Instagram collector is configured. Zero media files and Stories were downloaded, and no event dates were extracted. Arbitrary-account Stories remain manual-only.</p><p>Saving an account does not start a collector, send email, follow it or create dates. You can <Link href="/intake">privately submit a permitted post link or every flyer slide</Link> for verification now.</p></section>
    {result.error && <p className="notice" role="alert">Source health could not be loaded. This is a data-access failure; no successful or empty collection is implied. Your selected account list remains visible below.</p>}
    <div className="list-heading"><h2>Selected watchlist</h2><span className="small">{watchlist.accounts.length} accounts · {sampled.length} live samples · {blocked.length} blocked{unverified > 0 && <> · {unverified} unverified</>} · Stories manual-only</span></div>
    <div className="opportunity-list">{watchlist.accounts.map(account => {
      const source = sources.get(account.source_id);
      const sample = account.posts_access === 'live_sample_proven' ? account.live_sample : null;
      const probeBlocked = account.posts_access === 'blocked';
      return <article className="manual-item" key={account.source_id}>
        <div className="tags"><span>{sample ? 'Bounded live API sample proven' : probeBlocked ? 'Live API probe blocked' : 'API access not proven'}</span><span>Stories: manual-only</span><span>{source?.enabled ? 'Source enablement needs review' : 'Automatic collection disabled'}</span></div>
        <h2><a href={account.profile_url} target="_blank" rel="noopener noreferrer">@{account.handle} ↗</a></h2>
        <p>{account.focus}</p>
        <p className="small">Selection: provided by you · {sample ? 'Target identity and professional eligibility verified for this Business Discovery sample.' : 'Account identity/professional eligibility: unverified.'}</p>
        {sample && <p className="small">Live sample recorded {sample.observed_at_utc}: {sample.parent_posts} parent posts ({sample.standalone_images} images, {sample.reels} Reels, {sample.carousels} carousels), {sample.carousel_children} returned child IDs. Media files downloaded: {sample.media_files_downloaded}; Stories: {sample.stories_retrieved}. Full pagination and event extraction remain unverified.</p>}
        {probeBlocked && <p className="notice">Live API probe at {account.access_probe.observed_at_utc} returned HTTP {account.access_probe.http_statuses.join(', ')}. The cause is unresolved; access is not proven. This failure does not mean the account has no new posts.</p>}
        <p className="small">Collector state: {result.error ? 'unavailable' : source?.health_status || 'setup_needed'}<br />Last collector attempt: {result.error ? 'Unavailable' : timestamp(source?.last_attempt_at || null)}<br />Last collector success: {result.error ? 'Unavailable' : timestamp(source?.last_success_at || null)}</p>
        <p className="small">Stored collector note (may predate the access probes above): {result.error ? 'Health query failed; retry after checking database access.' : source?.health_message || source?.coverage_note || (source ? 'The production worker and scheduled Instagram collector are not configured. Account access evidence is shown separately.' : 'Not yet registered in source health. This does not mean the account has no new posts.')}</p>
      </article>;
    })}</div>
    <footer><span>{sampled.length} live read samples · {blocked.length} blocked · No media downloads or event extraction.</span><Link href="/intake">Submit a permitted link or flyer privately</Link></footer>
  </main>;
}
