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
 * instant it names in an IANA timezone. Returns null on any malformed input
 * or unknown zone — callers render a "to be announced" state instead.
 *
 * Two-pass offset search so wall clocks on either side of a DST transition
 * resolve with the offset actually in force at that moment.
 */
export function zonedDateTime(dateStr, timeStr, timeZone) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null;
  if (typeof timeStr !== 'string' || !TIME_24H_RE.test(timeStr)) return null;
  if (typeof timeZone !== 'string' || !timeZone) return null;

  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const wallMs = Date.UTC(y, mo - 1, d, h, mi);

  try {
    // offset(t) = wallClockAsUtcMs(t) − t; find utc with utc + offset(utc) = wall.
    const guess = wallMs - (wallClockAsUtcMs(new Date(wallMs), timeZone) - wallMs);
    const utcMs = wallMs - (wallClockAsUtcMs(new Date(guess), timeZone) - guess);
    return new Date(utcMs);
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
  const day = getDay(eventConfig, session?.dayId);
  if (!day || typeof timeZone !== 'string') return null;

  const start = zonedDateTime(day.date, session.startTime, timeZone);
  if (!start) return null;
  const end = zonedDateTime(day.date, session.endTime, timeZone);

  const s = clockParts(start, timeZone);
  const e = end ? clockParts(end, timeZone) : null;
  const samePeriod = e !== null && s.period === e.period;

  return {
    startIso: `${day.date}T${session.startTime}`,
    startLabel: samePeriod ? s.clock : `${s.clock} ${s.period}`.trim(),
    endIso: end ? `${day.date}T${session.endTime}` : null,
    endLabel: e ? `${e.clock} ${e.period}`.trim() : null,
    zone: zoneLabel(timeZone, start),
  };
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
