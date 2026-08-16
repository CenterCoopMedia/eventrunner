'use strict';

/**
 * Event lifecycle clock (spec §2.5).
 *
 * Replaces the reference implementation's hardcoded end-date boolean with a
 * pure, total function of (config, now). Two phases are editorial rather
 * than chronological — `announcedAt` and `archivedAt` are explicit admin-set
 * timestamps because dates alone cannot express "seeded but not public" or
 * "we are done with this site".
 *
 * All config timestamps (announcedAt, archivedAt, registration.opensAt /
 * closesAt, day boundaries) are naive event-local ISO strings. They are
 * compared lexicographically against {@link nowInZone} output with both
 * sides truncated to "YYYY-MM-DDTHH:MM", so mixed second/no-second
 * precision cannot skew a boundary.
 *
 * Totality: any malformed or missing field degrades safely — a malformed
 * timestamp is treated as null, unparseable days[] as empty, and a missing
 * or invalid timezone yields 'draft' (a broken config is never public by
 * accident). Nothing here throws.
 */

const { nowInZone } = require('../time.cjs');

// Full naive ISO datetime, minute precision or better.
const ISO_MINUTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/**
 * Truncate a naive ISO datetime string to "YYYY-MM-DDTHH:MM", or return
 * null when the value is not a full ISO datetime (date-only and malformed
 * values are treated as absent, never lex-compared).
 *
 * @param {*} value
 * @returns {string | null}
 */
function toMinuteIso(value) {
  if (typeof value !== 'string') return null;
  if (!ISO_MINUTE_RE.test(value)) return null;
  return value.slice(0, 16);
}

/**
 * Validated day list sorted chronologically (by date, then startTime) — or
 * [] when days is missing or any entry is malformed. Sorting here means the
 * in_progress/ended boundaries never depend on the config author keeping
 * days[] in date order (validateEventConfig rejects out-of-order days, but
 * this function must not assume the config was validated). Treating a
 * partially-malformed list as empty (rather than filtering) means a bad
 * first or last day can never move the in_progress/ended boundary; the
 * event just sits in a registration phase.
 *
 * @param {object} eventConfig
 * @returns {Array<{date: string, startTime: string, endTime: string}>}
 */
function validDays(eventConfig) {
  const days = eventConfig && eventConfig.days;
  if (!Array.isArray(days) || days.length === 0) return [];
  for (const d of days) {
    if (!d || typeof d !== 'object') return [];
    if (typeof d.date !== 'string' || !DATE_RE.test(d.date)) return [];
    if (typeof d.startTime !== 'string' || !HHMM_RE.test(d.startTime)) return [];
    if (typeof d.endTime !== 'string' || !HHMM_RE.test(d.endTime)) return [];
  }
  return days
    .slice()
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

/**
 * Compute the event's lifecycle phase from config and an instant.
 *
 * Implements the spec §2.5 evaluation table verbatim, first match wins:
 * archived, draft, ended, in_progress, registration_open,
 * registration_closed, announced (fallback).
 *
 * Null semantics: announcedAt null ⇒ draft; archivedAt null ⇒ never
 * archived; registration.opensAt null ⇒ open from announcement;
 * closesAt null ⇒ never closes on a clock; empty (or unparseable) days[]
 * ⇒ never ended / in_progress.
 *
 * @param {object} eventConfig - config/event shape (§2.2)
 * @param {Date} [now]
 * @returns {'draft'|'announced'|'registration_open'|'registration_closed'|'in_progress'|'ended'|'archived'}
 */
function getEventPhase(eventConfig, now = new Date()) {
  if (!eventConfig || typeof eventConfig !== 'object') return 'draft';

  let nowLocal = null;
  if (typeof eventConfig.timezone === 'string' && eventConfig.timezone) {
    try {
      nowLocal = toMinuteIso(nowInZone(eventConfig.timezone, now));
    } catch {
      nowLocal = null;
    }
  }
  // No usable clock ⇒ no boundary is decidable; fail closed into draft.
  if (!nowLocal) return 'draft';

  const archivedAt = toMinuteIso(eventConfig.archivedAt);
  if (archivedAt !== null && nowLocal >= archivedAt) return 'archived';

  const announcedAt = toMinuteIso(eventConfig.announcedAt);
  if (announcedAt === null || nowLocal < announcedAt) return 'draft';

  const days = validDays(eventConfig);
  if (days.length > 0) {
    const first = days[0];
    const last = days[days.length - 1];
    const eventStart = `${first.date}T${first.startTime}`;
    const eventEnd = `${last.date}T${last.endTime}`;
    if (nowLocal > eventEnd) return 'ended';
    if (nowLocal >= eventStart) return 'in_progress';
  }

  const registration =
    eventConfig.registration && typeof eventConfig.registration === 'object'
      ? eventConfig.registration
      : {};
  const opensAt = toMinuteIso(registration.opensAt);
  const closesAt = toMinuteIso(registration.closesAt);

  if ((opensAt === null || nowLocal >= opensAt) && (closesAt === null || nowLocal < closesAt)) {
    return 'registration_open';
  }
  if (closesAt !== null && nowLocal >= closesAt) return 'registration_closed';

  return 'announced';
}

module.exports = { getEventPhase };
