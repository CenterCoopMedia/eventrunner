// cmsTimeline helpers for the timeline list and editor (issue #194). A
// timeline entry is one past edition of the event, a record under the
// two-revision publish model (functions/src/cms/store.cjs), written through
// the generic content endpoints, whose timeline seam
// (functions/src/cms/timeline.cjs) checks each field at the save. This
// module gives the editor its form shape and the same limits, so a field
// names its problem before the server has to.
import { recordStateOf } from './recordState.js';

/**
 * The bounds each field keeps. Mirrors TIMELINE_LIMITS in
 * functions/src/cms/timeline.cjs; timelineDoc.test.js imports that object
 * and holds the two together.
 */
export const TIMELINE_LIMITS = Object.freeze({
  yearMin: 1900,
  yearMax: 2100,
  titleMax: 120,
  descriptionMax: 600,
});

const CONTROL_CHARACTER = /\p{Cc}/u;

const yearOf = (entry) => (Number.isInteger(entry?.year) ? entry.year : Number.POSITIVE_INFINITY);
const titleOf = (entry) => (typeof entry?.title === 'string' ? entry.title : '');

/**
 * One row per entry, from its live and draft revisions, in the order the
 * home page's History section lists them: oldest first, then by title and
 * id. `current` is the draft where there is one. An entry with no usable
 * year sorts last, where an operator finds it to fix.
 *
 * @param {Array<object>|null} liveDocs
 * @param {Array<object>|null} draftDocs
 * @returns {Array<{ id: string, live: object|null, draft: object|null, current: object, state: object }>}
 */
export function mergeTimelineRevisions(liveDocs, draftDocs) {
  const liveById = new Map((liveDocs ?? []).map((doc) => [doc.id, doc]));
  const draftById = new Map((draftDocs ?? []).map((doc) => [doc.id, doc]));
  return [...new Set([...liveById.keys(), ...draftById.keys()])]
    .map((id) => {
      const live = liveById.get(id) ?? null;
      const draft = draftById.get(id) ?? null;
      return { id, live, draft, current: draft ?? live, state: recordStateOf({ live, draft }) };
    })
    .sort(
      (a, b) =>
        yearOf(a.current) - yearOf(b.current) ||
        titleOf(a.current).localeCompare(titleOf(b.current)) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * The year as the form holds it: four digits are a number, and anything
 * else goes as typed, so the server's message names it.
 *
 * @param {string} value
 * @returns {number|string}
 */
function yearValue(value) {
  const raw = String(value ?? '').trim();
  return /^\d{4}$/.test(raw) ? Number(raw) : raw;
}

/**
 * The `fields` cmsCreateContent and cmsUpdateContent receive: the three
 * fields an entry stores and nothing else. The server drops the seed's
 * bookkeeping on every admin write, so an edited demo entry is the
 * client's from then on.
 *
 * @param {{ year: string, title: string, description: string }} form
 * @returns {{ year: number|string, title: string, description: string|null }}
 */
export function timelineFields(form) {
  const description = String(form.description ?? '').trim();
  return {
    year: yearValue(form.year),
    title: String(form.title ?? '').trim(),
    description: description || null,
  };
}

/**
 * The editor's own checks, field by field. The server repeats each one;
 * these name the problem while the operator is still looking at the field.
 *
 * @param {{ year: string, title: string, description: string }} form
 * @returns {Map<string, string>} field → message
 */
export function validateTimelineForm(form) {
  const errors = new Map();
  const year = yearValue(form.year);
  if (typeof year !== 'number') errors.set('year', 'Enter a year as four digits.');
  else if (year < TIMELINE_LIMITS.yearMin || year > TIMELINE_LIMITS.yearMax) {
    errors.set('year', `Enter a year from ${TIMELINE_LIMITS.yearMin} to ${TIMELINE_LIMITS.yearMax}.`);
  }
  const title = String(form.title ?? '').trim();
  if (!title) errors.set('title', 'Enter a title.');
  else if (title.length > TIMELINE_LIMITS.titleMax) errors.set('title', `Use ${TIMELINE_LIMITS.titleMax} characters or fewer.`);
  else if (CONTROL_CHARACTER.test(title)) errors.set('title', 'Keep the title on one line, without tabs.');
  const description = String(form.description ?? '').replace(/\r\n?/g, '\n').trim();
  if (description.length > TIMELINE_LIMITS.descriptionMax) {
    errors.set('description', `Use ${TIMELINE_LIMITS.descriptionMax} characters or fewer.`);
  } else if (CONTROL_CHARACTER.test(description.replaceAll('\n', ''))) {
    errors.set('description', 'Use plain text. A line break is the only control character allowed.');
  }
  return errors;
}
