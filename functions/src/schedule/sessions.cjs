'use strict';

/**
 * The session schedule shape: tracks and parent sessions (design brief
 * §4.6, §7 PR3).
 *
 * A `cmsSchedule` document is otherwise free-form — the generic content
 * endpoints write it, and no key list guards it — so this module validates
 * exactly the two fields that carry structure, and nothing else:
 *
 *   track     'A' … 'Z' — which concurrent line this session runs on. The
 *             LETTER only. The name lives once, in `config/event.tracks`,
 *             so renaming a line is one edit rather than a sweep of every
 *             session. A session with no track runs on its own, and a
 *             letter no track defines is refused: see checkSessionTrack.
 *
 *   parentId  the id of a top-level session on the same day. A parent and
 *             its children read as a service and its calling points (brief
 *             §4.6): a workshop block and the workshops inside it, a
 *             plenary and its breakouts.
 *
 * PARENTS ARE ONE LEVEL DEEP, and that is a rule, not a limitation of the
 * check. A schedule is a timetable, not a tree: a reader scanning a grid
 * can hold "this session sits under that one" and nothing deeper. Holding
 * the depth at one is also what makes a cycle impossible to construct —
 * see checkSessionParent, which refuses BOTH halves of every cycle it
 * could otherwise take two writes to build.
 *
 * WALKING MINUTES ARE NOT HERE. "Transfer to Line B · Hall 2 · 6 min walk"
 * (brief §4.6) is a fact about a pair of rooms in a building, not about a
 * session, and a per-session number would be wrong the moment either
 * session moved. It belongs in a venue file, and it is deliberately out of
 * this schema.
 */

const { TRACK_LETTER_RE } = require('shared/config');
const { isValidDocId } = require('../cms/store.cjs');

/** The live sessions collection and its draft sibling (§8.4). */
const SESSIONS = 'cmsSchedule';
const SESSIONS_DRAFTS = 'cmsSchedule_drafts';

/** Where the event's track definitions live (shared/config validates them). */
const CONFIG_COLLECTION = 'config';
const CONFIG_EVENT_DOC = 'event';

/** The letter a field states, or null for "this session names no track". */
function statedTrack(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Shape-check the two structural fields without touching Firestore. Pure,
 * so the cheap rejections cost no reads.
 *
 * Both fields are optional and both accept null, which is how an editor
 * clears one: "this session is on no track" and "this session has no
 * parent" are ordinary states, not errors.
 *
 * @param {object} fields the session's fields as they will be stored
 * @param {string} docId the session's own document id
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateSessionShape(fields, docId) {
  const errors = [];
  const track = fields?.track;
  if (track !== undefined && track !== null && track !== '') {
    if (typeof track !== 'string' || !TRACK_LETTER_RE.test(track)) {
      errors.push(
        `track: must be a single capital letter A-Z naming one of the event's tracks, ` +
        `got ${JSON.stringify(track)}`,
      );
    }
  }

  const parentId = fields?.parentId;
  if (parentId !== undefined && parentId !== null && parentId !== '') {
    // The SAME document-id contract the create/update endpoints apply to a
    // session's own id (cms/store.cjs isValidDocId, via resolveTarget), and
    // deliberately not a narrower one. A stricter rule here would make some
    // sessions unnameable as parents — a session created as `keynote.day1`
    // or `Session 3` exists, publishes, and renders, but could never be
    // pointed at, and the operator would be told its id was not "a session
    // document id" by the very system that let them create it.
    if (!isValidDocId(parentId)) {
      errors.push(`parentId: must be a session document id, got ${JSON.stringify(parentId)}`);
    } else if (parentId === docId) {
      errors.push(`parentId: a session cannot be its own parent ("${docId}")`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The letters `config/event.tracks` defines, in the order the config states
 * them (which is the order the schedule grid puts the columns in).
 *
 * READ FRESH, INSIDE THE CALLER'S TRANSACTION — deliberately NOT through
 * core/config.cjs getEventConfig. That loader caches per container for five
 * minutes, which is the right trade for a handler rendering a page and the
 * wrong one for a validator: an operator who adds track C in event settings
 * and immediately puts a session on it would be told, for up to five
 * minutes, that C is not one of the event's tracks — and worse, a track
 * DELETED in settings would keep accepting sessions for just as long, from
 * whichever containers still hold the old copy. A transactional read of the
 * document has neither problem, and it puts config/event in the write
 * transaction's read set: a concurrent settings save that drops the track
 * this session is claiming aborts the save rather than racing it.
 */
async function readTrackLetters({ db, tx }) {
  const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_EVENT_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const tracks = snap.exists ? snap.data()?.tracks : null;
  if (!Array.isArray(tracks)) return [];
  return tracks.map((t) => statedTrack(t?.letter)).filter((letter) => letter !== null);
}

/**
 * The track letter, checked against the tracks the event actually defines.
 *
 * A LETTER WITH NO DEFINITION IS REFUSED, including when the event defines
 * no tracks at all. A track is a line with a name (brief §4.6) — "Line B"
 * on a badge, in the grid header, in a route mark — and a session pointing
 * at a letter nothing names renders as a bare glyph the reader cannot
 * resolve. Rejecting says so while the operator is still in the editor,
 * with the letters that ARE defined in the message, rather than shipping a
 * schedule column with no heading.
 *
 * Existing documents are untouched: this runs at the write, exactly like
 * the stat contract, so a session stored before its track was removed keeps
 * publishing and rendering until someone edits it.
 *
 * @param {{ db: object, tx?: object, fields: object }} args
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkSessionTrack({ db, tx = null, fields }) {
  const track = statedTrack(fields?.track);
  if (track === null) return { ok: true, errors: [] };

  const letters = await readTrackLetters({ db, tx });
  if (letters.length === 0) {
    return {
      ok: false,
      errors: [
        `track: this event defines no tracks, so no session can run on track "${track}" — ` +
        'add the track in event settings first, or leave this session with no track',
      ],
    };
  }
  if (!letters.includes(track)) {
    return {
      ok: false,
      errors: [
        `track: "${track}" is not one of this event's tracks (${letters.join(', ')}) — ` +
        'add it in event settings first, or pick one of those',
      ],
    };
  }
  return { ok: true, errors: [] };
}

/** True when a stored session document names a parent. */
function hasParent(data) {
  return typeof data?.parentId === 'string' && data.parentId.trim().length > 0;
}

/**
 * The parent as an editor sees it: the draft revision when there is one,
 * the live document otherwise. A parent that exists only as an unpublished
 * draft is just as real to the person building the schedule as one already
 * live, which is the same reasoning cmsSavePage's path-uniqueness check
 * applies across both revisions.
 */
async function readSession({ db, tx, docId }) {
  const refs = [db.collection(SESSIONS_DRAFTS).doc(docId), db.collection(SESSIONS).doc(docId)];
  const [draft, live] = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
  if (draft.exists) return draft.data();
  if (live.exists) return live.data();
  return null;
}

/** Ids of the sessions naming `docId` as their parent, across both revisions. */
async function findChildIds({ db, tx, docId }) {
  const queries = [
    db.collection(SESSIONS_DRAFTS).where('parentId', '==', docId),
    db.collection(SESSIONS).where('parentId', '==', docId),
  ];
  const snaps = await Promise.all(queries.map((q) => (tx ? tx.get(q) : q.get())));
  const ids = new Set();
  for (const snap of snaps) for (const doc of snap.docs) ids.add(doc.id);
  return [...ids];
}

/**
 * The line a child may state (brief §4.6).
 *
 * A child session runs inside its parent — a clinic inside a workshop
 * block, a breakout inside a plenary — so it runs on its parent's line.
 * Two answers are therefore correct, and only two: say nothing and inherit,
 * or say the same letter the parent says. Anything else is a session the
 * grid cannot place, because its parent puts it in one column and its own
 * field puts it in another.
 *
 * Absence stays first-class: a child with no track is not missing data, it
 * is a child that inherits (resolveSessionTrack does the inheriting for
 * renderers), so nothing forces a letter onto it.
 *
 * @param {{ childTrack: unknown, parent: object, parentId: string }} args
 * @returns {string[]} at most one error
 */
function checkChildTrack({ childTrack, parent, parentId }) {
  const child = statedTrack(childTrack);
  if (child === null) return [];
  const parentLine = statedTrack(parent?.track);
  if (child === parentLine) return [];
  return [
    `track: "${child}" is not the track of its parent "${parentId}" ` +
    `(${parentLine === null ? 'which runs on no track' : `which runs on "${parentLine}"`}) — ` +
    'a child session runs on its parent\'s line, so leave its track unset to inherit, ' +
    'or set it to the same letter',
  ];
}

/**
 * The track a session RENDERS on: its own if it states one, otherwise its
 * parent's — which is what "a child inherits its parent's line" means at
 * the reading end, and why a child is allowed to state nothing at all.
 *
 * Parents are one level deep, so this never recurses: a parent's own track
 * is the end of the chain.
 *
 * @param {object|null} session
 * @param {Map<string, object>|Record<string, object>|null} byId every session
 *   the renderer holds, keyed by document id (a Map or a plain object)
 * @returns {string|null} the letter, or null for a session on no line
 */
function resolveSessionTrack(session, byId) {
  const own = statedTrack(session?.track);
  if (own !== null) return own;
  const parentId = session?.parentId;
  if (typeof parentId !== 'string' || parentId.trim().length === 0) return null;
  const parent = byId instanceof Map ? byId.get(parentId) : byId?.[parentId];
  return statedTrack(parent?.track);
}

/**
 * The parent reference, checked against what is actually stored. Reads run
 * inside the caller's transaction for the same reason the speaker seam's
 * do: a check in a separate round trip is only advisory, and the write it
 * guards can land after the world it checked has moved.
 *
 * Five refusals, each naming what is wrong:
 *
 *   - the parent does not exist (an orphan);
 *   - the parent is itself a child (depth is one);
 *   - the parent runs on another day (a child inherits its parent's day);
 *   - the child states a different track from its parent (a child runs on
 *     its parent's line — see checkChildTrack);
 *   - this session already has children of its own, so making it a child
 *     would build a cycle — this is the second half of every cycle, and
 *     refusing it is what makes "one level deep" hold across two writes
 *     rather than only within one.
 *
 * @param {{ db: object, tx?: object, docId: string, fields: object }} args
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkSessionParent({ db, tx = null, docId, fields }) {
  const parentId = fields?.parentId;
  if (typeof parentId !== 'string' || parentId.trim().length === 0) return { ok: true, errors: [] };
  if (parentId === docId) {
    return { ok: false, errors: [`parentId: a session cannot be its own parent ("${docId}")`] };
  }

  const parent = await readSession({ db, tx, docId: parentId });
  if (!parent) {
    return { ok: false, errors: [`parentId: no session exists with id "${parentId}"`] };
  }

  const errors = [];
  if (hasParent(parent)) {
    errors.push(
      `parentId: "${parentId}" is itself a child of "${parent.parentId}", ` +
      'and a session may hold children only one level deep',
    );
  }
  if (parent.dayId !== fields.dayId) {
    errors.push(
      `parentId: "${parentId}" runs on day ${JSON.stringify(parent.dayId)}, ` +
      `so this session cannot run on day ${JSON.stringify(fields.dayId)} — a child session ` +
      'runs on its parent\'s day',
    );
  }
  errors.push(...checkChildTrack({ childTrack: fields.track, parent, parentId }));

  const children = (await findChildIds({ db, tx, docId })).filter((id) => id !== docId);
  if (children.length > 0) {
    errors.push(
      `parentId: "${docId}" already has child sessions (${children.join(', ')}), ` +
      'so it cannot become a child itself',
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Every half in one call, shape before reads: a malformed payload costs no
 * reads at all, and the checks that do read run together so one save reports
 * everything wrong with it rather than one thing per round trip.
 *
 * @param {{ db: object, tx?: object, docId: string, fields: object }} args
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function validateSessionStructure({ db, tx = null, docId, fields }) {
  const shape = validateSessionShape(fields, docId);
  if (!shape.ok) return { ok: false, message: shape.errors.join('; ') };

  const errors = [];
  for (const check of [
    () => checkSessionTrack({ db, tx, fields }),
    () => checkSessionParent({ db, tx, docId, fields }),
  ]) {
    const verdict = await check();
    errors.push(...verdict.errors);
  }
  if (errors.length > 0) return { ok: false, message: errors.join('; ') };
  return { ok: true };
}

module.exports = {
  validateSessionShape,
  checkSessionTrack,
  checkSessionParent,
  validateSessionStructure,
  resolveSessionTrack,
  internals: {
    SESSIONS,
    SESSIONS_DRAFTS,
    findChildIds,
    readSession,
    readTrackLetters,
    statedTrack,
    checkChildTrack,
  },
};
