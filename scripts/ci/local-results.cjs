'use strict';

const CONTEXT_PREFIX = 'eventrunner/local-ci/v1/';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function statusContext(base) {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('base must be a full commit SHA');
  return `${CONTEXT_PREFIX}${base}`;
}

// Statuses are returned newest first. A later failure must supersede a pass.
function hasTrustedResult({ statuses, base, actorId, now = Date.now() }) {
  if (!/^[1-9][0-9]*$/.test(String(actorId || ''))) return false;
  const latest = statuses.find((status) => status.context === statusContext(base));
  if (!latest || latest.state !== 'success') return false;
  if (String(latest.creator?.id) !== String(actorId)) return false;
  const age = now - Date.parse(latest.created_at);
  return Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS;
}

module.exports = { hasTrustedResult, statusContext };
