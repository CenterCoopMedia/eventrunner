'use strict';

/**
 * URL safety helpers shared by web and functions (spec §4.4, §9).
 *
 * Two distinct checks that must not be conflated:
 * - {@link isSafeUrl} — "may this be a link target" (protocol allowlist)
 * - {@link looksLikeUrl} — "is this string URL-shaped" (embargo scrub)
 */

/**
 * An ABSOLUTE http(s) URL starts with the scheme AND the two slashes.
 *
 * The protocol test alone was not enough, and the gap was not theoretical.
 * `new URL('https:video.example.org/watch')` parses and reports protocol
 * `https:` — the WHATWG parser treats a special scheme with no `//` as a
 * relative reference against the scheme — so the string passed every check
 * and was stored as if it named an external site. Put in an `href` it does
 * not go to video.example.org at all: the browser resolves it against the
 * page it sits on, and a reader clicking "Watch the recording" lands on
 * `/schedule/video.example.org/watch` on the event's own domain. A missing
 * pair of slashes is a typo an operator cannot see in the field and cannot
 * diagnose from the result, so it is refused at the point of entry.
 *
 * The regex gates the SYNTAX and the parse gates the rest; neither alone is
 * sufficient, so both run.
 */
const ABSOLUTE_HTTP_RE = /^https?:\/\//i;

/**
 * The canonical form of an http(s) URL, or '' when the input is not one.
 *
 * Returning the parsed `href` rather than the raw string is what makes the
 * check and the stored value agree: what a later reader clicks is exactly
 * the string this function approved, with the host lower-cased and every
 * component percent-encoded the way the parser reads it. Storing the raw
 * text instead leaves the door open to a value that validates as one URL
 * and resolves as another.
 *
 * @param {string} url
 * @returns {string} the canonical href, or '' if the URL is not a safe one
 */
function safeUrlHref(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!ABSOLUTE_HTTP_RE.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * Returns true if the URL is an absolute http(s) link.
 *
 * Rejects javascript:, data:, file:, blob:, mailto:, protocol-relative
 * `//host` shapes, scheme-without-slashes shapes (see ABSOLUTE_HTTP_RE) and
 * unparseable input — the protocol allowlist is the load-bearing check, not
 * a denylist. Used to gate user-submitted URLs (link-type session
 * materials, a session's recording link) before storing them or rendering
 * them as anchor tags or window.open targets.
 *
 * Every caller in this repo asks the same question — "may this be a link
 * target that leaves the site" — so the rule lives here rather than in one
 * of them, and the browser-side check a reader's page runs stays identical
 * to the one the server enforced on the way in.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSafeUrl(url) {
  return safeUrlHref(url) !== '';
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

module.exports = { isSafeUrl, safeUrlHref, looksLikeUrl, scrubLinkLabel };
