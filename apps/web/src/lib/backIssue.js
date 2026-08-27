// The back issue (design brief §2.1, the device table).
//
// "An archival treatment for a past event or a past day. Reduce the palette
// to the archive tokens. Add the 'Back issue' folio. Remove live controls.
// NEVER HIDE THE CONTENT."
//
// This module answers one question — is this a back issue? — and answers it
// from the event's own clock. Two things make one:
//
//   a past day    the day's last minute is behind the reader. Yesterday's
//                 programme is still the programme; it is simply not
//                 happening again.
//   an archived   the operator set `config/event.archivedAt` and it has
//   event         passed. `getEventPhase` (shared/config) is the one place
//                 that decides that, and it is the same decision the server
//                 makes, so the site and the seam cannot disagree.
//
// Both are computed on the EVENT's wall clock, never the reader's: a
// visitor in another timezone must see the same programme as a visitor
// standing in the hall.
import { getEventPhase } from 'shared/config';
import { zonedDateTime } from './eventTime.js';

/** The last minute of a day, or null where the day cannot be resolved. */
function dayEnd(day, timeZone) {
  const stated =
    typeof day?.endTime === 'string' ? zonedDateTime(day?.date, day.endTime, timeZone) : null;
  // A day with no stated end runs to midnight. Ending it any earlier would
  // file a programme as an archive while people were still in the room.
  return stated ?? zonedDateTime(day?.date, '23:59', timeZone);
}

/**
 * Has this day finished?
 *
 * @param {object} day a config/event.days entry
 * @param {object} eventConfig
 * @param {Date} [now]
 * @returns {boolean}
 */
export function dayHasPassed(day, eventConfig, now = new Date()) {
  const end = dayEnd(day, eventConfig?.timezone);
  return end !== null && end.getTime() < now.getTime();
}

/**
 * Has the whole event been archived?
 *
 * @param {object} eventConfig
 * @param {Date} [now]
 * @returns {boolean}
 */
export function eventIsArchived(eventConfig, now = new Date()) {
  return getEventPhase(eventConfig, now) === 'archived';
}

/**
 * Is this day a back issue — because it has passed, or because the whole
 * event has been archived?
 *
 * @param {object} day
 * @param {object} eventConfig
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isBackIssue(day, eventConfig, now = new Date()) {
  return eventIsArchived(eventConfig, now) || dayHasPassed(day, eventConfig, now);
}
