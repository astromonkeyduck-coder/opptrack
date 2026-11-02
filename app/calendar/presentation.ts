import { safeExternalUrl, sourceIsStale } from '../../lib/intake/presentation';

export type CalendarApprovalCommand = {
  id: string; kind: 'occurrence' | 'milestone'; targetId: string; state: string;
  approvedAt: string; lastError?: string | null;
  payload: { summary: string; description: string; location?: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; extendedProperties: { private: { opptrackCommandId: string; opptrackFingerprint: string } } };
};
export type CalendarApprovalPreview = {
  kind: 'occurrence' | 'milestone'; targetId: string; title: string; description: string | null;
  calendarTitle: string; calendarDescription: string;
  sourceUrl: string | null; location: string | null; startsAt: string | null; endsAt: string | null;
  sourceLocalText: string | null; timezone: string | null; uncertainties: string[];
  sourceHealth: string; lastSuccessAt: string | null; cadenceSeconds: number | null;
  fingerprint: string; canApprove: boolean; blockedReason: string | null;
  existingCommand: CalendarApprovalCommand | null;
};
export const calendarTargetId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const instant = (value: unknown): value is string => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function calendarApprovalCommand(value: unknown): CalendarApprovalCommand | null {
  if (!record(value) || !calendarTargetId(value.id) || !['occurrence', 'milestone'].includes(String(value.kind)) || !calendarTargetId(value.targetId) || !['pending', 'processing', 'succeeded', 'uncertain', 'failed'].includes(String(value.state)) || typeof value.approvedAt !== 'string' || !record(value.payload)) return null;
  const payload = value.payload;
  if (typeof payload.summary !== 'string' || typeof payload.description !== 'string' || payload.location !== undefined && typeof payload.location !== 'string' || !record(payload.start) || !record(payload.end) || !instant(payload.start.dateTime) || !instant(payload.end.dateTime) || payload.start.timeZone !== 'America/New_York' || payload.end.timeZone !== 'America/New_York') return null;
  if (!record(payload.extendedProperties) || !record(payload.extendedProperties.private) || payload.extendedProperties.private.opptrackCommandId !== value.id || typeof payload.extendedProperties.private.opptrackFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.extendedProperties.private.opptrackFingerprint)) return null;
  return value as CalendarApprovalCommand;
}

export function calendarApprovalPreview(value: unknown): CalendarApprovalPreview | null {
  if (!record(value) || !['occurrence', 'milestone'].includes(String(value.kind)) || !calendarTargetId(value.targetId) || typeof value.title !== 'string' || !value.title.trim() || typeof value.calendarTitle !== 'string' || !value.calendarTitle.trim() || typeof value.calendarDescription !== 'string' || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.canApprove !== 'boolean' || !nullableString(value.blockedReason)) return null;
  for (const key of ['description', 'sourceUrl', 'location', 'startsAt', 'endsAt', 'sourceLocalText', 'timezone', 'lastSuccessAt']) if (!nullableString(value[key])) return null;
  if (typeof value.sourceHealth !== 'string' || !Array.isArray(value.uncertainties) || value.uncertainties.some(entry => typeof entry !== 'string') || value.cadenceSeconds !== null && (typeof value.cadenceSeconds !== 'number' || !Number.isFinite(value.cadenceSeconds))) return null;
  if (value.existingCommand !== null) {
    const command = calendarApprovalCommand(value.existingCommand);
    if (!command || command.kind !== value.kind || command.targetId !== value.targetId) return null;
  }
  return value as CalendarApprovalPreview;
}

export function approvalTime(value: string | null): string {
  return instant(value) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)) : 'Unverified';
}
export function approvalHealth(preview: CalendarApprovalPreview, now = Date.now()) {
  return `${preview.sourceHealth === 'success' ? 'Latest collection succeeded' : `Collection ${preview.sourceHealth || 'unknown'}`}${sourceIsStale(preview.lastSuccessAt, preview.cadenceSeconds, now) ? ' · stale or never succeeded' : ''}`;
}
export function approvalSourceLink(value: string | null) { return safeExternalUrl(value); }
export function approvalBlockedMessage(reason: string | null) {
  if (reason === 'not_scheduled') return 'The source does not currently mark this event as scheduled. Check its status before making plans.';
  if (reason === 'event_started') return 'This occurrence has already started. A past event cannot be added through this approval.';
  return 'The source has no verified timed start and end. Date-only, all-day and unknown-duration events need source verification before this app can add them.';
}
