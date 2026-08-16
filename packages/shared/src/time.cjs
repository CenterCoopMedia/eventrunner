'use strict';

/**
 * Event-timezone wall-clock helpers (spec §9, "Session time helpers" row).
 *
 * Replaces the intentional ESM/CJS duplicate pair from the reference
 * implementation (frontend calendar utils + backend helpers) with one
 * config-driven implementation. Every function takes the event config as
 * input; nothing here knows any event's dates or timezone.
 *
 * The comparison model is unchanged from the reference: naive wall-clock
 * ISO strings in the event's timezone, compared lexicographically. That is
 * only valid when both sides carry the full "YYYY-MM-DDTHH:MM" shape, which
 * is why {@link isSessionPast} fails closed on anything less — a date-only
 * string sorts before every same-day datetime and would release an embargo
 * for the whole day.
 */

// Clock shapes parseSessionDatetime accepts without failing: 12-hour clock,
// hour 1-12, optional minutes 00-59, AM/PM. Out-of-range values ("12:99 AM",
// "25:00 PM") are rejected rather than best-effort coerced.
const CLOCK_TIME_RE = /^(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*(AM|PM)$/i;
// Strict full-ISO datetime: date + T + HH:MM with optional :SS, end-anchored
// so trailing garbage fails closed, with field ranges enforced (month 01-12,
// day 01-31, hour 00-23, minute/second 00-59). Date-only values are
// deliberately rejected (fail closed) — see module doc.
const ISO_DATETIME_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/**
 * Current wall-clock in an IANA timezone as a naive ISO string
 * ("YYYY-MM-DDTHH:MM:SS"), suitable for lexicographic moment compare
 * against other strings of the same shape in the same zone.
 *
 * @param {string} timezone - IANA zone, e.g. "America/New_York"
 * @param {Date} [now]
 * @returns {string}
 */
function nowInZone(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  // Some ICU builds render midnight as "24" in hour12:false mode.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

/**
 * Look up a configured event day by its stable id.
 *
 * @param {{ days?: Array<{id: string, date: string}> }} eventConfig
 * @param {string} dayId
 * @returns {{id: string, date: string, startTime?: string, endTime?: string} | null}
 */
function getDay(eventConfig, dayId) {
  if (!eventConfig || !Array.isArray(eventConfig.days)) return null;
  return eventConfig.days.find((d) => d && d.id === dayId) || null;
}

/**
 * Resolve a session's day + time into a naive event-local ISO datetime
 * string, or null when the inputs cannot be resolved unambiguously.
 *
 * Unlike the reference implementation this never silently defaults to a
 * fallback day or 9 AM — callers that can tolerate missing data handle the
 * null; callers that gate security on the result fail closed on it.
 *
 * @param {{ days?: Array<{id: string, date: string}> }} eventConfig
 * @param {string} dayId - id of an entry in eventConfig.days
 * @param {string} timeStr - "3:15 PM" / "4 PM" clock time, or a full ISO
 *   datetime which is passed through
 * @returns {string | null}
 */
function parseSessionDatetime(eventConfig, dayId, timeStr) {
  if (typeof timeStr !== 'string' || !timeStr) return null;
  if (ISO_DATETIME_RE.test(timeStr)) return timeStr;

  const day = getDay(eventConfig, dayId);
  if (!day || typeof day.date !== 'string') return null;

  if (!CLOCK_TIME_RE.test(timeStr)) return null;
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;

  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toUpperCase();
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;

  return `${day.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * True when the session's end time is strictly before the supplied instant,
 * evaluated on the event's wall clock. Fails closed (returns false) when the
 * session lacks an explicit endTime, names an unconfigured dayId (even when
 * the endTime is a full ISO datetime that would not need the day for
 * resolution — an unconfigured day is a data problem, not a release signal),
 * or carries an endTime shape outside the accepted grammar.
 *
 * The comparison runs at minute precision: both sides are truncated to
 * "YYYY-MM-DDTHH:MM" (matching config/lifecycle.cjs), so a seconds-bearing
 * clock cannot read a minute-precision endTime as past during its final
 * minute. A session ending 17:00 is past starting 17:01.
 *
 * This gate fronts the materials embargo, so every fallback path here is a
 * security regression — the reference implementation's strict-ISO discipline
 * is preserved in behavior.
 *
 * @param {{ timezone?: string, days?: Array<object> }} eventConfig
 * @param {{ dayId?: string, endTime?: string }} session
 * @param {Date} [now]
 * @returns {boolean}
 */
function isSessionPast(eventConfig, session, now = new Date()) {
  if (!eventConfig || typeof eventConfig.timezone !== 'string' || !session) return false;
  if (typeof session.endTime !== 'string' || !session.endTime) return false;
  const isIso = ISO_DATETIME_RE.test(session.endTime);
  if (!isIso && !CLOCK_TIME_RE.test(session.endTime)) return false;
  if (!getDay(eventConfig, session.dayId)) return false;
  const endLocal = parseSessionDatetime(eventConfig, session.dayId, session.endTime);
  if (!endLocal) return false;
  // Minute-truncate both sides so mixed second/no-second precision cannot
  // skew the boundary (same discipline as config/lifecycle.cjs).
  return nowInZone(eventConfig.timezone, now).slice(0, 16) > endLocal.slice(0, 16);
}

/**
 * True when a configured day's endTime has passed on the event's wall clock.
 * Fails closed on an unknown dayId or a day missing date/endTime. Compared
 * at minute precision (like {@link isSessionPast}): a day ending 17:00 is
 * past starting 17:01.
 *
 * @param {{ timezone?: string, days?: Array<object> }} eventConfig
 * @param {string} dayId
 * @param {Date} [now]
 * @returns {boolean}
 */
function isDayPast(eventConfig, dayId, now = new Date()) {
  if (!eventConfig || typeof eventConfig.timezone !== 'string') return false;
  const day = getDay(eventConfig, dayId);
  if (!day || typeof day.date !== 'string' || typeof day.endTime !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !/^\d{2}:\d{2}$/.test(day.endTime)) return false;
  return nowInZone(eventConfig.timezone, now).slice(0, 16) > `${day.date}T${day.endTime}`;
}

module.exports = {
  nowInZone,
  getDay,
  parseSessionDatetime,
  isSessionPast,
  isDayPast,
  CLOCK_TIME_RE,
  ISO_DATETIME_RE,
};
