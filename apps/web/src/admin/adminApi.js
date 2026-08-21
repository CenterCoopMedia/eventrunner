// Admin HTTP client — the one seam between the admin UI and the deployed
// onRequest endpoints (functions/src/cms/*, functions/src/admin/config.cjs).
//
// Every admin endpoint is `POST <functionsOrigin>/<name>` with an
// `Authorization: Bearer <Firebase ID token>` header; the server's
// requireAdmin (core/auth.cjs) is the enforcement boundary — the client-side
// gate in AdminGate.jsx is convenience only.
//
// Failures normalize to AdminApiError carrying the server's `error.message`
// VERBATIM (spec: validation messages name the offending field, so rewriting
// them client-side would destroy the only useful part). `fieldErrors` splits
// that message into the per-field segments the server joined with '; ' so a
// form can mark individual inputs aria-invalid without inventing copy.
import { useCallback } from 'react';
import { functionsOrigin, useAuth } from '../contexts/AuthContext.jsx';

/** Leading context the server prepends before the joined field errors. */
const MESSAGE_PREFIX_RE = /^[^:]*Invalid [a-z]+:\s*/i;
const FIELD_SEGMENT_RE = /^([A-Za-z0-9_$[\].]+):\s*(.+)$/;

export class AdminApiError extends Error {
  constructor({ code, message, status, queueId = null }) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
    // cmsPublish reports a part-way failure as an error body PLUS a
    // top-level queueId, and resuming with { queueId } is what makes the
    // re-run skip the chunks that already committed (functions/src/cms/
    // publish.cjs). Dropping it here would turn every retry into a fresh
    // publish that re-publishes committed docs and double-bumps revisions,
    // so it is carried on the error rather than normalized away.
    this.queueId = queueId;
    this.fieldErrors = fieldErrorsOf(message);
  }
}

/**
 * Split a server validation message into `{ field, message }` segments.
 * Segments that do not start with `field:` are returned with field null, so
 * nothing is ever silently dropped.
 *
 * @param {string} message
 * @returns {Array<{ field: string|null, message: string }>}
 */
export function fieldErrorsOf(message) {
  if (typeof message !== 'string' || message.length === 0) return [];
  return message
    .replace(MESSAGE_PREFIX_RE, '')
    .split('; ')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const match = segment.match(FIELD_SEGMENT_RE);
      return match
        ? { field: match[1], message: segment }
        : { field: null, message: segment };
    });
}

/**
 * POST one admin endpoint with the caller's ID token.
 *
 * @param {string} name Deployed function name, e.g. 'cmsSavePage'.
 * @param {object} body JSON body.
 * @param {() => Promise<string>} getIdToken
 * @returns {Promise<object>} the parsed JSON response
 */
export async function callAdminEndpoint(name, body, getIdToken) {
  let token;
  try {
    token = await getIdToken();
  } catch {
    throw new AdminApiError({
      code: 'unauthenticated',
      status: 401,
      message: 'Your session has expired. Sign in again.',
    });
  }

  let response;
  try {
    response = await fetch(`${functionsOrigin()}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError({
      code: 'network',
      status: 0,
      message: 'We could not reach the server. Check your connection and try again.',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null; // non-JSON body (proxy error page); fall through
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new AdminApiError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Something went wrong. Try again.',
      queueId: typeof payload?.queueId === 'string' ? payload.queueId : null,
    });
  }
  return payload ?? {};
}

/**
 * `call(name, body)` bound to the signed-in user's ID token. Throws
 * AdminApiError('unauthenticated') when there is no user rather than
 * fetching without credentials.
 */
export function useAdminApi() {
  const { user } = useAuth();
  return useCallback(
    (name, body) =>
      callAdminEndpoint(name, body, () => {
        if (!user || typeof user.getIdToken !== 'function') {
          return Promise.reject(new Error('not signed in'));
        }
        return user.getIdToken();
      }),
    [user],
  );
}
