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
// Intl alone computes every offset, so no zone database ships with the
// bundle. Nothing here knows any event's dates or zone.

const DISPLAY_LOCALE = 'en-US';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function partsIn(timeZone, instant, options) {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, ...options })
    .formatToParts(instant)
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
}

const WALL_OPTIONS = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
};

function wallParts(instant, timeZone) {
  const p = partsIn(timeZone, instant, WALL_OPTIONS);
  // Some ICU builds still print midnight as "24".
  return { ...p, hour: p.hour === '24' ? '00' : p.hour };
}

/**
 * Whether Intl knows this IANA zone.
 *
 * @param {unknown} timeZone
 * @returns {boolean}
 */
export function isKnownTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's offset from UTC at one instant, in minutes (east is positive).
 *
 * @param {Date} instant
 * @param {string} timeZone
 * @returns {number}
 */
export function zoneOffsetMinutes(instant, timeZone) {
  const p = wallParts(instant, timeZone);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wall - whole) / MINUTE_MS);
}

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
 * A stored instant as the date and time inputs show it on the event's clock:
 * `{ date: 'YYYY-MM-DD', time: 'HH:MM' }`, with seconds (`'HH:MM:SS'`) only
 * when the stored instant carries them. Null for a blank or unreadable value.
 *
 * @param {unknown} value an RFC3339 string
 * @param {string} timeZone
 * @returns {{ date: string, time: string }|null}
 */
export function splitEventDateTime(value, timeZone) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !isKnownTimeZone(timeZone)) return null;
  const p = wallParts(new Date(ms), timeZone);
  const seconds = p.second !== '00' ? `:${p.second}` : '';
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}${seconds}` };
}

function readWall(date, time) {
  const d = typeof date === 'string' ? date.match(DATE_RE) : null;
  const t = typeof time === 'string' ? time.match(TIME_RE) : null;
  if (!d || !t) return null;
  const [y, mo, day] = [d[1], d[2], d[3]].map(Number);
  const wall = Date.UTC(y, mo - 1, day, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
  const check = new Date(wall);
  // Date.UTC rolls 2027-02-30 into March. A date that rolls is not a date.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) return null;
  return wall;
}

/**
 * Resolve a date and time on the event's clock.
 *
 * - `{ status: 'ok', instant, offset }`: one real instant.
 * - `{ status: 'gap', offsetBefore, offsetAfter }`: the clocks skip this
 *   time (spring forward). There is no instant to save.
 * - `{ status: 'overlap', candidates: [{ instant, offset }, { instant, offset }] }`:
 *   the clocks pass this time twice (fall back), earlier instant first.
 * - `{ status: 'invalid' }`: a malformed date or time, or an unknown zone.
 *
 * Offsets are minutes east of UTC.
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} time 'HH:MM' or 'HH:MM:SS'
 * @param {string} timeZone IANA zone
 */
export function resolveEventDateTime(date, time, timeZone) {
  const wall = readWall(date, time);
  if (wall === null || !isKnownTimeZone(timeZone)) return { status: 'invalid' };
  // Every offset in force near this wall clock. Two days either side covers
  // any single transition; a zone never changes twice in four days.
  const offsets = [...new Set([-2 * DAY_MS, 0, 2 * DAY_MS]
    .map((shift) => zoneOffsetMinutes(new Date(wall + shift), timeZone)))];
  const candidates = offsets
    .map((offset) => ({ instant: new Date(wall - offset * MINUTE_MS), offset }))
    .filter(({ instant, offset }) => zoneOffsetMinutes(instant, timeZone) === offset)
    .sort((a, b) => a.instant - b.instant);
  if (candidates.length === 1) return { status: 'ok', ...candidates[0] };
  if (candidates.length > 1) return { status: 'overlap', candidates: candidates.slice(0, 2) };
  const offsetBefore = zoneOffsetMinutes(new Date(wall - 2 * DAY_MS), timeZone);
  const offsetAfter = zoneOffsetMinutes(new Date(wall + 2 * DAY_MS), timeZone);
  return { status: 'gap', offsetBefore, offsetAfter };
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
