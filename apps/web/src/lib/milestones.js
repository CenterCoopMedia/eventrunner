// The event's milestones (config/event.milestones, issue #180) in the one
// order every reader shows them: by date, then by name for a tie. The admin
// overview and the public key dates on the live updates card (issue #200)
// both read this, so the two lists cannot disagree.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` date as a UTC midnight timestamp, or null when the string
 * does not have that shape.
 *
 * @param {unknown} date
 * @returns {number|null}
 */
export function utcDay(date) {
  const match = DATE_RE.exec(typeof date === 'string' ? date : '');
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * The milestones worth listing, sorted by date and then by name. An entry
 * with no name or no readable date is left out rather than drawn broken.
 *
 * @param {unknown} milestones config/event.milestones
 * @returns {Array<{ label: string, date: string }>}
 */
export function sortMilestones(milestones) {
  if (!Array.isArray(milestones)) return [];
  return milestones
    .filter((entry) => entry && typeof entry.label === 'string' && entry.label.trim() && utcDay(entry.date) !== null)
    .map((entry) => ({ label: entry.label.trim(), date: entry.date }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
