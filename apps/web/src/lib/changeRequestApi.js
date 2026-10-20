// Change requests (issue #188) — the browser side of submitChangeRequest for
// the public footer dialog, and of listMyChangeRequests for the requester's
// own page (issue #330). The admin page sends through useAdminApi instead;
// both reach the same endpoints and the same store.
//
// The caller must be signed in: the server takes the identity from the ID
// token and refuses a call without one. Neither call throws. A missing
// token, a network failure, or a refusal comes back as `{ ok: false, error }`
// for the page to state inline, the same fail-soft contract as
// lib/feedbackApi.js.
import { resolveFunctionsOrigin } from './errorReporting.js';
import { IS_DEMO } from './demoMode.js';

/**
 * POST one JSON body to a change request endpoint with the reader's token.
 *
 * @param {string} name the endpoint
 * @param {object} payload
 * @param {{ user: object|null, env?: object, fetchImpl?: typeof fetch,
 *           words: { signedOut: string, noBrowser: string, noServer: string } }} deps
 *   `words` are the refusals for no user, no fetch, and no endpoint origin
 * @returns {Promise<{ ok: true, body: object|null } | { ok: false, error: string }>}
 */
async function post(name, payload, deps) {
  const { user, env = import.meta.env, fetchImpl = typeof fetch === 'function' ? fetch : null, words } = deps;
  // The static demo has no endpoint. The flag is off in its snapshot, so the
  // footer control never shows there, but the seam must not depend on that.
  if (IS_DEMO) {
    return { ok: false, error: 'Change requests are off in this read-only demo.' };
  }
  if (!user || typeof user.getIdToken !== 'function') {
    return { ok: false, error: words.signedOut };
  }
  let token;
  try {
    token = await user.getIdToken();
  } catch {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }
  if (!fetchImpl) {
    return { ok: false, error: words.noBrowser };
  }
  const origin = resolveFunctionsOrigin(env);
  if (!origin) {
    return { ok: false, error: words.noServer };
  }

  let response;
  try {
    response = await fetchImpl(`${origin}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.' };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : null;
    return { ok: false, error: message || 'Something went wrong. Try again.' };
  }
  return { ok: true, body };
}

/**
 * @param {{ message: string, page?: string|null, submissionKey: string }} payload
 *   `submissionKey` is made once per dialog and resent unchanged on a retry,
 *   so a retry after a dropped response finds the stored request instead of
 *   storing a second one.
 * @param {{ user: { getIdToken: () => Promise<string> }|null,
 *           env?: object, fetchImpl?: typeof fetch }} deps
 * @returns {Promise<{ ok: true, id?: string } | { ok: false, error: string }>}
 */
export async function submitChangeRequest(payload, deps = {}) {
  const result = await post('submitChangeRequest', payload, {
    ...deps,
    words: {
      signedOut: 'Sign in to send a change request.',
      noBrowser: 'This browser cannot send a change request right now.',
      noServer: 'Your request could not be sent. Try again later.',
    },
  });
  if (!result.ok) return result;
  return { ok: true, id: typeof result.body?.id === 'string' ? result.body.id : undefined };
}

/**
 * The signed-in reader's own change requests, newest first, as the server
 * shapes them for a requester (functions/src/admin/changeRequests.cjs
 * requesterView): no address, no uid, no staff field.
 *
 * @param {{ user: { getIdToken: () => Promise<string> }|null,
 *           env?: object, fetchImpl?: typeof fetch }} deps
 * @returns {Promise<{ ok: true, requests: object[] } | { ok: false, error: string }>}
 */
export async function listMyChangeRequests(deps = {}) {
  const result = await post('listMyChangeRequests', {}, {
    ...deps,
    words: {
      signedOut: 'Sign in to see your change requests.',
      noBrowser: 'This browser cannot load your change requests right now.',
      noServer: 'Your change requests could not be loaded. Try again later.',
    },
  });
  if (!result.ok) return result;
  return { ok: true, requests: Array.isArray(result.body?.requests) ? result.body.requests : [] };
}
