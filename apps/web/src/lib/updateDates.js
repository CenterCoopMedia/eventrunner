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

/**
 * A formatter in the event's zone, or in the reader's when none is given or
 * the given one is not a zone the runtime knows. A dateline carries the
 * event's clock (design record §3.1): a post published late in the evening
 * at the venue is dated that day, not the reader's next morning.
 */
function formatterIn(timeZone, options) {
  if (typeof timeZone === 'string' && timeZone) {
    try {
      return new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, ...options });
    } catch {
      // An unknown zone: fall through to the reader's clock rather than
      // failing the page over a date.
    }
  }
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, options);
}

/**
 * "October 15, 2026" display copy, or null when unresolvable.
 *
 * @param {*} publishAt
 * @param {string} [timeZone] the event's zone (config/event.timezone)
 */
export function publishDateLabel(publishAt, timeZone) {
  const date = toPublishDate(publishAt);
  if (!date) return null;
  return formatterIn(timeZone, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

/**
 * The feed's order for two updates: pinned first, then newest publishAt
 * first. An update without a resolvable publishAt sorts after every dated
 * one (within the same pinned bucket) rather than floating to the top as
 * "newest". The admin's updates list orders its rows with this too
 * (admin/updatesDoc.js), so the two lists agree (issue #190).
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareUpdates(a, b) {
  const pinDiff = (b?.pinned === true ? 1 : 0) - (a?.pinned === true ? 1 : 0);
  if (pinDiff !== 0) return pinDiff;
  const aDate = toPublishDate(a?.publishAt);
  const bDate = toPublishDate(b?.publishAt);
  if (aDate && bDate) return bDate.getTime() - aDate.getTime();
  if (aDate) return -1;
  if (bDate) return 1;
  return 0;
}

/**
 * Sort updates in the feed's order (compareUpdates).
 *
 * @param {Array<object>} updates
 * @returns {Array<object>}
 */
export function sortUpdates(updates) {
  return updates.slice().sort(compareUpdates);
}

/**
 * "October 2026" — the standing head one month of the feed sits under, on
 * the event's clock when a zone is given.
 *
 * @param {*} publishAt
 * @param {string} [timeZone]
 */
export function publishMonthLabel(publishAt, timeZone) {
  const date = toPublishDate(publishAt);
  if (!date) return null;
  return formatterIn(timeZone, { month: 'long', year: 'numeric' }).format(date);
}

/**
 * THE FEED, CUT INTO THE RUNS A READER ACTUALLY READS (this review).
 *
 * `sortUpdates` puts pinned posts first and then everything newest-first,
 * which is the right order and the wrong single run: a pinned post from
 * August sitting above October's would put August's month head at the top
 * of the page. Pinned is not a date, so it is its own named run.
 *
 * Four kinds of run, in this order:
 *
 *   'lead'     the first featured post in sorted order (issue #191), alone,
 *              titled "Featured". Featured is not a date either. Only one
 *              post leads; another featured post stays in its own place.
 *   'pinned'   the posts the operator held to the top, in their sorted
 *              order. Titled "Pinned", never a month — the whole point of
 *              the group is that it is out of time.
 *   'month'    one per calendar month, newest first, titled "October 2026".
 *   'undated'  posts with no resolvable publishAt, last. They are real
 *              posts and they stay in the document; what they do not get is
 *              a month they never had.
 *
 * Takes an ALREADY SORTED list and never re-sorts it, so a run can never
 * hold a post the sort would have put elsewhere. The lead is the one post
 * taken out of its place, and it is left out of the runs after it, so no
 * post is listed twice.
 *
 * @param {Array<object>} sorted output of sortUpdates
 * @param {string} [timeZone] the event's zone, so a month head is the event's month
 * @returns {Array<{ kind: 'lead'|'pinned'|'month'|'undated', label: string, members: object[] }>}
 */
export function groupUpdates(sorted, timeZone) {
  const runs = [];
  // Only a real `true` features a post, the value cmsSaveUpdate stores.
  const lead = sorted.find((update) => update?.featured === true) ?? null;
  if (lead) runs.push({ kind: 'lead', label: 'Featured', members: [lead] });
  const push = (kind, label, update) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && last.label === label) last.members.push(update);
    else runs.push({ kind, label, members: [update] });
  };
  for (const update of sorted) {
    if (update === lead) continue;
    if (update?.pinned === true) {
      push('pinned', 'Pinned', update);
      continue;
    }
    const month = publishMonthLabel(update?.publishAt, timeZone);
    if (month) push('month', month, update);
    else push('undated', 'Undated', update);
  }
  return runs;
}
