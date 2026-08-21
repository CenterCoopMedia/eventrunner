'use strict';

/**
 * Token verification and the admin gate for onRequest handlers
 * (spec §1.3 core/, §8.4).
 *
 * Admin identity is the server-only `config/bootstrap.adminEmails` list —
 * never a client-writable doc and never a custom claim, so revoking an
 * admin is a config edit, not a token round-trip. `requireAdmin` returns a
 * verdict object instead of writing to `res`, so handlers own their error
 * shape via core/errors and tests never need an Express fake.
 *
 * Neither function throws on a bad token: an unverifiable token is the
 * same as no token. Only infrastructure failures (Firestore down inside
 * getConfig) propagate.
 */

const { hasAttendeeAccess } = require('shared/registration');

const BEARER_RE = /^Bearer\s+(\S+)$/i;
const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

/**
 * Pull the raw ID token out of `Authorization: Bearer <idToken>`.
 * Tolerates both Express (`req.get`) and bare `{ headers }` fakes.
 *
 * @param {{ get?: (name: string) => string|undefined,
 *           headers?: Record<string, string|undefined> }} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const raw = typeof req?.get === 'function'
    ? req.get('Authorization')
    : req?.headers?.authorization;
  if (typeof raw !== 'string') return null;
  const match = raw.match(BEARER_RE);
  return match ? match[1] : null;
}

/**
 * Verify the request's Firebase ID token. Returns the decoded token, or
 * null for a missing, malformed, expired, or otherwise unverifiable
 * token — it never throws to the caller, so handlers can treat "not
 * signed in" as one condition instead of two.
 *
 * @param {{ auth: { verifyIdToken: (t: string) => Promise<object> } }} deps
 * @param {object} req
 * @returns {Promise<object|null>} decoded token or null
 */
async function verifyAuthToken({ auth }, req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    return await auth.verifyIdToken(token);
  } catch {
    return null;
  }
}

/**
 * Admin gate for every CMS/admin mutation endpoint.
 *
 * Checks, in order: a verifiable ID token (else 401); a verified email on
 * the token (else 403 — an unverified address must never confer admin,
 * §1.3); membership in `config/bootstrap.adminEmails`, compared
 * case-insensitively (else 403). The 403 message never reveals whether
 * the bootstrap doc exists or which addresses are on the list.
 *
 * `db` is accepted for signature compatibility but unused: the injected
 * `getConfig` (core/config.cjs getEventConfig) already loads bootstrap.
 *
 * @param {{ auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<{ bootstrap: { adminEmails?: string[] } | null }>,
 *           db?: object }} deps
 * @param {object} req
 * @returns {Promise<{ ok: true, uid: string, email: string } |
 *                    { ok: false, status: 401|403, code: string, message: string }>}
 */
async function requireAdmin({ auth, getConfig }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Authentication required.' };
  }
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email || decoded.email_verified !== true) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Admin access required.' };
  }
  const config = await getConfig();
  const adminEmails = Array.isArray(config?.bootstrap?.adminEmails)
    ? config.bootstrap.adminEmails
    : [];
  const isAdmin = adminEmails.some(
    (entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email,
  );
  if (!isAdmin) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Admin access required.' };
  }
  return { ok: true, uid: decoded.uid, email };
}

/**
 * Attendee-access gate for endpoints spec §3.4 calls out by name (bookmarks
 * today; materials/reactions land on the same helper as they're built) —
 * "the predicate is not an authorization boundary, the rules are", but a
 * server handler still needs SOME check before it writes, and every such
 * handler must use the SAME one so a future tightening only has one call
 * site to change.
 *
 * `users/{uid}` is seeded by the auth onCreate trigger (issue #17,
 * functions/src/users/lifecycle.cjs — every account starts `pending`,
 * `speakerId: null`, `role: 'attendee'`) and updated by the
 * invite/approval transactions and the profile-setup self-update path, so
 * this reads a real, populated document for every signed-in caller. The
 * read-a-missing-doc case still fails closed rather than throwing (a
 * retried trigger delivery, a very recent sign-in the trigger hasn't
 * caught up with yet, or a hand-seeded test fixture) —
 * `hasAttendeeAccess` on an empty profile is false by construction
 * (packages/shared/src/registration.cjs). This is the same
 * `registrationStatus === 'approved' || speakerId != null` predicate the
 * rules' `requesterIsApprovedAttendee()` (firestore.rules) enforces for
 * direct client reads of `users_public` — one vocabulary, two enforcement
 * points that cannot drift apart.
 *
 * Bootstrap admins (`config/bootstrap.adminEmails`) get the SAME
 * `role: 'attendee'` default from the auth trigger as anyone else — the
 * trigger has no way to know an email is on the bootstrap list. The
 * client-side counterpart (ProfileContext.jsx) papers over this by
 * overriding `role` to `'admin'` when its own `isAdmin` probe succeeds,
 * so the UI shows a working bookmark pill for an admin who isn't also an
 * approved attendee — but this server gate, reading only the stored
 * document, would 403 that same admin's click. Resolving bootstrap-admin
 * identity the same way `requireAdmin` does (verified email against
 * `config/bootstrap.adminEmails`) keeps the UI's promise and the server's
 * enforcement in agreement, the same "one predicate, two checkpoints"
 * discipline the module doc above describes.
 *
 * @param {{ auth: { verifyIdToken: (t: string) => Promise<object> },
 *           db: FirebaseFirestore.Firestore,
 *           getConfig: () => Promise<{ bootstrap: { adminEmails?: string[] } | null }> }} deps
 * @param {object} req
 * @returns {Promise<{ ok: true, uid: string, email: string|null } |
 *                    { ok: false, status: 401|403, code: string, message: string }>}
 */
async function requireAttendeeAccess({ auth, db, getConfig }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Authentication required.' };
  }

  let isBootstrapAdmin = false;
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (email && decoded.email_verified === true && typeof getConfig === 'function') {
    const config = await getConfig();
    const adminEmails = Array.isArray(config?.bootstrap?.adminEmails)
      ? config.bootstrap.adminEmails
      : [];
    isBootstrapAdmin = adminEmails.some(
      (entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email,
    );
  }

  const snap = await db.collection('users').doc(decoded.uid).get();
  const data = snap.exists ? snap.data() : null;
  const profile = {
    registrationStatus: data?.registrationStatus,
    speakerId: data?.speakerId ?? null,
    role: isBootstrapAdmin ? 'admin' : data?.role,
  };
  if (!hasAttendeeAccess(profile)) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Attendee access required.',
    };
  }
  return { ok: true, uid: decoded.uid, email: typeof decoded.email === 'string' ? decoded.email : null };
}

/**
 * Pull the App Check attestation out of `X-Firebase-AppCheck`.
 * Tolerates both Express (`req.get`) and bare `{ headers }` fakes; bare
 * fakes carry Node's lowercased header names.
 *
 * @param {{ get?: (name: string) => string|undefined,
 *           headers?: Record<string, string|undefined> }} req
 * @returns {string|null}
 */
function extractAppCheckToken(req) {
  const raw = typeof req?.get === 'function'
    ? req.get(APP_CHECK_HEADER)
    : req?.headers?.[APP_CHECK_HEADER.toLowerCase()];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * App Check gate for the unauthenticated public endpoints (issue #45).
 *
 * NOT a substitute for the v2 `enforceAppCheck` option: that option lives on
 * `CallableOptions` only — firebase-functions declares
 * `HttpsOptions extends Omit<GlobalOptions, 'region' | 'enforceAppCheck'>`
 * and `onRequest` never reads it, so only `onCall` installs the platform
 * middleware. Our endpoints are plain `onRequest` (the client speaks fetch,
 * not the callable protocol), so the verification has to happen here.
 *
 * Fails CLOSED once enforcement is on: a missing header, an unverifiable
 * token, and an unavailable App Check service are all the same refusal. An
 * enforcement flag that quietly stops enforcing because the SDK failed to
 * load is worse than no flag at all.
 *
 * One verdict for every rejection, so the response cannot say WHY the
 * attestation failed. This gate runs before the request body is even read,
 * so it can leak nothing about addresses, accounts, or challenges.
 *
 * @param {{ appCheck: { verifyToken: (t: string) => Promise<object> }|null,
 *           enforced?: boolean }} deps
 * @param {object} req
 * @returns {Promise<{ ok: true, enforced: boolean } | { ok: false, reason: string }>}
 *   `reason` is for server-side logs only — never for the response body.
 */
async function requireAppCheck({ appCheck, enforced = false }, req) {
  if (!enforced) return { ok: true, enforced: false };
  if (!appCheck || typeof appCheck.verifyToken !== 'function') {
    return { ok: false, reason: 'app-check-unavailable' };
  }
  const token = extractAppCheckToken(req);
  if (!token) return { ok: false, reason: 'app-check-missing' };
  try {
    await appCheck.verifyToken(token);
    return { ok: true, enforced: true };
  } catch {
    return { ok: false, reason: 'app-check-invalid' };
  }
}

module.exports = {
  verifyAuthToken,
  requireAdmin,
  requireAttendeeAccess,
  requireAppCheck,
  internals: { extractBearerToken, extractAppCheckToken, APP_CHECK_HEADER },
};
