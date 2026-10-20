import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import IntakeForm from './upload-form';

export const dynamic = 'force-dynamic';
export default async function Intake() {
  await requireTrackerSession();
  return <main><header><Link className="wordmark" href="/inbox"><span className="mark" aria-hidden="true">F</span>Opportunity Tracker</Link><Link href="/inbox">Back to inbox</Link></header><section className="inbox-intro"><p className="eyebrow">Private manual intake</p><h1>Add a flyer or link</h1><p className="lead">Retain all slides, the original link, and your notes for review. These submissions are unverified; no OCR or model extraction runs in this stage.</p></section><section className="setup intake-panel"><IntakeForm /><p className="small">Links are saved without a server fetch. No social access, email delivery, RSVP, or calendar operation is triggered. Upload only material you are permitted to retain.</p></section><footer><span>Private files require your authenticated owner session.</span><span>Calendar writes disabled.</span></footer></main>;
}
