'use strict';

/**
 * HTTP plumbing shared by every console endpoint: CORS, the signed-in
 * check, and one error shape, `{ error: { code, message } }`, as in
 * functions/src/core. Each endpoint is a POST with a JSON body. The
 * console never trusts the browser for a write: the functions own every
 * write, and each one requires a verified email address.
 *
 * `message` is shown to the client as is, so it is plain words and never
 * holds a stack trace, a provider payload or another person's data.
 */

const BEARER_RE = /^Bearer\s+(\S+)$/i;

/**
 * An expected refusal. postEndpoint sends it as is. Set `fields` (field
 * path to message) to show the reasons next to the fields of a form.
 */
class ConsoleError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.name = 'ConsoleError';
    this.status = status;
    this.code = code;
  }
}

/**
 * `extras` adds detail for a form: `fields` (a map of field path to
 * message) or `field` (the one input a refusal is about, to focus).
 */
function sendError(res, status, code, message, extras = {}) {
  res.status(status).json({ error: { code, message, ...extras } });
}

/** @param {string|undefined} raw comma-separated origins @returns {string[]} */
function parseAllowedOrigins(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Header-only CORS, as in functions/src/core/http.cjs. The console web app
 * calls the functions through Hosting rewrites on its own origin, so CORS
 * matters only for a local dev server.
 *
 * @returns {boolean} true when the request was a preflight and is answered
 */
function applyCors(req, res, allowedOrigins) {
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function bearerToken(req) {
  const raw = typeof req?.get === 'function' ? req.get('Authorization') : req?.headers?.authorization;
  const match = typeof raw === 'string' ? raw.match(BEARER_RE) : null;
  return match ? match[1] : null;
}

/**
 * The signed-in caller, with a verified email address. The token is
 * checked for revocation, so a deleted or disabled account stops at once.
 *
 * @param {{ auth: { verifyIdToken: Function } }} deps
 * @returns {Promise<{ ok: true, uid: string, email: string } |
 *   { ok: false, status: number, code: string, message: string }>}
 */
async function requireVerifiedUser({ auth }, req) {
  const token = bearerToken(req);
  let decoded = null;
  if (token) {
    try {
      decoded = await auth.verifyIdToken(token, true);
    } catch {
      decoded = null;
    }
  }
  if (!decoded?.uid) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Sign in to continue.' };
  }
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email || decoded.email_verified !== true) {
    return {
      ok: false,
      status: 403,
      code: 'email-not-verified',
      message: 'We could not confirm your email address. Sign in with an emailed link to confirm it.',
    };
  }
  return { ok: true, uid: decoded.uid, email };
}

/**
 * Wrap one console action as an onRequest handler.
 *
 * `action({ body, user })` returns `{ status?, body }` or throws a
 * ConsoleError. Any other error is logged and answered with a plain 500.
 *
 * @param {{ auth: object, log?: { error: Function } }} deps
 * @param {(input: { body: object, user: { uid: string, email: string } }) =>
 *   Promise<{ status?: number, body: object }>} action
 */
function postEndpoint({ auth, log = console }, action) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      sendError(res, 405, 'method-not-allowed', 'Use POST.');
      return;
    }
    const gate = await requireVerifiedUser({ auth }, req);
    if (!gate.ok) {
      sendError(res, gate.status, gate.code, gate.message);
      return;
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendError(res, 400, 'bad-request', 'The request is not valid.');
      return;
    }
    try {
      const result = await action({ body, user: gate });
      res.status(result.status || 200).json(result.body);
    } catch (err) {
      if (err instanceof ConsoleError) {
        // A refusal caused by a failure (a mail provider error) is logged,
        // so the operator can see why; the caller sees only the message.
        if (err.cause) log.error('console endpoint refused after a failure', err.cause);
        if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
        const extras = {};
        if (err.fields && typeof err.fields === 'object') extras.fields = err.fields;
        if (typeof err.field === 'string') extras.field = err.field;
        sendError(res, err.status, err.code, err.message, extras);
        return;
      }
      log.error('console endpoint failed', err);
      sendError(res, 500, 'internal', 'Something went wrong. Try again.');
    }
  };
}

module.exports = { ConsoleError, applyCors, parseAllowedOrigins, postEndpoint, requireVerifiedUser, sendError };
