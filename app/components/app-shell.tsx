import type { ReactNode } from 'react';
import Link from 'next/link';
import { signOut } from '../actions';

type Section = 'discover' | 'saved' | 'instagram' | 'intake' | 'sources';

const navigation: { section: Section; href: string; label: string }[] = [
  { section: 'discover', href: '/inbox', label: 'Discover' },
  { section: 'saved', href: '/inbox?decision=save', label: 'Saved' },
  { section: 'instagram', href: '/instagram', label: 'Instagram' },
  { section: 'intake', href: '/intake', label: 'Add something' },
  { section: 'sources', href: '/sources', label: 'Sources' },
];

function NavigationIcon({ section }: { section: Section }) {
  const paths: Record<Section, ReactNode> = {
    discover: <><rect x="3" y="4" width="10" height="13" rx="1.5" /><path d="M7 2h9a1 1 0 0 1 1 1v11M6 8h4M6 11h4" /></>,
    saved: <path d="M5 3h10v14l-5-3-5 3V3Z" />,
    instagram: <><rect x="3" y="3" width="14" height="14" rx="4" /><circle cx="10" cy="10" r="3" /><path d="M14.2 5.8h.01" /></>,
    intake: <><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M10 6v8M6 10h8" /></>,
    sources: <><path d="M5 14v3M10 9v8M15 3v14" /></>,
  };
  return <svg className="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[section]}</svg>;
}

export function AppShell({ active, children }: { active: Section; children: ReactNode }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="app-sidebar">
      <div className="app-brand-group">
        <Link className="wordmark app-brand" href="/inbox">opptrack<span className="wordmark-dot" aria-hidden="true">.</span></Link>
        <span className="app-brand-caption">Florida State</span>
      </div>
      <nav className="app-nav" aria-label="Main navigation">
        {navigation.map(item => <Link key={item.section} href={item.href} className={`app-nav-link${active === item.section ? ' is-active' : ''}`} aria-current={active === item.section ? 'page' : undefined}><NavigationIcon section={item.section} /><span>{item.label}</span></Link>)}
      </nav>
      <div className="app-sidebar-bottom">
        <p className="calendar-state"><span aria-hidden="true" />Calendar writes off</p>
        <form action={signOut}><button className="app-signout" type="submit">Sign out <span aria-hidden="true">↗</span></button></form>
      </div>
    </aside>
    <main id="main-content" className="app-main" tabIndex={-1}>{children}</main>
  </div>;
}
