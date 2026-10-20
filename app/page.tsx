import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicSupabaseConfig } from '../lib/supabase/config';
import { trackerSession } from '../lib/auth/session';
import { signIn } from './actions';

export const dynamic = 'force-dynamic';
const messages: Record<string, string> = {
  invalid_login: 'Sign-in did not succeed. Check your existing Supabase account and try again.',
  not_allowed: 'Your account is signed in, but the owner allowlist has not granted access. Complete the owner setup in the runbook.',
  database_unavailable: 'The private database could not be verified. Apply the migrations and check service health; no catalog was loaded.',
  auth_unavailable: 'The authentication service could not be reached or verified. Check service access and try again; no private data was loaded.',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const configured = Boolean(publicSupabaseConfig());
  const session = configured ? await trackerSession() : null;
  if (session?.state === 'ready') redirect('/inbox');
  const notice = messages[state || session?.state || ''];
  return <main>
    <header><Link className="wordmark" href="/"><span className="mark" aria-hidden="true">F</span>Opportunity Tracker</Link><span className="status">Private campus inbox</span></header>
    <section className="intro"><p className="eyebrow">Make more of campus</p><h1>Find your next<br />worthwhile thing.</h1><p className="lead">Speakers, concerts, clubs, films, trips, research, and unfamiliar opportunities. Discover broadly, then choose what deserves your time.</p></section>
    <section className="setup" aria-labelledby="login-heading"><h2 id="login-heading">{configured ? 'Sign in to your review inbox' : 'Connect your private inbox'}</h2>{notice && <p role="alert" className="notice">{notice}</p>}
      {configured ? <form action={signIn} className="stack"><label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label><button type="submit">Sign in</button><p className="small">Use the existing Supabase Auth account registered as this tracker’s owner. Public signup is disabled.</p></form> : <><p>Supabase is not configured. Enter the three Supabase values and Trigger development key in <code>.env.local</code>, then restart the local app. Apply the migrations and register your existing Auth user with the owner setup command.</p><p className="small">No event catalog has been loaded here. Missing access is a setup requirement.</p></>}
      <p className="approval">Calendar writes are disabled. Saving an item never adds it to your calendar.</p>
    </section><footer><span>Campus comes first.</span><span>Stage 1 · Read, review, and collect.</span></footer>
  </main>;
}
