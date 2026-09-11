// Schedule narrowing (issues #162, #163; expansion record §3.3).
//
// Pure: no React, no DOM. The page owns the controls; this module decides
// what survives them.
//
// TWO FACTS SHAPE THE SHAPE OF THE ANSWER:
//
// A calling point is not a row of its own (lib/scheduleGrid.js), and a
// filter must not turn one into one. When a child session matches and its
// parent does not, the parent row stays — a calling point without its
// parent's time and room reads as a stray line — and only the matching
// children stay under it. When the parent itself matches, the whole entry
// is the match, so all of its calling points stay: they are stops inside
// it.
//
// The search text is resolved, not stored: a session names its speakers by
// id, so the words a reader types ("Dana") have to meet the speaker's
// display name, and the track's name has to meet the letter the session
// stores. Everything folds to lower case once, here, so the page compares
// with indexOf and nothing else.

/** Lower-case, or ''. */
function fold(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * The track name a session runs on, or '' where it runs on none the event
 * defines (lib/scheduleGrid.js treats an undefined letter as untracked).
 */
function trackName(session, columns) {
  const letter = fold(session?.track).trim();
  if (!letter) return '';
  return columns.find((column) => fold(column.letter) === letter)?.name ?? '';
}

/**
 * One searchable text per session: title, description, room, the track's
 * own name, and the resolved speaker display names, folded to lower case.
 *
 * @param {object[]} sessions
 * @param {Map<string, string>} speakerNamesById resolved display names
 * @param {Array<{ letter: string, name: string }>} columns
 * @returns {Map<string, string>} sessionId -> searchable text
 */
export function buildSearchIndex(sessions, speakerNamesById, columns) {
  const index = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || typeof session.id !== 'string') continue;
    const speakers = Array.isArray(session.speakerIds)
      ? session.speakerIds
          .map((id) => (speakerNamesById instanceof Map ? speakerNamesById.get(id) : undefined))
          .filter(Boolean)
          .join(', ')
      : '';
    const text = [
      session.title,
      session.description,
      session.location,
      trackName(session, Array.isArray(columns) ? columns : []),
      speakers,
    ]
      .map(fold)
      .filter(Boolean)
      .join(' ');
    index.set(session.id, text);
  }
  return index;
}

/** Whether one folded search text carries the whole query. An empty query keeps everything. */
export function matchesQuery(text, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return text.includes(q);
}

/**
 * The distinct session formats present in the data, in first-seen order,
 * each with the count of sessions carrying it. The list is not fixed in
 * code: a format an event never stored offers nothing to filter on.
 *
 * @param {object[]} sessions
 * @returns {Array<{ value: string, label: string, count: number }>}
 */
export function collectFormats(sessions) {
  const counts = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const format = session?.type;
    if (typeof format !== 'string' || !format.trim()) continue;
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, label: value, count }));
}

/**
 * Whether a session passes the facet filters. A facet with nothing selected
 * filters nothing; a session must pass every facet that is on.
 *
 * @param {object} session
 * @param {{ formats?: string[], tracks?: string[] }} selected
 */
export function matchesFilters(session, selected) {
  const formats = Array.isArray(selected?.formats) ? selected.formats : [];
  if (formats.length > 0 && !formats.includes(session?.type)) return false;
  const tracks = Array.isArray(selected?.tracks) ? selected.tracks : [];
  if (tracks.length > 0 && !tracks.map(fold).includes(fold(session?.track))) return false;
  return true;
}

/**
 * One day's sessions as parent entries, narrowed by a predicate over
 * sessions. The parent's relationship rules are the ones withCallingPoints
 * applies: a child is a session whose `parentId` names another session in
 * the same day, one level deep, never itself.
 *
 * A matched parent keeps all of its calling points; a parent kept only for
 * a matched calling point keeps just the matched ones.
 *
 * @param {object[]} sessions one day, sorted
 * @param {(session: object) => boolean} keep
 * @returns {Array<{ session: object, children: object[] }>}
 */
export function filterEntries(sessions, keep) {
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

  const matchedIds = new Set(
    list.filter((session) => keep(session)).map((session) => session.id),
  );

  // Parents kept only for a matched calling point.
  const parentsOfMatched = new Set();
  for (const session of list) {
    if (!matchedIds.has(session.id)) continue;
    const parent = parentOf(session);
    if (parent) parentsOfMatched.add(parent.id);
  }

  const entries = [];
  for (const session of list) {
    if (parentOf(session)) continue;
    const parentMatched = matchedIds.has(session.id);
    if (!parentMatched && !parentsOfMatched.has(session.id)) continue;
    entries.push({
      session,
      children: list.filter(
        (child) =>
          parentOf(child) === session &&
          (parentMatched || matchedIds.has(child.id)),
      ),
    });
  }
  return entries;
}

// ------------------------------------------------------------- URL state
//
// The whole view round trips through query parameters (issue #164), so a
// filtered day is a link a reader can hand to somebody else. `read` treats
// every unknown value as the default, because the URL is untrusted input a
// bookmark may carry for years: a day the event no longer runs, a sort the
// page never offered, a filter token for a facet that is gone — each falls
// back rather than rendering a wrong or empty page.

/** The sort orders the schedule offers. 'saved' needs the bookmark counts. */
export const SCHEDULE_SORTS = Object.freeze(['time', 'saved']);

/** A comma-separated parameter as a list, kept only where `allowed` knows a token. */
function csvParam(value, allowed) {
  if (typeof value !== 'string' || !value) return [];
  const tokens = value.split(',').map((token) => token.trim()).filter(Boolean);
  if (!Array.isArray(allowed)) return tokens;
  const known = new Set(allowed);
  return tokens.filter((token) => known.has(token));
}

/**
 * The view one URLSearchParams carries.
 *
 * @param {URLSearchParams} searchParams
 * @param {{ dayIds?: string[] | Set<string>, formats?: string[], tracks?: string[] }} [known]
 * @returns {{ q: string, formats: string[], tracks: string[], day: string | null, sort: string }}
 *   `day` is null where the URL names no usable day, which the caller reads
 *   as its first configured day.
 */
export function readScheduleView(searchParams, known = {}) {
  const get = (key) => {
    try {
      return searchParams?.get(key);
    } catch {
      return null;
    }
  };
  const dayIds = known.dayIds instanceof Set ? known.dayIds : new Set(known.dayIds ?? []);
  const day = get('day');
  return {
    q: get('q') ?? '',
    formats: csvParam(get('format'), known.formats),
    tracks: csvParam(get('track'), known.tracks),
    day: day && dayIds.has(day) ? day : null,
    sort: SCHEDULE_SORTS.includes(get('sort')) ? get('sort') : 'time',
  };
}

/**
 * The URLSearchParams one view produces. Defaults are omitted, so a cleared
 * view keeps the clean URL it started from.
 *
 * @param {{ q?: string, formats?: string[], tracks?: string[], day?: string | null, sort?: string }} view
 * @param {{ firstDayId?: string | null }} [defaults]
 */
export function writeScheduleView(view, defaults = {}) {
  const params = new URLSearchParams();
  if (typeof view.q === 'string' && view.q) params.set('q', view.q);
  if (Array.isArray(view.formats) && view.formats.length > 0) {
    params.set('format', view.formats.join(','));
  }
  if (Array.isArray(view.tracks) && view.tracks.length > 0) {
    params.set('track', view.tracks.join(','));
  }
  if (view.day && view.day !== defaults.firstDayId) params.set('day', view.day);
  if (view.sort === 'saved') params.set('sort', 'saved');
  return params;
}

// ------------------------------------------------------------------- sort

/**
 * Entries in the chosen order (issue #164). 'time' is the programme order
 * the caller's sortSessions already produced; 'saved' puts the sessions the
 * most attendees bookmarked first, with an absent count reading as zero and
 * ties keeping the programme order (the platform's sort is stable).
 *
 * @param {Array<{ session: object, children: object[] }>} entries
 * @param {string} sort
 * @param {Map<string, number> | null} [countsById] aggregate bookmark counts
 * @returns {Array<{ session: object, children: object[] }>}
 */
export function sortEntries(entries, sort, countsById = null) {
  const list = [...(Array.isArray(entries) ? entries : [])];
  if (sort !== 'saved') return list;
  const countOf = (entry) =>
    countsById instanceof Map ? countsById.get(entry.session?.id) ?? 0 : 0;
  return list.sort(
    (a, b) =>
      countOf(b) - countOf(a) ||
      String(a.session?.startTime ?? '').localeCompare(String(b.session?.startTime ?? '')) ||
      (a.session?.order ?? 0) - (b.session?.order ?? 0) ||
      String(a.session?.title ?? '').localeCompare(String(b.session?.title ?? '')),
  );
}
