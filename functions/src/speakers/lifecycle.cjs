'use strict';

/**
 * Speaker delete / unlink and the users.speakerId ↔ speakers.uid pair
 * (spec §4.3 seams #2 and #3, §9 "Speaker delete / unlink", issue #20).
 *
 * Replaces `cmsDeleteSpeaker` + `cleanupRevokedInviteSessionIds` + eight
 * reconciliation scripts with ONE transaction.
 *
 * Seam #2 — **speaker delete is an atomic unlink.** `deleteSpeaker` runs a
 * single transaction that:
 *
 *   1. queries `cmsSchedule.where('speakerIds','array-contains', id)` and
 *      removes the id from every session it names,
 *   2. does the same for `cmsSchedule_drafts` — a draft is a session save
 *      waiting to happen, and seam #1 REJECTS a save naming a missing
 *      speaker, so a dangling draft reference would make the session
 *      un-saveable until an admin hand-edited it,
 *   3. clears `users/{uid}.speakerId` when `speakers.uid` is set,
 *   4. deletes `speakers_public/{id}`,
 *   5. deletes `speakers/{id}`.
 *
 * Above the transaction's write limit the operation REFUSES, naming the
 * count, and directs the admin to the soft delete
 * (`speakers.status = 'removed'`), which hides the speaker everywhere —
 * the projection trigger removes `speakers_public` — without touching
 * sessions. A speaker on 500-plus sessions is not a real case, but failing
 * loudly beats a half-applied unlink.
 *
 * Seam #3 — **the `users.speakerId` ↔ `speakers.uid` pair is written only
 * by the invite/acceptance transaction and by `deleteSpeaker`.** Both
 * halves are set or cleared in the SAME commit, never independently.
 * `linkSpeakerToUser` / `unlinkSpeakerFromUser` below are that primitive;
 * the invite pipeline (issue #21) calls them rather than writing either
 * document itself, and the admin CRUD in ./profile.cjs rejects `uid` in a
 * payload by name. firestore.rules already makes both documents
 * server-write-only, so there is no client path that can set one half.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction, isValidDocId } = require('../cms/store.cjs');

const SPEAKERS = 'speakers';
const SPEAKERS_PUBLIC = 'speakers_public';
const SESSIONS = 'cmsSchedule';
const SESSION_DRAFTS = 'cmsSchedule_drafts';
const USERS = 'users';

/**
 * Firestore's per-transaction write ceiling. The unlink spends up to three
 * writes on the speaker itself (user link, projection, record), so the
 * session budget is what is left.
 */
const MAX_TRANSACTION_WRITES = 500;
const FIXED_WRITES = 3;
const MAX_UNLINKED_SESSIONS = MAX_TRANSACTION_WRITES - FIXED_WRITES;

/** Sessions in one collection referencing `speakerId`, read in `tx`. */
async function readReferencingSessions({ tx, db, collection, speakerId }) {
  const snap = await tx.get(
    db.collection(collection).where('speakerIds', 'array-contains', speakerId),
  );
  return snap.docs.map((doc) => ({
    ref: doc.ref ?? db.collection(collection).doc(doc.id),
    id: doc.id,
    speakerIds: Array.isArray(doc.data()?.speakerIds) ? doc.data().speakerIds : [],
  }));
}

/**
 * Delete a speaker, or soft-delete them.
 *
 * The unlink writes each session's filtered `speakerIds` array rather than
 * an `arrayRemove` sentinel: the array was read inside this same
 * transaction, so the filtered value is exactly as safe against concurrent
 * writes as the sentinel would be, and it keeps this module free of a
 * firebase-admin import (house rule — the injected db is the only Firestore
 * seam).
 *
 * @param {{ db: object, speakerId: unknown, soft?: boolean,
 *           actor: { uid: string, email: string }, now?: () => number }} args
 * @returns {Promise<{ ok: true, mode: 'hard'|'soft', speakerId: string,
 *                     unlinkedSessions: string[], unlinkedDrafts: string[],
 *                     clearedUid: string|null } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyDeleteSpeaker({ db, speakerId, soft = false, actor, now = Date.now }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  const at = new Date(now());
  const speakerRef = db.collection(SPEAKERS).doc(speakerId);
  const publicRef = db.collection(SPEAKERS_PUBLIC).doc(speakerId);

  let outcome;
  try {
    outcome = await db.runTransaction(async (tx) => {
      const speakerSnap = await tx.get(speakerRef);
      if (!speakerSnap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
        throw err;
      }
      const speaker = speakerSnap.data();

      if (soft) {
        // The soft delete deliberately does NOT touch sessions: the whole
        // point of the fallback is that it fits in one write. The
        // projection trigger sees `removed` and deletes speakers_public,
        // so the speaker disappears from every public surface; the
        // sessions keep a reference to a record that still exists, so
        // seam #1 stays satisfiable.
        tx.set(speakerRef, { status: 'removed', updatedAt: at, updatedBy: actor.email }, { merge: true });
        return { mode: 'soft', unlinkedSessions: [], unlinkedDrafts: [], clearedUid: null };
      }

      const linkedUid = typeof speaker.uid === 'string' && speaker.uid ? speaker.uid : null;
      const userRef = linkedUid ? db.collection(USERS).doc(linkedUid) : null;
      // Every read before every write — Firestore transactions require it,
      // and the user read must be part of this transaction so the pair is
      // cleared against the state the delete actually saw.
      const [sessions, drafts, userSnap] = await Promise.all([
        readReferencingSessions({ tx, db, collection: SESSIONS, speakerId }),
        readReferencingSessions({ tx, db, collection: SESSION_DRAFTS, speakerId }),
        userRef ? tx.get(userRef) : Promise.resolve(null),
      ]);

      const referenceCount = sessions.length + drafts.length;
      if (referenceCount > MAX_UNLINKED_SESSIONS) {
        const err = new Error('TOO_MANY_REFERENCES');
        err.conflict = {
          status: 409,
          code: 'too-many-references',
          message:
            `This speaker is referenced by ${referenceCount} session documents, more than the ` +
            `${MAX_UNLINKED_SESSIONS} a single transaction can unlink. Nothing was changed. ` +
            'Retry with { "soft": true } to mark the speaker removed, which hides them everywhere ' +
            'without touching sessions.',
        };
        throw err;
      }

      for (const session of [...sessions, ...drafts]) {
        tx.set(
          session.ref,
          { speakerIds: session.speakerIds.filter((id) => id !== speakerId) },
          { merge: true },
        );
      }
      // Both halves of the pair in the same commit (seam #3). A `uid` that
      // names an account which no longer exists clears nothing rather than
      // failing the delete — the link is already broken in that direction.
      if (userRef && userSnap?.exists) {
        tx.set(userRef, { speakerId: null, updatedAt: at }, { merge: true });
      }
      tx.delete(publicRef);
      tx.delete(speakerRef);

      return {
        mode: 'hard',
        unlinkedSessions: sessions.map((s) => s.id),
        unlinkedDrafts: drafts.map((s) => s.id),
        clearedUid: userSnap?.exists ? linkedUid : null,
      };
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    throw err;
  }

  return { ok: true, speakerId, ...outcome };
}

/**
 * Set both halves of the `users.speakerId` ↔ `speakers.uid` pair in one
 * commit (seam #3). The invite/acceptance transaction (issue #21) is the
 * intended caller; nothing else may write either field.
 *
 * @param {{ db: object, speakerId: string, uid: string, now?: () => number }} args
 * @returns {Promise<{ ok: true } | { ok: false, status: number, code: string, message: string }>}
 */
async function linkSpeakerToUser({ db, speakerId, uid, now = Date.now }) {
  return writeSpeakerLink({ db, speakerId, uid, now });
}

/**
 * Clear both halves of the pair in one commit. Used when an invite is
 * revoked or an account is unlinked; `deleteSpeaker` does the same work
 * inline because it must happen in the transaction that removes the
 * speaker.
 *
 * @param {{ db: object, speakerId: string, now?: () => number }} args
 */
async function unlinkSpeakerFromUser({ db, speakerId, now = Date.now }) {
  return writeSpeakerLink({ db, speakerId, uid: null, now });
}

async function writeSpeakerLink({ db, speakerId, uid, now }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  if (uid !== null && !isValidDocId(uid)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'uid: required' };
  }
  const at = new Date(now());
  const speakerRef = db.collection(SPEAKERS).doc(speakerId);

  try {
    await db.runTransaction(async (tx) => {
      const speakerSnap = await tx.get(speakerRef);
      if (!speakerSnap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
        throw err;
      }
      const previousUid = typeof speakerSnap.data().uid === 'string' ? speakerSnap.data().uid : null;
      const targetUid = uid;

      // Reads first, all of them: the account losing the link and the one
      // gaining it are both read before anything is written.
      const refs = [...new Set([previousUid, targetUid].filter(Boolean))]
        .map((id) => [id, db.collection(USERS).doc(id)]);
      const snaps = await Promise.all(refs.map(([, ref]) => tx.get(ref)));

      snaps.forEach((snap, i) => {
        const [id, ref] = refs[i];
        if (!snap.exists) return;
        tx.set(ref, { speakerId: id === targetUid ? speakerId : null, updatedAt: at }, { merge: true });
      });
      tx.set(speakerRef, { uid: targetUid, updatedAt: at }, { merge: true });
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    throw err;
  }
  return { ok: true };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createDeleteSpeakerHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function deleteSpeaker(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const actor = { uid: gate.uid, email: gate.email };

    const soft = req.body?.soft;
    if (soft !== undefined && typeof soft !== 'boolean') {
      return badRequest(res, 'soft: must be true or false');
    }

    let result;
    try {
      result = await applyDeleteSpeaker({
        db,
        speakerId: req.body?.speakerId,
        soft: soft === true,
        actor,
        now,
      });
    } catch (err) {
      log.error('deleteSpeaker failed', err);
      return internal(res, 'The speaker could not be deleted.');
    }
    if (!result.ok) {
      return result.status === 404
        ? notFound(res, result.message)
        : sendError(res, result.status, result.code, result.message);
    }
    await logAdminAction({
      db,
      action: result.mode === 'soft' ? 'softDeleteSpeaker' : 'deleteSpeaker',
      docPath: `${SPEAKERS}/${result.speakerId}`,
      actor,
      now,
      log,
    });
    res.status(200).json({
      speakerId: result.speakerId,
      mode: result.mode,
      unlinkedSessions: result.unlinkedSessions,
      unlinkedDrafts: result.unlinkedDrafts,
      clearedUid: result.clearedUid,
    });
  };
}

/** Deployable exports (spec §1.3 speakers/): deleteSpeaker. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    deleteSpeaker: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      const handled = applyCors(req, res, {
        allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
        methods: ['POST'],
      });
      if (handled) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await createDeleteSpeakerHandler({
        db,
        auth: getAuth(),
        getConfig: () => getEventConfig({ db }),
      })(req, res);
    }),
  };
}

module.exports = {
  applyDeleteSpeaker,
  linkSpeakerToUser,
  unlinkSpeakerFromUser,
  createDeleteSpeakerHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    SPEAKERS,
    SPEAKERS_PUBLIC,
    SESSIONS,
    SESSION_DRAFTS,
    USERS,
    MAX_TRANSACTION_WRITES,
    MAX_UNLINKED_SESSIONS,
    readReferencingSessions,
  },
};
