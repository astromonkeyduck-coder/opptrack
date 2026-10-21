'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { occurrenceSchedule } from '../../lib/review/deck';
import { calendarBlockPosition, calendarPreviewWeek, calendarTimeRange, calendarTimelineBounds, easternDateKey, eventsForCalendarDay, occurrenceForCalendarDay, parseCalendarResponse, reviewCalendarDate, shiftCalendarDay, timedIntervalForDay, type CalendarDisplayResponse } from '../../lib/review/calendar-layout';
import type { InboxRow } from './components';

const loading: CalendarDisplayResponse = { state: 'loading', events: [], complete: false };

export const ReviewCalendar = memo(function ReviewCalendar({ candidate, savedRows, connectionMessage }: { candidate?: InboxRow; savedRows: InboxRow[]; connectionMessage?: string }) {
  const candidateDate = candidate ? reviewCalendarDate(candidate) : null;
  const today = easternDateKey(new Date().toISOString())!;
  const [selected, setSelected] = useState(candidateDate || today);
  const [response, setResponse] = useState<CalendarDisplayResponse>(loading);
  const [connectionNotice, setConnectionNotice] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { if (candidateDate) setSelected(candidateDate); }, [candidateDate]);
  const week = useMemo(() => calendarPreviewWeek(selected, savedRows), [selected, savedRows]);
  const first = week[0]?.dateKey || today;
  useEffect(() => {
    const controller = new AbortController(); setResponse(loading);
    fetch(`/api/calendar/events?from=${first}`, { cache: 'no-store', signal: controller.signal })
      .then(async res => {
        const body = parseCalendarResponse(await res.json());
        if (!res.ok && (body.state === 'connected' || body.state === 'partial')) throw new Error('Invalid calendar response');
        return body;
      })
      .then(body => { if (!controller.signal.aborted) setResponse(body); })
      .catch(() => { if (!controller.signal.aborted) setResponse({ state: 'unavailable', events: [], complete: false, notice: 'Your calendar could not be loaded. Availability is unknown.' }); });
    return () => controller.abort();
  }, [first, refresh]);
  const connected = response.state === 'connected' || response.state === 'partial';
  const events = eventsForCalendarDay(response.events, selected);
  const saved = savedRows.filter(item => item.decision === 'save' && occurrenceForCalendarDay(item, selected) && item.id !== candidate?.id);
  const dayTitle = new Date(`${selected}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
  const timedEvents = events.filter(e => !e.allDay);
  const allDay = events.filter(e => e.allDay);
  const candidateSchedule = candidate ? occurrenceSchedule(candidate) : null;
  const candidateVisible = candidate && occurrenceForCalendarDay(candidate, selected);
  const candidateTimed = candidateVisible && candidateSchedule?.precision === 'instant';
  const { startHour, endHour } = calendarTimelineBounds(selected, events, [...saved, ...(candidateVisible ? [candidate] : [])]);
  const scale = 44;
  function blockPosition(start: string, end?: string | null) {
    const interval = timedIntervalForDay(start, end, selected);
    return interval ? calendarBlockPosition(interval, startHour, scale) : undefined;
  }
  const conflict = candidateTimed && candidate.ends_at && timedEvents.some(event => Date.parse(event.start) < Date.parse(candidate.ends_at!) && Date.parse(event.end) > Date.parse(candidate.starts_at!));
  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/calendar/disconnect', { method: 'POST' });
      const body: unknown = await res.json();
      if (!res.ok || !body || typeof body !== 'object' || !('state' in body) || body.state !== 'disconnected' || !('revoked' in body) || typeof body.revoked !== 'boolean') throw new Error('Disconnect unconfirmed');
      const notice = 'notice' in body && typeof body.notice === 'string' ? body.notice : body.revoked ? 'Google Calendar disconnected.' : 'The stored connection was removed. Google revocation could not be confirmed; review your Google Account permissions.';
      setConnectionNotice(notice);
      setRefresh(value => value + 1);
    } catch { setConnectionNotice('Disconnect could not be confirmed. Your Google connection may still be active. Try again.'); }
    finally { setDisconnecting(false); }
  }
  return <aside className="review-calendar" aria-label="Calendar beside event cards">
    <div className="calendar-heading"><div><p className="kicker">Make room for it</p><h2>Your calendar<span className="calendar-readonly">Read only</span></h2></div><button type="button" className="icon-button" onClick={() => setRefresh(v => v + 1)} aria-label="Refresh Google Calendar">↻</button></div>
    <div className="calendar-month"><strong>{new Date(`${selected}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</strong><div><button type="button" className="icon-button" aria-label="Previous calendar week" onClick={() => setSelected(shiftCalendarDay(selected, -7))}>←</button><button type="button" className="text-button" onClick={() => setSelected(today)}>Today</button><button type="button" className="icon-button" aria-label="Next calendar week" onClick={() => setSelected(shiftCalendarDay(selected, 7))}>→</button></div></div>
    <div className="calendar-week">{week.map(day => <button type="button" key={day.dateKey} onClick={() => setSelected(day.dateKey)} className={day.dateKey === selected ? 'is-selected' : ''} aria-pressed={day.dateKey === selected} aria-label={`${day.label}, ${day.dateKey}${day.occurrences.length ? `, ${day.occurrences.length} saved events` : ''}`}><span>{day.label.slice(0, 1)}</span><strong>{day.day}</strong><i className={day.occurrences.length ? 'has-saved' : ''} aria-hidden="true" /></button>)}</div>
    {connectionNotice && <p className="notice" role="status">{connectionNotice}</p>}
    {connectionMessage === 'failed' && <p className="notice" role="alert">Google could not be connected. Try connecting again.</p>}
    {!connected && response.state !== 'loading' && <div className="calendar-connect"><span className="calendar-glyph" aria-hidden="true">▦</span><h3>{response.state === 'reconnect_required' ? 'Reconnect Google Calendar' : 'See how it fits.'}</h3><p>{response.notice || (response.state === 'unconfigured' ? 'Google Calendar setup is not finished yet. Personal availability is not shown.' : response.state === 'disconnected' ? 'Connect your primary Google calendar to see your plans beside each event.' : 'Calendar access failed. Your availability is unknown.')}</p><form method="post" action="/api/calendar/connect"><button className="button-secondary" disabled={response.state === 'unconfigured'}>Connect Google Calendar <span aria-hidden="true">↗</span></button></form><small>Read-only access. No events will be added, edited or deleted.</small></div>}
    {response.state === 'loading' && <p className="calendar-loading" role="status">Checking your calendar…</p>}
    {response.state === 'partial' && <p className="notice" role="alert">{response.notice || 'Only part of your calendar loaded. Availability is incomplete.'}</p>}
    <div className="calendar-day-heading"><strong>{dayTitle}</strong><span>Eastern time</span></div>
    <div className="calendar-legend"><span><i className="google-dot" />Google</span><span><i className="saved-dot" />Saved here</span><span><i className="preview-dot" />This card</span></div>
    {allDay.map(event => <div className="calendar-all-day" key={event.id}>All day · {event.title}</div>)}
    {saved.filter(item => occurrenceSchedule(item).precision !== 'instant').map(item => <div className="calendar-all-day saved-calendar-event" key={item.id}>{occurrenceSchedule(item).timeLabel} · {item.title}</div>)}
    {candidateVisible && !candidateTimed && <div className="calendar-all-day candidate-calendar-event">{candidateSchedule?.timeLabel} · {candidate.title}</div>}
    {conflict && <p className="calendar-conflict">Overlaps an event on Google Calendar.</p>}
    <div className="calendar-timeline-scroll"><div className="calendar-timeline" style={{ height: (endHour - startHour) * scale }}>
      {Array.from({ length: endHour - startHour }, (_, i) => <div className="calendar-hour" key={i} style={{ top: i * scale }}><span>{(startHour + i) % 12 || 12}{startHour + i < 12 ? 'am' : 'pm'}</span></div>)}
      <div className="calendar-blocks">
        {timedEvents.map(event => <div key={event.id} className="calendar-event google-calendar-event" style={blockPosition(event.start, event.end)}><strong>{event.title}</strong><span>{calendarTimeRange(event.start, event.end, selected)}</span></div>)}
        {saved.filter(item => occurrenceSchedule(item).precision === 'instant').map(item => <div key={item.id} className="calendar-event saved-calendar-event" style={blockPosition(item.starts_at!, item.ends_at)}><strong>{item.title}</strong><span>{calendarTimeRange(item.starts_at!, item.ends_at, selected)}</span></div>)}
        {candidateTimed && <div className="calendar-event candidate-calendar-event" style={blockPosition(candidate.starts_at!, candidate.ends_at)}><strong>{candidate.title}</strong><span>{calendarTimeRange(candidate.starts_at!, candidate.ends_at, selected)}</span></div>}
      </div>
    </div></div>
    <section className="calendar-agenda" aria-label="All events shown for the selected day"><h3>Day details</h3>
      {events.map(event => <p key={`google-${event.id}`}><strong>{event.title}</strong><span>{event.allDay ? 'All day' : calendarTimeRange(event.start, event.end, selected)} · Google</span></p>)}
      {saved.map(item => <p key={`saved-${item.id}`}><strong>{item.title}</strong><span>{occurrenceSchedule(item).precision === 'instant' ? calendarTimeRange(item.starts_at!, item.ends_at, selected) : occurrenceSchedule(item).timeLabel} · Saved here</span></p>)}
      {candidateVisible && <p><strong>{candidate.title}</strong><span>{candidateTimed ? calendarTimeRange(candidate.starts_at!, candidate.ends_at, selected) : candidateSchedule?.timeLabel} · This card, preview only</span></p>}
      {response.state === 'connected' && response.complete && !events.length && <p>No primary-calendar events returned for this day.</p>}
    </section>
    <p className="calendar-footnote">{connected ? 'Primary Google calendar only · ' : 'Personal calendar not loaded; availability unknown · '}Saved events stay in this tracker. The outlined event is a preview. Unknown durations use a small marker.{connected && " Google test access requires reconnection after 7 days."}</p>
    {connected && <button type="button" className="text-button disconnect-calendar" disabled={disconnecting} title="Removes the tracker connection and attempts to revoke this app’s Google grant" onClick={() => void disconnect()}>{disconnecting ? 'Disconnecting…' : 'Disconnect Google Calendar'}</button>}
  </aside>;
});
