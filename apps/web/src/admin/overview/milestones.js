// The overview's milestones (issue #180): config/event.milestones in date
// order, and how far each one is from today on the event's own calendar.
//
// "Today" is the calendar date in the EVENT's timezone (shared/time
// nowInZone), not the reader's: an organizer checking the overview from
// another continent sees the same count the venue does. The distance is a
// count of calendar dates, worked out on UTC dates, so a daylight saving
// change between now and the milestone cannot make a day 23 or 25 hours
// long and round the count the wrong way.
import { nowInZone } from 'shared/time';
import { sortMilestones, utcDay } from '../../lib/milestones.js';

const DAY_MS = 86_400_000;

// The ordering lives in lib/milestones.js, which the public key dates read
// too (issue #200); it is re-exported here so the overview keeps one import.
export { sortMilestones };

/**
 * Whole calendar days from today, in the event's timezone, to `date`: 0 on
 * the day itself, negative once it has passed, null for a date that cannot
 * be read. A timezone Intl does not know falls back to UTC rather than
 * throwing.
 *
 * @param {string} date YYYY-MM-DD
 * @param {string} timezone the event's IANA timezone
 * @param {Date} [now]
 * @returns {number|null}
 */
export function daysUntil(date, timezone, now = new Date()) {
  const target = utcDay(date);
  if (target === null) return null;
  let today;
  try {
    today = nowInZone(timezone, now).slice(0, 10);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return Math.round((target - utcDay(today)) / DAY_MS);
}

/**
 * The days as words: "Today", "In 1 day", "In 12 days", "1 day ago".
 *
 * @param {number|null} days from daysUntil
 * @returns {string}
 */
export function daysPhrase(days) {
  if (days === null || !Number.isFinite(days)) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'In 1 day';
  if (days > 1) return `In ${days} days`;
  if (days === -1) return '1 day ago';
  return `${-days} days ago`;
}
