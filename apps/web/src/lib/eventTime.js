// Event-timezone display helpers for schedule surfaces (issue #16).
//
// `shared/time` (packages/shared) owns the lifecycle clock: a 12-hour
// "3:15 PM" grammar plus naive-ISO lexicographic compares for embargo gates.
// Published cmsSchedule docs store 24-hour "HH:MM" wall-clock strings, which
// that grammar rejects by design — so display formatting lives here instead:
// resolve day date + wall clock to a real instant in the configured IANA
// zone, then let Intl render it back in that same zone. Nothing in this
// module knows any event's dates or timezone (spec §2.4 event-neutrality);
// `getDay` is reused from the shared workspace package.
import { getDay } from 'shared/time';

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const TIME_24H_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Deterministic display locale for v1 (matches the "9:30 AM" register used
// across the platform's emails); localization is a later, separate concern.
const DISPLAY_LOCALE = 'en-US';

function partsIn(timeZone, instant, options) {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, ...options })
    .formatToParts(instant)
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
}

// The UTC-ms value whose fields equal `instant`'s wall clock in `timeZone`.
function wallClockAsUtcMs(instant, timeZone) {
  const p = partsIn(timeZone, instant, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // Some ICU builds render midnight as "24" in hour12:false mode.
  const hour = p.hour === '24' ? '00' : p.hour;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
}

/**
 * Resolve an event-local wall clock ("YYYY-MM-DD" + 24h "HH:MM") to the Date
 * instant it names in an IANA timezone. Returns null on any malformed input,
 * unknown zone, or a wall clock that does not exist in that zone — callers
 * render a "to be announced" state instead.
 *
 * Two-pass offset search so wall clocks on either side of a DST transition
 * resolve with the offset actually in force at that moment. A wall clock
 * inside a "spring forward" gap (e.g. 2:30 AM on the transition day in
 * America/New_York, where the clock jumps from 2:00 to 3:00) has no real
 * instant to resolve to — the search still returns *some* instant, but
 * rendering it back in the zone yields a different wall clock than the one
 * requested. Detect that mismatch and fail soft rather than silently
 * returning a session at the wrong time.
 */
export function zonedDateTime(dateStr, timeStr, timeZone) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null;
  if (typeof timeStr !== 'string' || !TIME_24H_RE.test(timeStr)) return null;
  if (typeof timeZone !== 'string' || !timeZone) return null;

  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const wallMs = Date.UTC(y, mo - 1, d, h, mi);
  // Date.UTC normalizes out-of-range components instead of rejecting them
  // (e.g. 2026-02-30 silently becomes March 2) — check the round trip so an
  // impossible calendar date fails soft here rather than resolving to a
  // different day than the one requested.
  const normalized = new Date(wallMs);
  if (
    normalized.getUTCFullYear() !== y ||
    normalized.getUTCMonth() !== mo - 1 ||
    normalized.getUTCDate() !== d
  ) {
    return null;
  }

  try {
    // offset(t) = wallClockAsUtcMs(t) − t; find utc with utc + offset(utc) = wall.
    const guess = wallMs - (wallClockAsUtcMs(new Date(wallMs), timeZone) - wallMs);
    const utcMs = wallMs - (wallClockAsUtcMs(new Date(guess), timeZone) - guess);
    const resolved = new Date(utcMs);
    if (wallClockAsUtcMs(resolved, timeZone) !== wallMs) return null;
    return resolved;
  } catch {
    // Invalid IANA zone name in config — fail soft, never throw in render.
    return null;
  }
}

function clockParts(instant, timeZone) {
  const p = partsIn(timeZone, instant, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return { clock: `${p.hour}:${p.minute}`, period: p.dayPeriod ?? '' };
}

/** Short zone name ("EDT", or "GMT+5:30" where no abbreviation exists). */
export function zoneLabel(timeZone, instant = new Date()) {
  try {
    return (
      new Intl.DateTimeFormat(DISPLAY_LOCALE, {
        timeZone,
        timeZoneName: 'short',
      })
        .formatToParts(instant)
        .find((part) => part.type === 'timeZoneName')?.value ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Resolve a session's start/end to real Date instants on the event's wall
 * clock: `{ start, end, startDate, endDate }` (the last two are the
 * event-local "YYYY-MM-DD" the instant falls on — `endDate` rolls forward a
 * calendar day for a midnight-crossing session). `start`/`startDate` are
 * null when the day or start time cannot be resolved; `end`/`endDate` are
 * null when only the end is missing or malformed. This is the one place
 * that resolves a session's wall clock to instants — display formatting
 * (below) and calendar export (utils/calendar.js) both build on it, so a
 * DST or midnight-rollover fix here reaches both.
 */
export function resolveSessionInstants(eventConfig, session) {
  const timeZone = eventConfig?.timezone;
  const day = getDay(eventConfig, session?.dayId);
  if (!day || typeof timeZone !== 'string') {
    return { start: null, end: null, startDate: null, endDate: null };
  }

  const start = zonedDateTime(day.date, session.startTime, timeZone);
  if (!start) return { start: null, end: null, startDate: null, endDate: null };
  let end = zonedDateTime(day.date, session.endTime, timeZone);
  // A session ending after midnight ("23:30"–"00:15") resolves its wall
  // clock on the *next* calendar day — roll both the instant and the ISO
  // date forward one day so callers never see the session end before it
  // starts.
  let endDate = day.date;
  if (end && end <= start) {
    const rolled = zonedDateTime(rollDateForward(day.date), session.endTime, timeZone);
    if (rolled) {
      end = rolled;
      endDate = rollDateForward(day.date);
    }
  }
  return { start, end, startDate: day.date, endDate: end ? endDate : null };
}

/**
 * A session's time range on the event's wall clock, ready to render:
 * `{ startIso, startLabel, endIso, endLabel, zone }`. The shared AM/PM
 * period appears once, on the end ("9:30–10:00 AM"); ranges that cross
 * noon carry it on both sides ("11:30 AM–1:00 PM"). ISO strings are
 * event-local naive datetimes for <time dateTime>. Null when the session's
 * day or start time cannot be resolved; endIso/endLabel are null when only
 * the end is missing or malformed.
 */
export function formatSessionTimeRange(eventConfig, session) {
  const timeZone = eventConfig?.timezone;
  const { start, end, startDate, endDate } = resolveSessionInstants(eventConfig, session);
  if (!start) return null;

  const s = clockParts(start, timeZone);
  const e = end ? clockParts(end, timeZone) : null;
  const samePeriod = e !== null && s.period === e.period;

  return {
    startIso: `${startDate}T${session.startTime}`,
    startLabel: samePeriod ? s.clock : `${s.clock} ${s.period}`.trim(),
    endIso: end ? `${endDate}T${session.endTime}` : null,
    endLabel: e ? `${e.clock} ${e.period}`.trim() : null,
    zone: zoneLabel(timeZone, start),
  };
}

/**
 * A session's START on its own: `{ startIso, startLabel }`, with the AM/PM
 * always carried. Null where the session's day or start time cannot be
 * resolved.
 *
 * formatSessionTimeRange drops the period from the start of a range that
 * does not cross noon ("9:30–10:00 AM"), which is right for a range and
 * wrong for a time standing alone — a schedule-grid row header reading
 * "9:00" states half a time. Asking the same formatter for a range with no
 * end is what makes the period come back, so there is still one formatter
 * and one set of rules about how a time reads.
 *
 * @param {object} eventConfig
 * @param {object} session
 * @returns {{ startIso: string, startLabel: string }|null}
 */
export function formatSessionStart(eventConfig, session) {
  const range = formatSessionTimeRange(eventConfig, { ...session, endTime: null });
  return range ? { startIso: range.startIso, startLabel: range.startLabel } : null;
}

/** "YYYY-MM-DD" one calendar day later, UTC-safe (no local-timezone DST). */
function rollDateForward(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * A configured day's date as display copy ("Thursday, October 15"),
 * evaluated on the event's wall clock. Null when unresolvable.
 */
export function formatDayDate(day, timeZone) {
  const instant = zonedDateTime(day?.date, '12:00', timeZone);
  if (!instant) return null;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(instant);
}

/**
 * The event's own start instant — the earliest configured day's start time,
 * resolved in the event's timezone — or null when it cannot be resolved (no
 * timezone, or no valid days). This deliberately matches the lifecycle
 * clock's own `validDays` (packages/shared/src/config/lifecycle.cjs)
 * fail-CLOSED rule rather than filtering: ONE malformed day invalidates the
 * whole list, rather than being dropped from it. `getEventPhase` treats a
 * partially-malformed `days` the same way — a bad day can never move the
 * in_progress/ended boundary, so it must never move the countdown's target
 * either. A per-day filter here would let the countdown count down to a day
 * the lifecycle clock does not recognize as the event's start.
 *
 * @param {object} eventConfig
 * @returns {Date | null}
 */
export function resolveEventStart(eventConfig) {
  const timeZone = eventConfig?.timezone;
  if (typeof timeZone !== 'string' || !timeZone) return null;
  const days = eventConfig?.days;
  if (!Array.isArray(days) || days.length === 0) return null;
  for (const day of days) {
    if (!day || typeof day !== 'object') return null;
    if (typeof day.date !== 'string' || !DATE_RE.test(day.date)) return null;
    if (typeof day.startTime !== 'string' || !TIME_24H_RE.test(day.startTime)) return null;
  }
  const [first] = days
    .slice()
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  return zonedDateTime(first.date, first.startTime, timeZone);
}

/**
 * Split a duration in milliseconds into days/hours/minutes/seconds for a
 * countdown display. Negative input clamps to zero throughout rather than
 * counting down past the target — a caller ticking on a timer can render
 * one more frame after the target passes before it re-reads the event
 * phase and switches away from the countdown, and that frame must never
 * read as a negative figure.
 *
 * @param {number} msRemaining
 * @returns {{ days: number, hours: number, minutes: number, seconds: number }}
 */
export function countdownParts(msRemaining) {
  const clamped = Number.isFinite(msRemaining) ? Math.max(0, msRemaining) : 0;
  return {
    days: Math.floor(clamped / 86_400_000),
    hours: Math.floor(clamped / 3_600_000) % 24,
    minutes: Math.floor(clamped / 60_000) % 60,
    seconds: Math.floor(clamped / 1000) % 60,
  };
}

/**
 * The configured days as one dateline for the masthead nameplate (design
 * brief §2.1): "October 14–16, 2026" within a month, "October 30 – November
 * 1, 2026" across one, "December 31, 2026 – January 1, 2027" across a year.
 *
 * Runtime config/event can deliver a malformed or empty `days` array, so
 * every unresolvable date is dropped and an empty result returns null — the
 * nameplate simply renders without its dateline rather than blanking the
 * shell that wraps every route.
 *
 * The en dash is the range dash (interface guidelines: Typography); the
 * spaced form is used where either side already carries a space, which is
 * the ordinary typographic rule for a range of multi-word endpoints.
 */
export function formatEventDateRange(days, timeZone) {
  const instants = (Array.isArray(days) ? days : [])
    .map((day) => zonedDateTime(day?.date, '12:00', timeZone))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (instants.length === 0) return null;

  const first = instants[0];
  const last = instants[instants.length - 1];
  const parts = (instant, options) => partsIn(timeZone, instant, options);
  const startParts = parts(first, { year: 'numeric', month: 'long', day: 'numeric' });
  const endParts = parts(last, { year: 'numeric', month: 'long', day: 'numeric' });

  const startFull = `${startParts.month} ${startParts.day}, ${startParts.year}`;
  if (first.getTime() === last.getTime()) return startFull;
  if (startParts.year !== endParts.year) {
    return `${startFull} – ${endParts.month} ${endParts.day}, ${endParts.year}`;
  }
  if (startParts.month !== endParts.month) {
    return `${startParts.month} ${startParts.day} – ${endParts.month} ${endParts.day}, ${endParts.year}`;
  }
  return `${startParts.month} ${startParts.day}–${endParts.day}, ${endParts.year}`;
}
