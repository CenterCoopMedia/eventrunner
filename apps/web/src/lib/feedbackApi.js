// Public feedback submission (issue #28, spec §9 "Feedback inbox") — the
// browser side of submitFeedback. Unauthenticated by design (spec: any
// visitor can report a bug or leave feedback), so this never throws: a
// network failure or a non-2xx response comes back as `{ ok: false, error }`
// for the modal to show inline, the same fail-soft contract as
// lib/errorReporting.js's reportClientError.
import { resolveFunctionsOrigin } from './errorReporting.js';
import { IS_DEMO } from './demoMode.js';

/** Bound the entire request, including reading the response body. */
export const FEEDBACK_REQUEST_TIMEOUT_MS = 20_000;

const UNCONFIRMED_RECEIPT =
  'We could not confirm your feedback was received. Check your connection and try again. Your message is still here.';

/**
 * @param {{ message: string, email?: string, category?: string,
 *           honeypot: string, startedAt: number, submissionKey: string }} payload
 *   `submissionKey` is a per-form-session id the caller generates once and
 *   resends unchanged on a retry (FeedbackModal.jsx) — the server uses it as
 *   the feedback doc id, so a retry after a dropped response is idempotent
 *   instead of creating a duplicate row and a duplicate confirmation email.
 * @param {{ env?: object, fetchImpl?: typeof fetch, signal?: AbortSignal }} [deps]
 * @returns {Promise<{ ok: true, id?: string } | { ok: false, error: string }>}
 */
export async function submitFeedback(payload, deps = {}) {
  const {
    env = import.meta.env,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    signal,
  } = deps;
  // Static demo build (lib/demoMode.js): unauthenticated by design, so
  // nothing else gates this — the modal is only reachable when the event
  // config turns the feature on (Layout.jsx), which the demo snapshot does
  // not, but the seam must not depend on that staying true. Answered with
  // the module's ordinary fail-soft shape so the modal shows it inline.
  // Compile-time `false` in a normal client build.
  if (IS_DEMO) {
    return { ok: false, error: 'Feedback is disabled in this read-only demo.' };
  }
  if (!fetchImpl) {
    return { ok: false, error: 'This browser cannot send feedback right now.' };
  }
  const origin = resolveFunctionsOrigin(env);
  if (!origin) {
    return { ok: false, error: 'Feedback could not be sent. Try again later.' };
  }

  const unconfirmed = { ok: false, error: UNCONFIRMED_RECEIPT };
  if (signal?.aborted) return unconfirmed;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeout;
  let stop;
  const deadline = new Promise((resolve) => {
    stop = () => {
      // Resolve independently of abort: a transport or response reader may
      // ignore AbortSignal. A late result cannot replace this settled one.
      resolve(unconfirmed);
      controller?.abort();
    };
    timeout = setTimeout(stop, FEEDBACK_REQUEST_TIMEOUT_MS);
  });
  signal?.addEventListener('abort', stop, { once: true });

  async function request() {
    try {
      const response = await fetchImpl(`${origin}/submitFeedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        ...(controller || signal ? { signal: controller?.signal ?? signal } : {}),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const message = typeof body?.error?.message === 'string' ? body.error.message : null;
        return { ok: false, error: message || UNCONFIRMED_RECEIPT };
      }
      return { ok: true, id: typeof body?.id === 'string' ? body.id : undefined };
    } catch {
      // A lost response does not tell us whether the server committed the
      // feedback. The modal keeps the draft and its idempotency key.
      return unconfirmed;
    }
  }

  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
  }
}
