'use strict';

/**
 * The checks on config/event.announcedAt and archivedAt (ADR 0001 §2.2,
 * audit 07 #1 and #6). getEventPhase (shared/config lifecycle) reads a
 * malformed stamp as null, so a bad announce date would put a public site
 * back in draft with no sign.
 *
 * They live here, at the one endpoint that saves the stamps, and not in the
 * shared validateEventConfig: the public site loads that module on first
 * paint, and these checks put its bundle over the budget.
 */

const { ISO_DATETIME_RE } = require('shared/time');

/** True for "YYYY-MM-DDTHH:MM(:SS)" with no zone, a real date and a real clock time. */
function isNaiveLocalDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATETIME_RE.test(value)) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Each stamp is null, absent, or a naive event-local datetime. An archive
 * date needs an announce date and is not before it, compared at minute
 * precision as the lifecycle clock compares them.
 *
 * @param {object} event the config/event document to be stored
 * @returns {string[]} one message for each problem, named by field
 */
function lifecycleStampErrors(event) {
  if (!event || typeof event !== 'object') return [];
  const errors = [];
  const shape = 'must be null or a naive ISO datetime "YYYY-MM-DDTHH:MM(:SS)" with a real date and time';
  for (const key of ['announcedAt', 'archivedAt']) {
    if (event[key] != null && !isNaiveLocalDateTime(event[key])) errors.push(`${key}: ${shape}`);
  }
  if (errors.length > 0 || event.archivedAt == null) return errors;
  if (event.announcedAt == null) {
    errors.push('archivedAt: needs an announce date');
  } else if (event.archivedAt.slice(0, 16) < event.announcedAt.slice(0, 16)) {
    errors.push('archivedAt: must not be before announcedAt');
  }
  return errors;
}

module.exports = { lifecycleStampErrors };
