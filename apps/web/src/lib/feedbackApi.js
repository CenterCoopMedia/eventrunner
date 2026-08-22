// Public feedback submission (issue #28, spec §9 "Feedback inbox") — the
// browser side of submitFeedback. Unauthenticated by design (spec: any
// visitor can report a bug or leave feedback), so this never throws: a
// network failure or a non-2xx response comes back as `{ ok: false, error }`
// for the modal to show inline, the same fail-soft contract as
// lib/errorReporting.js's reportClientError.
import { resolveFunctionsOrigin } from './errorReporting.js';

/**
 * @param {{ message: string, email?: string, category?: string,
 *           honeypot: string, startedAt: number, submissionKey: string }} payload
 *   `submissionKey` is a per-form-session id the caller generates once and
 *   resends unchanged on a retry (FeedbackModal.jsx) — the server uses it as
 *   the feedback doc id, so a retry after a dropped response is idempotent
 *   instead of creating a duplicate row and a duplicate confirmation email.
 * @param {{ env?: object, fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<{ ok: true, id?: string } | { ok: false, error: string }>}
 */
export async function submitFeedback(payload, deps = {}) {
  const { env = import.meta.env, fetchImpl = typeof fetch === 'function' ? fetch : null } = deps;
  if (!fetchImpl) {
    return { ok: false, error: 'This browser cannot send feedback right now.' };
  }
  const origin = resolveFunctionsOrigin(env);
  if (!origin) {
    return { ok: false, error: 'Feedback could not be sent. Try again later.' };
  }

  let response;
  try {
    response = await fetchImpl(`${origin}/submitFeedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
