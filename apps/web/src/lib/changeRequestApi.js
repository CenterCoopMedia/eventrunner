// Change requests (issue #188) — the browser side of submitChangeRequest for
// the public footer dialog. The admin page sends through useAdminApi instead;
// both reach the same endpoint and the same store.
//
// The caller must be signed in: the server takes the sender's identity from
// the ID token and refuses a request without one. This never throws. A
// missing token, a network failure, or a refusal comes back as
// `{ ok: false, error }` for the dialog to state inline, the same fail-soft
// contract as lib/feedbackApi.js.
import { resolveFunctionsOrigin } from './errorReporting.js';
import { IS_DEMO } from './demoMode.js';

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
  const { user, env = import.meta.env, fetchImpl = typeof fetch === 'function' ? fetch : null } = deps;
  // The static demo has no endpoint. The flag is off in its snapshot, so the
  // footer control never shows there, but the seam must not depend on that.
  if (IS_DEMO) {
    return { ok: false, error: 'Change requests are off in this read-only demo.' };
  }
  if (!user || typeof user.getIdToken !== 'function') {
    return { ok: false, error: 'Sign in to send a change request.' };
  }
  let token;
  try {
    token = await user.getIdToken();
  } catch {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }
  if (!fetchImpl) {
    return { ok: false, error: 'This browser cannot send a change request right now.' };
  }
  const origin = resolveFunctionsOrigin(env);
  if (!origin) {
    return { ok: false, error: 'Your request could not be sent. Try again later.' };
  }

  let response;
  try {
    response = await fetchImpl(`${origin}/submitChangeRequest`, {
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
  return { ok: true, id: typeof body?.id === 'string' ? body.id : undefined };
}
