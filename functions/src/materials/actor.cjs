'use strict';

/**
 * Shared actor resolution for the materials HTTP handlers (store.cjs,
 * review.cjs, access.cjs) — one place that turns a request into
 * `{ uid, isAdmin, speakerId }` so the three write-ACL variants in
 * store.cjs (admin-or-speaker-of-session create, admin-or-owning-speaker
 * update/delete) and the embargo predicate in access.cjs share a single
 * notion of "who is asking", the same "one predicate, two checkpoints"
 * discipline core/auth.cjs's module doc describes for
 * `requireAttendeeAccess`.
 *
 * Resolves admin status via `requireAdmin`'s verified-email-against-
 * `config/bootstrap.adminEmails` check (NOT `requireAttendeeAccess`'s
 * bootstrap-admin fallback, which needs a `users/{uid}` doc to already
 * exist) so an admin who happens not to be a registered attendee can still
 * manage materials. `speakerId` is read directly off `users/{uid}` —
 * `requireAttendeeAccess` deliberately does not expose it.
 */

const { verifyAuthToken, requireAdmin } = require('../core/auth.cjs');

/**
 * @param {{ auth: object, db: object, getConfig: () => Promise<object> }} deps
 * @param {object} req
 * @returns {Promise<{ ok: true, uid: string, isAdmin: boolean, speakerId: string|null } |
 *                    { ok: false, status: 401|403, code: string, message: string }>}
 */
async function resolveActor({ auth, db, getConfig }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Authentication required.' };
  }
  return loadActorForUid({ auth, db, getConfig }, req, decoded.uid);
}

/**
 * Same resolution as {@link resolveActor}, but a missing/invalid token
 * resolves to an anonymous actor (`uid: null, isAdmin: false,
 * speakerId: null`) instead of failing. `getSessionMaterialUrl`'s embargo
 * predicate (materials/access.cjs) grants an approved-and-past-session
 * material to ANY caller, signed in or not — that is the "discovery"
 * half of §4.4's embargo design, and the endpoint must not turn away an
 * anonymous visitor just to find that out.
 *
 * @param {{ auth: object, db: object, getConfig: () => Promise<object> }} deps
 * @param {object} req
 * @returns {Promise<{ ok: true, uid: string|null, isAdmin: boolean, speakerId: string|null }>}
 */
async function resolveActorOptional({ auth, db, getConfig }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) {
    return { ok: true, uid: null, isAdmin: false, speakerId: null };
  }
  return loadActorForUid({ auth, db, getConfig }, req, decoded.uid);
}

async function loadActorForUid({ auth, db, getConfig }, req, uid) {
  const adminVerdict = await requireAdmin({ auth, getConfig }, req);
  const isAdmin = adminVerdict.ok === true;

  const snap = await db.collection('users').doc(uid).get();
  const speakerId = snap.exists ? snap.data()?.speakerId ?? null : null;

  return { ok: true, uid, isAdmin, speakerId };
}

module.exports = { resolveActor, resolveActorOptional };
