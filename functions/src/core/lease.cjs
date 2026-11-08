'use strict';

/**
 * The run lease: one holder at a time for a scheduled or staff-started run
 * (reminder schedules, the Airtable refresh, announcement send chunks).
 * A lease is a token plus an end. It is live until its end, so a crashed run
 * frees it on its own. Only the run whose token is stored may release it, so
 * a run that outlives its lease never clears the lease of the run that took
 * over.
 *
 * Two stored shapes exist: `{ token, until }` and `{ token, startedAt }`
 * with a fixed length. Leases last minutes, so the shapes stay as they are;
 * this module reads both.
 *
 * The Stripe order leases (queue, payment attempt, reconcile) are not run
 * leases: each fences one payment step and changes state with it, so they
 * stay beside that code (state machine map, 01 finding 8).
 */
const crypto = require('node:crypto');

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

/** Whether `lease` still blocks another run at `nowMs`. */
function leaseIsLive(lease, nowMs, lengthMs) {
  const until = toMillis(lease?.until);
  if (until !== null) return until > nowMs;
  const startedAt = toMillis(lease?.startedAt);
  return startedAt !== null && nowMs - startedAt < lengthMs;
}

/** Whether the run with `token` holds `lease`. */
function holdsLease(lease, token) {
  return typeof token === 'string' && token !== '' && lease?.token === token;
}

function newLeaseToken() {
  return crypto.randomUUID();
}

module.exports = { leaseIsLive, holdsLease, newLeaseToken };
