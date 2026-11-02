'use client';

import { useRef, useState, type FormEvent } from 'react';
import { reminderLocalInstant } from '../../lib/calendar/time';
import { approvalBlockedMessage, approvalHealth, approvalSourceLink, approvalTime, calendarTargetId, type CalendarApprovalPreview } from './presentation';

type Result = { state: 'succeeded' | 'processing' | 'uncertain' | 'failed' | 'reconnect_required' | 'disabled'; commandId?: string; notice: string; htmlLink?: string };
const states = new Set(['succeeded', 'processing', 'uncertain', 'failed', 'reconnect_required', 'disabled']);
function resultLink(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'calendar.google.com' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function CalendarApproval({ preview, connected }: { preview: CalendarApprovalPreview; connected: boolean }) {
  const command = preview.existingCommand;
  const [result, setResult] = useState<Result | null>(command ? { state: command.state === 'pending' ? 'processing' : states.has(command.state) ? command.state as Result['state'] : 'uncertain', commandId: command.id, notice: command.state === 'succeeded' ? 'This approved addition is already on your primary Google Calendar.' : 'An earlier approval exists. Any retry uses exactly its original title and times below.' } : null);
  const [startLocal, setStartLocal] = useState(''), [endLocal, setEndLocal] = useState('');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef(false);
  const reminder = preview.kind === 'milestone';
  let chosenStart: string | null = null, chosenEnd: string | null = null, timeError = '';
  if (reminder && (startLocal || endLocal)) {
    try {
      if (startLocal) chosenStart = reminderLocalInstant(startLocal);
      if (endLocal) chosenEnd = reminderLocalInstant(endLocal);
      if (chosenStart && chosenEnd && Date.parse(chosenEnd) <= Date.parse(chosenStart)) timeError = 'Choose an end after the start.';
      else if (chosenStart && chosenEnd && Date.parse(chosenEnd) - Date.parse(chosenStart) > 86400000) timeError = 'Keep an action reminder within 24 hours.';
      else if (chosenStart && Date.parse(chosenStart) <= Date.now()) timeError = 'Choose a future reminder time.';
    } catch { timeError = 'This Eastern time is invalid or ambiguous at a daylight-saving change. Choose another time.'; }
  }
  const displayTitle = command?.payload.summary ?? preview.calendarTitle;
  const displayStart = command?.payload.start.dateTime ?? (reminder ? chosenStart : preview.startsAt);
  const displayEnd = command?.payload.end.dateTime ?? (reminder ? chosenEnd : preview.endsAt);
  const location = command?.payload.location ?? (command || reminder ? null : preview.location);
  const source = approvalSourceLink(preview.sourceUrl);
  const htmlLink = resultLink(result?.htmlLink);
  const retryable = !!result?.commandId && result.state !== 'succeeded' && result.state !== 'disabled';
  const canApprove = preview.canApprove && (!reminder || !!chosenStart && !!chosenEnd && !timeError);
  const locked = !!command || !!result?.commandId || result?.state === 'succeeded' || result?.state === 'uncertain';
  const needsConnection = !connected || result?.state === 'reconnect_required';
  const sourceChanged = !!command && command.payload.extendedProperties.private.opptrackFingerprint !== preview.fingerprint;
  const checkExistingOnly = !!command && (sourceChanged || !preview.canApprove);

  function fifteenMinutes() {
    if (!startLocal) { setError('Choose the reminder start first.'); return; }
    try {
      const instant = new Date(Date.parse(reminderLocalInstant(startLocal)) + 15 * 60000);
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
      const part = (type: string) => parts.find(value => value.type === type)?.value;
      const local = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
      if (reminderLocalInstant(local) !== instant.toISOString()) throw new Error('Ambiguous end');
      setEndLocal(local); setError(''); setConfirmed(false);
    } catch { setError('Choose a valid, unambiguous Eastern start and end.'); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (operation.current || !confirmed || needsConnection || (!retryable && (!canApprove || locked))) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(retryable ? '/api/calendar/retry' : '/api/calendar/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryable ? { commandId: result!.commandId } : { kind: preview.kind, targetId: preview.targetId, fingerprint: preview.fingerprint, ...(reminder ? { startAt: chosenStart, endAt: chosenEnd } : {}) }),
      });
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('state' in value) || typeof value.state !== 'string' || !states.has(value.state) || !('notice' in value) || typeof value.notice !== 'string' || 'commandId' in value && !calendarTargetId(value.commandId) || 'htmlLink' in value && typeof value.htmlLink !== 'string') throw new Error('Unconfirmed response');
      setResult(value as Result); setConfirmed(false);
    } catch {
      setResult({ state: 'uncertain', notice: 'The request result could not be confirmed. Reload this approval to check its recorded state before trying again.' });
      setConfirmed(false);
    } finally { operation.current = false; setBusy(false); }
  }
  return <section className="calendar-approval" aria-label="Approve one calendar addition">
    <div className="calendar-approval-facts"><p className="kicker">{command ? 'Previously approved details' : reminder ? 'One action reminder' : 'One event occurrence'}</p><h2>{displayTitle}</h2>
      <dl><div><dt>Calendar</dt><dd>Primary Google Calendar</dd></div><div><dt>Start</dt><dd>{approvalTime(displayStart)}</dd></div><div><dt>End</dt><dd>{approvalTime(displayEnd)}</dd></div><div><dt>Timezone</dt><dd>America/New_York · Eastern</dd></div><div><dt>Location</dt><dd>{location || 'Not specified'}</dd></div></dl>
      <details className="post-details"><summary>Calendar description</summary><p className="full-description">{command?.payload.description ?? preview.calendarDescription}</p></details>
      {command && <p className="small">Approved {approvalTime(command.approvedAt)}. Retries preserve these details even if the source has since changed.</p>}
    </div>
    {checkExistingOnly && <p className="notice" role="alert">{sourceChanged ? 'Current source differs from this approval.' : 'The current source no longer permits this addition.'} A new event will not be inserted. The Google event may already exist; a retry only checks it.</p>}
    <div className="calendar-approval-source"><h3>Check the source</h3>{checkExistingOnly && <p className="small"><strong>Current source title: {preview.title}</strong><br />Current source start: {approvalTime(preview.startsAt)}<br />Current source end: {approvalTime(preview.endsAt)}<br />Current source location: {preview.location || 'Not specified'}</p>}{preview.sourceLocalText && <p>{preview.sourceLocalText}</p>}{preview.description && <details className="post-details"><summary>Source description</summary><p className="full-description">{preview.description}</p></details>}<p className="small">Source timezone: {preview.timezone || 'Unconfirmed'}<br />{approvalHealth(preview)}<br />Last successful read: {approvalTime(preview.lastSuccessAt)}</p>{preview.uncertainties.length > 0 && <ul className="small">{preview.uncertainties.map((text, index) => <li key={index}>{text}</li>)}</ul>}<p className="small">Ticket availability and eligibility are unverified. Adding this item does not reserve a place or submit an application.</p>{source && <a href={source} target="_blank" rel="noopener noreferrer">Open official source ↗</a>}</div>
    {!preview.canApprove && <p className="notice" role="alert">{approvalBlockedMessage(preview.blockedReason)}</p>}
    {reminder && !locked && <fieldset className="calendar-reminder-time"><legend>Your reminder time</legend><p className="small">Choose when you want a calendar block, with no pop-up notification. This is your choice, not a verified source deadline or release instant. All entries below use Eastern time.</p><label className="form-field"><span>Reminder start · Eastern</span><input type="datetime-local" disabled={busy} value={startLocal} onChange={event => { setStartLocal(event.target.value); setConfirmed(false); }} required /></label><label className="form-field"><span>Reminder end · Eastern</span><input type="datetime-local" disabled={busy} value={endLocal} onChange={event => { setEndLocal(event.target.value); setConfirmed(false); }} required /></label><button type="button" className="text-button" disabled={busy} onClick={fifteenMinutes}>Choose a 15-minute reminder</button>{timeError && <p role="alert" className="notice">{timeError}</p>}</fieldset>}
    {result && <div className={`notice${result.state === 'succeeded' ? ' success' : ''}`} role={result.state === 'failed' || result.state === 'uncertain' ? 'alert' : 'status'}><p>{result.notice}</p>{htmlLink && <a href={htmlLink} target="_blank" rel="noopener noreferrer">View added event in Google ↗</a>}{result.state === 'uncertain' && !result.commandId && <a href={`/calendar?kind=${preview.kind}&id=${encodeURIComponent(preview.targetId)}`}>Reload recorded approval</a>}</div>}
    {needsConnection && result?.state !== 'succeeded' && (preview.canApprove || !!command) && <div className="calendar-write-connect"><h3>Connect calendar approval</h3><p>Google will ask for permission to view and edit events on calendars you own. This app uses your primary calendar and creates only the single item you explicitly approve here. Save and Pass stay separate.</p><form method="post" action="/api/calendar/connect?mode=write"><button className="button-secondary">Connect Google for approved additions ↗</button></form><p className="small">Google test access may need reconnection after seven days. Connecting adds no events.</p></div>}
    {!needsConnection && result?.state !== 'succeeded' && result?.state !== 'disabled' && (!locked || retryable) && <form className="calendar-approval-submit" onSubmit={event => void submit(event)}><label className="calendar-approval-check"><input type="checkbox" checked={confirmed} disabled={busy || !retryable && !canApprove} onChange={event => setConfirmed(event.target.checked)} /><span>{retryable ? checkExistingOnly ? 'Check only this previously approved Google event; do not insert a new event.' : 'Retry only this previously approved addition, using the exact details shown above.' : `I approve adding only this ${reminder ? 'reminder at my chosen time' : 'event occurrence'} to my primary Google Calendar.`}</span></label><p className="small">No guests, invitations, recurrence or email alerts. Other saved items will not be added.</p><button className="button-primary" disabled={busy || !confirmed || !retryable && !canApprove}>{busy ? 'Checking calendar addition…' : retryable ? checkExistingOnly ? 'Check existing Google event' : 'Retry this approved addition' : reminder ? 'Approve this reminder & add to Google' : 'Approve this event & add to Google'}</button></form>}
    {error && <p role="alert" className="notice">{error}</p>}
  </section>;
}
