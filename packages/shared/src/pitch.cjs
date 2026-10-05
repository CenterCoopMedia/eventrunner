'use strict';

const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isValidCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** Return a canonical RFC3339 instant, or null. */
function readClosesAt(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(RFC3339_RE);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, , oh, om] = match;
  const parts = [y, mo, d, h, mi, s, oh ?? '0', om ?? '0'].map(Number);
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  if (!isValidCalendarDate(year, month, day)
      || hour > 23 || minute > 59 || second > 59
      || offsetHour > 23 || offsetMinute > 59) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

module.exports = { readClosesAt };
