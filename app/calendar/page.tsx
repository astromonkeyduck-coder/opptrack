import Link from 'next/link';
import { requireTrackerSession } from '../../lib/auth/session';
import { calendarConfig, decryptCredentials, getCalendarConnection, GOOGLE_CALENDAR_WRITE_SCOPE } from '../../lib/calendar/google';
import { AppShell } from '../components/app-shell';
import { CalendarApproval } from './components';
import { CalendarApprovalHistory } from './history';
import { calendarApprovalCommand, calendarApprovalPreview, calendarTargetId, type CalendarApprovalCommand, type CalendarApprovalPreview } from './presentation';

export const dynamic = 'force-dynamic';
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user } = await requireTrackerSession();
  const params = await searchParams;
  const kind = params.kind === 'occurrence' || params.kind === 'milestone' ? params.kind : null;
  const targetId = calendarTargetId(params.id) ? params.id : null;
  const enabled = process.env.CALENDAR_WRITES_ENABLED === 'true';
  const config = calendarConfig();
  let connected = false;
  if (enabled && config) {
    try { const connection = await getCalendarConnection(supabase); connected = !!connection && decryptCredentials(connection.encryptedCredentials, config.encryptionKey, user.id).scope === GOOGLE_CALENDAR_WRITE_SCOPE; } catch { /* The approval API rechecks the grant before writing. */ }
  }
  let preview: CalendarApprovalPreview | null = null;
  if (enabled && kind && targetId) {
    try { const result = await supabase.rpc('calendar_write_preview', { p_kind: kind, p_target_id: targetId }); if (!result.error) preview = calendarApprovalPreview(result.data); }
    catch { /* A failed read must never become an empty or approved calendar item. */ }
  }
  let history: CalendarApprovalCommand[] = [], historyError = false;
  if (enabled && config && (!kind || !targetId)) {
    try {
      const result = await supabase.rpc('calendar_write_list');
      if (result.error || !Array.isArray(result.data)) historyError = true;
      else {
        const parsed = result.data.slice(0, 50).map(calendarApprovalCommand);
        if (parsed.some(value => !value)) historyError = true;
        else history = parsed as CalendarApprovalCommand[];
      }
    } catch { historyError = true; }
  }
  const connectionState = typeof params.connection === 'string' ? params.connection : params.connected === '1' ? 'connected' : null;
  return <AppShell active={kind === 'milestone' ? 'deadlines' : 'saved'}><div className="page-heading"><div><p className="kicker">You choose what goes on your calendar</p><h1>Review calendar addition.</h1><p className="subtitle">One explicit approval for one event or reminder.</p></div></div>
    {connectionState === 'cancelled' && <p className="notice" role="status">Google connection was cancelled. No calendar item was added.</p>}
    {(connectionState === 'failed' || connectionState === 'unconfigured' || connectionState === 'connected' && !connected) && <p className="notice" role="alert">Calendar approval access could not be verified. No item was added by connecting; open an individual item to reconnect and review it.</p>}
    {!enabled ? <p className="notice">Calendar writing is disabled. You can still open a Google draft from an event’s Details or Saved and save it yourself.</p>
      : !config ? <p className="notice" role="alert">Calendar connection setup is unavailable. Nothing can be added until configuration is restored.</p>
      : !kind || !targetId ? <><div className="calendar-approval-empty"><h2>{connectionState === 'connected' && connected ? 'Calendar approval is connected.' : 'Choose an event or reminder first.'}</h2><p>Return to an individual event or notice to review its exact details. Connecting Google has added nothing, and saved items stay in this tracker.</p></div><CalendarApprovalHistory commands={history} error={historyError} /></>
      : !preview ? <p className="notice" role="alert">This item’s latest calendar details could not be verified. It may have changed or be unavailable. Nothing has been approved or added; return to the source and try again.</p>
      : <CalendarApproval preview={preview} connected={connected} />}
    <nav className="calendar-approval-back" aria-label="Back to review"><Link href="/inbox?decision=save">← Saved events</Link><Link href="/deadlines">Deadlines & tickets →</Link>{preview && <Link href="/calendar">Recorded approvals</Link>}</nav>
  </AppShell>;
}
