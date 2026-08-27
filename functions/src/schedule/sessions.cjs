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
 *             session. A session with no track runs on its own.
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

/** The live sessions collection and its draft sibling (§8.4). */
const SESSIONS = 'cmsSchedule';
const SESSIONS_DRAFTS = 'cmsSchedule_drafts';

/** A session document id: no slashes, no dots — a Firestore path segment. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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
    if (typeof parentId !== 'string' || !SESSION_ID_RE.test(parentId)) {
      errors.push(`parentId: must be a session document id, got ${JSON.stringify(parentId)}`);
    } else if (parentId === docId) {
      errors.push(`parentId: a session cannot be its own parent ("${docId}")`);
    }
  }
  return { ok: errors.length === 0, errors };
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
 * The parent reference, checked against what is actually stored. Reads run
 * inside the caller's transaction for the same reason the speaker seam's
 * do: a check in a separate round trip is only advisory, and the write it
 * guards can land after the world it checked has moved.
 *
 * Four refusals, each naming what is wrong:
 *
 *   - the parent does not exist (an orphan);
 *   - the parent is itself a child (depth is one);
 *   - the parent runs on another day (a child inherits its parent's day);
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
 * Both halves in one call, shape before reads.
 *
 * @param {{ db: object, tx?: object, docId: string, fields: object }} args
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function validateSessionStructure({ db, tx = null, docId, fields }) {
  const shape = validateSessionShape(fields, docId);
  if (!shape.ok) return { ok: false, message: shape.errors.join('; ') };
  const parent = await checkSessionParent({ db, tx, docId, fields });
  if (!parent.ok) return { ok: false, message: parent.errors.join('; ') };
  return { ok: true };
}

module.exports = {
  validateSessionShape,
  checkSessionParent,
  validateSessionStructure,
  internals: { SESSIONS, SESSIONS_DRAFTS, SESSION_ID_RE, findChildIds, readSession },
};
