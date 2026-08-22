'use strict';

/**
 * Admin CRUD over the canonical `speakers/{speakerId}` store
 * (spec §4.3, issue #20).
 *
 *   createSpeaker  admin POST — a new canonical record; 409 if the id or
 *                  the slug is taken
 *   updateSpeaker  admin POST — a partial merge onto an existing record
 *
 * Deletion is ./lifecycle.cjs (`deleteSpeaker`), because it is not a write
 * to one document: it is the atomic unlink of every reference to it.
 *
 * `speakers` is NOT part of the two-revision publish model (§8.4). A
 * speaker is not site copy with a draft and a live revision; it is one
 * record with a pipeline `status`, and the public surface is the
 * `speakers_public` projection the onSpeakerWritten trigger maintains. So
 * these handlers write the canonical document directly and never touch
 * `speakers_public` — the projection is one-way, and a handler that wrote
 * both would be the copied-data drift §4.3 exists to remove.
 *
 * Validation, the editable/server-owned field split, and the status
 * vocabulary all live in packages/shared/src/speaker.cjs so the demo
 * fixture and the web app cannot drift from the server.
 */

const { requireAdmin, verifyAuthToken } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction, isValidDocId, isAlreadyExistsError } = require('../cms/store.cjs');
const { validateSpeaker, SELF_EDITABLE_SPEAKER_FIELDS } = require('shared/speaker');
const { generateSpeakerSlug } = require('shared/slug');
const { readLinkedUser } = require('./lifecycle.cjs');

const SPEAKERS = 'speakers';
/**
 * Slug reservations: `speaker_slugs/{slug}` holds `{ speakerId }`.
 *
 * A `where('slug','==',x)` query inside a transaction is NOT a lock — a
 * query that matches nothing puts nothing in the read set, so two
 * concurrent creates of different documents can both see the slug free and
 * both commit it. A document at a DETERMINISTIC id is the lock: Firestore
 * tracks the non-existence of a document that was read, so the second
 * transaction aborts, and `create()` refuses outright on the retry.
 *
 * Server-only (firestore.rules); nothing reads it but these handlers.
 */
const SPEAKER_SLUGS = 'speaker_slugs';

/** Defaults a brand-new canonical record carries for every optional field. */
function newSpeakerDefaults() {
  return {
    email: null,
    bio: '',
    headshotPath: null,
    organization: '',
    jobTitle: '',
    socialHandles: {},
    status: 'draft',
  };
}

/** Shared admin-POST preamble. Sends the response itself on failure. */
async function gateAdminPost({ auth, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, getConfig }, req);
  if (!verdict.ok) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return null;
  }
  return { uid: verdict.uid, email: verdict.email };
}

/**
 * Another speaker already holding `slug`, or null.
 *
 * Slugs address the public speaker page, so two speakers cannot share one.
 * TWO checks, both inside the caller's transaction, because they catch
 * different things:
 *
 *   1. The `speaker_slugs/{slug}` reservation document. This is the actual
 *      lock — reading a deterministic id puts its (non-)existence in the
 *      transaction's read set, so concurrent creates serialize.
 *   2. A `where('slug','==',…)` query over `speakers`. This is NOT a lock
 *      (an empty query result locks nothing), but it still catches a
 *      record written outside these handlers — a seed script, a console
 *      edit, anything predating reservations — which the reservation
 *      collection knows nothing about.
 *
 * @param {{ tx: object, db: object, slug: string, exceptId?: string }} args
 * @returns {Promise<string|null>} the conflicting doc id
 */
async function findSlugOwner({ tx, db, slug, exceptId = null }) {
  const reservation = await tx.get(db.collection(SPEAKER_SLUGS).doc(slug));
  if (reservation.exists) {
    const owner = reservation.data()?.speakerId;
    if (typeof owner === 'string' && owner && owner !== exceptId) return owner;
  }
  const snap = await tx.get(db.collection(SPEAKERS).where('slug', '==', slug).limit(2));
  for (const doc of snap.docs) {
    if (doc.id !== exceptId) return doc.id;
  }
  return null;
}

/**
 * Create one canonical speaker.
 *
 * The doc id is the caller's `speakerId` when they supplied one, else the
 * slug — human-readable ids make a dangling `speakerIds` entry legible in
 * an admin payload, which is the whole reason §4.3's seam #1 names the id
 * it rejects.
 *
 * @param {{ db: object, speakerId?: unknown, payload: unknown,
 *           actor: { uid: string, email: string }, now?: () => number }} args
 * @returns {Promise<{ ok: true, speakerId: string, docPath: string } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyCreateSpeaker({ db, speakerId, payload, actor, now = Date.now }) {
  const verdict = validateSpeaker(payload);
  if (!verdict.ok) {
    return { ok: false, status: 400, code: 'bad-request', message: verdict.errors.join('; ') };
  }
  const fields = { ...newSpeakerDefaults(), ...verdict.fields };

  let docId;
  if (speakerId === undefined || speakerId === null || speakerId === '') {
    docId = fields.slug;
  } else if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: not a valid document id' };
  } else {
    docId = speakerId;
  }

  const at = new Date(now());
  const ref = db.collection(SPEAKERS).doc(docId);
  const doc = {
    ...fields,
    // Server-owned from here down (§4.3 rule 3). `uid` is one half of the
    // users.speakerId ↔ speakers.uid pair: it is seeded null and only ever
    // moves inside the invite/acceptance transaction or deleteSpeaker,
    // never through this handler.
    uid: null,
    inviteToken: null,
    approvedAt: fields.status === 'approved' ? at : null,
    createdAt: at,
    updatedAt: at,
    updatedBy: actor.email,
  };

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const err = new Error(`ALREADY_EXISTS: ${SPEAKERS}/${docId}`);
        err.conflict = { status: 409, code: 'already-exists', message: `A speaker with id "${docId}" already exists.` };
        throw err;
      }
      const owner = await findSlugOwner({ tx, db, slug: doc.slug });
      if (owner) {
        const err = new Error('SLUG_TAKEN');
        err.conflict = { status: 409, code: 'already-exists', message: `slug: "${doc.slug}" is already used by speaker "${owner}"` };
        throw err;
      }
      // create(), not set(): even if two transactions somehow both read the
      // reservation as free, only one create can land.
      tx.create(db.collection(SPEAKER_SLUGS).doc(doc.slug), { speakerId: docId, updatedAt: at });
      tx.set(ref, doc);
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    if (isAlreadyExistsError(err)) {
      return { ok: false, status: 409, code: 'already-exists', message: `A speaker with id "${docId}" already exists.` };
    }
    throw err;
  }

  return { ok: true, speakerId: docId, docPath: `${SPEAKERS}/${docId}` };
}

/**
 * Merge a partial payload onto an existing speaker.
 *
 * Read-and-write in ONE transaction, because the stored `status` decides
 * whether `approvedAt` is stamped and the slug check must see the same
 * collection the write lands in.
 *
 * @param {{ db: object, speakerId: unknown, payload: unknown,
 *           actor: { uid: string, email: string }, now?: () => number }} args
 * @returns {Promise<{ ok: true, speakerId: string, docPath: string } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyUpdateSpeaker({ db, speakerId, payload, actor, now = Date.now }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  const verdict = validateSpeaker(payload, { partial: true });
  if (!verdict.ok) {
    return { ok: false, status: 400, code: 'bad-request', message: verdict.errors.join('; ') };
  }
  if (Object.keys(verdict.fields).length === 0) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speaker: no editable fields in the payload' };
  }

  const at = new Date(now());
  const ref = db.collection(SPEAKERS).doc(speakerId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
        throw err;
      }
      const stored = snap.data();
      const patch = { ...verdict.fields };

      // A name change with no explicit slug re-derives the slug, so the
      // public URL follows the name instead of silently keeping the old
      // one. An explicit slug in the payload always wins.
      if (patch.slug === undefined && (patch.firstName !== undefined || patch.lastName !== undefined)) {
        const derived = generateSpeakerSlug(
          patch.firstName ?? stored.firstName,
          patch.lastName ?? stored.lastName,
        );
        if (derived) patch.slug = derived;
      }
      const slugMoved = patch.slug !== undefined && patch.slug !== stored.slug;
      if (slugMoved) {
        const owner = await findSlugOwner({ tx, db, slug: patch.slug, exceptId: speakerId });
        if (owner) {
          const err = new Error('SLUG_TAKEN');
          err.conflict = { status: 409, code: 'already-exists', message: `slug: "${patch.slug}" is already used by speaker "${owner}"` };
          throw err;
        }
      }

      // Entering `removed` severs the account link. `users.speakerId !=
      // null` is what firestore.rules reads as "this account is a speaker"
      // — it grants attendee-level access on its own (§3.4) — so a removal
      // that left it set would hide the speaker from the public site while
      // leaving them holding speaker identity and access. Both halves move
      // in this commit, which is the seam-#3 rule: the pair is written by
      // the invite/acceptance transaction and by the delete paths (a
      // soft delete is one), never independently. Read before write.
      const removing = patch.status === 'removed' && stored.status !== 'removed';
      const linked = removing ? await readLinkedUser({ tx, db, speaker: stored }) : null;
      if (removing) patch.uid = null;

      // An admin status edit that moves a speaker OFF `invited` kills the
      // outstanding invitation in this same commit (issue #21). Acceptance
      // already refuses a speaker whose status is not `invited`, so the
      // stale token was inert either way — but leaving it would keep a row
      // reading `pending` in the admin invite list for an invitation nobody
      // can act on, and a later re-invite would then show two live-looking
      // invitations for one speaker. One commit moves both, the same
      // discipline seam #3 applies to the account-link pair.
      //
      // Changing the EMAIL of an invited speaker kills it too, and that one
      // is a security fix rather than tidiness: the outstanding token was
      // mailed to the OLD address, and acceptance authorizes against the
      // address stored here (invites.cjs). Left live, the old recipient
      // could still accept and bind their account — so re-pointing a
      // speaker at a new address would silently hand the old one a working
      // credential for it. Retyping an address is also exactly what an
      // admin does after mistyping it, or after a speaker changes jobs.
      //
      // The speaker drops back to `draft`, which is honest: `draft` is the
      // §4.3 state for "a record that has not been invited", and there is
      // now no invitation outstanding. The admin list then offers Invite
      // again, which mails the new address.
      const emailChanged = patch.email !== undefined &&
        String(patch.email ?? '').toLowerCase() !== String(stored.email ?? '').toLowerCase();
      const leavingInvited = patch.status !== undefined && patch.status !== 'invited';
      if (stored.status === 'invited' && (leavingInvited || emailChanged)) {
        const { invalidateInviteInTx } = require('./inviteTokens.cjs');
        Object.assign(patch, invalidateInviteInTx({
          tx, db, speaker: stored, at, status: 'superseded', actorEmail: actor.email,
        }));
        if (!leavingInvited) patch.status = 'draft';
      }

      // approvedAt is server-owned and records the FIRST approval: stamped
      // only when there is none stored. A speaker who is removed and later
      // re-approved keeps their original date — the field is history, and
      // a later save is not a new fact about when they were first approved.
      if (patch.status === 'approved' && stored.approvedAt == null) {
        patch.approvedAt = at;
      }

      if (slugMoved) {
        tx.set(db.collection(SPEAKER_SLUGS).doc(patch.slug), { speakerId, updatedAt: at });
        if (typeof stored.slug === 'string' && stored.slug) {
          tx.delete(db.collection(SPEAKER_SLUGS).doc(stored.slug));
        }
      }
      if (linked) tx.set(linked.ref, { speakerId: null, updatedAt: at }, { merge: true });
      tx.set(ref, { ...patch, updatedAt: at, updatedBy: actor.email }, { merge: true });
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    throw err;
  }

  return { ok: true, speakerId, docPath: `${SPEAKERS}/${speakerId}` };
}

/**
 * The self-service view of a speaker's OWN record (spec §4.3, §9 "Speaker
 * profile wizard", issue #22). Deliberately narrower than PUBLIC_SPEAKER_FIELDS
 * PLUS PUBLIC_SPEAKER_FIELDS: it adds `status` (so the wizard can say "an
 * organizer is reviewing this" versus "this is live"), but never `email`,
 * `inviteToken`, or `approvedAt` — the module doc's "NOT anonymously or
 * attendee-readable" line applies to the speaker's own client just as much
 * as to anyone else's, so those stay server-side even for the owner.
 *
 * @param {object} speaker stored `speakers/{id}` document
 * @param {string} speakerId
 * @returns {object}
 */
function buildOwnSpeakerView(speaker, speakerId) {
  return {
    speakerId,
    firstName: typeof speaker.firstName === 'string' ? speaker.firstName : '',
    lastName: typeof speaker.lastName === 'string' ? speaker.lastName : '',
    slug: typeof speaker.slug === 'string' ? speaker.slug : '',
    bio: typeof speaker.bio === 'string' ? speaker.bio : '',
    headshotPath: typeof speaker.headshotPath === 'string' && speaker.headshotPath
      ? speaker.headshotPath
      : null,
    organization: typeof speaker.organization === 'string' ? speaker.organization : '',
    jobTitle: typeof speaker.jobTitle === 'string' ? speaker.jobTitle : '',
    socialHandles: speaker.socialHandles && typeof speaker.socialHandles === 'object'
      ? { ...speaker.socialHandles }
      : {},
    status: typeof speaker.status === 'string' ? speaker.status : 'draft',
  };
}

/**
 * Authenticate the caller for the self-service speaker endpoints and decide
 * whether they are acting as an admin. Deliberately does NOT decide
 * ownership of a particular speaker record — that check needs the record
 * itself, which each caller reads on its own (a transaction for the write
 * path, a plain get for the read path), so this only answers "who is this
 * and are they an admin" once per request.
 *
 * @param {{ auth: object, getConfig: () => Promise<object> }} deps
 * @param {object} req
 * @returns {Promise<{ ok: true, uid: string, email: string, isAdmin: boolean } |
 *                    { ok: false, status: 401, code: string, message: string }>}
 */
async function gateSpeakerSelfOrAdmin({ auth, getConfig }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Authentication required.' };
  }
  let isAdmin = false;
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (email && decoded.email_verified === true) {
    const config = await getConfig();
    const adminEmails = Array.isArray(config?.bootstrap?.adminEmails)
      ? config.bootstrap.adminEmails
      : [];
    isAdmin = adminEmails.some(
      (entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email,
    );
  }
  return {
    ok: true,
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : '',
    isAdmin,
  };
}

/**
 * Read the caller's own speaker record (or, for an admin, any record —
 * support and the admin UI both need to see what a speaker currently has
 * without going through the admin CRUD's server-owned fields).
 *
 * @param {{ db: object, speakerId: unknown, uid: string, isAdmin: boolean }} args
 */
async function applyGetOwnSpeakerProfile({ db, speakerId, uid, isAdmin }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  const snap = await db.collection(SPEAKERS).doc(speakerId).get();
  if (!snap.exists) {
    return { ok: false, status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
  }
  const stored = snap.data();
  if (!isAdmin && (typeof stored.uid !== 'string' || !stored.uid || stored.uid !== uid)) {
    return { ok: false, status: 403, code: 'forbidden', message: 'You may only view your own speaker profile.' };
  }
  return { ok: true, speaker: buildOwnSpeakerView(stored, speakerId) };
}

/**
 * Self-service edit of the caller's OWN canonical speaker record — the
 * server half of the profile wizard (spec §4.3, §9, issue #22). Same
 * transaction shape as applyUpdateSpeaker, but:
 *
 *   - the editable surface is SELF_EDITABLE_SPEAKER_FIELDS, enforced by
 *     validateSpeaker's `fieldsAllowed` — a payload naming `slug`, `email`,
 *     `status`, or any SERVER_OWNED_SPEAKER_FIELDS entry is rejected by
 *     name rather than silently dropped;
 *   - the slug is NEVER re-derived here, unlike the admin path: a speaker
 *     correcting their own name must not move their public URL out from
 *     under a link already shared;
 *   - there is no invite-invalidation branch, because neither `email` nor
 *     `status` — the two fields that branch reacts to — is reachable
 *     through this payload at all.
 *
 * Ownership is checked INSIDE the transaction against the record it is
 * about to write, not against a value the caller passed in — the same
 * "read the thing you're about to gate on, in the same transaction"
 * discipline applyUpdateSpeaker's removal branch follows.
 *
 * @param {{ db: object, speakerId: unknown, uid: string, isAdmin: boolean,
 *           payload: unknown, actor: { uid: string, email: string },
 *           now?: () => number }} args
 * @returns {Promise<{ ok: true, speakerId: string, docPath: string } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyUpdateOwnSpeakerProfile({ db, speakerId, uid, isAdmin, payload, actor, now = Date.now }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  const verdict = validateSpeaker(payload, { partial: true, fieldsAllowed: SELF_EDITABLE_SPEAKER_FIELDS });
  if (!verdict.ok) {
    return { ok: false, status: 400, code: 'bad-request', message: verdict.errors.join('; ') };
  }
  if (Object.keys(verdict.fields).length === 0) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speaker: no editable fields in the payload' };
  }

  const at = new Date(now());
  const ref = db.collection(SPEAKERS).doc(speakerId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
        throw err;
      }
      const stored = snap.data();
      if (!isAdmin && (typeof stored.uid !== 'string' || !stored.uid || stored.uid !== uid)) {
        const err = new Error('FORBIDDEN');
        err.conflict = { status: 403, code: 'forbidden', message: 'You may only edit your own speaker profile.' };
        throw err;
      }
      tx.set(ref, { ...verdict.fields, updatedAt: at, updatedBy: actor.email }, { merge: true });
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    throw err;
  }

  return { ok: true, speakerId, docPath: `${SPEAKERS}/${speakerId}` };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createGetOwnSpeakerProfileHandler({ db, auth, getConfig, log = console }) {
  return async function getOwnSpeakerProfile(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await gateSpeakerSelfOrAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let result;
    try {
      result = await applyGetOwnSpeakerProfile({
        db, speakerId: req.body?.speakerId, uid: gate.uid, isAdmin: gate.isAdmin,
      });
    } catch (err) {
      log.error('getOwnSpeakerProfile failed', err);
      return internal(res, 'Your speaker profile could not be loaded.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    res.status(200).json({ speaker: result.speaker });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createUpdateOwnSpeakerProfileHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updateOwnSpeakerProfile(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const speakerId = req.body?.speakerId;
    if (!isValidDocId(speakerId)) return badRequest(res, 'speakerId: required');
    const gate = await gateSpeakerSelfOrAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let result;
    try {
      result = await applyUpdateOwnSpeakerProfile({
        db,
        speakerId,
        uid: gate.uid,
        isAdmin: gate.isAdmin,
        payload: req.body?.speaker,
        actor: { uid: gate.uid, email: gate.email },
        now,
      });
    } catch (err) {
      log.error('updateOwnSpeakerProfile failed', err);
      return internal(res, 'Your speaker profile could not be saved.');
    }
    if (!result.ok) {
      return result.status === 404
        ? notFound(res, result.message)
        : sendError(res, result.status, result.code, result.message);
    }
    await logAdminAction({
      db,
      action: 'updateOwnSpeakerProfile',
      docPath: result.docPath,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    res.status(200).json({ speakerId: result.speakerId, docPath: result.docPath });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createCreateSpeakerHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function createSpeaker(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    let result;
    try {
      result = await applyCreateSpeaker({
        db,
        speakerId: req.body?.speakerId,
        payload: req.body?.speaker,
        actor,
        now,
      });
    } catch (err) {
      log.error('createSpeaker failed', err);
      return internal(res, 'The speaker could not be saved.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    await logAdminAction({ db, action: 'createSpeaker', docPath: result.docPath, actor, now, log });
    res.status(200).json({ speakerId: result.speakerId, docPath: result.docPath });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createUpdateSpeakerHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updateSpeaker(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    let result;
    try {
      result = await applyUpdateSpeaker({
        db,
        speakerId: req.body?.speakerId,
        payload: req.body?.speaker,
        actor,
        now,
      });
    } catch (err) {
      log.error('updateSpeaker failed', err);
      return internal(res, 'The speaker could not be saved.');
    }
    if (!result.ok) {
      return result.status === 404
        ? notFound(res, result.message)
        : sendError(res, result.status, result.code, result.message);
    }
    await logAdminAction({ db, action: 'updateSpeaker', docPath: result.docPath, actor, now, log });
    res.status(200).json({ speakerId: result.speakerId, docPath: result.docPath });
  };
}

/** Deployable exports (spec §1.3 speakers/). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), now: Date.now, log: console };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    createSpeaker: onRequest({ region }, withCors(async (req, res) => {
      await createCreateSpeakerHandler(buildDeps())(req, res);
    })),
    updateSpeaker: onRequest({ region }, withCors(async (req, res) => {
      await createUpdateSpeakerHandler(buildDeps())(req, res);
    })),
    getOwnSpeakerProfile: onRequest({ region }, withCors(async (req, res) => {
      await createGetOwnSpeakerProfileHandler(buildDeps())(req, res);
    })),
    updateOwnSpeakerProfile: onRequest({ region }, withCors(async (req, res) => {
      await createUpdateOwnSpeakerProfileHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  applyCreateSpeaker,
  applyUpdateSpeaker,
  applyGetOwnSpeakerProfile,
  applyUpdateOwnSpeakerProfile,
  createCreateSpeakerHandler,
  createUpdateSpeakerHandler,
  createGetOwnSpeakerProfileHandler,
  createUpdateOwnSpeakerProfileHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    SPEAKERS, SPEAKER_SLUGS, newSpeakerDefaults, findSlugOwner, gateAdminPost,
    gateSpeakerSelfOrAdmin, buildOwnSpeakerView,
  },
};
