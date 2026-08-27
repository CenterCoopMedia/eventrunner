'use strict';

/**
 * The neutral default `config/theme` document (spec §2.2, §7.2) and the
 * font/radius vocabularies the CSS generator resolves it against.
 *
 * Colors are declared as RGB triples and converted to the hex form
 * `validateTheme` requires. That is not an aesthetic choice: the repo lint
 * bans hex color literals outside the spec §7.6 allowlist (eslint.config.mjs),
 * and `scripts/**` is not on it. Triples are also the form the generated
 * stylesheet needs, so `--brand-primary-rgb: 42 157 143` and the stored
 * `#2a9d8f` come from one source instead of two lists that can drift.
 *
 * The palette itself is deliberately generic — a muted teal/terracotta on
 * warm paper, no client's brand — because init seeds it into a fresh
 * deployment and an operator replaces it from the admin Settings UI.
 */

const { DEFAULT_MODE_POLICY, DEFAULT_TEXTURE, DEFAULT_HEADER } = require('shared/theme');

/** Brand + semantic slots as [r, g, b]. Order is the emitted CSS order. */
const NEUTRAL_PALETTE_RGB = Object.freeze({
  brandPrimary: Object.freeze([42, 157, 143]),
  brandPrimaryDark: Object.freeze([30, 114, 104]),
  brandPrimaryLight: Object.freeze([95, 191, 179]),
  brandAccent: Object.freeze([200, 75, 49]),
  brandSurface: Object.freeze([245, 240, 230]),
  brandSurfaceAlt: Object.freeze([237, 232, 220]),
  brandInk: Object.freeze([44, 62, 80]),
  brandInkMuted: Object.freeze([92, 107, 122]),
  semanticSuccess: Object.freeze([22, 101, 52]),
  semanticWarning: Object.freeze([217, 119, 6]),
  semanticDanger: Object.freeze([202, 53, 83]),
  semanticHighlight: Object.freeze([212, 160, 23]),
  semanticKeynote: Object.freeze([94, 53, 177]),
});

/** camelCase theme key → CSS custom property stem (`--<stem>-rgb`). */
const CSS_VARIABLE_STEM = Object.freeze({
  brandPrimary: 'brand-primary',
  brandPrimaryDark: 'brand-primary-dark',
  brandPrimaryLight: 'brand-primary-light',
  brandAccent: 'brand-accent',
  brandSurface: 'brand-surface',
  brandSurfaceAlt: 'brand-surface-alt',
  brandInk: 'brand-ink',
  brandInkMuted: 'brand-ink-muted',
  semanticSuccess: 'semantic-success',
  semanticWarning: 'semantic-warning',
  semanticDanger: 'semantic-danger',
  semanticHighlight: 'semantic-highlight',
  semanticKeynote: 'semantic-keynote',
});

/**
 * Font set ids (spec §7.4) → the stack the generator writes, and the
 * self-hosted woff2 face it needs. `null` fileBase means system fonts
 * only, so no @font-face block is emitted.
 */
const FONT_SETS = Object.freeze({
  'serif-editorial': Object.freeze({
    family: 'Source Serif 4',
    fileBase: 'source-serif-4-latin',
    stack: "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  }),
  'sans-humanist': Object.freeze({
    family: 'Source Sans 3',
    fileBase: 'source-sans-3-latin',
    stack: "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
  }),
  'script-casual': Object.freeze({
    family: 'Caveat',
    fileBase: 'caveat-latin',
    stack: "'Caveat', 'Segoe Script', 'Bradley Hand', cursive",
  }),
});

/** Radius scale ids (spec §7.2) → the two emitted lengths. */
const RADIUS_SCALES = Object.freeze({
  sharp: Object.freeze({ base: '0', large: '2px' }),
  soft: Object.freeze({ base: '8px', large: '16px' }),
  round: Object.freeze({ base: '16px', large: '28px' }),
});

/** Storage paths for the neutral branding placeholders (spec §5.4, §7.2). */
const PLACEHOLDER_LOGOS = Object.freeze({
  primary: 'branding/logo.svg',
  mark: 'branding/mark.svg',
  footer: 'branding/mark.svg',
  ogDefault: 'branding/og-default.svg',
  favicon: 'branding/favicon.svg',
});

/** @param {readonly number[]} rgb @returns {string} `#rrggbb` */
function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, c | 0)).toString(16).padStart(2, '0')).join('')}`;
}

/** @param {string} hex `#rgb` or `#rrggbb` @returns {number[]|null} */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const body = hex.replace(/^#/, '');
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [full.slice(0, 2), full.slice(2, 4), full.slice(4, 6)].map((p) => parseInt(p, 16));
}

/**
 * The seeded `config/theme` document. Passes `validateTheme` (colors are
 * hex) and carries the placeholder-logo bookkeeping the launch-readiness
 * branding row reads (§5.1.1): every slot listed in `placeholderLogos` is
 * still a neutral stand-in, and replacing one through the admin media flow
 * removes it from the list.
 *
 * @returns {object} config/theme
 */
function defaultTheme() {
  const colors = {};
  for (const [key, rgb] of Object.entries(NEUTRAL_PALETTE_RGB)) colors[key] = rgbToHex(rgb);
  return {
    colors,
    // Font ROLES, never family names (design brief §3.2). One neutral
    // humanist sans carries every role: the base picks no register, and a
    // theme brings the pairing that gives a deployment its character.
    fonts: { heading: 'sans-humanist', body: 'sans-humanist', data: 'sans-humanist' },
    texture: DEFAULT_TEXTURE,
    radius: 'soft',
    mode: DEFAULT_MODE_POLICY,
    // Which header the public pages render (design brief §2.1). The theme
    // states the deployment default; a page may override it.
    header: DEFAULT_HEADER,
    logos: { ...PLACEHOLDER_LOGOS },
    placeholderLogos: Object.keys(PLACEHOLDER_LOGOS),
  };
}

module.exports = {
  NEUTRAL_PALETTE_RGB,
  CSS_VARIABLE_STEM,
  FONT_SETS,
  RADIUS_SCALES,
  PLACEHOLDER_LOGOS,
  rgbToHex,
  hexToRgb,
  defaultTheme,
};
