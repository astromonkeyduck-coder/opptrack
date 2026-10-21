import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicSupabaseConfig } from '../lib/supabase/config';
import { trackerSession } from '../lib/auth/session';
import { signIn } from './actions';

export const dynamic = 'force-dynamic';
const messages: Record<string, string> = {
  invalid_login: 'The email or password didn’t match. Please try again.',
  not_allowed: 'This account doesn’t have access to this private tracker yet.',
  database_unavailable: 'Your inbox is temporarily unavailable. Please try again in a moment.',
  auth_unavailable: 'We couldn’t connect to sign-in. Please try again in a moment.',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const configured = Boolean(publicSupabaseConfig());
  const session = configured ? await trackerSession() : null;
  if (session?.state === 'ready') redirect('/inbox');
  const notice = messages[state || session?.state || ''];
  return <main className="auth-page">
    <header className="auth-header">
      <Link className="wordmark auth-brand" href="/">opptrack<span className="wordmark-dot" aria-hidden="true">.</span></Link>
      <span className="auth-location">Florida State · Tallahassee</span>
    </header>
    <div className="auth-layout">
      <section className="auth-story" aria-labelledby="welcome-heading">
        <p className="kicker">A private place to keep up</p>
        <h1 id="welcome-heading">There’s more<br />to campus.</h1>
        <p className="auth-description">Live music, a film after class, a new club, your next opportunity. Keep the things you might want to do in one place.</p>
        <div className="auth-caption"><span className="auth-caption-line" aria-hidden="true" /><p>Find something.<br />Make it your thing.</p></div>
      </section>
      <section className="auth-form-panel" aria-labelledby="login-heading">
        <div className="auth-form-heading"><h2 id="login-heading">{configured ? 'Welcome back' : 'Set up your inbox'}</h2><p>{configured ? 'Sign in to see what’s happening.' : 'Connect the tracker to start collecting.'}</p></div>
        {notice && <p role="alert" className="notice">{notice}</p>}
        {configured ? <form action={signIn} className="stack auth-form">
          <label>Email<input name="email" type="email" autoComplete="username" placeholder="you@example.com" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
          <button type="submit" className="button-primary">Sign in <span aria-hidden="true">↗</span></button>
          <p className="form-help">This is a private tracker. Sign in with your existing account.</p>
        </form> : <div className="auth-setup"><p>Supabase is not configured. Add the three Supabase values and Trigger development key to <code>.env.local</code>, then restart the app. Follow the runbook to apply migrations and grant your existing account access.</p><p className="form-help">No opportunities have been loaded.</p></div>}
        <p className="auth-note">Your plans are yours. Saving something never adds it to your calendar.</p>
      </section>
    </div>
    <footer className="auth-footer"><span>Built around campus.</span><span>Only you decide what makes the calendar.</span></footer>
  </main>;
}
