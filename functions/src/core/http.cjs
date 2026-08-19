'use strict';

/**
 * CORS handling for onRequest handlers (spec §1.3 core/).
 *
 * The allowed-origin list comes from EVENT_ALLOWED_ORIGINS (Tier A,
 * spec §2.1) — comma-separated origins, no wildcard support on purpose.
 */

/** @param {string|undefined} raw @returns {string[]} */
function parseAllowedOrigins(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply CORS headers and answer preflights.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ allowedOrigins: string[], methods?: string[] }} opts
 * @returns {boolean} true when the request was fully handled (a preflight)
 *   and the handler must return without doing work. Non-preflight requests
 *   always proceed: this helper is header-only CORS — the browser enforces
 *   the missing allow-origin header, and endpoint auth is a separate check,
 *   never this one.
 */
function applyCors(req, res, { allowedOrigins, methods = ['POST'] }) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', methods.join(', '));
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

module.exports = { applyCors, parseAllowedOrigins };
