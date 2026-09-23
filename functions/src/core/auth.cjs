'use strict';

/**
 * Token verification and the admin gate for onRequest handlers
 * (spec §1.3 core/, §8.4).
 *
 * Admin identity is the server-only `config/bootstrap` document — never a
 * client-writable doc and never a custom claim, so revoking an admin is a
 * config edit, not a token round-trip. `requireAdmin` returns a verdict
 * object instead of writing to `res`, so handlers own their error shape
 * via core/errors and tests never need an Express fake.
 *
 * TWO TIERS (issue #186). `config/bootstrap` carries two lists:
 *
 *   adminEmails  — operators. Branding, feature flags, access control,
 *                  deployment settings, system errors. The name predates
 *                  the split and is kept so every existing deployment keeps
 *                  full access with no migration: an address on this list
 *                  has always meant "can do everything", and still does.
 *   staffEmails  — staff. Content, schedule, speakers, attendees, media,
 *                  materials, feedback, live updates, ticketing operations.
 *
 * An address on either list is an admin; an address on `adminEmails` is
 * an operator. `resolveAdminTier` is the ONE predicate, and it is shared
 * with every place that used to scan `adminEmails` by hand (speakers/
 * profile.cjs, media/upload.cjs, `requireAttendeeAccess` below) so the two
 * lists cannot be read two ways. firestore.rules carries the same split
 * as isOperator() / isStaff() / isAdmin().
 *
 * Neither function throws on a bad token: an unverifiable token is the
 * same as no token. Only infrastructure failures (Firestore down inside
 * getConfig) propagate.
 */

const { hasAttendeeAccess } = require('shared/registration');

const BEARER_RE = /^Bearer\s+(\S+)$/i;
const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

/**
 * The two admin tiers, strictest first. `requireAdmin` defaults to the
 * strictest, so an endpoint that forgets to state its tier is closed to
 * staff rather than open to them.
 */
const ADMIN_TIERS = Object.freeze(['operator', 'staff']);

/** @param {unknown} list @param {string} email lowercased @returns {boolean} */
function listHasEmail(list, email) {
  return Array.isArray(list)
    && list.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email);
}

/**
 * The tier an address holds on `config/bootstrap`, or null for no admin
 * access at all. Case-insensitive on both sides. An address on both lists
 * is an operator: the wider grant wins, the same way the rules'
 * `isOperator() || isStaff()` reads it. A missing document, a missing
 * list, or a malformed list is "not an admin", never a throw.
 *
 * @param {{ adminEmails?: unknown, staffEmails?: unknown }|null|undefined} bootstrap
 * @param {string|null|undefined} email
 * @returns {'operator'|'staff'|null}
 */
function resolveAdminTier(bootstrap, email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized) return null;
  if (listHasEmail(bootstrap?.adminEmails, normalized)) return 'operator';
  if (listHasEmail(bootstrap?.staffEmails, normalized)) return 'staff';
  return null;
}

/**
 * Whether `held` satisfies `required`. Operator satisfies everything;
 * staff satisfies staff only.
 *
 * @param {'operator'|'staff'|null} held
 * @param {'operator'|'staff'} required
 * @returns {boolean}
 */
function tierSatisfies(held, required) {
  if (held === 'operator') return true;
  return held === 'staff' && required === 'staff';
}

/**
 * The bootstrap document as it is NOW, for an admin decision.
 *
 * core/config.cjs caches config per container for five minutes, and every
 * function runs in its own container, so a grant or a revocation made
 * through setAdminAccess would otherwise reach the other endpoints only
 * when their copies expired: a newly granted staff member refused for
 * minutes, a revoked account admitted for minutes. An admin decision reads
 * the document live instead — one small document read per admin request,
 * and admin requests are people clicking.
 *
 * The cached copy is the fallback, never the first choice: when no `db`
 * was handed in, when the live read fails, or when the document is
 * absent (the cached copy is then either null, or what the container had
 * before the document went — exactly what today's readers see). The
 * fallback never widens beyond that.
 *
 * @param {{ db?: { collection: Function }, getConfig?: () => Promise<{ bootstrap?: object|null }> }} deps
 * @returns {Promise<object|null>}
 */
async function loadBootstrap({ db, getConfig }) {
  if (db && typeof db.collection === 'function') {
    try {
      const snap = await db.collection('config').doc('bootstrap').get();
      if (snap?.exists) return snap.data() ?? null;
    } catch {
      // Fall through to the cached copy.
    }
  }
  if (typeof getConfig !== 'function') return null;
  const config = await getConfig();
  return config?.bootstrap ?? null;
}

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
 * §1.3); membership in `config/bootstrap`, compared case-insensitively
 * (else 403); and that the tier held satisfies the tier the endpoint
 * asks for (else 403). The 403 message never reveals whether the
 * bootstrap doc exists or which addresses are on either list.
 *
 * `options.tier` is the endpoint's own classification and the ONE place
 * it states it: `'staff'` admits both tiers, `'operator'` admits operators
 * only. It defaults to `'operator'`, so an endpoint that does not say
 * refuses staff rather than admitting them. The verdict carries the tier
 * the caller holds, for a handler that gates one field more tightly than
 * the rest (admin/config.cjs's sender block).
 *
 * `db` makes the decision current: with it, `config/bootstrap` is read
 * live (see loadBootstrap); without it, the injected `getConfig`
 * (core/config.cjs getEventConfig) supplies the cached copy.
 *
 * @param {{ auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<{ bootstrap: { adminEmails?: string[], staffEmails?: string[] } | null }>,
 *           db?: object }} deps
 * @param {object} req
 * @param {{ tier?: 'operator'|'staff' }} [options]
 * @returns {Promise<{ ok: true, uid: string, email: string, tier: 'operator'|'staff' } |
 *                    { ok: false, status: 401|403, code: string, message: string }>}
 */
async function requireAdmin({ auth, db, getConfig }, req, { tier = 'operator' } = {}) {
  if (!ADMIN_TIERS.includes(tier)) {
    throw new TypeError(`requireAdmin: unknown tier "${tier}" (expected ${ADMIN_TIERS.join(' or ')})`);
  }
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Authentication required.' };
  }
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email || decoded.email_verified !== true) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Admin access required.' };
  }
  const held = resolveAdminTier(await loadBootstrap({ db, getConfig }), email);
  if (held === null) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Admin access required.' };
  }
  if (!tierSatisfies(held, tier)) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Operator access required.' };
  }
  return { ok: true, uid: decoded.uid, email, tier: held };
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
 * Bootstrap admins (either tier on `config/bootstrap`) get the SAME
 * `role: 'attendee'` default from the auth trigger as anyone else — the
 * trigger has no way to know an email is on the bootstrap list. The
 * client-side counterpart (ProfileContext.jsx) papers over this by
 * overriding `role` to `'admin'` when its own `isAdmin` probe succeeds,
 * so the UI shows a working bookmark pill for an admin who isn't also an
 * approved attendee — but this server gate, reading only the stored
 * document, would 403 that same admin's click. Resolving bootstrap-admin
 * identity the same way `requireAdmin` does (verified email through
 * `resolveAdminTier`) keeps the UI's promise and the server's enforcement
 * in agreement, the same "one predicate, two checkpoints" discipline the
 * module doc above describes. Staff count here too: attendee access is
 * the floor under every admin, not an operator privilege.
 *
 * This gate reads the CACHED bootstrap, not the live document: it runs on
 * every bookmark and reaction at attendee volume, the admin branch only
 * widens what an approved attendee already has, and a five-minute lag on
 * an admin's bookmark pill costs nobody anything.
 *
 * @param {{ auth: { verifyIdToken: (t: string) => Promise<object> },
 *           db: FirebaseFirestore.Firestore,
 *           getConfig: () => Promise<{ bootstrap: { adminEmails?: string[], staffEmails?: string[] } | null }> }} deps
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
    isBootstrapAdmin = resolveAdminTier(config?.bootstrap, email) !== null;
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
  ADMIN_TIERS,
  resolveAdminTier,
  loadBootstrap,
  verifyAuthToken,
  requireAdmin,
  requireAttendeeAccess,
  requireAppCheck,
  internals: { extractBearerToken, extractAppCheckToken, tierSatisfies, APP_CHECK_HEADER },
};
