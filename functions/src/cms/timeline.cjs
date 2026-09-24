'use strict';

/**
 * Timeline entry rules at the content-write seam (issue #194).
 *
 * A cmsTimeline document is one past edition of the event: its year, a
 * title, and an optional description. The home page's History section
 * lists them oldest first (apps/web/src/components/HistorySection.jsx).
 * They go through the generic content endpoints (content.cjs), which
 * check reserved key NAMES and never a TYPE, so these rules refuse a bad
 * value at the save, where the editor can put the message on the field it
 * names.
 *
 * THE RECORD IS CHECKED ON THE MERGED RESULT, the way the speaker, session
 * and organization seams check theirs: what matters is the entry that ends
 * up stored, not the half of it one request sent.
 *
 * THE FIELD SET IS CLOSED. The live document is public and ships in the
 * build-time snapshot, so no key outside TIMELINE_FIELDS may reach it. A
 * key the request itself sends is refused by name. A key that only the
 * stored draft or live document carries (the generic endpoint accepted any
 * key before this seam) is dropped from the merged result, so the next
 * save cleans the entry instead of locking it.
 *
 * Every field is plain text. Nothing here is markup, and the page renders
 * each value as text.
 *
 * Pure: no db, no clock. content.cjs calls this inside the write
 * transaction and throws the joined messages as a 400.
 */

const COLLECTION = 'cmsTimeline';

/**
 * Every key a timeline entry may store. `seeded` and `seededAt` are the
 * seed's own bookkeeping (scripts/lib/idempotency.cjs); content.cjs drops
 * both from every admin write before this check runs.
 */
const TIMELINE_FIELDS = Object.freeze(['year', 'title', 'description', 'seeded', 'seededAt']);

/**
 * The bounds each field keeps. The editor mirrors them
 * (apps/web/src/admin/timelineDoc.js), and a web test imports this object
 * to hold the two together.
 */
const TIMELINE_LIMITS = Object.freeze({
  yearMin: 1900,
  yearMax: 2100,
  titleMax: 120,
  descriptionMax: 600,
});

const MESSAGES = Object.freeze({
  year: `year: enter a year from ${TIMELINE_LIMITS.yearMin} to ${TIMELINE_LIMITS.yearMax} as four digits`,
  titleType: 'title: must be text',
  titleMissing: 'title: enter a title',
  titleShape: `title: use ${TIMELINE_LIMITS.titleMax} characters or fewer on one line`,
  descriptionType: 'description: must be text',
  descriptionLength: `description: use ${TIMELINE_LIMITS.descriptionMax} characters or fewer`,
  descriptionControl: 'description: use plain text; a line break is the only control character allowed',
});

// Unicode control characters: C0, DEL and C1, line breaks and tabs included.
const CONTROL_CHARACTER = /\p{Cc}/u;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

/**
 * Check and normalize one timeline entry.
 *
 * @param {object} fields the merged fields as they will be stored
 * @param {object} [sent] the request's own `fields`; a key in it outside
 *   TIMELINE_FIELDS is refused, where the same key only in `fields` is
 *   dropped
 * @returns {{ ok: true, fields: object } | { ok: false, errors: string[] }}
 */
function validateTimelineFields(fields, sent = {}) {
  const errors = [];
  for (const key of Object.keys(sent ?? {})) {
    if (!TIMELINE_FIELDS.includes(key)) errors.push(`${key}: unknown field`);
  }

  const out = {};
  for (const key of TIMELINE_FIELDS) {
    if (hasOwn(fields, key) && fields[key] !== undefined) out[key] = fields[key];
  }

  // year: a whole number in range. A string is refused, not coerced, so a
  // script that stores '2024' learns it at the save.
  const year = fields?.year;
  if (!Number.isInteger(year) || year < TIMELINE_LIMITS.yearMin || year > TIMELINE_LIMITS.yearMax) {
    errors.push(MESSAGES.year);
  }

  // title: required text on one line.
  const title = fields?.title;
  if (typeof title !== 'string') {
    errors.push(title === undefined || title === null ? MESSAGES.titleMissing : MESSAGES.titleType);
  } else {
    const trimmed = title.trim();
    if (trimmed.length === 0) errors.push(MESSAGES.titleMissing);
    else if (trimmed.length > TIMELINE_LIMITS.titleMax || CONTROL_CHARACTER.test(trimmed)) {
      errors.push(MESSAGES.titleShape);
    } else {
      out.title = trimmed;
    }
  }

  // description: optional text; blank is none. Line breaks are kept as
  // written (a carriage return reads as one), and no other control
  // character is.
  const description = fields?.description;
  if (description === undefined || description === null) {
    out.description = null;
  } else if (typeof description !== 'string') {
    errors.push(MESSAGES.descriptionType);
  } else {
    const trimmed = description.replace(/\r\n?/g, '\n').trim();
    if (trimmed.length > TIMELINE_LIMITS.descriptionMax) errors.push(MESSAGES.descriptionLength);
    else if (CONTROL_CHARACTER.test(trimmed.replaceAll('\n', ''))) errors.push(MESSAGES.descriptionControl);
    else out.description = trimmed || null;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields: out };
}

module.exports = {
  TIMELINE_COLLECTION: COLLECTION,
  TIMELINE_FIELDS,
  TIMELINE_LIMITS,
  validateTimelineFields,
};
