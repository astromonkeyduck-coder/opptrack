'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import { safeExternalUrl, sourceIsStale } from '../../lib/intake/presentation';
import { occurrenceSchedule, swipeFeedback, swipeIntent, uniqueOccurrences } from '../../lib/review/deck';
import { reviewOccurrence, undoReviewOccurrence } from './review-actions';
import { timestamp, type InboxRow } from './components';
import { ReviewCalendar } from './review-calendar';

type Decision = 'save' | 'reject';
type History = { row: InboxRow; decision: Decision; decisionId: string; previousDecision: Decision | null };

function sourceName(id: string) {
  return id === 'fsu-calendar-api' ? 'FSU Calendar' : id === 'fsu-music-events' ? 'College of Music' : id.replace(/^instagram-/, '@').replaceAll('-', ' ');
}

export function ReviewDeck({ rows: input, savedRows, nextPage, previousPage, total, page, calendarMessage, continueReviewLink }: {
  rows: InboxRow[]; savedRows: InboxRow[]; nextPage?: string; previousPage?: string; total: number; page: number; calendarMessage?: string; continueReviewLink?: string;
}) {
  const [rows] = useState(() => uniqueOccurrences(input));
  const [initialTotal] = useState(total);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [saved, setSaved] = useState(savedRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [art, setArt] = useState<{ url: string; alt: string } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const gesture = useRef<{ pointerId: number; x: number; y: number; dx: number; dy: number; width: number } | null>(null);
  const operation = useRef(false);
  const card = useRef<HTMLElement>(null);
  const row = rows.find(item => !reviewed.includes(item.id));
  const schedule = row ? occurrenceSchedule(row) : null;
  const feedback = swipeFeedback(offset, card.current?.clientWidth || 420);
  const url = row ? safeExternalUrl(row.source_url) : null;
  const latest = history.at(-1);

  useEffect(() => {
    setArt(null); setImageFailed(false);
    if (!row || row.source_id !== 'fsu-calendar-api') return;
    const controller = new AbortController();
    fetch(`/api/event-art?opportunity=${encodeURIComponent(row.opportunity_id)}`, { signal: controller.signal, cache: 'no-store' })
      .then(res => res.json()).then(result => {
        if (result.state === 'available' && typeof result.url === 'string' && /^https:\/\/localist-images\.azureedge\.net\/photos\/\d+\/huge\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/.test(result.url)) setArt({ url: result.url, alt: typeof result.alt === 'string' ? result.alt : 'Source event image' });
      }).catch(() => {});
    return () => controller.abort();
  }, [row?.opportunity_id, row?.source_id]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) { if (operation.current) event.preventDefault(); }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  async function choose(decision: Decision) {
    if (!row || operation.current) return;
    operation.current = true; setBusy(true); setError(''); setOffset(0); setDragging(false);
    try {
      const result = await reviewOccurrence({ id: row.id, revision: row.revision, decision });
      if (!result.ok) { setError(result.error); return; }
      setReviewed(items => [...items, row.id]);
      setHistory(items => [...items, { row, decision, decisionId: result.decisionId, previousDecision: result.previousDecision }]);
      setSaved(items => decision === 'save' ? [...items.filter(item => item.id !== row.id), { ...row, decision: 'save' }] : items.filter(item => item.id !== row.id));
      setAnnouncement(`${decision === 'save' ? 'Saved' : 'Passed on'} ${row.title}. Nothing added to your calendar.`);
    } catch { setError('Your decision could not be saved. This card is still here. Try again.'); }
    finally { operation.current = false; setBusy(false); }
  }

  async function undo() {
    if (!latest || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const result = await undoReviewOccurrence({ id: latest.row.id, revision: latest.row.revision, expectedDecision: latest.decision, expectedDecisionId: latest.decisionId, previousDecision: latest.previousDecision });
      if (!result.ok) { setError(result.error); return; }
      setReviewed(items => items.filter(id => id !== latest.row.id));
      setHistory(items => items.slice(0, -1));
      setSaved(items => latest.previousDecision === 'save' ? [...items.filter(item => item.id !== latest.row.id), { ...latest.row, decision: 'save' }] : items.filter(item => item.id !== latest.row.id));
      setAnnouncement(`Undid your decision for ${latest.row.title}.`);
    } catch { setError('Undo could not be saved. Your last decision is unchanged.'); }
    finally { operation.current = false; setBusy(false); }
  }

  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (busy || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('a,button,input,select,textarea,summary,details')) return;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, width: event.currentTarget.clientWidth };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return;
    g.dx = event.clientX - g.x; g.dy = event.clientY - g.y;
    setOffset(Math.abs(g.dy) > Math.abs(g.dx) ? 0 : Math.max(-g.width, Math.min(g.width, g.dx)));
  }
  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null; setDragging(false); setOffset(0);
    const decision = swipeIntent({ dx: event.clientX - g.x, dy: event.clientY - g.y, width: g.width, cancelled });
    if (decision) void choose(decision);
  }

  return <div className={`review-workspace${showCalendar ? ' calendar-visible' : ''}`}>
    <section className="deck-column" aria-label="Review event cards">
      <div className="deck-toolbar"><span>{row ? `${reviewed.length + 1} / ${rows.length}` : `${rows.length} / ${rows.length}`} <span className="muted">on this page</span></span><button type="button" className="text-button calendar-toggle" onClick={() => setShowCalendar(v => !v)} aria-expanded={showCalendar}>{showCalendar ? 'Hide calendar' : 'View calendar'} <span aria-hidden="true">▦</span></button><button type="button" className="undo-button" onClick={undo} disabled={busy || !latest} aria-label="Undo last decision">↶ Undo</button></div>
      {error && <p role="alert" className="notice">{error}</p>}
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      <div className="deck-stage">
        <div className="swipe-aura aura-reject" style={{ opacity: feedback.direction === 'reject' ? feedback.progress * .85 : 0 }} />
        <div className="swipe-aura aura-save" style={{ opacity: feedback.direction === 'save' ? feedback.progress * .85 : 0 }} />
        {row && schedule ? <>
          <div className="card-underlay" aria-hidden="true" />
          <article ref={card} key={row.id} className={`event-card${dragging ? ' is-dragging' : ''}`} style={{ '--swipe-x': `${offset * .65}px`, '--swipe-rotation': `${offset / 32}deg` } as CSSProperties} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={() => { gesture.current = null; setOffset(0); setDragging(false); }} aria-labelledby="current-event-title" aria-busy={busy}>
            <div className={`event-art art-${row.source_id === 'fsu-music-events' ? 'music' : 'campus'}`}>
              {art && !imageFailed && <><img className="event-photo" src={art.url} alt={art.alt} draggable={false} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /><span className="photo-credit">Source image · FSU Calendar</span></>}
              <span className="event-category">{row.categories?.[0] || (row.source_id === 'fsu-music-events' ? 'Music' : 'Campus listings')}</span>
              <div className="poster-type" aria-hidden="true"><span>{schedule.weekday || 'FSU'}</span><strong>{schedule.day || '↗'}</strong></div>
              <span className="poster-month">{schedule.month || 'Find your next thing'}</span>
              <span className="poster-line" aria-hidden="true" />
              <div className={`swipe-stamp${feedback.direction === 'reject' ? ' stamp-reject' : ' stamp-save'}`} style={{ opacity: feedback.progress }} aria-hidden="true">{feedback.direction === 'reject' ? 'PASS' : 'SAVE'}<small>{feedback.progress >= 1 ? 'Release to confirm' : 'Keep dragging'}</small></div>
            </div>
            <div className="event-body">
              <div className="event-source"><span>{sourceName(row.source_id)}</span><span>{row.status !== 'scheduled' ? row.status : 'Event'}</span></div>
              <h2 id="current-event-title">{row.title}</h2>
              <div className="event-when"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2v4m8-4v4M3 8h14"/></svg><div><strong>{schedule.weekday ? `${schedule.weekday}, ` : ""}{schedule.dateLabel}</strong><span>{schedule.timeLabel}{schedule.timezoneLabel ? ` · ${schedule.timezoneLabel}` : ''}</span></div></div>

              <p className="event-location"><span aria-hidden="true">↗</span> {row.location || 'Location unverified'}</p>
              {row.description && <p className="event-excerpt">{row.description}</p>}
              <div className="event-flags"><span>Tickets unverified</span>{row.status !== 'scheduled' && <span className="flag-warning">{row.status}</span>}{(row.source_health !== 'success' || sourceIsStale(row.source_last_success_at, row.source_cadence_seconds ?? null)) && <span className="flag-warning">Source {row.source_health !== 'success' ? row.source_health : 'stale'}</span>}</div>
              <details className="event-details"><summary>Details & source <span aria-hidden="true">+</span></summary><div>{schedule.localText && schedule.uncertain && <p>Source time: {schedule.localText} · source timezone unconfirmed</p>}{row.description && <p className="full-description">{row.description}</p>}<p>{[...new Set(['Ticket availability unverified', ...(row.uncertainties || [])])].join(' · ')}</p><p>End: {row.ends_at ? timestamp(row.ends_at) : 'End time unverified'}</p><p>Health: {row.source_health} · Last success: {timestamp(row.source_last_success_at)}</p>{row.coverage_note && <p>{row.coverage_note}</p>}{url && <a href={url} rel="noopener noreferrer" target="_blank">Open source listing ↗</a>}{art && !imageFailed && <p><a href={art.url} target="_blank" rel="noopener noreferrer">View full source image ↗</a></p>}</div></details>
            </div>
          </article>
        </> : <div className="deck-complete"><span aria-hidden="true">✓</span><h2>{rows.length ? 'Caught up with this page.' : 'Nothing here yet.'}</h2><p>{rows.length ? 'Your decisions are saved. Keep going, or take another look at your saved events.' : 'Try a broader search, or check Sources for collection gaps.'}</p>{(nextPage || (continueReviewLink && initialTotal > reviewed.length)) ? <a className="button-primary" href={continueReviewLink || nextPage!}>Keep reviewing →</a> : <Link className="button-secondary" href="/inbox?decision=save">See saved events ↗</Link>}</div>}
      </div>
      {row && <div className="deck-controls"><button type="button" className="decision-button reject-button" disabled={busy} onClick={() => void choose('reject')} aria-label={`Pass on ${row.title}`}><span aria-hidden="true">×</span><strong>Pass</strong><small>Swipe left</small></button><p>{busy ? 'Saving your decision…' : 'Your call.'}<span>Nothing added to your calendar.</span></p><button type="button" className="decision-button save-button" disabled={busy} onClick={() => void choose('save')} aria-label={`Save ${row.title}`}><span aria-hidden="true">✓</span><strong>Save</strong><small>Swipe right</small></button></div>}
      <nav className="pagination deck-pagination" aria-label="Catalog pages">{!continueReviewLink && previousPage && <Link href={previousPage}>← Previous page</Link>}<span>{continueReviewLink ? "One occurrence, one decision." : `Page ${page}`}</span>{!continueReviewLink && nextPage && <Link href={nextPage}>Next page →</Link>}</nav>
    </section>
    <ReviewCalendar candidate={row} savedRows={saved} connectionMessage={calendarMessage} />
  </div>;
}
