'use strict';

const { createHash } = require('node:crypto');
const { ConsoleError } = require('./http.cjs');

function confirmationVersion(...snapshots) {
  const versions = snapshots.map(({ ref, updateTime }) => [
    ref.path, updateTime?.seconds ?? null, updateTime?.nanoseconds ?? null,
  ]).sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(versions)).digest('hex');
}

function requireConfirmation(expectedVersion, ...snapshots) {
  if (expectedVersion !== undefined && expectedVersion !== confirmationVersion(...snapshots)) {
    throw new ConsoleError(409, 'stale-confirmation', 'This record changed after you reviewed it. Reload it and confirm again.');
  }
}

module.exports = { confirmationVersion, requireConfirmation };
