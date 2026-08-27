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

/** "October 2026" — the standing head one month of the feed sits under. */
export function publishMonthLabel(publishAt) {
  const date = toPublishDate(publishAt);
  if (!date) return null;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { month: 'long', year: 'numeric' }).format(date);
}

/**
 * THE FEED, CUT INTO THE RUNS A READER ACTUALLY READS (this review).
 *
 * `sortUpdates` puts pinned posts first and then everything newest-first,
 * which is the right order and the wrong single run: a pinned post from
 * August sitting above October's would put August's month head at the top
 * of the page. Pinned is not a date, so it is its own named run.
 *
 * Three kinds of run, in this order:
 *
 *   'pinned'   the posts the operator held to the top, in their sorted
 *              order. Titled "Pinned", never a month — the whole point of
 *              the group is that it is out of time.
 *   'month'    one per calendar month, newest first, titled "October 2026".
 *   'undated'  posts with no resolvable publishAt, last. They are real
 *              posts and they stay in the document; what they do not get is
 *              a month they never had.
 *
 * Takes an ALREADY SORTED list and never re-sorts it, so a run can never
 * hold a post the sort would have put elsewhere.
 *
 * @param {Array<object>} sorted output of sortUpdates
 * @returns {Array<{ kind: 'pinned'|'month'|'undated', label: string, members: object[] }>}
 */
export function groupUpdates(sorted) {
  const runs = [];
  const push = (kind, label, update) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && last.label === label) last.members.push(update);
    else runs.push({ kind, label, members: [update] });
  };
  for (const update of sorted) {
    if (update?.pinned === true) {
      push('pinned', 'Pinned', update);
      continue;
    }
    const month = publishMonthLabel(update?.publishAt);
    if (month) push('month', month, update);
    else push('undated', 'Undated', update);
  }
  return runs;
}
