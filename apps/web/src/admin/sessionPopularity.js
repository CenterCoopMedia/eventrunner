// Session popularity (issue #182): the sessions attendees saved most, from
// the public `sessionBookmarks/{sessionId}` counts (parity plan, M9: "reads
// the public sessionBookmarks counts").
//
// The rows are the admin's own session rows (useAdminSessions groups), so
// every entry names a session the Sessions page lists and carries the day
// heading that page draws for it (#248's resolveDayLabel, through the group
// label), never a day id.
//
// Only the bookmarkSession function writes a count, and only for a session
// on the site (functions/src/schedule/bookmarks.cjs), so a draft or a hidden
// session cannot have been saved. That is why `unsaved` counts the rows on
// the site with no saves, and nothing else: a draft with no saves is not a
// session nobody chose.

const byTitle = (row) => String(row.current?.title || row.id);

/**
 * The saved sessions, most saved first, and the count of sessions on the
 * site that nobody has saved yet.
 *
 * Ties break on the title, then the id, so the order is stable from one
 * snapshot to the next. A count whose id matches no row (a session deleted
 * since it was saved) is ignored.
 *
 * @param {Array<{ label: string, rows: Array<{ id: string, live: object|null, current: object }> }>} groups
 * @param {Map<string, number>} countsById
 * @returns {{ ranked: Array<{ id: string, title: string, dayLabel: string, count: number }>, unsaved: number }}
 */
export function rankSessionsBySaves(groups, countsById) {
  const counts = countsById instanceof Map ? countsById : new Map();
  const ranked = [];
  let unsaved = 0;
  for (const group of groups ?? []) {
    for (const row of group.rows ?? []) {
      const count = counts.get(row.id);
      if (Number.isFinite(count) && count > 0) {
        ranked.push({ id: row.id, title: byTitle(row), dayLabel: group.label, count });
      } else if (row.live?.visible === true) {
        unsaved += 1;
      }
    }
  }
  ranked.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { ranked, unsaved };
}
