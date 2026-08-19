'use strict';

/**
 * Uniform HTTP error responses for onRequest handlers (spec §1.3 core/).
 *
 * Every error body has the same shape: `{ error: { code, message } }`.
 * `message` must be safe for the caller's eyes — no stack traces, no
 * provider payloads, no internal identifiers.
 */

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function badRequest(res, message) {
  sendError(res, 400, 'bad-request', message);
}

function unauthorized(res, message = 'Authentication required.') {
  sendError(res, 401, 'unauthorized', message);
}

function forbidden(res, message = 'Not allowed.') {
  sendError(res, 403, 'forbidden', message);
}

function notFound(res, message = 'Not found.') {
  sendError(res, 404, 'not-found', message);
}

function methodNotAllowed(res, allowed) {
  res.set('Allow', allowed.join(', '));
  sendError(res, 405, 'method-not-allowed', `Use ${allowed.join(' or ')}.`);
}

function internal(res, message = 'Internal error.') {
  sendError(res, 500, 'internal', message);
}

module.exports = {
  sendError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  internal,
};
