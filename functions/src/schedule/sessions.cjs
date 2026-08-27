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
 *   parentId  the id of a top-level session on the same day and the same
 *             line. A parent and its children read as a service and its
 *             calling points (brief §4.6): a workshop block and the
 *             workshops inside it, a plenary and its breakouts.
 *
 * PARENTS ARE ONE LEVEL DEEP, and that is a rule, not a limitation of the
 * check. A schedule is a timetable, not a tree: a reader scanning a grid
 * can hold "this session sits under that one" and nothing deeper. Holding
 * the depth at one is also what makes a cycle impossible to construct —
 * see checkSessionParent, which refuses BOTH halves of every cycle it
 * could otherwise take two writes to build.
 *
 * A RELATIONSHIP IS GUARDED FROM BOTH ENDS AND AT EVERY EDGE. Checking the
 * child's side alone left three ways to break the same rules without ever
 * writing an invalid child: edit the PARENT out from under its children
 * (checkSessionChildren), DELETE the parent (checkSessionDeletable), or
 * PUBLISH a child while its parent is still a draft
 * (checkSchedulePublishSet). Each one produced exactly the state the
 * child-side check exists to prevent, so each has its own refusal, and
 * each reads inside the transaction whose write it guards.
 *
 *   placeId   the id of one of the venue's places (`config/event.venue
 *             .places`, shared/venue.cjs). Which ROOM this session is in,
 *             said as a reference rather than as a string — the session's
 *             free-text `location` stays exactly what it was, a label an
 *             operator writes for a reader, and is not touched here.
 *
 * WALKING MINUTES ARE STILL NOT HERE, and now there is somewhere they are.
 * "Transfer to Line B · Hall 2 · 6 min walk" (brief §4.6) is a fact about a
 * PAIR of rooms in a building, not about a session, and a per-session
 * number would be wrong the moment either session moved. It lives in
 * `config/event.venue.movements` and is validated by shared/config
 * validateEventConfig. What a session carries is which place it is in, and
 * checkSessionPlace below refuses an id the venue does not define — for
 * exactly the reasons checkSessionTrack refuses an undefined letter.
 */

const { TRACK_LETTER_RE } = require('shared/config');
const { PLACE_ID_RE } = require('shared/venue');
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
 * Shape-check the three structural fields without touching Firestore.
 * Pure, so the cheap rejections cost no reads.
 *
 * All three are optional and all three accept null, which is how an editor
 * clears one: "this session is on no track", "this session has no parent",
 * and "this session is in no recorded place" are ordinary states, not
 * errors. The last one is the ordinary state for most events — a venue that
 * has recorded no places has every session in none of them.
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

  const placeId = fields?.placeId;
  if (placeId !== undefined && placeId !== null && placeId !== '') {
    if (typeof placeId !== 'string' || !PLACE_ID_RE.test(placeId)) {
      errors.push(
        'placeId: must be a place id — lowercase letters, digits and single hyphens — ' +
        `got ${JSON.stringify(placeId)}`,
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
 * The place ids `config/event.venue.places` defines.
 *
 * Read fresh inside the caller's transaction, for every reason
 * readTrackLetters is: a five-minute-stale config would tell an operator
 * who has just added a room that the room does not exist, and would go on
 * accepting sessions in a room they have just deleted. The transactional
 * read also puts config/event in the write's read set, so a settings save
 * that drops this place aborts the session write rather than racing it.
 */
async function readPlaceIds({ db, tx }) {
  const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_EVENT_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const places = snap.exists ? snap.data()?.venue?.places : null;
  if (!Array.isArray(places)) return [];
  return places
    .map((place) => place?.id)
    .filter((id) => typeof id === 'string' && PLACE_ID_RE.test(id));
}

/**
 * The place, checked against the places the venue actually defines.
 *
 * A PLACE ID WITH NO DEFINITION IS REFUSED, including when the venue
 * defines no places at all — the same rule, and the same reasons, as
 * checkSessionTrack. A place id is what the movement model resolves a
 * transfer through (shared/venue.cjs resolveMovement): a session pointing
 * at an id nothing defines resolves to no place, therefore to no movement,
 * therefore to silence — and the operator who typed it would have no way to
 * tell that silence apart from "nobody recorded that route". Rejecting at
 * the save says which it is, while they can still fix it.
 *
 * Existing documents are untouched: this runs at the write, so a session
 * stored before its place was removed keeps publishing and rendering until
 * someone edits it.
 *
 * @param {{ db: object, tx?: object, fields: object }} args
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkSessionPlace({ db, tx = null, fields }) {
  const placeId = fields?.placeId;
  if (typeof placeId !== 'string' || placeId.trim().length === 0) return { ok: true, errors: [] };

  const ids = await readPlaceIds({ db, tx });
  if (ids.length === 0) {
    return {
      ok: false,
      errors: [
        `placeId: this event's venue defines no places, so no session can be in "${placeId}" — ` +
        'add the place in event settings first, or leave this session with no place',
      ],
    };
  }
  if (!ids.includes(placeId)) {
    return {
      ok: false,
      errors: [
        `placeId: "${placeId}" is not one of this venue's places (${ids.join(', ')}) — ` +
        'add it in event settings first, or pick one of those',
      ],
    };
  }
  return { ok: true, errors: [] };
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

/**
 * The sessions naming `docId` as their parent, across both revisions, each
 * as the editor sees it: the draft revision when there is one, the live
 * document otherwise (same rule as readSession). A child that exists only
 * as an unpublished draft is a child.
 *
 * @returns {Promise<Array<{ id: string, data: object }>>}
 */
async function findChildren({ db, tx, docId }) {
  const queries = [
    db.collection(SESSIONS).where('parentId', '==', docId),
    db.collection(SESSIONS_DRAFTS).where('parentId', '==', docId),
  ];
  // Live first, drafts second: a draft revision overwrites the live one.
  const snaps = await Promise.all(queries.map((q) => (tx ? tx.get(q) : q.get())));
  const byId = new Map();
  for (const snap of snaps) for (const doc of snap.docs) byId.set(doc.id, doc.data());
  return [...byId.entries()]
    .filter(([id]) => id !== docId)
    .map(([id, data]) => ({ id, data }));
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
 * @param {{ db: object, tx?: object, docId: string, fields: object,
 *           children?: Array<{ id: string, data: object }>|null }} args
 *   `children` is the already-read child set when the caller has one
 *   (validateSessionStructure reads it once for both child checks); left
 *   out, this reads it itself.
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkSessionParent({ db, tx = null, docId, fields, children = null }) {
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

  const own = children ?? (await findChildren({ db, tx, docId }));
  if (own.length > 0) {
    errors.push(
      `parentId: "${docId}" already has child sessions (${own.map((c) => c.id).join(', ')}), ` +
      'so it cannot become a child itself',
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * THE SAME INVARIANTS, READ FROM THE PARENT'S END (design brief §4.6).
 *
 * checkSessionParent judges a child against its parent, which covers every
 * write made from the child's side. The other side was unguarded: editing a
 * PARENT — moving it to another day, putting it on another line — silently
 * broke the same rules for every child attached to it, because nothing
 * re-checked the children the parent was carrying. A workshop block moved
 * to day 3 left its clinics on day 2, still pointing at it: each child
 * document then failed the rule its parent had just changed under it, and
 * nothing in the system would say so until someone next edited a child.
 *
 * So a save that has children validates the children too, and names the
 * count. The operator is told what is attached and what to do about it —
 * move the children or delete them — rather than being handed a schedule
 * that quietly stopped making sense.
 *
 * A child that states no track is not a mismatch: it inherits, so it
 * follows the parent onto its new line by construction.
 *
 * @param {{ db: object, tx?: object, docId: string, fields: object,
 *           children?: Array<{ id: string, data: object }>|null }} args
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkSessionChildren({ db, tx = null, docId, fields, children = null }) {
  const own = children ?? (await findChildren({ db, tx, docId }));
  if (own.length === 0) return { ok: true, errors: [] };

  const errors = [];
  const named = (list) => `${list.length} child session${list.length === 1 ? '' : 's'} ` +
    `(${list.map((c) => c.id).join(', ')})`;

  const offDay = own.filter((child) => child.data?.dayId !== fields?.dayId);
  if (offDay.length > 0) {
    errors.push(
      `dayId: this session carries ${named(offDay)} running on ` +
      `${[...new Set(offDay.map((c) => JSON.stringify(c.data?.dayId)))].join(', ')}, ` +
      `so it cannot run on day ${JSON.stringify(fields?.dayId)} — a child session runs on ` +
      'its parent\'s day, so move those children to this day, re-parent them, or delete them first',
    );
  }

  const track = statedTrack(fields?.track);
  const offTrack = own.filter((child) => {
    const childTrack = statedTrack(child.data?.track);
    return childTrack !== null && childTrack !== track;
  });
  if (offTrack.length > 0) {
    errors.push(
      `track: this session carries ${named(offTrack)} on ` +
      `${[...new Set(offTrack.map((c) => JSON.stringify(statedTrack(c.data?.track))))].join(', ')}, ` +
      `so it cannot run on ${track === null ? 'no track' : JSON.stringify(track)} — a child ` +
      'session runs on its parent\'s line, so clear those children\'s tracks to let them ' +
      'inherit, set them to this one, or re-parent them first',
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * May this session be deleted? (spec §8.4 step 4, brief §4.6.)
 *
 * Deleting a parent used to be the one way to build the orphan every other
 * check in this module exists to prevent: deleteBoth removes the live
 * document and its draft, the children keep their `parentId`, and every
 * one of them now points at a session that does not exist. Nothing
 * reconciles it — the children are not touched by the delete, they are
 * still published, and the next reader gets a calling point with no
 * service. The cost lands on whoever notices, not on whoever caused it.
 *
 * Refusing is right rather than cascading. A cascade would delete content
 * the operator never named, from a button that says "delete this session";
 * the children may be the sessions actually worth keeping. So the refusal
 * names them and hands the decision back: re-parent them or delete them,
 * then delete this.
 *
 * MUST RUN INSIDE THE DELETING TRANSACTION. As a pre-check it is only
 * advisory — a child can be created between the check and the batch, which
 * is exactly the window the session-save seam closes on its own writes.
 *
 * @param {{ db: object, tx?: object, docId: string }} args
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function checkSessionDeletable({ db, tx = null, docId }) {
  const children = await findChildren({ db, tx, docId });
  if (children.length === 0) return { ok: true };
  const ids = children.map((child) => child.id);
  return {
    ok: false,
    message:
      `Cannot delete session "${docId}": ${ids.length} session${ids.length === 1 ? '' : 's'} ` +
      `still run${ids.length === 1 ? 's' : ''} inside it (${ids.join(', ')}). ` +
      'Move those sessions to another parent or delete them first.',
  };
}

/** getAll in fixed batches, so a 2000-id publish is not one giant read. */
const READ_CHUNK = 100;
async function getAllChunked(db, refs) {
  const snaps = [];
  for (let i = 0; i < refs.length; i += READ_CHUNK) {
    snaps.push(...(await db.getAll(...refs.slice(i, i + READ_CHUNK))));
  }
  return snaps;
}

/**
 * The publish set, checked for children that would go live ahead of their
 * parents (spec §8.4 step 3, brief §4.6).
 *
 * Publishing is where the draft world and the live world meet, and the
 * parent rules were only ever enforced in the draft world. A child saved
 * against a parent that exists only as a draft is a legitimate draft — that
 * is the point of readSession reading the draft revision. Publishing THAT
 * CHILD ALONE put a live session on the public schedule whose parentId
 * names nothing live: the same orphan a delete would have made, arriving
 * through the one path that had no check at all.
 *
 * Two ways to satisfy it, and the message says both: the parent is already
 * live, or the parent is in this same publish set (its draft goes live in
 * the same run, so the pair lands together). `{ all: true }` — the ordinary
 * "publish everything" — satisfies it by construction.
 *
 * A docId with no draft publishes nothing (publishDocs reports it as
 * `no-draft`), so it neither needs a parent nor counts as one.
 *
 * @param {{ db: object, docIds: string[] }} args
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkSchedulePublishSet({ db, docIds }) {
  const ids = [...new Set((docIds || []).filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return { ok: true, errors: [] };

  const draftSnaps = await getAllChunked(db, ids.map((id) => db.collection(SESSIONS_DRAFTS).doc(id)));
  const publishing = new Set();
  const parentOf = new Map();
  ids.forEach((id, i) => {
    if (!draftSnaps[i].exists) return;
    publishing.add(id);
    const parentId = draftSnaps[i].data()?.parentId;
    if (typeof parentId === 'string' && parentId.trim().length > 0) parentOf.set(id, parentId);
  });

  const elsewhere = [...new Set([...parentOf.values()].filter((id) => !publishing.has(id)))];
  if (elsewhere.length === 0) return { ok: true, errors: [] };

  const liveSnaps = await getAllChunked(db, elsewhere.map((id) => db.collection(SESSIONS).doc(id)));
  const unpublished = new Set(elsewhere.filter((_, i) => !liveSnaps[i].exists));
  const errors = [...parentOf.entries()]
    .filter(([, parentId]) => unpublished.has(parentId))
    .map(([childId, parentId]) =>
      `${childId}: this session runs inside "${parentId}", which is not published — ` +
      'publish them together, or publish the parent first');
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

  // Read once, judge from both ends: the child set answers both "can this
  // session become a child" (no, if it is already a parent) and "do the
  // children it carries still hold after this edit".
  const children = await findChildren({ db, tx, docId });

  const errors = [];
  for (const check of [
    () => checkSessionTrack({ db, tx, fields }),
    () => checkSessionPlace({ db, tx, fields }),
    () => checkSessionParent({ db, tx, docId, fields, children }),
    () => checkSessionChildren({ db, tx, docId, fields, children }),
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
  checkSessionPlace,
  checkSessionParent,
  checkSessionChildren,
  checkSessionDeletable,
  checkSchedulePublishSet,
  validateSessionStructure,
  resolveSessionTrack,
  internals: {
    SESSIONS,
    SESSIONS_DRAFTS,
    findChildren,
    readSession,
    readTrackLetters,
    readPlaceIds,
    statedTrack,
    checkChildTrack,
  },
};
