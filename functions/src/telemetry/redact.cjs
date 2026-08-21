'use strict';

/**
 * PII redaction for client-error telemetry (spec §9, issue #10).
 *
 * Client error reports carry free text an attacker or an honest bug can
 * fill with anything — a stack frame that happens to include a query
 * string, a message that echoes back a signed-in user's email. This module
 * is the one place that text is scrubbed before it reaches `system_errors`
 * (an admin-readable collection), so every redaction rule lives here and
 * is unit-tested on its own rather than re-derived per call site.
 *
 * Deliberately pattern-based, not an allowlist: the input is unstructured
 * text (error messages, stack traces, URLs), so there is no schema to
 * validate against. Over-redaction (turning a coincidental 40-char string
 * into `[redacted-token]`) is the safe failure mode; under-redaction is not.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Three dot-separated base64url segments — the JWT shape, regardless of
// whether it decodes to anything meaningful.
const JWT_RE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi;

// Query-string / form-encoded param names that carry credentials. Matches
// `key=value` whether the pair sits after a real `?`/`&` or just appears in
// running text (a stack frame printing a fetch URL, for instance).
const CREDENTIAL_PARAM_NAMES =
  '(?:token|code|key|secret|password|pass|auth|apikey|api_key|access_token|id_token|session|sig|signature)';
const CREDENTIAL_PARAM_RE = new RegExp(
  `([?&]${CREDENTIAL_PARAM_NAMES}=)([^&\\s"'<>]*)`,
  'gi',
);

/**
 * Redact emails, bearer/JWT-shaped tokens, and credential-bearing
 * query-string values out of free text.
 * @param {string} value
 * @returns {string}
 */
function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(BEARER_RE, 'Bearer [redacted-token]')
    .replace(JWT_RE, '[redacted-token]')
    .replace(CREDENTIAL_PARAM_RE, '$1[redacted]');
}

/**
 * Redact a URL. Absolute URLs are parsed so only credential-shaped query
 * param *values* are replaced (the rest of the URL — host, path, other
 * params — is preserved for debugging); anything that fails to parse (a
 * relative path, a malformed string) falls back to the text-level scrub,
 * which still catches `?token=...`-shaped substrings.
 * @param {string} url
 * @returns {string}
 */
function redactUrl(url) {
  if (typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (new RegExp(`^${CREDENTIAL_PARAM_NAMES}$`, 'i').test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return redactText(parsed.toString());
  } catch {
    return redactText(url);
  }
}

module.exports = {
  redactText,
  redactUrl,
  internals: { EMAIL_RE, JWT_RE, BEARER_RE, CREDENTIAL_PARAM_RE },
};
