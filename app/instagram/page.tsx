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
  return <main className="inbox-shell">
    <header><Link className="wordmark" href="/inbox"><span className="mark" aria-hidden="true">F</span>Opportunity Tracker</Link><nav><Link href="/inbox">Review inbox</Link><Link href="/intake">Add a flyer or link</Link><form action={signOut}><button className="text-button">Sign out</button></form></nav></header>
    <section className="inbox-intro"><p className="eyebrow">Campus discovery · Instagram</p><h1>Your selected accounts</h1><p className="lead">{watchlist.accounts.length} accounts you selected for opportunity monitoring. Keep their access requirements and collection health in view.</p><p className="approval">Automatic collection is not configured · Calendar writes disabled.</p></section>
    <section className="coverage" aria-label="Instagram access limits"><strong>API access has not been proven</strong><p>Meta Business Discovery may support posts from eligible professional accounts after a permitted account, linked managed Facebook Page, app and token are configured. These accounts’ eligibility and live post access are unverified. No arbitrary-account Stories route has been established; Stories remain manual-only.</p><p>Saving an account to this list does not start a collector, send an email, follow the account, or create event dates. You can <Link href="/intake">privately submit a permitted post link or every flyer slide</Link> for verification now.</p></section>
    {result.error && <p className="notice" role="alert">Source health could not be loaded. This is a data-access failure; no successful or empty collection is implied. Your selected account list remains visible below.</p>}
    <div className="list-heading"><h2>Selected watchlist</h2><span className="small">{watchlist.accounts.length} accounts · posts unconfigured · Stories manual-only</span></div>
    <div className="opportunity-list">{watchlist.accounts.map(account => {
      const source = sources.get(account.source_id);
      return <article className="manual-item" key={account.source_id}>
        <div className="tags"><span>API access not proven</span><span>Stories: manual-only</span><span>{source?.enabled ? 'Source enablement needs review' : 'Automatic collection disabled'}</span></div>
        <h2><a href={account.profile_url} target="_blank" rel="noopener noreferrer">@{account.handle} ↗</a></h2>
        <p>{account.focus}</p>
        <p className="small">Selection: provided by you · Account identity/professional eligibility: unverified.</p>
        <p className="small">Source state: {result.error ? 'unavailable' : source?.health_status || 'setup_needed'}<br />Last attempt: {result.error ? 'Unavailable' : timestamp(source?.last_attempt_at || null)}<br />Last success: {result.error ? 'Unavailable' : timestamp(source?.last_success_at || null)}</p>
        <p className="small">{result.error ? 'Health query failed; retry after checking database access.' : source?.health_message || source?.coverage_note || (source ? 'No live Meta collection is configured. Access setup and an eligible-account probe are required.' : 'Not yet registered in source health. This does not mean the account has no new posts.')}</p>
      </article>;
    })}</div>
    <footer><span>No post or Story captures claimed.</span><Link href="/intake">Submit a permitted link or flyer privately</Link></footer>
  </main>;
}
