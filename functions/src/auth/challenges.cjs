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
 *   auth_send_ceiling/global  deployment-wide OTP send ceiling — the
 *     circuit breaker behind the per-address bucket (issue #45).
 *
 * Every function takes an injected db and clock — no firebase-admin import.
 */

const crypto = require('node:crypto');

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SEND_CEILING_MAX = 500;
const SEND_CEILING_WINDOW_MS = 60 * 60 * 1000;
const SEND_CEILING_DOC = 'global';

/** @param {string} email @returns {string} */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/** @param {string} email @returns {string} sha256 hex of the normalized address */
function emailHash(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');
}

/**
 * Rate-bucket key: additionally strips a +tag from the local part, since
 * victim+1@ and victim+2@ deliver to the same inbox — without this, sub-
 * addressing gives an attacker a fresh 5/15min budget per tag against one
 * victim. Challenges keep the full address; only the bucket collapses.
 * @param {string} email @returns {string} sha256 hex
 */
function rateBucketHash(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  const local = at === -1 ? normalized : normalized.slice(0, at);
  const domain = at === -1 ? '' : normalized.slice(at);
  const plus = local.indexOf('+');
  const bucketAddress = (plus === -1 ? local : local.slice(0, plus)) + domain;
  return crypto.createHash('sha256').update(bucketAddress, 'utf8').digest('hex');
}

/**
 * Challenge-scoped code digest, deliberately expensive: a 6-digit code has
 * only 10^6 values, so a plain SHA-256 beside its salt falls to offline
 * brute force in seconds if auth_challenges ever leaks. scrypt at these
 * parameters (~50-100ms per guess) pushes a full sweep past the 10-minute
 * challenge TTL without needing a server-side pepper secret (the spec caps
 * the secret surface, §2.1/§8.2). Online guessing is bounded separately by
 * the 5-attempt lockout.
 * @param {string} token challenge id (salt) @param {string} code
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
/** Async on purpose: the ~50-100ms derivation runs on libuv's threadpool,
 * so a stream of unauthenticated guesses cannot serialize the event loop
 * of a public verification instance. @returns {Promise<string>} */
function hashCode(token, code) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(code), `otp:${token}`, 32, SCRYPT_PARAMS, (err, buf) => {
      if (err) reject(err);
      else resolve(buf.toString('hex'));
    });
  });
}

/**
 * Read `expiresAt` in whichever shape the store handed back: a JS Date from
 * the in-memory fake, a Firestore Timestamp in production, an ISO string
 * from a hand-repaired document.
 * @param {*} value @returns {number} ms, or NaN when unreadable
 */
function expiresAtMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return Date.parse(value);
}

/**
 * True when a challenge document is still a candidate for verification:
 * unexpired, unconsumed, attempts left. Deliberately crypto-free — it is
 * the pre-check that decides whether deriving the scrypt hash is worth it,
 * and it is re-run inside the transaction as the authoritative check.
 * @param {object|undefined} data @param {number} nowMs
 */
function isVerifiable(data, nowMs) {
  if (!data) return false;
  const expires = expiresAtMs(data.expiresAt);
  if (!Number.isFinite(expires) || nowMs >= expires) return false;
  if (data.consumedAt) return false;
  if ((data.attempts || 0) >= MAX_ATTEMPTS) return false;
  return true;
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
  const ref = db.collection('auth_rate_limits').doc(rateBucketHash(email));
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
 * Take one slot against the deployment-wide OTP send ceiling (issue #45).
 *
 * The per-address bucket above is a per-victim control: an attacker holding
 * a list of a million addresses never trips it, and every request that gets
 * through costs the operator one provider send. This is the circuit breaker
 * behind it — a cap on total sends per rolling window for the whole
 * deployment, independent of who is asking.
 *
 * Storage mirrors `auth_rate_limits`: one document holding the live
 * timestamps, filtered on read, swept by `sweepExpired` on `updatedAt`.
 * Deliberately unsharded. A slot is written only when the request is BELOW
 * the ceiling, so writes are capped at `max` per window — 500/hour is two
 * orders of magnitude under Firestore's sustained per-document write rate —
 * and once the breaker trips the transaction stops writing entirely, which
 * is exactly the flood case sharding would otherwise be sized for.
 *
 * `trippedAt` is stored so the first request over the line can be told
 * apart from the thousand behind it: the caller alerts on `firstTrip` only,
 * once per trip episode and durably across container restarts, rather than
 * once per request. It is cleared as soon as the window drains.
 *
 * MUST be called after the per-address bucket, never before: a single
 * address hammering the endpoint is stopped by its own 5/15min budget and
 * must not be able to spend the whole deployment's ceiling on its own.
 *
 * @param {{ db: FirebaseFirestore.Firestore, now?: () => number,
 *           max?: number, windowMs?: number }} args
 * @returns {Promise<{ limited: boolean, count: number, firstTrip: boolean,
 *           retryAfterMs?: number }>}
 */
async function takeGlobalSendSlot({
  db,
  now = Date.now,
  max = SEND_CEILING_MAX,
  windowMs = SEND_CEILING_WINDOW_MS,
}) {
  const ref = db.collection('auth_send_ceiling').doc(SEND_CEILING_DOC);
  const nowMs = now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const sends = (Array.isArray(data?.sends) ? data.sends : [])
      .filter((t) => typeof t === 'number' && nowMs - t < windowMs);

    if (sends.length >= max) {
      const oldest = Math.min(...sends);
      const firstTrip = !data?.trippedAt;
      if (firstTrip) {
        tx.set(ref, { sends, trippedAt: new Date(nowMs), updatedAt: new Date(nowMs) });
      }
      return {
        limited: true,
        count: sends.length,
        firstTrip,
        retryAfterMs: Math.max(0, oldest + windowMs - nowMs),
      };
    }

    sends.push(nowMs);
    // set(), not update(): rewriting the document drops a stale trippedAt
    // the moment the window drains below the ceiling, so the next trip
    // alerts again.
    tx.set(ref, { sends, updatedAt: new Date(nowMs) });
    return { limited: false, count: sends.length, firstTrip: false };
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
  const codeHash = await hashCode(token, code);
  await db.collection('auth_challenges').doc(token).set({
    kind: 'otp',
    email: normalizeEmail(email),
    codeHash,
    attempts: 0,
    expiresAt,
    createdAt: new Date(nowMs),
  });
  return { token, expiresAt };
}

/**
 * Verify a code against a stored challenge. Single verdict path: every
 * failure (unknown token, expired, locked out, wrong code, email mismatch,
 * already consumed) is the same `{ ok: false }` so responses cannot be
 * used as an oracle.
 *
 * The attempt is recorded transactionally BEFORE the compare, so a burst
 * of parallel guesses cannot share one attempt slot. A correct code marks
 * the challenge consumed in the same transaction — blocking concurrent
 * replay — but does NOT delete it: the caller finalizes after the custom
 * token is issued, or releases so a transient Auth failure does not force
 * the user to burn another rate-limit slot on a fresh code.
 *
 * Three stages, in this order (issue #47):
 *   1. a crypto-free pre-check on one plain read — exists, unexpired,
 *      unconsumed, attempts left;
 *   2. the ~50-100ms scrypt derivation, only for a challenge that passed;
 *   3. the transaction, which re-checks everything authoritatively.
 * Without stage 1 an unauthenticated flood of random well-formed ids each
 * bought a threadpool scrypt without consuming an attempt. The pre-check is
 * advisory only — a stale read can never widen what stage 3 accepts — and
 * it changes no response: every miss is still the same `{ ok: false }`. The
 * timing difference between "unknown id" and "wrong code" is accepted;
 * challenge ids are handles, not secrets.
 *
 * @param {{ db: FirebaseFirestore.Firestore, token: string, email: string,
 *           code: string, now?: () => number,
 *           hashFn?: (token: string, code: string) => Promise<string> }} args
 * @returns {Promise<{ ok: boolean, email?: string }>}
 */
async function verifyChallenge({ db, token, email, code, now = Date.now, hashFn = hashCode }) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return { ok: false };
  const ref = db.collection('auth_challenges').doc(token);
  const nowMs = now();

  const preSnap = await ref.get();
  if (!preSnap.exists || !isVerifiable(preSnap.data(), nowMs)) return { ok: false };

  // Derived OUTSIDE the transaction: the expensive hash must run once per
  // request, not once per transaction retry.
  const providedHash = await hashFn(token, String(code));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false };
    const data = snap.data();
    if (!isVerifiable(data, nowMs)) return { ok: false };

    const expected = Buffer.from(String(data.codeHash || ''), 'utf8');
    const provided = Buffer.from(providedHash, 'utf8');
    const codeMatches = expected.length === provided.length &&
      crypto.timingSafeEqual(expected, provided);
    const emailMatches = data.email === normalizeEmail(email);

    if (codeMatches && emailMatches) {
      tx.update(ref, { consumedAt: new Date(nowMs) });
      return { ok: true, email: data.email };
    }
    tx.update(ref, { attempts: (data.attempts || 0) + 1 });
    return { ok: false };
  });
}

/** Delete a verified challenge once the custom token has been issued. */
async function finalizeChallenge({ db, token }) {
  await db.collection('auth_challenges').doc(token).delete();
}

/**
 * Undo the consumed marker after a failed token issuance so the user can
 * retry the SAME correct code instead of burning a rate slot on a new one.
 * The challenge's expiry and attempt count still apply on retry.
 */
async function releaseChallenge({ db, token }) {
  const ref = db.collection('auth_challenges').doc(token);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    tx.update(ref, { consumedAt: null });
  });
}

/**
 * Sweep expired challenges and stale rate-limit docs (the auth module's
 * own cleanup export, spec §1.3; maintenance/cleanup.cjs calls the same).
 *
 * @param {{ db: FirebaseFirestore.Firestore, now?: () => number,
 *           batchLimit?: number }} args
 * @returns {Promise<{ challenges: number, rateLimits: number, sendCeilings: number }>}
 */
async function sweepExpired({ db, now = Date.now, batchLimit = 250, maxBatches = 40 }) {
  // Drain in batches until a batch comes back short — a daily run capped at
  // one batch would let a busy event accumulate an unbounded backlog of
  // expired auth data. maxBatches bounds a single invocation; the next run
  // continues.
  async function drain(query) {
    let deleted = 0;
    for (let i = 0; i < maxBatches; i += 1) {
      const batch = await query.get();
      for (const doc of batch.docs) {
        await doc.ref.delete();
        deleted += 1;
      }
      if (batch.docs.length < batchLimit) break;
    }
    return deleted;
  }

  const challenges = await drain(
    db.collection('auth_challenges').where('expiresAt', '<', new Date(now())).limit(batchLimit),
  );
  const rateLimits = await drain(
    db.collection('auth_rate_limits')
      .where('updatedAt', '<', new Date(now() - RATE_LIMIT_WINDOW_MS))
      .limit(batchLimit),
  );
  // A drained ceiling document holds only dead timestamps; dropping it also
  // drops any stale trippedAt, so a later trip alerts as a first trip.
  const sendCeilings = await drain(
    db.collection('auth_send_ceiling')
      .where('updatedAt', '<', new Date(now() - SEND_CEILING_WINDOW_MS))
      .limit(batchLimit),
  );
  return { challenges, rateLimits, sendCeilings };
}

module.exports = {
  takeRateLimitSlot,
  takeGlobalSendSlot,
  createChallenge,
  verifyChallenge,
  finalizeChallenge,
  releaseChallenge,
  sweepExpired,
  normalizeEmail,
  emailHash,
  rateBucketHash,
  hashCode,
  internals: {
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    CHALLENGE_TTL_MS,
    MAX_ATTEMPTS,
    SEND_CEILING_MAX,
    SEND_CEILING_WINDOW_MS,
    isVerifiable,
  },
};
