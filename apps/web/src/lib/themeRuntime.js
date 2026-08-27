// Runtime theme CSS builder (spec §7.2, design brief §3.3 and §3.6).
//
// config/theme arrives from Firestore carrying hex color strings as DATA.
// This module converts them to the same space-separated RGB triples the
// build-time generated/theme.css establishes, so EventConfigProvider can
// write a <style id="event-theme-runtime"> element that overrides the same
// custom properties — and Tailwind's rgb(var(--…-rgb) / <alpha-value>)
// utilities (tailwind.config.js) pick the change up live, opacity modifiers
// included. No color literals appear in this source file (spec §7.6); every
// value is computed from incoming data.
//
// This is the ONE runtime builder (brief §3.6). It now writes mode-scoped
// blocks, because every color token is defined per mode. Overrides may
// arrive in either shape:
//
//   colors: { primary: '#…', … }                 one palette (the shape
//                                                 every stored document has
//                                                 today). The dark values
//                                                 are derived from it.
//   colors: { light: { … }, dark: { … } }        per-mode overrides. Dark
//                                                 starts from the derivation
//                                                 and the named tokens win,
//                                                 so a partial dark override
//                                                 is enough.
import {
  THEME_MODES,
  THEME_MODE_POLICIES,
  THEME_FONT_ROLES,
  THEME_TEXTURES,
  DEFAULT_MODE_POLICY,
  canonicalColorKey,
  deriveDarkColors,
  deriveRuleColors,
} from 'shared/theme';

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

// Rule weight → custom property (brief §3.7). Rules are structure, so their
// color is ink mixed into the surface. A runtime override of ink or surface
// has to move the rules with it, or a restyled site keeps build-time rules
// on a new ground.
const RULE_PROPS = {
  hairline: '--rule-hairline-rgb',
  strong: '--rule-strong-rgb',
  nameplate: '--rule-nameplate-rgb',
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

// config/theme.radius id → [--radius-base, --radius-large] (spec §7.2).
const RADIUS_SCALES = {
  sharp: ['0px', '2px'],
  soft: ['8px', '16px'],
  round: ['16px', '28px'],
};

const HEX_DIGITS = '0123456789abcdef';

// The admin Branding tab edits exactly these vocabularies, so they are
// exported from here rather than duplicated: one definition of "which colors
// exist", "which font sets are bundled", and "which textures/radii/modes are
// legal" serves both the runtime CSS builder and the editor that feeds it.
// The lists that the SERVER also validates live in shared/theme, so the two
// sides cannot drift (themeRuntime.parity.test.js pins that).
/** config/theme.colors keys, in the order the Branding tab shows them. */
export const THEME_COLOR_KEYS = Object.freeze(Object.keys(COLOR_PROPS));
/** config/theme.colors key → the custom property it overrides. */
export const THEME_COLOR_PROPERTIES = Object.freeze({ ...COLOR_PROPS });
/** Bundled font-set ids (spec §7.4 allowlist). */
export const FONT_SET_IDS = Object.freeze(Object.keys(FONT_SETS));
/** config/theme.fonts roles (brief §3.2). */
export { THEME_FONT_ROLES };
/** config/theme.radius ids. */
export const RADIUS_IDS = Object.freeze(Object.keys(RADIUS_SCALES));
/** config/theme.texture values. */
export const TEXTURE_IDS = Object.freeze([...THEME_TEXTURES]);
/** config/theme.mode values (brief §3.3). */
export const MODE_POLICY_IDS = Object.freeze([...THEME_MODE_POLICIES]);
/** The mode policy a document without a `mode` field renders as. */
export { DEFAULT_MODE_POLICY };

/**
 * Convert a hex color string (data from config/theme) to `[r, g, b]`.
 * Accepts #rgb, #rrggbb, and #rrggbbaa (alpha ignored — opacity comes from
 * Tailwind's <alpha-value> modifiers), with or without the leading hash.
 * Returns null for anything that is not a valid hex color.
 *
 * @param {unknown} value
 * @returns {number[]|null}
 */
function hexToChannels(value) {
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
  return [channel(0), channel(2), channel(4)];
}

/**
 * Convert a hex color string to the space-separated RGB triple form the
 * theme custom properties use. Returns null for anything that is not a
 * valid hex color, so a malformed Firestore value degrades to the
 * build-time snapshot value instead of producing broken CSS.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function hexToRgbTriple(value) {
  const channels = hexToChannels(value);
  return channels ? channels.join(' ') : null;
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

/** @param {unknown} v @returns {boolean} */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Read `config/theme.colors` in either shape into one palette per mode.
 *
 * @param {unknown} colors
 * @returns {{ light: Record<string, number[]>, dark: Record<string, number[]> }}
 */
function readColorOverrides(colors) {
  const palettes = { light: {}, dark: {} };
  if (!isPlainObject(colors)) return palettes;

  const perMode = isPlainObject(colors.light) || isPlainObject(colors.dark);
  const lightSource = perMode ? colors.light : colors;
  for (const [key, hex] of Object.entries(lightSource || {})) {
    const channels = hexToChannels(hex);
    if (channels) palettes.light[canonicalColorKey(key)] = channels;
  }

  // Dark starts from the same derivation the generator runs, so a document
  // that names only one palette still restyles both modes.
  palettes.dark = deriveDarkColors(palettes.light);
  if (perMode) {
    for (const [key, hex] of Object.entries(colors.dark || {})) {
      const channels = hexToChannels(hex);
      if (channels) palettes.dark[canonicalColorKey(key)] = channels;
    }
  }
  return palettes;
}

/**
 * Build the override blocks for <style id="event-theme-runtime"> from a
 * config/theme document. Only properties the document validly specifies are
 * emitted — everything else keeps its build-time value from generated
 * theme.css. Returns '' when there is nothing to override.
 *
 * The light block carries two selectors. `:root` beats the generated
 * attribute-free baseline that first paint uses; `:root[data-mode='light']`
 * beats the generated light block once the runtime has written the
 * attribute. Both win on document order, because this element is appended
 * after the generated stylesheet.
 *
 * @param {object} themeDoc
 * @returns {string}
 */
export function buildRuntimeThemeCss(themeDoc) {
  if (!isPlainObject(themeDoc)) return '';

  const rootLines = [];
  const fonts = themeDoc.fonts || {};
  for (const role of THEME_FONT_ROLES) {
    const stack = FONT_SETS[fonts[role]];
    if (stack) rootLines.push(`  --font-${role}: ${stack};`);
  }

  const radius = RADIUS_SCALES[themeDoc.radius];
  if (radius) {
    rootLines.push(`  --radius-base: ${radius[0]};`);
    rootLines.push(`  --radius-large: ${radius[1]};`);
  }

  if (THEME_TEXTURES.includes(themeDoc.texture)) {
    rootLines.push(`  --texture: ${themeDoc.texture};`);
  }

  const palettes = readColorOverrides(themeDoc.colors);
  const modeLines = { light: [], dark: [] };
  for (const mode of THEME_MODES) {
    const palette = palettes[mode];
    for (const [key, prop] of Object.entries(COLOR_PROPS)) {
      if (palette[key]) modeLines[mode].push(`  ${prop}: ${palette[key].join(' ')};`);
    }
    if (palette.ink && palette.surface) {
      const rules = deriveRuleColors({ ink: palette.ink, surface: palette.surface });
      for (const [weight, prop] of Object.entries(RULE_PROPS)) {
        modeLines[mode].push(`  ${prop}: ${rules[weight].join(' ')};`);
      }
    }
  }

  const blocks = [];
  if (rootLines.length > 0) blocks.push(`:root {\n${rootLines.join('\n')}\n}`);
  if (modeLines.light.length > 0) {
    blocks.push(`:root,\n:root[data-mode='light'] {\n${modeLines.light.join('\n')}\n}`);
  }
  if (modeLines.dark.length > 0) {
    blocks.push(`:root[data-mode='dark'] {\n${modeLines.dark.join('\n')}\n}`);
  }
  if (blocks.length === 0) return '';
  return `${blocks.join('\n')}\n`;
}
