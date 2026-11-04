'use strict';

/**
 * Fixed-window rate limits for the console's public write surface
 * (ADR 0007, Consequences). One document per key in
 * `console_rate_limits/{key}`: `{ count, windowStart }`. The rules give
 * clients no access to the collection.
 *
 * A slot is taken before the work is done, so a failed send still counts.
 * That is the safe side for a limit that exists to stop abuse.
 */

const { ConsoleError } = require('./http.cjs');
const { toMillis } = require('./access.cjs');

const COLLECTION = 'console_rate_limits';

/**
 * @param {object} db
 * @param {{ key: string, max: number, windowMs: number, now?: () => number, message?: string }} opts
 * @throws {ConsoleError} 429 when the window is full
 */
async function takeSlot(db, { key, max, windowMs, now = Date.now, message = 'Too many requests. Try again later.' }) {
  if (typeof key !== 'string' || !key || key.includes('/')) {
    throw new TypeError('takeSlot: key must be one document id');
  }
  const ref = db.collection(COLLECTION).doc(key);
  await db.runTransaction(async (tx) => {
    const at = now();
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const start = data ? toMillis(data.windowStart) : Number.NaN;
    const open = Number.isFinite(start) && at - start < windowMs;
    if (open && data.count >= max) {
      const err = new ConsoleError(429, 'rate-limited', message);
      err.retryAfterSeconds = Math.max(1, Math.ceil((start + windowMs - at) / 1000));
      throw err;
    }
    tx.set(ref, open
      ? { count: data.count + 1, windowStart: data.windowStart }
      : { count: 1, windowStart: new Date(at) });
  });
}

module.exports = { takeSlot, COLLECTION };
