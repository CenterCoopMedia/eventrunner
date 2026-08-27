// The schedule's second axis (design brief §2.1 "Grid schedule", §4.6).
//
// The schedule has one axis in the data — time — and one in the
// configuration: `config/event.tracks`, the event's concurrent lines. This
// module turns the two into the shape a two-axis grid renders from. It is
// pure: no React, no DOM, no formatting. The renderer decides how a cell
// looks; this decides what is in it.
//
// Three facts the schedule data model carries (PR3-A), and what each one
// means here:
//
//   `config/event.tracks`  a letter and a name, listed once. THE ARRAY
//                          ORDER IS THE COLUMN ORDER. A client reorders
//                          their lines by reordering the list.
//   `session.track`        the LETTER only. A session whose letter no track
//                          defines cannot be placed in a column, so it is
//                          treated the way an untracked session is: it
//                          spans the width. That is the honest reading —
//                          "this runs across the whole event" — and it is
//                          what a plenary is.
//   `session.parentId`     a top-level session on the same day. A parent
//                          and its children read as a service and its
//                          calling points (visual story, Atlas): the child
//                          renders under its parent, in its parent's time
//                          context, never as a row of its own.
//
// The write path refuses a cycle, a second level, and a cross-day parent.
// This module still refuses them itself, because a renderer meets what is
// already stored, including documents written before those checks existed.

/**
 * The event's lines, in the order the grid draws them.
 *
 * `config/event` is runtime data a live write can replace with anything, so
 * every entry is type checked. A letter is normalized to upper case once,
 * here, and matched against `session.track` the same way — that is the one
 * place the two halves of the join have to agree. A line with no name is
 * still a line: "Line B" is the plainest name the story allows, and a mark
 * without a word beside it is a puzzle rather than a sign (§4.6).
 *
 * @param {object|null} eventConfig
 * @returns {Array<{ letter: string, name: string }>}
 */
export function resolveTracks(eventConfig) {
  const stored = Array.isArray(eventConfig?.tracks) ? eventConfig.tracks : [];
  const seen = new Set();
  const tracks = [];
  for (const track of stored) {
    const letter =
      typeof track?.letter === 'string' ? track.letter.trim().toUpperCase() : '';
    if (!letter || seen.has(letter)) continue;
    seen.add(letter);
    const name = typeof track?.name === 'string' && track.name.trim() ? track.name.trim() : '';
    tracks.push({ letter, name: name || `Line ${letter}` });
  }
  return tracks;
}

/**
 * The letter a session runs on, or null where it runs across the width.
 *
 * @param {object} session
 * @param {Set<string>} letters the letters the event actually defines
 * @returns {string|null}
 */
function trackOf(session, letters) {
  const letter = typeof session?.track === 'string' ? session.track.trim().toUpperCase() : '';
  return letters.has(letter) ? letter : null;
}

/**
 * One day's sessions as top-level entries, each carrying its calling points.
 *
 * A child is a session whose `parentId` names another session in the same
 * day. Three stored shapes are refused rather than rendered: a session that
 * names itself, a session whose parent is not in this day, and a session
 * whose parent is itself a child. The first two render the session on its
 * own — the reader still sees it, which is the rule that matters. The third
 * keeps "one level deep" true in the renderer even where a stored document
 * broke it.
 *
 * Order is the caller's: pass the day already sorted (Schedule's
 * sortSessions), and both the entries and each entry's calling points come
 * back in that order.
 *
 * @param {object[]} sessions one day's sessions, sorted
 * @returns {Array<{ session: object, children: object[] }>}
 */
export function withCallingPoints(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const byId = new Map(list.map((session) => [session.id, session]));
  const parentOf = (session) => {
    const id = typeof session?.parentId === 'string' ? session.parentId : null;
    if (!id || id === session.id) return null;
    const parent = byId.get(id);
    if (!parent) return null;
    const grandparent =
      typeof parent.parentId === 'string' ? byId.get(parent.parentId) : null;
    return grandparent && grandparent.id !== parent.id ? null : parent;
  };

  const callingPoints = new Map();
  for (const session of list) {
    const parent = parentOf(session);
    if (!parent) continue;
    callingPoints.set(parent.id, [...(callingPoints.get(parent.id) ?? []), session]);
  }

  return list
    .filter((session) => !parentOf(session))
    .map((session) => ({ session, children: callingPoints.get(session.id) ?? [] }));
}

/**
 * The grid's rows: time down the left, tracks across the head.
 *
 * A row is one start time. A time can produce two rows, and the order is
 * deliberate: anything that spans the width comes first (a plenary is the
 * thing everyone is at), then the tracked columns for that same time. Both
 * rows carry the same time in the row header, the way a printed programme
 * repeats the hour beside every entry under it.
 *
 * @param {Array<{ session: object, children: object[] }>} entries
 * @param {Array<{ letter: string, name: string }>} columns
 * @returns {Array<{
 *   key: string, time: string,
 *   span?: Array<{ session: object, children: object[] }>,
 *   cells?: Array<{ track: string, entries: Array<{ session: object, children: object[] }> }>,
 * }>}
 */
export function buildGridRows(entries, columns) {
  const letters = new Set(columns.map((column) => column.letter));
  const rows = [];
  const times = [];
  for (const entry of entries) {
    const time = String(entry.session?.startTime ?? '');
    if (!times.includes(time)) times.push(time);
  }
  for (const time of times) {
    const at = entries.filter((entry) => String(entry.session?.startTime ?? '') === time);
    const span = at.filter((entry) => trackOf(entry.session, letters) === null);
    const tracked = at.filter((entry) => trackOf(entry.session, letters) !== null);
    if (span.length > 0) rows.push({ key: `${time}-span`, time, span });
    if (tracked.length > 0) {
      rows.push({
        key: `${time}-tracks`,
        time,
        cells: columns.map((column) => ({
          track: column.letter,
          entries: tracked.filter((entry) => trackOf(entry.session, letters) === column.letter),
        })),
      });
    }
  }
  return rows;
}
