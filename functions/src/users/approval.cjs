'use strict';

/**
 * Admin approval and revocation of attendee registration (spec §3.4,
 * issue #32).
 *
 *   approveUser  POST { uid } — admin-gated. Moves the account to
 *                `approved` and records `approvalSource: 'admin'`.
 *   revokeUser   POST { uid } — admin-gated. Moves the account to `revoked`
 *                and CLEARS `approvalSource`.
 *
 * These are the two edges of the §3.4 table no ticket can produce, and the
 * `approvalSource` they write is what makes the recomputation in
 * `ticketing/entitlement.cjs` behave correctly afterwards:
 *
 *   • `'admin'` makes `computeEntitlement` true on its own, so an explicit
 *     approval — a scholarship attendee, a volunteer, a press pass —
 *     survives every ticket refund. §3.4: "an organizer who approved a
 *     scholarship attendee … made a decision the ticketing provider knows
 *     nothing about, and a refund elsewhere in the order must not silently
 *     reverse it."
 *   • Clearing it on revocation is the other half: §3.4 calls an admin
 *     revocation "explicit and separate: it clears `approvalSource` and sets
 *     `revoked` directly, so it is never undone by a later ticket sync."
 *     Recomputation cannot leave `revoked` (the table has no
 *     `revoked → ticketed` edge, and `revoked → approved` needs
 *     `admin_reapproval`), so re-approval is an organizer's decision, made
 *     here.
 *
 * Every edge is checked with the shared `isValidTransition` before it is
 * written — the same table the frontend gate reads — so an approval the
 * table does not allow is a 409, not a silently different state. Both
 * handlers are transactional and idempotent: an account already in the
 * target state is reported as unchanged rather than rewritten, so a double
 * click cannot produce two audit rows' worth of state churn.
 */

const { isValidTransition } = require('shared/registration');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');

const USERS = 'users';

/** Longest uid this endpoint will look up (Firebase uids are 28 chars). */
const MAX_UID_LEN = 128;

/** @param {unknown} value @returns {string|null} */
function readUid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_UID_LEN) return null;
  if (trimmed.includes('/')) return null;
  return trimmed;
}

/**
 * Apply an admin approval (spec §3.4).
 *
 * `pending → approved` and `ticketed → approved` are `admin_approval`;
 * `revoked → approved` is `admin_reapproval` — one table, two trigger names,
 * both checked rather than assumed.
 *
 * An already-`approved` account is NOT an invalid transition: approving it
 * re-pins `approvalSource` to `'admin'`, which is the whole point when the
 * account was auto-approved from a ticket (`'ticket'`) and the organizer now
 * wants that approval to survive a refund. The status does not move, so no
 * edge is required.
 *
 * @param {{ db: object, uid: string, now?: () => Date }} deps
 * @returns {Promise<{ ok: true, changed: boolean, registrationStatus: string,
 *                     approvalSource: string, previousStatus: string|null } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyApproveUser({ db, uid, now = () => new Date() }) {
  const ref = db.collection(USERS).doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false, status: 404, code: 'not-found', message: 'No such account.' };
    }
    const data = snap.data() || {};
    const current = data.registrationStatus ?? null;
    const approvalSource = data.approvalSource ?? null;

    if (current !== 'approved') {
      const trigger = current === 'revoked' ? 'admin_reapproval' : 'admin_approval';
      if (!isValidTransition(current, 'approved', trigger)) {
        return {
          ok: false,
          status: 409,
          code: 'invalid-transition',
          message: `An account with registration status "${current}" cannot be approved.`,
        };
      }
    }
    if (current === 'approved' && approvalSource === 'admin') {
      return {
        ok: true,
        changed: false,
        registrationStatus: 'approved',
        approvalSource: 'admin',
        previousStatus: current,
      };
    }
    tx.set(
      ref,
      { registrationStatus: 'approved', approvalSource: 'admin', updatedAt: now() },
      { merge: true },
    );
    return {
      ok: true,
      changed: true,
      registrationStatus: 'approved',
      approvalSource: 'admin',
      previousStatus: current,
    };
  });
}

/**
 * Apply an admin revocation (spec §3.4).
 *
 * `approved → revoked` and `ticketed → revoked` under `admin_revocation`.
 * `pending → revoked` is NOT an edge of the table — an account that never
 * held a grant has nothing to revoke — so it is refused rather than
 * invented.
 *
 * @param {{ db: object, uid: string, now?: () => Date }} deps
 */
async function applyRevokeUser({ db, uid, now = () => new Date() }) {
  const ref = db.collection(USERS).doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false, status: 404, code: 'not-found', message: 'No such account.' };
    }
    const data = snap.data() || {};
    const current = data.registrationStatus ?? null;

    if (current === 'revoked') {
      return {
        ok: true,
        changed: false,
        registrationStatus: 'revoked',
        approvalSource: null,
        previousStatus: current,
      };
    }
    if (!isValidTransition(current, 'revoked', 'admin_revocation')) {
      return {
        ok: false,
        status: 409,
        code: 'invalid-transition',
        message: `An account with registration status "${current}" cannot be revoked.`,
      };
    }
    tx.set(
      ref,
      { registrationStatus: 'revoked', approvalSource: null, updatedAt: now() },
      { merge: true },
    );
    return {
      ok: true,
      changed: true,
      registrationStatus: 'revoked',
      approvalSource: null,
      previousStatus: current,
    };
  });
}

/**
 * Shared handler body for the two actions — same gate, same validation,
 * same audit row, so the pair cannot drift apart.
 *
 * @param {{ action: 'approveUser'|'revokeUser',
 *           apply: (deps: object) => Promise<object> }} spec
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: object }} deps
 */
function createApprovalHandler({ action, apply }, { db, auth, getConfig, now = () => new Date(), log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, getConfig }, req);
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const uid = readUid(req.body?.uid);
    if (!uid) return badRequest(res, 'uid is required.');

    let result;
    try {
      result = await apply({ db, uid, now });
    } catch (err) {
      log.error(`${action} failed`, err);
      return internal(res, 'The registration status could not be updated.');
    }
    if (!result.ok) {
      return result.status === 404
        ? notFound(res, result.message)
        : sendError(res, result.status, result.code, result.message);
    }

    // Audit every accepted call, including the no-op: "an admin pressed
    // approve on this account" is the fact an audit log exists to record,
    // and whether the state happened to already match is not the actor's
    // doing. Best-effort, same contract as everywhere else.
    await logAdminAction({ db, action, docPath: `${USERS}/${uid}`, actor: verdict, now, log });

    res.status(200).json({
      ok: true,
      uid,
      changed: result.changed,
      registrationStatus: result.registrationStatus,
      approvalSource: result.approvalSource,
    });
  };
}

/** @param {object} deps */
function createApproveUserHandler(deps) {
  return createApprovalHandler({ action: 'approveUser', apply: applyApproveUser }, deps);
}

/** @param {object} deps */
function createRevokeUserHandler(deps) {
  return createApprovalHandler({ action: 'revokeUser', apply: applyRevokeUser }, deps);
}

/** Deployable exports (spec §1.3 users/): approveUser, revokeUser. */
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
    const { getAuth } = require('firebase-admin/auth');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  return {
    approveUser: onRequest({ region }, withCors(async (req, res) => {
      await createApproveUserHandler(buildAdminDeps())(req, res);
    })),
    revokeUser: onRequest({ region }, withCors(async (req, res) => {
      await createRevokeUserHandler(buildAdminDeps())(req, res);
    })),
  };
}

module.exports = {
  applyApproveUser,
  applyRevokeUser,
  createApproveUserHandler,
  createRevokeUserHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { readUid, USERS, MAX_UID_LEN },
};
