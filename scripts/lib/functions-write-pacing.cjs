'use strict';

// #954: function updates and invoker policies exhausted write quotas in run 43486748816.
// One shared start interval stays below both Functions generations' limits, even
// when their writes and Cloud Run IAM writes arrive concurrently from the CLI.
const WRITE_INTERVAL_MS = 1500;
const QUOTA_WAIT_MS = 105_000;
const MAX_QUOTA_ATTEMPTS = 3;

function createPacedFetch(fetch, {
  origins,
  now = () => performance.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = console,
} = {}) {
  const managedOrigins = new Set(origins.map((origin) => new URL(origin).origin));
  let previousStart = -Infinity;
  let resumeAt = 0;
  let turn = Promise.resolve();

  function dispatch(resource, options) {
    let response;
    const next = turn.then(async () => {
      let remaining;
      while ((remaining = Math.max(previousStart + WRITE_INTERVAL_MS, resumeAt) - now()) > 0) {
        await wait(remaining);
      }
      previousStart = now();
      response = fetch(resource, options);
    });
    turn = next.catch(() => {});
    return next.then(() => response);
  }

  return async function pacedFetch(resource, options) {
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    const method = (options?.method || resource.method || 'GET').toUpperCase();
    if (!managedOrigins.has(url.origin) || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return fetch(resource, options);
    }
    for (let attempt = 1; attempt <= MAX_QUOTA_ATTEMPTS; attempt += 1) {
      const response = await dispatch(resource, options);
      if (response.status !== 429) return response;
      resumeAt = Math.max(resumeAt, now() + QUOTA_WAIT_MS);
      if (attempt === MAX_QUOTA_ATTEMPTS) return response;
      // Consume the failed response without logging URLs, headers or bodies.
      await response.text().catch(() => {});
      log.warn(`functions writes: quota retry ${attempt}/${MAX_QUOTA_ATTEMPTS - 1}; pausing writes for ${QUOTA_WAIT_MS / 1000}s`);
    }
  };
}

module.exports = { createPacedFetch, WRITE_INTERVAL_MS, QUOTA_WAIT_MS, MAX_QUOTA_ATTEMPTS };
