'use strict';

/**
 * The reminder planner (issue #518, ADR 0006): which scheduled reminder is
 * due now, worked out from the schedule's settings and the clock alone.
 *
 * Nothing here reads or writes a store. The scheduler calls planReminders
 * on every run, sends what `due` names through the send path that already
 * exists, and records only what it did. Nothing waits in Firestore for a
 * later run, so this is not a queue (CONTRIBUTING, "There is exactly one
 * queue").
 *
 * OFFSETS ARE CALENDAR DAYS. An offset of N fires on the anchor's local
 * date minus N days, at the staff-set local send time. Across a daylight
 * saving change that is not N × 24 hours, and it should not be: "a week
 * before, at 10:00" means 10:00 on the clock people read.
 *
 * A LOCAL TIME THAT IS NOT ONE INSTANT. shared/eventDateTime reports a
 * spring-forward gap and a fall-back overlap. The admin asks a person; a
 * schedule cannot, so the rule here is fixed: a time in a gap fires at the
 * first minute after the gap, and a time in an overlap fires at the earlier
 * of its two instants.
 *
 * WINDOWS. Offsets are sorted from the largest. Each offset's window runs
 * from its fire instant until the next offset fires, and the last window
 * runs until the anchor. A run that missed the fire instant still sends
 * inside the same window (catch-up). A window that has closed is dropped:
 * a later offset supersedes it, and nobody gets the 14-day reminder 3 days
 * before. Each window has a stable key, `{anchor local date}-{N}d`, for the
 * ledger.
 *
 * QUIET HOURS. Nothing is due from 20:00 to 08:00 on the event's clock. A
 * window that opens in quiet hours opens at the next 08:00.
 */

const {
  isKnownTimeZone,
  readWall,
  resolveEventDateTime,
  splitEventDateTime,
  zoneOffsetMinutes,
} = require('./eventDateTime.cjs');

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SEND_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Longest offset a schedule may name, in days. */
const MAX_OFFSET_DAYS = 365;
/** Event-local hours in which nothing is due: from `start` until `end`. */
const QUIET_HOURS = Object.freeze({ start: '20:00', end: '08:00' });
/** Default offsets, in days before the anchor (owner decision, #518). */
const DEFAULT_OFFSETS = Object.freeze({
  speakers: Object.freeze([14, 7, 2]),
  attendees: Object.freeze([7, 1]),
});

/** 'YYYY-MM-DD' plus `days` calendar days (negative goes back). */
function addCalendarDays(date, days) {
  const wall = readWall(date, '00:00');
  if (wall === null) return null;
  return new Date(wall + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One instant for a local date and time, by the schedule's rule: the first
 * minute after a gap, the earlier instant of an overlap. Null when the date,
 * time or zone is not valid.
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} time 'HH:MM'
 * @param {string} timeZone
 * @returns {Date|null}
 */
function resolveLocalInstant(date, time, timeZone) {
  const result = resolveEventDateTime(date, time, timeZone);
  if (result.status === 'ok') return result.instant;
  if (result.status === 'overlap') return result.candidates[0].instant;
  if (result.status !== 'gap') return null;
  // Read with the later offset the wall time lands before the change; read
  // with the earlier one it lands after. The change is the first whole
  // minute between them that already has the later offset.
  const wall = readWall(date, time);
  let lo = (wall - result.offsetAfter * MINUTE_MS) / MINUTE_MS;
  let hi = (wall - result.offsetBefore * MINUTE_MS) / MINUTE_MS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zoneOffsetMinutes(new Date(mid * MINUTE_MS), timeZone) === result.offsetAfter) hi = mid;
    else lo = mid;
  }
  return new Date(hi * MINUTE_MS);
}

/** Whether an instant falls in quiet hours on the event's clock. */
function isQuietAt(instant, timeZone) {
  const { time } = splitEventDateTime(instant.toISOString(), timeZone);
  const hhmm = time.slice(0, 5);
  return hhmm >= QUIET_HOURS.start || hhmm < QUIET_HOURS.end;
}

/** The first instant at or after `instant` that is outside quiet hours. */
function quietHoursEnd(instant, timeZone) {
  if (!isQuietAt(instant, timeZone)) return instant;
  const { date, time } = splitEventDateTime(instant.toISOString(), timeZone);
  const day = time.slice(0, 5) >= QUIET_HOURS.start ? addCalendarDays(date, 1) : date;
  return resolveLocalInstant(day, QUIET_HOURS.end, timeZone);
}

function toInstant(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  return null;
}

/**
 * The anchor as an instant and a local date. It is an instant (a Date, an
 * RFC3339 string or milliseconds), or `{ date, time }` on the event's clock.
 */
function readAnchor(anchor, timeZone) {
  if (anchor && typeof anchor === 'object' && !(anchor instanceof Date)) {
    const instant = resolveLocalInstant(anchor.date, anchor.time, timeZone);
    return instant ? { instant, date: anchor.date } : null;
  }
  const instant = toInstant(anchor);
  if (!instant) return null;
  return { instant, date: splitEventDateTime(instant.toISOString(), timeZone).date };
}

/**
 * Offsets as whole days from 1 to MAX_OFFSET_DAYS, largest first, without
 * repeats. Null when any entry is not one.
 */
function readOffsets(offsetsDays) {
  if (!Array.isArray(offsetsDays) || offsetsDays.length === 0) return null;
  if (!offsetsDays.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_OFFSET_DAYS)) return null;
  return [...new Set(offsetsDays)].sort((a, b) => b - a);
}

/** The ledger key of one window: `2026-11-20-7d`. */
function windowKeyFor(anchorDate, offsetDays) {
  return `${anchorDate}-${offsetDays}d`;
}

/**
 * Plan a reminder schedule at one moment.
 *
 * @param {{ anchor: Date|string|number|{ date: string, time: string },
 *   offsetsDays: number[], sendTime: string, timeZone: string,
 *   now: Date|number }} input
 * @returns {{ ok: false, error: string } | {
 *   ok: true,
 *   anchor: { instant: Date, date: string },
 *   quietNow: boolean,
 *   windows: { offsetDays: number, windowKey: string, fireAt: Date, opensAt: Date,
 *     closesAt: Date, state: 'upcoming'|'open'|'closed'|'empty' }[],
 *   due: object|null,
 *   next: { offsetDays: number, windowKey: string, at: Date }|null,
 * }}
 *
 * `fireAt` is the offset's local send time. `opensAt` is when the window
 * opens, after quiet hours. `due` is the open window, when it is not quiet
 * hours now. `next` is the next moment a window can send, not counting
 * `due`; null when no window is left.
 */
function planReminders({ anchor, offsetsDays, sendTime, timeZone, now } = {}) {
  if (!isKnownTimeZone(timeZone)) return { ok: false, error: 'timeZone: Must be a known IANA time zone.' };
  if (typeof sendTime !== 'string' || !SEND_TIME_RE.test(sendTime)) {
    return { ok: false, error: 'sendTime: Must be a time as HH:MM.' };
  }
  const offsets = readOffsets(offsetsDays);
  if (!offsets) return { ok: false, error: `offsetsDays: Each entry must be a whole number of days from 1 to ${MAX_OFFSET_DAYS}.` };
  const at = toInstant(now);
  if (!at) return { ok: false, error: 'now: Must be an instant.' };
  const start = readAnchor(anchor, timeZone);
  if (!start) return { ok: false, error: 'anchor: Must be an instant, or a date and time on the event clock.' };

  const fires = offsets.map((offsetDays) => ({
    offsetDays,
    fireAt: resolveLocalInstant(addCalendarDays(start.date, -offsetDays), sendTime, timeZone),
  }));
  const nowMs = at.getTime();
  const windows = fires.map(({ offsetDays, fireAt }, index) => {
    const closesAt = index + 1 < fires.length ? fires[index + 1].fireAt : start.instant;
    const opensAt = quietHoursEnd(fireAt, timeZone);
    let state = 'upcoming';
    if (opensAt >= closesAt) state = 'empty';
    else if (nowMs >= closesAt.getTime()) state = 'closed';
    else if (nowMs >= opensAt.getTime()) state = 'open';
    return { offsetDays, windowKey: windowKeyFor(start.date, offsetDays), fireAt, opensAt, closesAt, state };
  });

  const quietNow = isQuietAt(at, timeZone);
  const open = windows.find((w) => w.state === 'open') ?? null;
  const due = open && !quietNow ? open : null;
  let next = null;
  if (open && quietNow) {
    const resume = quietHoursEnd(at, timeZone);
    if (resume < open.closesAt) next = { offsetDays: open.offsetDays, windowKey: open.windowKey, at: resume };
  }
  if (!next) {
    const upcoming = windows.find((w) => w.state === 'upcoming');
    if (upcoming) next = { offsetDays: upcoming.offsetDays, windowKey: upcoming.windowKey, at: upcoming.opensAt };
  }
  return { ok: true, anchor: start, quietNow, windows, due, next };
}

module.exports = {
  DEFAULT_OFFSETS,
  MAX_OFFSET_DAYS,
  QUIET_HOURS,
  addCalendarDays,
  isQuietAt,
  planReminders,
  quietHoursEnd,
  resolveLocalInstant,
  windowKeyFor,
};
