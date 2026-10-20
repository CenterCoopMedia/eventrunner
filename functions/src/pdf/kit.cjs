'use strict';

/**
 * Shared PDF helpers for pdf-lib documents (issue #209).
 *
 * These helpers were written for the schedule PDF (`schedule/pdf.cjs`,
 * spec §9) and moved here unchanged so the invoice PDF can use them too.
 * They do not know about sessions, days or invoices:
 *
 *   - `hexToRgb01` and `resolveThemeColors` turn `config/theme.colors` into
 *     the numeric RGB that pdf-lib's `rgb()` needs
 *   - `resolveBranding` reads the header text from `config/event`
 *   - `fitText` finds the largest font size that fits a width
 *   - `canEncode` and `sanitizeForFont` keep text that a WinAnsi standard
 *     font cannot draw from crashing the document
 *
 * Spec §7.6 allowlist: this file may hold hex literals because pdf-lib needs
 * numeric RGB, but the values in {@link DEFAULT_COLORS} are fallbacks only.
 * A configured theme always wins.
 */

const { configuredThemeColor } = require('shared/theme');

const DEFAULT_COLORS = Object.freeze({
  // Fallback palette (spec §7.6 allowlist path) — used only for the fields
  // a configured `config/theme.colors` doc omits. A fully-configured theme
  // never reaches these.
  primary: '#1F2933',
  ink: '#1F2933',
  inkMuted: '#52606D',
  surface: '#FFFFFF',
  accent: '#3E7CB1',
});

/** @param {*} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Hex color string ("#rgb" or "#rrggbb") to 0-1 RGB floats for pdf-lib's
 * `rgb()`. Returns null on anything that is not a valid hex color — callers
 * fall back to a default rather than crash a whole PDF generation over one
 * bad config value.
 *
 * @param {*} hex
 * @returns {{ r: number, g: number, b: number } | null}
 */
function hexToRgb01(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

/**
 * Resolve the theme colors this document needs, each falling back to
 * {@link DEFAULT_COLORS} independently when the configured value is
 * missing or not a valid hex color.
 *
 * @param {{ colors?: Record<string, string> } | null | undefined} theme
 * @returns {Record<keyof typeof DEFAULT_COLORS, { r: number, g: number, b: number }>}
 */
function resolveThemeColors(theme) {
  const colors = theme && typeof theme === 'object' ? theme.colors : null;
  const out = {};
  for (const key of Object.keys(DEFAULT_COLORS)) {
    const configured = configuredThemeColor(colors, key);
    out[key] = hexToRgb01(configured) || hexToRgb01(DEFAULT_COLORS[key]);
  }
  return out;
}

/**
 * Resolve the header/branding text this document needs from `config/event`.
 * Every field fails soft to a placeholder string rather than throwing or
 * printing "undefined" — a half-seeded config/event must still produce a
 * readable (if sparse) PDF.
 *
 * @param {object | null | undefined} event
 * @returns {{ name: string, tagline: string | null, venueLine: string | null }}
 */
function resolveBranding(event) {
  const name = isNonEmptyString(event?.name) ? event.name.trim() : 'Event schedule';
  const tagline = isNonEmptyString(event?.tagline) ? event.tagline.trim() : null;
  const venue = event?.venue;
  let venueLine = null;
  if (venue && typeof venue === 'object') {
    const parts = [venue.name, venue.city, venue.region].filter(isNonEmptyString);
    venueLine = parts.length > 0 ? parts.join(', ') : null;
  }
  return { name, tagline, venueLine };
}

/**
 * `fitText` binary search (spec §9, ported as-is): the largest integer font
 * size in `[minSize, maxSize]` whose rendered width (per `measure`) is
 * still `<= maxWidth`. Falls back to `minSize` when even the smallest size
 * overflows — callers accept the overflow rather than lose the size floor
 * (a 0pt label is worse than a slightly clipped one).
 *
 * @param {{ measure: (text: string, size: number) => number, text: string,
 *           maxWidth: number, maxSize: number, minSize?: number }} args
 * @returns {{ size: number, width: number }}
 */
function fitText({ measure, text, maxWidth, maxSize, minSize = 6 }) {
  if (!isNonEmptyString(text)) return { size: maxSize, width: 0 };
  if (!(maxSize >= minSize)) return { size: minSize, width: measure(text, minSize) };

  let lo = minSize;
  let hi = maxSize;
  let best = minSize;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const w = measure(text, mid);
    if (w <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { size: best, width: measure(text, best) };
}

// Strips Unicode combining diacritical marks (U+0300-U+036F) left behind by
// an NFKD decomposition — e.g. "é" -> "e" + U+0301, this removes the U+0301.
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/**
 * Whether `font` (a pdf-lib StandardFonts font, WinAnsi-encoded) can render
 * `text` without throwing. `widthOfTextAtSize` validates encodability the
 * same way `drawText` does, so this is a safe probe with no side effect.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {string} text
 * @returns {boolean}
 */
function canEncode(font, text) {
  try {
    font.widthOfTextAtSize(text, 12);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort sanitize free-text config/session/speaker content for a
 * WinAnsi-only standard font (Helvetica/HelveticaBold) before it is drawn.
 *
 * pdf-lib's standard fonts throw ("WinAnsi cannot encode ...") the instant
 * `drawText`/`widthOfTextAtSize` sees a character outside Windows-1252 —
 * which is most of Unicode: CJK, Arabic, Cyrillic, emoji, and Latin
 * characters beyond Latin-1 (e.g. Vietnamese, Turkish "ğ"). Left unhandled,
 * one event name or speaker name in any of those scripts 500s the whole
 * public endpoint.
 *
 * Tradeoff, chosen over embedding a Unicode font: a broad-coverage face
 * (e.g. Noto Sans + a CJK companion) that actually covers CJK/Arabic runs
 * several megabytes even subsetted to common ranges, which is a real cost
 * on every cold start of a Cloud Function whose only other dependency is
 * pdf-lib itself (functions ship no other font today, and fontkit's
 * subsetting still has to walk the full glyph table at embed time). This
 * sanitize step keeps the function's footprint unchanged and NEVER 500s;
 * the readable cost is that a CJK/Arabic-only title renders as the bracketed
 * fallback below, not its own script. If a client's schedule regularly needs
 * non-Latin display text, embedding a subset Unicode font via
 * `@pdf-lib/fontkit` is the follow-up — noted here rather than done
 * speculatively for zero configured deployments that need it yet.
 *
 * Per Unicode code point (not UTF-16 code unit, so a surrogate-pair emoji is
 * never split into two invalid lone surrogates):
 *   1. Encodable as-is (the common case: plain ASCII/Latin-1) -> kept.
 *   2. Not encodable, but NFKD-decomposing it and stripping combining marks
 *      yields an encodable base letter (accented Latin beyond Latin-1,
 *      e.g. "ế" -> "e") -> the transliterated form is kept.
 *   3. Still not encodable (CJK, Arabic, Cyrillic, emoji, ...) -> dropped.
 * If every character in a non-empty input drops, the whole string becomes
 * a bracketed placeholder rather than silently rendering blank.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {*} text
 * @returns {string}
 */
function sanitizeForFont(font, text) {
  if (typeof text !== 'string' || text === '') return '';
  if (canEncode(font, text)) return text; // fast path: no scan needed at all

  let out = '';
  for (const ch of text) {
    if (canEncode(font, ch)) {
      out += ch;
      continue;
    }
    const transliterated = ch.normalize('NFKD').replace(COMBINING_MARKS_RE, '');
    if (transliterated && transliterated !== ch && canEncode(font, transliterated)) {
      out += transliterated;
    }
    // else: unrecoverable in this font — dropped, not replaced per-character
    // (a run of "???" is worse than a shorter, still-readable string).
  }
  return out.trim() ? out : '(unsupported characters)';
}

module.exports = {
  DEFAULT_COLORS,
  isNonEmptyString,
  hexToRgb01,
  resolveThemeColors,
  resolveBranding,
  fitText,
  canEncode,
  sanitizeForFont,
};
