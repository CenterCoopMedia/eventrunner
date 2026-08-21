// Display formatting for cmsUpdates.publishAt (issue #27 follow-up: /updates
// routes). The field is stored as a Firestore Timestamp when written through
// the live SDK (functions/src/cms/updates.cjs stores a Date, which Firestore
// persists as a Timestamp), but tests and the admin form may also hand this
// a plain Date or an ISO string — accept all three, fail soft (null) on
// anything else rather than throwing mid-render.
const DISPLAY_LOCALE = 'en-US';

/**
 * @param {*} publishAt - Firestore Timestamp | Date | string | null | undefined
 * @returns {Date | null}
 */
export function toPublishDate(publishAt) {
  if (publishAt == null) return null;
  const date =
    typeof publishAt?.toDate === 'function' ? publishAt.toDate() : new Date(publishAt);
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

/** "October 15, 2026" display copy, or null when unresolvable. */
export function publishDateLabel(publishAt) {
  const date = toPublishDate(publishAt);
  if (!date) return null;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Sort updates pinned-first, then newest publishAt first. Updates without a
 * resolvable publishAt sort after every dated one (within the same pinned
 * bucket) rather than floating to the top as "newest".
 *
 * @param {Array<object>} updates
 * @returns {Array<object>}
 */
export function sortUpdates(updates) {
  return updates.slice().sort((a, b) => {
    const pinDiff = (b?.pinned === true ? 1 : 0) - (a?.pinned === true ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    const aDate = toPublishDate(a?.publishAt);
    const bDate = toPublishDate(b?.publishAt);
    if (aDate && bDate) return bDate.getTime() - aDate.getTime();
    if (aDate) return -1;
    if (bDate) return 1;
    return 0;
  });
}
