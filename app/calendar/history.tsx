import { approvalTime, type CalendarApprovalCommand } from './presentation';

export function CalendarApprovalHistory({ commands, error }: { commands: CalendarApprovalCommand[]; error: boolean }) {
  if (error) return <p className="notice" role="alert">Recorded calendar approvals could not be loaded. An empty history is not confirmed; check Google before trying to add the same item again.</p>;
  return <section className="calendar-approval-history" aria-label="Recorded calendar approvals"><h2>Your recent approvals</h2><p className="small">Up to 50 most recent approvals. Open an item to review its recorded result or explicitly retry the same addition.</p>{commands.length ? <ol>{commands.slice(0, 50).map(command => <li key={command.id}><div><strong>{command.payload.summary}</strong><span>{approvalTime(command.payload.start.dateTime)}</span><span>State: {command.state === 'pending' ? 'awaiting execution' : command.state}</span></div><a href={`/calendar?kind=${command.kind}&id=${encodeURIComponent(command.targetId)}`}>Review recorded approval →</a></li>)}</ol> : <p>No calendar approvals have been recorded.</p>}</section>;
}
