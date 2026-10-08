'use strict';

/**
 * Server-owned write policy for historical demos (issue #347).
 *
 * Read config/event directly at each side-effect boundary. The general
 * getEventConfig cache may still describe a writable event for five minutes
 * after an operator enables historicalDemo. A request body, Auth claim, or
 * build-time demo flag must never override this durable setting.
 */
async function checkDemoWrites({ db }) {
  const unavailable = {
    ok: false,
    status: 503,
    code: 'config-unavailable',
    message: 'Event configuration is unavailable. Try again later.',
  };
  let event;
  try {
    const snap = await db.collection('config').doc('event').get();
    event = snap.exists ? snap.data() : null;
  } catch {
    return unavailable;
  }
  // Older client deployments omit the optional flag. A missing event doc
  // or malformed flag is different: we cannot establish the write policy.
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || (event.historicalDemo !== undefined && typeof event.historicalDemo !== 'boolean')) {
    return unavailable;
  }
  if (event.historicalDemo === true) {
    return {
      ok: false,
      status: 403,
      code: 'read-only-demo',
      message: 'This historical demo is read-only. Account, feedback, and email actions are disabled.',
    };
  }
  return { ok: true };
}

/** Background triggers retry unavailable policy reads, but skip demos. */
function throwIfDemoPolicyUnavailable(verdict) {
  if (verdict.code !== 'config-unavailable') return;
  const error = new Error(verdict.message);
  error.code = verdict.code;
  throw error;
}

module.exports = { checkDemoWrites, throwIfDemoPolicyUnavailable };
