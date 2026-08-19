'use strict';

/**
 * OTP challenge store and auth rate bucket (spec §3.1, §4.1, §9).
 *
 * Collections:
 *   auth_challenges/{token}   { kind: 'otp', email, codeHash, attempts,
 *                               expiresAt, createdAt } — server-only.
 *     `kind` is kept for forward compatibility even though OTP is the only
 *     kind in v1 (spec §9).
 *   auth_rate_limits/{emailHash}  5 requests / 15 minutes, keyed by SHA-256
 *     of the normalized address so raw addresses never index a collection.
 *
 * Every function takes an injected db and clock — no firebase-admin import.
 */

const crypto = require('node:crypto');

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** @param {string} email @returns {string} */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/** @param {string} email @returns {string} sha256 hex of the normalized address */
function emailHash(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');
}

/**
 * Salted challenge-scoped code hash: the same code in two challenges never
 * produces the same stored hash.
 * @param {string} token challenge id @param {string} code
 */
function hashCode(token, code) {
  return crypto.createHash('sha256').update(`${token}:${code}`, 'utf8').digest('hex');
}

/**
 * Check and record one rate-limit slot atomically. The check and the
 * record share a transaction so parallel requests cannot both pass a
 * stale read (spec §3.1: 5 per 15 minutes per address).
 *
 * @param {{ db: FirebaseFirestore.Firestore, email: string, now?: () => number }} args
 * @returns {Promise<{ limited: boolean, retryAfterMs?: number }>}
 */
async function takeRateLimitSlot({ db, email, now = Date.now }) {
  const ref = db.collection('auth_rate_limits').doc(emailHash(email));
  const nowMs = now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data()?.requests : null;
    const requests = (Array.isArray(stored) ? stored : [])
      .filter((t) => typeof t === 'number' && nowMs - t < RATE_LIMIT_WINDOW_MS);
    if (requests.length >= RATE_LIMIT_MAX) {
      const oldest = Math.min(...requests);
      return { limited: true, retryAfterMs: Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - nowMs) };
    }
    requests.push(nowMs);
    tx.set(ref, { requests, updatedAt: new Date(nowMs) });
    return { limited: false };
  });
}

/**
 * Create a new OTP challenge. The token doubles as the document id and the
 * hash salt; it is returned to the client as the challenge handle and
 * carries no secret by itself.
 *
 * @param {{ db: FirebaseFirestore.Firestore, email: string, code: string,
 *           now?: () => number }} args
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
async function createChallenge({ db, email, code, now = Date.now }) {
  const token = crypto.randomBytes(32).toString('hex');
  const nowMs = now();
  const expiresAt = new Date(nowMs + CHALLENGE_TTL_MS);
  await db.collection('auth_challenges').doc(token).set({
    kind: 'otp',
    email: normalizeEmail(email),
    codeHash: hashCode(token, code),
    attempts: 0,
    expiresAt,
    createdAt: new Date(nowMs),
  });
  return { token, expiresAt };
}

/**
 * Verify a code against a stored challenge. Single verdict path: every
 * failure (unknown token, expired, locked out, wrong code, email mismatch)
 * is the same `{ ok: false }` so responses cannot be used as an oracle.
 *
 * The attempt is recorded transactionally BEFORE the compare, so a burst
 * of parallel guesses cannot share one attempt slot; a correct code
 * consumes (deletes) the challenge in the same transaction — single use.
 *
 * @param {{ db: FirebaseFirestore.Firestore, token: string, email: string,
 *           code: string, now?: () => number }} args
 * @returns {Promise<{ ok: boolean, email?: string }>}
 */
async function verifyAndConsumeChallenge({ db, token, email, code, now = Date.now }) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return { ok: false };
  const ref = db.collection('auth_challenges').doc(token);
  const nowMs = now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false };
    const data = snap.data();

    const expiresMs = data.expiresAt instanceof Date
      ? data.expiresAt.getTime()
      : typeof data.expiresAt?.toMillis === 'function'
        ? data.expiresAt.toMillis()
        : Date.parse(data.expiresAt);
    if (!Number.isFinite(expiresMs) || nowMs >= expiresMs) return { ok: false };
    if ((data.attempts || 0) >= MAX_ATTEMPTS) return { ok: false };

    const expected = Buffer.from(String(data.codeHash || ''), 'utf8');
    const provided = Buffer.from(hashCode(token, String(code)), 'utf8');
    const codeMatches = expected.length === provided.length &&
      crypto.timingSafeEqual(expected, provided);
    const emailMatches = data.email === normalizeEmail(email);

    if (codeMatches && emailMatches) {
      tx.delete(ref);
      return { ok: true, email: data.email };
    }
    tx.update(ref, { attempts: (data.attempts || 0) + 1 });
    return { ok: false };
  });
}

/**
 * Sweep expired challenges and stale rate-limit docs (the auth module's
 * own cleanup export, spec §1.3; maintenance/cleanup.cjs calls the same).
 *
 * @param {{ db: FirebaseFirestore.Firestore, now?: () => number,
 *           batchLimit?: number }} args
 * @returns {Promise<{ challenges: number, rateLimits: number }>}
 */
async function sweepExpired({ db, now = Date.now, batchLimit = 250 }) {
  const nowDate = new Date(now());
  let challenges = 0;
  let rateLimits = 0;

  const expired = await db
    .collection('auth_challenges')
    .where('expiresAt', '<', nowDate)
    .limit(batchLimit)
    .get();
  for (const doc of expired.docs) {
    await doc.ref.delete();
    challenges += 1;
  }

  const staleBefore = new Date(now() - RATE_LIMIT_WINDOW_MS);
  const stale = await db
    .collection('auth_rate_limits')
    .where('updatedAt', '<', staleBefore)
    .limit(batchLimit)
    .get();
  for (const doc of stale.docs) {
    await doc.ref.delete();
    rateLimits += 1;
  }

  return { challenges, rateLimits };
}

module.exports = {
  takeRateLimitSlot,
  createChallenge,
  verifyAndConsumeChallenge,
  sweepExpired,
  normalizeEmail,
  emailHash,
  hashCode,
  internals: { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, CHALLENGE_TTL_MS, MAX_ATTEMPTS },
};
