'use strict';

/**
 * URL safety helpers shared by web and functions (spec §4.4, §9).
 *
 * Two distinct checks that must not be conflated:
 * - {@link isSafeUrl} — "may this be a link target" (protocol allowlist)
 * - {@link looksLikeUrl} — "is this string URL-shaped" (embargo scrub)
 */

/**
 * Returns true if the URL parses and its protocol is http: or https:.
 *
 * Rejects javascript:, data:, file:, blob:, mailto: and unparseable input —
 * the protocol allowlist is the load-bearing check, not a denylist. Used to
 * gate user-submitted URLs (link-type session materials) before rendering
 * them as anchor tags or window.open targets.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSafeUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * True when a string is URL-shaped. Used as an embargo scrub on the
 * `filename` field of link-type session materials — that field reaches the
 * anonymously readable public projection, so a URL-shaped filename would
 * leak a material's URL past the session-ended embargo. Ported verbatim in
 * behavior from the reference implementation, including the bare-domain
 * regex. Server enforcement is the only gate that survives a future client
 * regression.
 *
 * Note the deliberate breadth: bare `domain.tld` shapes with no slash
 * (e.g. "slides.pdf") also match — file materials are never scrubbed
 * (spec §4.4), so this only ever fires on link labels, where over-matching
 * is safe.
 *
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeUrl(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.includes('://')) return true;
  // Bare domains like docs.example.org/abc — anything containing a slash
  // after a dot is URL-shaped enough that we don't trust it on the
  // public doc.
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return true;
  return false;
}

/**
 * Scrub a link material's display label. Returns the trimmed label, or
 * 'External link' when the label is empty or URL-shaped.
 *
 * This is the PR #438 embargo invariant (spec §4.4): a link material whose
 * label is blank or is itself the URL must never publish that URL as the
 * material's display name — the embargo would be defeated without the URL
 * ever touching a URL field. Applied on every write path AND in the
 * projection trigger (defense in depth). File materials are never passed
 * through this scrub.
 *
 * @param {string} label
 * @returns {string}
 */
function scrubLinkLabel(label) {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (!trimmed || looksLikeUrl(trimmed)) return 'External link';
  return trimmed;
}

module.exports = { isSafeUrl, looksLikeUrl, scrubLinkLabel };
