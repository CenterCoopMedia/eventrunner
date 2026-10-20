// A date and a time on the event's clock, converted to and from the stored
// RFC3339 instant (issue #476). Staff type an ordinary date and time; the
// event's IANA zone (config/event.timezone) supplies the offset for that
// date, so nobody composes "2027-02-01T04:59:59.000Z" by hand.
//
// A daylight-saving change makes two kinds of local time that a plain
// offset lookup gets wrong. A time inside the spring-forward gap does not
// exist; a time inside the fall-back overlap happens twice. Neither is
// shifted silently here: resolveEventDateTime reports a gap as a gap and an
// overlap as two candidates, and the caller asks the person to choose.
//
// The conversion itself lives in shared/eventDateTime, so the functions read
// a local time with the same rules (issue #518). This file re-exports it and
// adds the words the admin shows.
//
// Intl alone computes every offset, so no zone database ships with the
// bundle. Nothing here knows any event's dates or zone.

import {
  isKnownTimeZone,
  partsIn,
  readWall,
  resolveEventDateTime,
  splitEventDateTime,
  wallParts,
  zoneOffsetMinutes,
} from 'shared/eventDateTime';

export { isKnownTimeZone, resolveEventDateTime, splitEventDateTime, zoneOffsetMinutes };

const DISPLAY_LOCALE = 'en-US';

/**
 * "UTC−05:00", "UTC+05:30", "UTC+00:00". The minus is U+2212, which a
 * screen reader says as "minus".
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatUtcOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/**
 * The stored form of an instant: RFC3339 in UTC with milliseconds, which is
 * the form the server already writes ("2027-02-01T04:59:59.000Z").
 *
 * @param {Date} instant
 * @returns {string}
 */
export function toStoredInstant(instant) {
  return instant.toISOString();
}

function zoneName(instant, timeZone, style) {
  try {
    return partsIn(timeZone, instant, { timeZoneName: style }).timeZoneName ?? null;
  } catch {
    return null;
  }
}

/**
 * The zone in plain words, for the line under the control: "Eastern Time
 * (America/New_York)". Falls back to the IANA name alone.
 *
 * @param {string} timeZone
 * @param {Date} [instant]
 * @returns {string}
 */
export function describeTimeZone(timeZone, instant = new Date()) {
  const generic = zoneName(instant, timeZone, 'longGeneric');
  return generic && generic !== timeZone ? `${generic} (${timeZone})` : timeZone;
}

/**
 * The clock time alone, with seconds only when they are not zero:
 * "11:59 PM", "11:59:59 PM".
 *
 * @param {Date} instant
 * @param {string} timeZone
 * @returns {string}
 */
export function formatEventClock(instant, timeZone) {
  const withSeconds = wallParts(instant, timeZone).second !== '00';
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone, hour: 'numeric', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}),
  }).format(instant);
}

/**
 * One instant in words on the event's clock, with the zone and the offset
 * in force on THAT date: "Sunday, January 31, 2027 at 11:59:59 PM Eastern
 * Standard Time (UTC−05:00)".
 *
 * @param {Date} instant
 * @param {string} timeZone
 * @returns {string}
 */
export function describeEventDateTime(instant, timeZone) {
  const day = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(instant);
  const zone = zoneName(instant, timeZone, 'long');
  const offset = formatUtcOffset(zoneOffsetMinutes(instant, timeZone));
  return `${day} at ${formatEventClock(instant, timeZone)} ${zone ? `${zone} (${offset})` : offset}`;
}

/** "March 14, 2027" for a 'YYYY-MM-DD' date, read as a calendar date. */
export function formatCalendarDate(date) {
  const wall = readWall(date, '12:00');
  if (wall === null) return date;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(wall));
}

/** "2:30 AM" for an 'HH:MM' time, read as a wall clock. */
export function formatWallClock(time) {
  const wall = readWall('2000-01-01', time);
  if (wall === null) return time;
  const seconds = new Date(wall).getUTCSeconds() !== 0;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  }).format(new Date(wall));
}

/** "one hour", "30 minutes": the size of a clock change, in words. */
export function formatShift(minutes) {
  const abs = Math.abs(minutes);
  if (abs === 60) return 'one hour';
  if (abs % 60 === 0) return `${abs / 60} hours`;
  if (abs < 60) return `${abs} minutes`;
  return `${Math.floor(abs / 60)} hours ${abs % 60} minutes`;
}
