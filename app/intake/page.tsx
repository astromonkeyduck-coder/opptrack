import { requireTrackerSession } from '../../lib/auth/session';
import { AppShell } from '../components/app-shell';
import IntakeForm from './upload-form';

export const dynamic = 'force-dynamic';
export default async function Intake() {
  await requireTrackerSession();
  return <AppShell active="intake">
    <div className="page-heading"><div><p className="kicker">Your desk</p><h1>Add something</h1><p className="subtitle">Found a flyer, post or opportunity? Keep it here for a closer look.</p></div></div>
    <div className="intake-layout">
      <section className="panel"><IntakeForm /></section>
      <aside className="intake-aside">
        <h2>A place for the details</h2>
        <p>Save the original link, every flyer slide and anything you want to remember. Your files stay private.</p>
        <p>Submissions are saved as you provide them. Dates and details aren’t extracted or verified yet.</p>
        <p className="form-help">Links are saved without opening them. Only upload material you’re allowed to retain.</p>
      </aside>
    </div>
  </AppShell>;
}
