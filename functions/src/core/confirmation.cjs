'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (value instanceof Date) {
    const seconds = Math.floor(value.getTime() / 1000);
    return ['time', seconds, (value.getTime() - seconds * 1000) * 1_000_000];
  }
  if (typeof value?.toMillis === 'function' && Number.isInteger(value.seconds)) {
    return ['time', value.seconds, value.nanoseconds];
  }
  if (Array.isArray(value)) return ['array', value.map(canonical)];
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return ['map', keys.map((key) => [key, canonical(value[key])])];
  }
  return value;
}

/** Fingerprint the saved values, independent of Firestore map key order. */
function confirmationVersion(...values) {
  const json = JSON.stringify(values.map(canonical));
  return createHash('sha256').update(json).digest('hex');
}

function matchesConfirmation(expectedVersion, ...values) {
  return expectedVersion === undefined || expectedVersion === confirmationVersion(...values);
}

const STALE_CONFIRMATION = 'This record changed after you reviewed it. Reload it and confirm again.';

class ConfirmationConflict extends Error {
  constructor() {
    super(STALE_CONFIRMATION);
    this.status = 409;
    this.code = 'stale-confirmation';
  }
}

function requireConfirmation(expectedVersion, ...values) {
  if (!matchesConfirmation(expectedVersion, ...values)) throw new ConfirmationConflict();
}

module.exports = { confirmationVersion, matchesConfirmation, requireConfirmation, ConfirmationConflict };
