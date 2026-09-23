'use strict';

/**
 * Attendee administration beyond approve and revoke (issue #185).
 *
 *   updateAttendee  POST { uid, pastAttendance } — staff tier. Writes the
 *                   organizer-owned fields of an account (ORGANIZER_OWNED_FIELDS)
 *                   and nothing else.
 *   deleteAttendee  POST { uid } — staff tier. A guarded delete that takes
 *                   the account out of the directory atomically, then clears
 *                   every other per-account store.
 *
 * ORGANIZER-OWNED FIELDS. `pastAttendance` is the one field of the approved
 * export set that no other process writes: the attendee owns their profile
 * fields (the rules allowlist, SELF_EDITABLE_PROFILE_FIELDS), and the
 * registration and speaker processes own theirs. The rules deny it to every
 * client by omission from `editsOnlySelfProfileFields` — its owner
 * included, to set or to remove — and admins have no client write on
 * `users` at all, so this endpoint is its only writer. It is not on
 * PUBLIC_PROFILE_FIELDS, so it never reaches `users_public`.
 *
 * THE DELETE, in two phases, both inline in the request. No queue and no
 * scheduled retry (CONTRIBUTING.md, "There is exactly one queue"): the
 * admin retries a part-way delete from the page, and every step is
 * idempotent.
 *
 *   1. One transaction reads the account, the admin lists, and the claimed
 *      tickets, and checks the guards on THAT read: not the caller, not an
 *      admin address, not linked to a speaker. The invite acceptance and
 *      deleteSpeaker transactions read the same account document, so a
 *      concurrent link aborts one side instead of racing the guard (seam
 *      #3, speakers/lifecycle.cjs). The commit deletes the account, its
 *      directory profile, and its schedule share, releases its ticket
 *      claims, and writes the audit row — together. After it, the account
 *      is out of the directory.
 *   2. The sweep deletes the sign-in, the saved sessions (lowering each
 *      session's count), the private notes, and the profile photo files.
 *      These can outgrow one transaction's 500-write ceiling, which would
 *      strand an account that could never be deleted, so they run after
 *      the commit, each step on its own.
 *
 * A call for an account whose document is already gone takes the RESUME
 * path: it re-checks the guards against the sign-in if one remains, writes
 * its own audit row first, and runs the sweep again. It answers 404 only
 * when nothing of the account remains.
 *
 * Approve and revoke (approval.cjs) are not touched.
 */

const { requireAdmin, resolveAdminTier } = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const {
  internals: { readUid },
} = require('./approval.cjs');

const USERS = 'users';
const ADMIN_LOGS = 'admin_logs';

/**
 * The account fields an organizer owns and the attendee cannot change. The
 * rules deny each of them to the owner by leaving it off the self-edit
 * allowlist; tests/firestore.rules.test.js pins that for every name here.
 */
const ORGANIZER_OWNED_FIELDS = Object.freeze(['pastAttendance']);

/** Limits on the past attendance list. */
const MAX_PAST_ATTENDANCE = 20;
const MAX_EDITION_LENGTH = 40;
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Every per-account store an attendee delete clears besides `users/{uid}`
 * itself, in the order the delete runs them. ONE list: the transaction, the
 * sweep, the resume check, the write budget, and the `removed` counts all
 * read it, so a store added later is added HERE and nowhere else. (The
 * change request queue adds `change_requests` and
 * `change_request_rate_limits/{uid}` when it lands.)
 *
 *   phase 'directory' — cleared in the transaction that deletes the account,
 *                       so the person leaves the directory in one commit.
 *   phase 'sweep'     — cleared after that commit, idempotently, and again
 *                       on a resumed delete.
 *
 *   kind 'doc'        — the document `{collection}/{uid}`.
 *   kind 'claim'      — every `{collection}` document whose `{field}` is the
 *                       uid. The document stays; the claim fields are set
 *                       to null, the shape ticketing/sync.cjs creates.
 *   kind 'counted'    — `users/{uid}/{subcollection}`, each member lowering
 *                       `{counter}/{memberId}.count` (never below 0).
 *   kind 'subcollection' — `users/{uid}/{subcollection}`.
 *   kind 'files'      — Storage objects under `{prefix}/{uid}/`.
 *
 * `key` names the store's count in the response's `removed`.
 */
const PER_ACCOUNT_STORES = Object.freeze([
  { phase: 'directory', kind: 'doc', collection: 'users_public' },
  { phase: 'directory', kind: 'doc', collection: 'schedule_shares' },
  {
    phase: 'directory',
    kind: 'claim',
    collection: 'tickets',
    field: 'claimedByUid',
    clear: ['claimedByUid', 'claimedAt'],
    key: 'tickets',
  },
  { phase: 'sweep', kind: 'counted', subcollection: 'bookmarks', counter: 'sessionBookmarks', key: 'bookmarks' },
  { phase: 'sweep', kind: 'subcollection', subcollection: 'sessionNotes', key: 'notes' },
  { phase: 'sweep', kind: 'files', prefix: 'profile-photos', key: 'photos' },
]);

/** Firestore's per-transaction write ceiling. */
const MAX_TRANSACTION_WRITES = 500;
/**
 * Sweep page sizes: a counted member costs two writes, a note one. Every
 * sweep reads one page, clears it, and reads again until a page comes back
 * empty, because the owner can create notes and photo files without limit
 * and one read of all of them could exhaust the function's memory.
 */
const COUNTED_CHUNK = 200;
const SUBCOLLECTION_CHUNK = 400;
const FILES_CHUNK = 500;

const DIRECTORY_STORES = PER_ACCOUNT_STORES.filter((store) => store.phase === 'directory');
const SWEEP_STORES = PER_ACCOUNT_STORES.filter((store) => store.phase === 'sweep');

/**
 * The writes phase 1 spends before any claim: the account, the audit row,
 * and one per directory document. What is left is the claim budget.
 */
const FIXED_DIRECTORY_WRITES = 2 + DIRECTORY_STORES.filter((store) => store.kind === 'doc').length;
const MAX_RELEASED_CLAIMS = MAX_TRANSACTION_WRITES - FIXED_DIRECTORY_WRITES;

const DELETE_INCOMPLETE_MESSAGE =
  'The account is out of the directory. Some of its data could not be cleared. Try again.';

const REFUSALS = Object.freeze({
  self: { status: 409, code: 'own-account', message: 'You cannot delete your own account.' },
  admin: {
    status: 409,
    code: 'admin-account',
    message: 'This account has admin access. An operator must remove that access before the account can be deleted.',
  },
  speaker: {
    status: 409,
    code: 'speaker-linked',
    message: 'This account is linked to a speaker. Delete the speaker record first.',
  },
});

// ------------------------------------------------------------ updateAttendee

/**
 * Validate an updateAttendee body. Every problem is named, in the
 * `field: reason` form the admin client splits (adminApi.js fieldErrorsOf).
 *
 * @param {unknown} body
 * @returns {{ ok: true, uid: string, pastAttendance: string[] } | { ok: false, errors: string[] }}
 */
function readUpdateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body: must be a JSON object with uid and pastAttendance.'] };
  }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (key === 'uid' || ORGANIZER_OWNED_FIELDS.includes(key)) continue;
    errors.push(`${String(key).slice(0, 60)}: cannot be set here. Only pastAttendance is an organizer field.`);
  }
  const uid = readUid(body.uid);
  if (!uid) errors.push('uid: is required.');

  const pastAttendance = [];
  const raw = body.pastAttendance;
  if (!Array.isArray(raw)) {
    errors.push('pastAttendance: must be a list of editions.');
  } else if (raw.length > MAX_PAST_ATTENDANCE) {
    errors.push(`pastAttendance: at most ${MAX_PAST_ATTENDANCE} editions.`);
  } else {
    const seen = new Set();
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        errors.push('pastAttendance: every edition must be text.');
        break;
      }
      const text = entry.trim();
      if (text.length === 0) {
        errors.push('pastAttendance: an edition cannot be blank.');
        break;
      }
      if (CONTROL_CHARACTERS.test(text)) {
        errors.push('pastAttendance: an edition cannot contain a line break, a tab, or another control character.');
        break;
      }
      if ([...text].length > MAX_EDITION_LENGTH) {
        errors.push(`pastAttendance: "${text.slice(0, MAX_EDITION_LENGTH)}…" is longer than ${MAX_EDITION_LENGTH} characters.`);
        break;
      }
      const folded = text.toLowerCase();
      if (seen.has(folded)) {
        errors.push(`pastAttendance: "${text}" is listed twice.`);
        break;
      }
      seen.add(folded);
      pastAttendance.push(text);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, uid, pastAttendance };
}

/**
 * Merge the organizer fields into the account, in a transaction that reads
 * it first so a missing account is a 404 and never a created one.
 *
 * @param {{ db: object, uid: string, pastAttendance: string[], now?: () => Date }} args
 * @returns {Promise<{ ok: true } | { ok: false }>}
 */
async function applyUpdateAttendee({ db, uid, pastAttendance, now = () => new Date() }) {
  const ref = db.collection(USERS).doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false };
    tx.set(ref, { pastAttendance, updatedAt: now() }, { merge: true });
    return { ok: true };
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: object }} deps
 */
function createUpdateAttendeeHandler({ db, auth, getConfig, now = () => new Date(), log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const request = readUpdateRequest(req.body);
    if (!request.ok) return badRequest(res, request.errors.join('; '));
    const { uid, pastAttendance } = request;

    let result;
    try {
      result = await applyUpdateAttendee({ db, uid, pastAttendance, now });
    } catch (err) {
      log.error('updateAttendee failed', err);
      return internal(res, 'The record could not be saved. Try again.');
    }
    if (!result.ok) return notFound(res, 'No such account.');

    // Best effort, the same contract as approveUser.
    await logAdminAction({ db, action: 'updateAttendee', docPath: `${USERS}/${uid}`, actor: verdict, now, log });

    res.status(200).json({ ok: true, uid, pastAttendance });
  };
}

// ------------------------------------------------------------ deleteAttendee

/** @param {unknown} value @returns {string} lowercased address or '' */
function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** True when `code` is Firebase Auth's "no such user". */
function isUserNotFound(err) {
  return err?.code === 'auth/user-not-found' || err?.errorInfo?.code === 'auth/user-not-found';
}

/**
 * The sign-in, if one remains.
 *
 * @param {{ auth: object, uid: string }} args
 * @returns {Promise<{ exists: boolean, email: string }>}
 */
async function readSignIn({ auth, uid }) {
  try {
    const record = await auth.getUser(uid);
    return { exists: true, email: normalizedEmail(record?.email) };
  } catch (err) {
    if (isUserNotFound(err)) return { exists: false, email: '' };
    throw err;
  }
}

/** Whether either address is on either admin list of `bootstrap`. */
function holdsAdminAccess(bootstrap, emails) {
  return emails.some((email) => email && resolveAdminTier(bootstrap, email) !== null);
}

/**
 * Phase 1: the guarded, atomic removal from the directory.
 *
 * @param {{ db: object, uid: string, signInEmail: string,
 *           actor: { uid: string, email: string }, now: () => Date }} args
 * @returns {Promise<{ outcome: 'deleted', released: Record<string, number> } |
 *                   { outcome: 'absent' } |
 *                   { outcome: 'refused', refusal: { status: number, code: string, message: string } }>}
 */
async function removeFromDirectory({ db, uid, signInEmail, actor, now }) {
  const userRef = db.collection(USERS).doc(uid);
  const bootstrapRef = db.collection('config').doc('bootstrap');

  return db.runTransaction(async (tx) => {
    // Every read first, as Firestore requires.
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return { outcome: 'absent' };
    const bootstrapSnap = await tx.get(bootstrapRef);
    const claims = [];
    for (const store of DIRECTORY_STORES) {
      if (store.kind !== 'claim') continue;
      const snap = await tx.get(db.collection(store.collection).where(store.field, '==', uid));
      claims.push({ store, docs: snap.docs });
    }

    const user = userSnap.data() || {};
    const bootstrap = bootstrapSnap.exists ? bootstrapSnap.data() : null;
    if (holdsAdminAccess(bootstrap, [normalizedEmail(user.email), signInEmail])) {
      return { outcome: 'refused', refusal: REFUSALS.admin };
    }
    if (typeof user.speakerId === 'string' ? user.speakerId.length > 0 : user.speakerId != null) {
      return { outcome: 'refused', refusal: REFUSALS.speaker };
    }
    const claimCount = claims.reduce((sum, { docs }) => sum + docs.length, 0);
    if (claimCount > MAX_RELEASED_CLAIMS) {
      return {
        outcome: 'refused',
        refusal: {
          status: 409,
          code: 'too-many-claims',
          message: `This account holds ${claimCount} claimed tickets. One delete can release at most ${MAX_RELEASED_CLAIMS}.`,
        },
      };
    }

    const at = now();
    const released = {};
    for (const { store, docs } of claims) {
      const cleared = Object.fromEntries(store.clear.map((field) => [field, null]));
      for (const doc of docs) tx.set(doc.ref, { ...cleared, updatedAt: at }, { merge: true });
      released[store.key] = docs.length;
    }
    for (const store of DIRECTORY_STORES) {
      if (store.kind === 'doc') tx.delete(db.collection(store.collection).doc(uid));
    }
    tx.delete(userRef);
    tx.set(db.collection(ADMIN_LOGS).doc(), {
      action: 'deleteAttendee',
      docPath: `${USERS}/${uid}`,
      uid: actor.uid,
      email: actor.email,
      at,
    });
    return { outcome: 'deleted', released };
  });
}

/** One page of `users/{uid}/{name}`, in document id order. */
async function pageOfMembers(db, uid, name, size) {
  const snap = await db.collection(`${USERS}/${uid}/${name}`).orderBy('__name__').limit(size).get();
  return snap.docs;
}

/** One page of the Storage objects under `{prefix}/{uid}/`. */
async function pageOfFiles(bucket, prefix, uid, size) {
  const [files] = await bucket.getFiles({ prefix: `${prefix}/${uid}/`, maxResults: size, autoPaginate: false });
  return Array.isArray(files) ? files : [];
}

/**
 * Remove a counted membership subcollection a page at a time, one
 * transaction per page: it reads each member and its counter, deletes the
 * member, and lowers the count only when the member was still there — so a
 * retried page never lowers a count twice.
 */
async function sweepCounted({ db, uid, store, now }) {
  let removed = 0;
  for (;;) {
    const page = await pageOfMembers(db, uid, store.subcollection, COUNTED_CHUNK);
    if (page.length === 0) return removed;
    removed += await db.runTransaction(async (tx) => {
      const memberRefs = page.map((member) => member.ref);
      const counterRefs = page.map((member) => db.collection(store.counter).doc(member.id));
      const memberSnaps = await tx.getAll(...memberRefs);
      const counterSnaps = await tx.getAll(...counterRefs);
      const at = now();
      let count = 0;
      memberSnaps.forEach((memberSnap, index) => {
        if (!memberSnap.exists) return;
        count += 1;
        tx.delete(memberRefs[index]);
        const counterSnap = counterSnaps[index];
        if (!counterSnap.exists) return;
        const stored = counterSnap.data()?.count;
        const current = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
        tx.set(counterRefs[index], { count: Math.max(0, current - 1), updatedAt: at }, { merge: true });
      });
      return count;
    });
  }
}

/** Delete a plain subcollection a page at a time, one batch per page. */
async function sweepSubcollection({ db, uid, store }) {
  let removed = 0;
  for (;;) {
    const page = await pageOfMembers(db, uid, store.subcollection, SUBCOLLECTION_CHUNK);
    if (page.length === 0) return removed;
    const batch = db.batch();
    for (const member of page) batch.delete(member.ref);
    await batch.commit();
    removed += page.length;
  }
}

/** Delete the Storage objects under the store's prefix, a page at a time. */
async function sweepFiles({ getBucket, uid, store }) {
  const bucket = getBucket();
  let removed = 0;
  for (;;) {
    const files = await pageOfFiles(bucket, store.prefix, uid, FILES_CHUNK);
    if (files.length === 0) return removed;
    for (const file of files) await file.delete({ ignoreNotFound: true });
    removed += files.length;
  }
}

const SWEEPERS = Object.freeze({
  counted: sweepCounted,
  subcollection: sweepSubcollection,
  files: sweepFiles,
});

/** Whether a sweep store still holds anything for the account. */
async function holdsAnything({ db, getBucket, uid, store }) {
  if (store.kind === 'files') return (await pageOfFiles(getBucket(), store.prefix, uid, 1)).length > 0;
  return (await pageOfMembers(db, uid, store.subcollection, 1)).length > 0;
}

/**
 * Phase 2: every step on its own, every step idempotent. A failed step does
 * not stop the next one; the caller reports the delete incomplete and the
 * admin's retry takes the resume path.
 *
 * @returns {Promise<{ removed: Record<string, number>, failed: string[] }>}
 */
async function sweepAccount({ db, auth, getBucket, uid, now, log }) {
  const removed = {};
  const failed = [];

  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (!isUserNotFound(err)) {
      failed.push('sign-in');
      log.error('deleteAttendee: the sign-in could not be deleted', err);
    }
  }

  for (const store of SWEEP_STORES) {
    const sweep = SWEEPERS[store.kind];
    if (!sweep) throw new TypeError(`deleteAttendee: no sweep for store kind "${store.kind}"`);
    try {
      removed[store.key] = await sweep({ db, getBucket, uid, store, now });
    } catch (err) {
      removed[store.key] = 0;
      failed.push(store.key);
      log.error(`deleteAttendee: the ${store.key} could not be cleared`, err);
    }
  }
  return { removed, failed };
}

/**
 * Whether anything of an account whose document is gone remains. A store
 * that cannot be checked counts as remaining: the resume path then runs,
 * and a sweep that still fails says so.
 */
async function anythingRemains({ db, getBucket, uid, signIn, log }) {
  if (signIn.exists) return true;
  for (const store of SWEEP_STORES) {
    try {
      if (await holdsAnything({ db, getBucket, uid, store })) return true;
    } catch (err) {
      log.error(`deleteAttendee: the ${store.key} could not be checked`, err);
      return true;
    }
  }
  return false;
}

/** The `removed` counts, zero for a store this call did not touch. */
function removedCounts(...parts) {
  const out = {};
  for (const store of PER_ACCOUNT_STORES) if (store.key) out[store.key] = 0;
  for (const part of parts) {
    for (const [key, value] of Object.entries(part || {})) out[key] = value;
  }
  return out;
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           getBucket: () => object, now?: () => Date, log?: object }} deps
 */
function createDeleteAttendeeHandler({
  db, auth, getConfig, getBucket, now = () => new Date(), log = console,
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return badRequest(res, 'body: must be a JSON object with uid.');
    }
    const extra = Object.keys(body).filter((key) => key !== 'uid');
    if (extra.length > 0) {
      return badRequest(res, extra.map((key) => `${String(key).slice(0, 60)}: is not accepted. Send uid only.`).join('; '));
    }
    const uid = readUid(body.uid);
    if (!uid) return badRequest(res, 'uid: is required.');

    const refuse = ({ status, code, message }) => sendError(res, status, code, message);
    if (uid === verdict.uid) return refuse(REFUSALS.self);

    let signIn;
    try {
      signIn = await readSignIn({ auth, uid });
    } catch (err) {
      log.error('deleteAttendee: the sign-in could not be read', err);
      return internal(res, 'The account could not be checked. Try again.');
    }
    if (signIn.exists && signIn.email && signIn.email === verdict.email) return refuse(REFUSALS.self);

    let phase1;
    try {
      phase1 = await removeFromDirectory({ db, uid, signInEmail: signIn.email, actor: verdict, now });
    } catch (err) {
      log.error('deleteAttendee: the account could not be removed', err);
      return internal(res, 'The account could not be deleted. Nothing was removed. Try again.');
    }
    if (phase1.outcome === 'refused') return refuse(phase1.refusal);

    if (phase1.outcome === 'absent') {
      // Resume. The account document is gone (an earlier delete got this
      // far), so the guards run against the sign-in, if one remains.
      if (signIn.exists) {
        let bootstrap;
        try {
          const snap = await db.collection('config').doc('bootstrap').get();
          bootstrap = snap.exists ? snap.data() : null;
        } catch (err) {
          log.error('deleteAttendee: config/bootstrap could not be read', err);
          return internal(res, 'The account could not be checked. Try again.');
        }
        if (holdsAdminAccess(bootstrap, [signIn.email])) return refuse(REFUSALS.admin);
      }
      if (!(await anythingRemains({ db, getBucket, uid, signIn, log }))) {
        return notFound(res, 'No such account.');
      }
      // The resumed delete records itself BEFORE it removes anything.
      try {
        await db.collection(ADMIN_LOGS).doc().set({
          action: 'deleteAttendee',
          docPath: `${USERS}/${uid}`,
          uid: verdict.uid,
          email: verdict.email,
          at: now(),
          details: { resumed: true },
        });
      } catch (err) {
        log.error('deleteAttendee: the resumed delete could not be recorded; nothing was removed', err);
        return internal(res, 'The delete could not be recorded, so nothing was removed. Try again.');
      }
    }

    const { removed, failed } = await sweepAccount({ db, auth, getBucket, uid, now, log });
    if (failed.length > 0) {
      log.error(`deleteAttendee: incomplete; failed steps: ${failed.join(', ')}`);
      return sendError(res, 500, 'delete-incomplete', DELETE_INCOMPLETE_MESSAGE);
    }

    res.status(200).json({
      ok: true,
      uid,
      removed: removedCounts(phase1.outcome === 'deleted' ? phase1.released : {}, removed),
    });
  };
}

/** Deployable exports (spec §1.3 users/): updateAttendee, deleteAttendee. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  const buildAdminDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const { getBucket } = require('../core/storage.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), getBucket: () => getBucket() };
  };

  return {
    updateAttendee: onRequest({ region }, withCors(async (req, res) => {
      await createUpdateAttendeeHandler(buildAdminDeps())(req, res);
    })),
    deleteAttendee: onRequest({ region }, withCors(async (req, res) => {
      await createDeleteAttendeeHandler(buildAdminDeps())(req, res);
    })),
  };
}

module.exports = {
  ORGANIZER_OWNED_FIELDS,
  PER_ACCOUNT_STORES,
  createUpdateAttendeeHandler,
  createDeleteAttendeeHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    readUpdateRequest,
    removeFromDirectory,
    sweepAccount,
    MAX_RELEASED_CLAIMS,
    MAX_PAST_ATTENDANCE,
    MAX_EDITION_LENGTH,
    DELETE_INCOMPLETE_MESSAGE,
  },
};
