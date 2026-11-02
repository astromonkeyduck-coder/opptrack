import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { ReviewDeck } from '../app/inbox/review-deck';
import { OpportunityCard, SavedCalendarGuidance, type InboxRow } from '../app/inbox/components';
import { SavedForLaterNotice } from '../app/inbox/calendar-draft-link';

// Synthetic render fixtures. No review action, credential, database or Google request is executed.
const id = '11111111-1111-4111-8111-111111111111';
const row: InboxRow = {
  id, opportunity_id: '22222222-2222-4222-8222-222222222222', title: 'Synthetic afternoon concert',
  description: 'Synthetic source facts', source_url: 'https://calendar.fsu.edu/event/synthetic',
  categories: [], uncertainties: [], starts_at: '2027-01-05T19:00:00Z', ends_at: '2027-01-05T20:00:00Z',
  local_start_text: null, timezone: 'UTC', date_precision: 'instant', location: 'Synthetic hall',
  status: 'scheduled', revision: 1, source_id: 'fsu-calendar-api', source_health: 'success',
  source_last_success_at: '2026-11-02T15:00:00Z', source_last_attempt_at: '2026-11-02T15:00:00Z',
  source_cadence_seconds: 3600, coverage_note: null, decision: null,
};
const approvalHref = `/calendar?kind=occurrence&id=${id}`;

test('the unsaved event card exposes its calendar review without expanding source details', () => {
  const $ = load(renderToStaticMarkup(createElement(ReviewDeck, {
    rows: [row], savedRows: [], total: 1, page: 1, calendarWritesEnabled: true,
  })));
  const link = $('article.event-card a').filter((_, node) => $(node).attr('href') === approvalHref);
  assert.equal(link.length, 1);
  assert.match(link.text(), /Add to Google Calendar/);
  assert.equal(link.closest('details').length, 0);
  assert.match(link.parent().text(), /Review and approve this one event on the next screen/);
  const save = $('button.save-button');
  assert.equal(save.attr('aria-label'), `Save ${row.title} for later`);
  assert.match(save.text(), /Save for later/);
  assert.match($('.deck-controls').text(), /Swipes only organize your inbox/);
  assert.equal($('form[action*="calendar/approve"]').length, 0);
});

test('a saved event has its own approval link and is labelled saved for later', () => {
  const $ = load(renderToStaticMarkup(createElement(OpportunityCard, {
    row: { ...row, decision: 'save' }, calendarWritesEnabled: true,
  })));
  assert.equal($('.decision').text(), 'Saved for later');
  const link = $('a').filter((_, node) => $(node).attr('href') === approvalHref);
  assert.match(link.text(), /Add to Google Calendar/);
  assert.equal(link.closest('details').length, 0);
  assert.match($('.card-actions').text(), /Saving for later is separate from calendar approval/);
  assert.equal($('form').length, 0);
});

test('post-save feedback keeps the saved item title and identity for its separate approval', () => {
  const $ = load(renderToStaticMarkup(createElement(SavedForLaterNotice, {
    row: { ...row, title: 'Saved <original> event' }, calendarWritesEnabled: true,
  })));
  assert.match($('[role="status"]').text(), /Saved for later\. Saved <original> event/);
  assert.equal($('a').attr('href'), approvalHref);
  assert.equal($('original').length, 0);
  assert.equal($('button,form,input').length, 0);
  assert.match($('[role="status"]').text(), /Review and approve this one event/);
});

test('saved guidance routes to individual events or recorded history without claiming a calendar result', () => {
  const discover = load(renderToStaticMarkup(createElement(SavedCalendarGuidance, { count: 15, savedView: false })));
  assert.match(discover('aside').text(), /15 saved for later/);
  assert.equal(discover('a').attr('href'), '/inbox?decision=save');
  const saved = load(renderToStaticMarkup(createElement(SavedCalendarGuidance, { count: 15, savedView: true })));
  assert.match(saved('aside').text(), /review and approve that one occurrence/);
  assert.equal(saved('a').attr('href'), '/calendar');
  assert.doesNotMatch(saved('aside').text(), /all added|nothing added|no calendar approvals/i);
  assert.equal(saved('button,form,input').length, 0);
});
