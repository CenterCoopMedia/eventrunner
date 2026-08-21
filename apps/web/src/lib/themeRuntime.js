// Runtime theme CSS builder (spec §7.2).
//
// config/theme arrives from Firestore carrying hex color strings as DATA.
// This module converts them to the same space-separated RGB triples the
// build-time generated/theme.css establishes, so EventConfigProvider can
// write a <style id="event-theme-runtime"> element that overrides the same
// :root custom properties — and Tailwind's rgb(var(--…-rgb) / <alpha-value>)
// utilities (tailwind.config.js) pick the change up live, opacity modifiers
// included. No color literals appear in this source file (spec §7.6); every
// value is computed from incoming data.

// config/theme.colors key → custom property it overrides.
const COLOR_PROPS = {
  primary: '--brand-primary-rgb',
  primaryDark: '--brand-primary-dark-rgb',
  primaryLight: '--brand-primary-light-rgb',
  accent: '--brand-accent-rgb',
  surface: '--brand-surface-rgb',
  surfaceAlt: '--brand-surface-alt-rgb',
  ink: '--brand-ink-rgb',
  inkMuted: '--brand-ink-muted-rgb',
  success: '--semantic-success-rgb',
  warning: '--semantic-warning-rgb',
  danger: '--semantic-danger-rgb',
  highlight: '--semantic-highlight-rgb',
  keynote: '--semantic-keynote-rgb',
};

// Bundled font-set allowlist (spec §7.4). config/theme.fonts names a set id;
// the stacks must match the @font-face families self-hosted in public/fonts
// (declared in generated/theme.css — the runtime override only swaps which
// family a role resolves to, it never introduces a remote font).
const FONT_SETS = {
  'serif-editorial':
    "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  'sans-humanist':
    "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
  'script-casual': "'Caveat', 'Segoe Script', 'Bradley Hand', cursive",
};

const FONT_ROLES = ['heading', 'body', 'accent'];

// config/theme.radius id → [--radius-base, --radius-large] (spec §7.2).
const RADIUS_SCALES = {
  sharp: ['0px', '2px'],
  soft: ['8px', '16px'],
  round: ['16px', '28px'],
};

const TEXTURES = ['paper', 'flat'];

const HEX_DIGITS = '0123456789abcdef';

// The admin Branding tab edits exactly these vocabularies, so they are
// exported from here rather than duplicated: one definition of "which colors
// exist", "which font sets are bundled", and "which textures/radii are legal"
// serves both the runtime CSS builder and the editor that feeds it.
/** config/theme.colors keys, in the order the Branding tab shows them. */
export const THEME_COLOR_KEYS = Object.freeze(Object.keys(COLOR_PROPS));
/** config/theme.colors key → the custom property it overrides. */
export const THEME_COLOR_PROPERTIES = Object.freeze({ ...COLOR_PROPS });
/** Bundled font-set ids (spec §7.4 allowlist). */
export const FONT_SET_IDS = Object.freeze(Object.keys(FONT_SETS));
/** config/theme.fonts roles. */
export const THEME_FONT_ROLES = Object.freeze([...FONT_ROLES]);
/** config/theme.radius ids. */
export const RADIUS_IDS = Object.freeze(Object.keys(RADIUS_SCALES));
/** config/theme.texture values. */
export const TEXTURE_IDS = Object.freeze([...TEXTURES]);

/**
 * Convert a hex color string (data from config/theme) to the
 * space-separated RGB triple form the theme custom properties use.
 * Accepts #rgb, #rrggbb, and #rrggbbaa (alpha ignored — opacity comes from
 * Tailwind's <alpha-value> modifiers), with or without the leading hash.
 * Returns null for anything that is not a valid hex color, so a malformed
 * Firestore value degrades to the build-time snapshot value instead of
 * producing broken CSS.
 */
export function hexToRgbTriple(value) {
  if (typeof value !== 'string') return null;
  let digits = value.trim().toLowerCase();
  if (digits.startsWith('#')) digits = digits.slice(1);
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (digits.length === 8) digits = digits.slice(0, 6);
  if (digits.length !== 6) return null;

  const nibbles = [];
  for (const ch of digits) {
    const n = HEX_DIGITS.indexOf(ch);
    if (n === -1) return null;
    nibbles.push(n);
  }
  const channel = (i) => nibbles[i] * 16 + nibbles[i + 1];
  return `${channel(0)} ${channel(2)} ${channel(4)}`;
}

/**
 * Inverse of hexToRgbTriple: turn a space- or comma-separated RGB triple (the
 * form the theme custom properties hold) back into a hex color string. Used
 * by the admin Branding tab to seed its color inputs from the build-time
 * palette when config/theme carries no `colors` map yet. Returns null for
 * anything that is not three 0-255 channels. No color literals here either —
 * the digits are computed from the incoming numbers.
 *
 * @param {unknown} triple e.g. '42 157 143'
 * @returns {string|null}
 */
export function rgbTripleToHex(triple) {
  if (typeof triple !== 'string') return null;
  const parts = triple.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const digits = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    digits.push(HEX_DIGITS[Math.floor(value / 16)], HEX_DIGITS[value % 16]);
  }
  return `#${digits.join('')}`;
}

/**
 * Build the :root override block for <style id="event-theme-runtime"> from a
 * config/theme document. Only properties the document validly specifies are
 * emitted — everything else keeps its build-time value from generated
 * theme.css. Returns '' when there is nothing to override.
 */
export function buildRuntimeThemeCss(themeDoc) {
  if (!themeDoc || typeof themeDoc !== 'object') return '';
  const lines = [];

  const colors = themeDoc.colors || {};
  for (const [key, prop] of Object.entries(COLOR_PROPS)) {
    const triple = hexToRgbTriple(colors[key]);
    if (triple) lines.push(`  ${prop}: ${triple};`);
  }

  const fonts = themeDoc.fonts || {};
  for (const role of FONT_ROLES) {
    const stack = FONT_SETS[fonts[role]];
    if (stack) lines.push(`  --font-${role}: ${stack};`);
  }

  const radius = RADIUS_SCALES[themeDoc.radius];
  if (radius) {
    lines.push(`  --radius-base: ${radius[0]};`);
    lines.push(`  --radius-large: ${radius[1]};`);
  }

  if (TEXTURES.includes(themeDoc.texture)) {
    lines.push(`  --texture: ${themeDoc.texture};`);
  }

  if (lines.length === 0) return '';
  return `:root {\n${lines.join('\n')}\n}\n`;
}
