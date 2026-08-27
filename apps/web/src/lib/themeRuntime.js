// Runtime theme CSS builder (spec §7.2, design brief §3.3, §3.6, §4, §5.2).
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
// This is the ONE runtime builder (brief §3.6), and it leans on the ONE
// resolver in shared/theme (brief §5.2). It never decides what a preset
// means; it asks. What it owns is turning that answer into CSS text.
//
// What a document may say, and what wins:
//
//   preset          the base look. Its two authored palettes, its type map,
//                   its shape, and its motif default (brief §4).
//   optionPicks     which curated option is picked in each of that preset's
//                   option groups. An option remaps existing tokens only.
//   tokens          per-mode raw color overrides — the advanced path.
//   colors          the legacy palette. For a PRESET document this is an
//                   output, materialized on publish for email and PDF, and
//                   the resolver ignores it on the way in. For a document
//                   with no preset it is still the palette, exactly as
//                   before, with the dark values derived from it.
//   fonts           a role named outright, overriding the preset's type map.
//   motifSet        which motif set data-motif-set switches to (brief §3.8).
//   adminAccent     the one client-owned colour in the admin identity.
//
// SPECIFICITY. The generated stylesheet now carries one block per
// (preset, mode) pair, and `:root[data-theme='zine'][data-mode='dark']` is
// more specific than `:root[data-mode='dark']`. So each mode block below
// names a `[data-theme]` selector too. Attribute-presence and
// attribute-equals have the same specificity, so the two tie and this
// element wins on document order — it is appended after the generated
// stylesheet.
import {
  THEME_MODES,
  THEME_MODE_POLICIES,
  THEME_FONT_ROLES,
  THEME_TEXTURES,
  THEME_PRESET_IDS,
  THEME_MOTIF_SET_IDS,
  THEME_NAV_PLACEMENTS,
  DEFAULT_MODE_POLICY,
  DEFAULT_PRESET_ID,
  ADMIN_TOKEN_SET,
  deriveRuleColors,
  resolveAdminAccent,
  resolveComponentFonts,
  resolveFontRoles,
  resolveMotifSet,
  resolvePresetTokens,
  resolveShape,
  resolveThemePalettes,
  themePresetId,
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
// on a new ground. `control` rides the same table for the same reason: a
// form control's border (WCAG 1.4.11) is ink mixed into the surface too, at
// a share high enough to clear 3:1 against either ground.
const RULE_PROPS = {
  hairline: '--rule-hairline-rgb',
  control: '--color-border-control-rgb',
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
  'caslon-display':
    "'Libre Caslon Display', 'Libre Caslon Text', Georgia, 'Times New Roman', serif",
  'caslon-text': "'Libre Caslon Text', Georgia, 'Times New Roman', serif",
  baskerville: "'Libre Baskerville', Baskerville, Georgia, 'Times New Roman', serif",
  spectral: "'Spectral', 'Source Serif 4', Georgia, serif",
  fraunces: "'Fraunces', 'Source Serif 4', Georgia, serif",
  newsreader: "'Newsreader', 'Source Serif 4', Georgia, serif",
  'plex-sans':
    "'IBM Plex Sans', 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
  'plex-mono': "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  'archivo-condensed': "'Archivo Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  merriweather: "'Merriweather', Georgia, 'Times New Roman', serif",
  'public-sans':
    "'Public Sans', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, system-ui, sans-serif",
  karrik: "'Karrik', 'Arial Black', Impact, sans-serif",
  bagnard: "'Bagnard', Georgia, 'Times New Roman', serif",
  avara: "'Avara', Georgia, 'Times New Roman', serif",
  'fragment-mono': "'Fragment Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  besley: "'Besley', 'Clarendon', Georgia, 'Times New Roman', serif",
  vollkorn: "'Vollkorn', Georgia, 'Times New Roman', serif",
  overpass:
    "'Overpass', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, system-ui, sans-serif",
  'overpass-mono': "'Overpass Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  'libre-franklin':
    "'Libre Franklin', 'Franklin Gothic', 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

// config/theme.radius id → [--radius-base, --radius-large] (spec §7.2).
const RADIUS_SCALES = {
  sharp: ['0px', '2px'],
  small: ['2px', '4px'],
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
/** Set id → the stack a role resolves to. Must match the generator's. */
export const FONT_SET_STACKS = Object.freeze({ ...FONT_SETS });
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
/** The six preset ids (brief §4). data-theme carries one of these. */
export const PRESET_IDS = Object.freeze([...THEME_PRESET_IDS]);
/** The preset a new deployment starts on. */
export { DEFAULT_PRESET_ID };
/** The motif sets data-motif-set switches between (brief §3.8). */
export const MOTIF_SET_IDS = Object.freeze([...THEME_MOTIF_SET_IDS]);

/** Where the site puts its navigation (shared/theme THEME_NAV_PLACEMENTS). */
export const NAV_PLACEMENT_IDS = Object.freeze([...THEME_NAV_PLACEMENTS]);

/**
 * What each placement is called, in an operator's words.
 *
 * ONE SET OF WORDS, because the setting is offered in two places — once for
 * the site on the Branding tab, once as a per-page exception in the page
 * editor — and an operator who sets it in one and then reads the other has
 * to recognize their own choice. Two names for one value is two settings as
 * far as they can tell.
 */
export const NAV_PLACEMENT_LABELS = Object.freeze({
  top: 'Across the top',
  side: 'Down the side',
});

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
 * Build the override blocks for <style id="event-theme-runtime"> from a
 * config/theme document. Only properties the document validly resolves are
 * emitted — everything else keeps its build-time value from generated
 * theme.css. Returns '' when there is nothing to override.
 *
 * Each block names every selector it has to beat:
 *
 *   :root                                    the attribute-free baseline
 *                                            first paint renders.
 *   :root[data-mode='light'|'dark']          the generated mode block.
 *   :root[data-theme][data-mode='…']         the generated (preset, mode)
 *                                            block, which is more specific
 *                                            than the one above it.
 *
 * All three are in one rule, so a single declaration list serves them and
 * document order decides — this element is appended after the generated
 * stylesheet.
 *
 * @param {object} themeDoc
 * @returns {string}
 */
export function buildRuntimeThemeCss(themeDoc) {
  if (!isPlainObject(themeDoc)) return '';

  const rootLines = [];

  // The type map: the preset's, then its picked heading-face option, then
  // any role the document names outright. One resolver answers all three.
  const roles = resolveFontRoles(themeDoc);
  for (const role of THEME_FONT_ROLES) {
    const stack = FONT_SETS[roles[role]];
    if (stack) rootLines.push(`  --font-${role}: ${stack};`);
  }
  // Component-token faces beyond the four roles. Zine's --callout-font is
  // the only one at launch: a component token, not a fifth role.
  for (const [name, setId] of Object.entries(resolveComponentFonts(themeDoc))) {
    const stack = FONT_SETS[setId];
    if (stack) rootLines.push(`  ${name}: ${stack};`);
  }

  // A document that names no preset overrides only what it names outright,
  // exactly as it did before presets existed: density and the motif-set
  // record are a preset's to state, so they stay out of the block unless a
  // preset or the document itself puts them there.
  const presetId = themePresetId(themeDoc);
  const shape = resolveShape(themeDoc);
  const radius = RADIUS_SCALES[shape.radius];
  if (radius) {
    rootLines.push(`  --radius-base: ${radius[0]};`);
    rootLines.push(`  --radius-large: ${radius[1]};`);
  }
  if (THEME_TEXTURES.includes(shape.texture)) {
    rootLines.push(`  --texture: ${shape.texture};`);
  }
  if (presetId && shape.density) rootLines.push(`  --density: ${shape.density};`);

  // The preset's own token remaps, then the picked options'. Every name is
  // a tier 2 or tier 3 token the generated stylesheet already declares: an
  // option never adds a property name (brief §3.4).
  for (const [name, value] of Object.entries(resolvePresetTokens(themeDoc))) {
    rootLines.push(`  ${name}: ${value};`);
  }

  // The record of which motif set is active. It does NOT do the switching:
  // data-motif-set on the root element does, against the [data-motif-set]
  // blocks in the generated stylesheet (brief §3.8).
  if (presetId || THEME_MOTIF_SET_IDS.includes(themeDoc.motifSet)) {
    rootLines.push(`  --motif-set: ${resolveMotifSet(themeDoc)};`);
  }

  const palettes = resolveThemePalettes(themeDoc);
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
    // The one client-owned colour in the admin identity, with its legibility
    // floor applied per mode (admin story part 6f). A failing accent falls
    // back to the admin ink; it is never clamped, and the editor states what
    // it fell back to.
    const accent = resolveAdminAccent(themeDoc, mode);
    if (accent.rgb) {
      modeLines[mode].push(`  --admin-client-accent-rgb: ${accent.rgb.join(' ')};`);
    }
  }

  const blocks = [];
  if (rootLines.length > 0) blocks.push(`:root {\n${rootLines.join('\n')}\n}`);
  for (const mode of THEME_MODES) {
    if (modeLines[mode].length === 0) continue;
    const selectors = mode === 'light'
      ? [':root', ":root[data-mode='light']", ":root[data-theme][data-mode='light']"]
      : [":root[data-mode='dark']", ":root[data-theme][data-mode='dark']"];
    blocks.push(`${selectors.join(',\n')} {\n${modeLines[mode].join('\n')}\n}`);
  }
  if (blocks.length === 0) return '';
  return `${blocks.join('\n')}\n`;
}

/**
 * The root-element attributes a document resolves to (brief §3.4, §3.8).
 * EventConfigProvider writes these; the mode attribute is modeRuntime's,
 * because it also follows a media query.
 *
 * @param {object} themeDoc
 * @returns {{ theme: string|null, motifSet: string }}
 */
export function resolveRootAttributes(themeDoc) {
  return {
    theme: themePresetId(themeDoc),
    motifSet: resolveMotifSet(themeDoc),
  };
}

/**
 * Whether the client accent clears the admin ground in a mode, and what the
 * marker actually renders (admin story part 6f). The theme editor states
 * this in words; nothing clamps the stored value.
 *
 * @param {object} themeDoc
 * @param {'light'|'dark'} mode
 * @returns {{ rgb: number[]|null, ratio: number|null, fellBack: boolean, floor: number }}
 */
export function adminAccentVerdict(themeDoc, mode) {
  return { ...resolveAdminAccent(themeDoc, mode), floor: ADMIN_ACCENT_FLOOR };
}

/** The contrast the admin position marker must clear: it is non-text UI. */
const ADMIN_ACCENT_FLOOR = 3;

/** The admin token set, for the editor's own preview surfaces. */
export { ADMIN_TOKEN_SET };
