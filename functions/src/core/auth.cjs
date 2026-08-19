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

const BEARER_RE = /^Bearer\s+(\S+)$/i;

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

module.exports = {
  verifyAuthToken,
  requireAdmin,
  internals: { extractBearerToken },
};
