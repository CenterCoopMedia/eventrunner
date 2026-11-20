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
//   brandColor      the client's main brand colour. The three brand steps
//                   are DERIVED from it per mode, contrast-safe by
//                   construction, and the admin's own position marker takes
//                   the resolved value with its legibility floor applied.
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
  THEME_FONT_ROLES,
  THEME_TEXTURES,
  THEME_DENSITY_STEPS,
  THEME_MOTIF_SET_IDS,
  deriveRuleColors,
  deriveMoreContrastColors,
  resolveAdminAccent,
  resolveAdminScheme,
  resolveComponentFonts,
  resolveFontRoles,
  resolveMotifSet,
  resolvePresetTokens,
  resolveShape,
  resolveThemePalettes,
  themePresetId,
} from 'shared/theme';

// config/theme.colors key → custom property it overrides.
export const COLOR_PROPS = {
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
export const FONT_SETS = {
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
  cabin: "'Cabin', Arial, sans-serif",
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
export const RADIUS_SCALES = {
  sharp: ['0px', '2px'],
  small: ['2px', '4px'],
  editorial: ['4px', '4px'],
  soft: ['8px', '16px'],
  round: ['16px', '28px'],
};

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
  if (presetId && shape.density) {
    rootLines.push(`  --density: ${shape.density};`);
    // The same step the generator emits (scripts/lib/tokens.cjs). --density
    // names the choice; --density-step is what the public devices multiply
    // their spacing by, because CSS cannot measure a word.
    rootLines.push(`  --density-step: ${THEME_DENSITY_STEPS[shape.density]};`);
  }

  // The preset's own token remaps, then the picked options'. Every name is
  // a tier 2 or tier 3 token the generated stylesheet already declares: an
  // option never adds a property name (brief §3.4).
  for (const [name, value] of Object.entries(resolvePresetTokens(themeDoc, { resetComponents: true }))) {
    rootLines.push(`  ${name}: ${value};`);
  }
  // Component-token faces beyond the four roles (Zine's --callout-font, and
  // a picked option's, such as the toner-block quote's). They come after
  // the remaps, as in the generated stylesheet (scripts/lib/tokens.cjs):
  // the component reset above names every component token's default, and
  // written first, a picked face lost to it.
  for (const [name, setId] of Object.entries(resolveComponentFonts(themeDoc))) {
    const stack = FONT_SETS[setId];
    if (stack) rootLines.push(`  ${name}: ${stack};`);
  }

  // The record of which motif set is active. It does NOT do the switching:
  // data-motif-set on the root element does, against the [data-motif-set]
  // blocks in the generated stylesheet (brief §3.8).
  if (presetId || THEME_MOTIF_SET_IDS.includes(themeDoc.motifSet)) {
    rootLines.push(`  --motif-set: ${resolveMotifSet(themeDoc)};`);
  }

  const palettes = resolveThemePalettes(themeDoc);
  const modeLines = { light: [], dark: [] };
  // The light palette again, without the admin token: what paper gets.
  const printLines = [];
  for (const mode of THEME_MODES) {
    const palette = palettes[mode];
    const forPrint = mode === 'light';
    for (const [key, prop] of Object.entries(COLOR_PROPS)) {
      if (!palette[key]) continue;
      const line = `  ${prop}: ${palette[key].join(' ')};`;
      modeLines[mode].push(line);
      if (forPrint) printLines.push(line);
    }
    if (palette.ink && palette.surface) {
      const rules = deriveRuleColors({ ink: palette.ink, surface: palette.surface });
      for (const [weight, prop] of Object.entries(RULE_PROPS)) {
        const line = `  ${prop}: ${rules[weight].join(' ')};`;
        modeLines[mode].push(line);
        if (forPrint) printLines.push(line);
      }
    }
    // The one client-owned colour in the admin identity, with its legibility
    // floor applied per mode (admin story part 6f). A failing accent falls
    // back to the admin ink; it is never clamped, and the editor states what
    // it fell back to. It stays out of the print block: the admin is a screen
    // tool and no print rule reads its tokens.
    const accent = resolveAdminAccent(themeDoc, mode);
    if (accent.rgb) {
      modeLines[mode].push(`  --admin-client-accent-rgb: ${accent.rgb.join(' ')};`);
    }
    // The event's colours reach the admin (desk amendment): the rail and
    // the action family for the mode, derived from the brand colour or
    // from the house scheme the document names, so a published theme
    // restyles the admin as it restyles the site. Screen only, like the
    // accent.
    for (const [name, rgb] of Object.entries(resolveAdminScheme(themeDoc, mode).tokens)) {
      modeLines[mode].push(`  ${name}: ${rgb.join(' ')};`);
    }
  }

  const blocks = [];
  const contrastBlocks = [];
  if (rootLines.length > 0) blocks.push(`:root {\n${rootLines.join('\n')}\n}`);
  for (const mode of THEME_MODES) {
    if (modeLines[mode].length === 0) continue;
    const selectors = mode === 'light'
      ? [':root', ":root[data-mode='light']", ":root[data-theme][data-mode='light']"]
      : [":root[data-mode='dark']", ":root[data-theme][data-mode='dark']"];
    blocks.push(`${selectors.join(',\n')} {\n${modeLines[mode].join('\n')}\n}`);
    const declarations = Object.entries(deriveMoreContrastColors(palettes[mode])).map(([name, rgb]) =>
      `  ${name === 'secondary' ? '--color-text-secondary-rgb' : RULE_PROPS[name]}: ${rgb.join(' ')};`);
    if (declarations.length === 0) continue;
    const selector = selectors.map((one) => `${one}:not(:has(.admin-room))`).join(',\n');
    contrastBlocks.push(`${selector} {\n${declarations.join('\n')}\n}`);
  }
  if (contrastBlocks.length > 0) blocks.push(`@media screen and (prefers-contrast: more) {\n${contrastBlocks.join('\n')}\n}`);
  if (printLines.length > 0) blocks.push(printBlock(printLines));
  if (blocks.length === 0) return '';
  return `${blocks.join('\n')}\n`;
}

/**
 * The `@media print` selectors the generated stylesheet writes, in the same
 * order (`scripts/lib/tokens.cjs` `printPaletteBlock`).
 *
 * Each one leads with the `html` type selector, which is what lifts a print
 * declaration above its screen twin inside the same stylesheet.
 */
const PRINT_SELECTORS = Object.freeze([
  'html:root',
  'html:root:not([data-mode])',
  "html:root[data-mode='dark']",
  "html:root[data-theme][data-mode='dark']",
]);

/**
 * Paper's copy of the LIVE light palette.
 *
 * The generated stylesheet already carries a print block, and it is right
 * about the rule: paper has no dark mode, so a reader printing from a dark
 * screen gets the light edition. What it cannot be right about is the
 * VALUES. They are frozen at build time, and `config/theme` arrives over
 * `onSnapshot` — so an operator who restyles a running site left every
 * printed page on the palette the deployment shipped with. The screen
 * updated; the handout did not.
 *
 * Worse, it only went wrong in one mode. The generated print selectors lead
 * with `html`, which beats this element's `[data-mode='dark']` block on
 * specificity, so a dark screen printed the stale build-time light palette
 * while a light screen printed the live one. Same document, two editions.
 *
 * So this block names the SAME selector list. Selector for selector the
 * specificity ties, and this element is appended after the generated
 * stylesheet, so document order decides and the live values win. The
 * generated block stays exactly where it is: it is what a reader with no
 * JavaScript, or one printing before the snapshot lands, still gets.
 *
 * @param {string[]} lines declarations, already indented
 * @returns {string}
 */
function printBlock(lines) {
  const selectors = PRINT_SELECTORS.join(',\n  ');
  const body = lines.map((line) => `  ${line}`).join('\n');
  return `@media print {\n  ${selectors} {\n${body}\n  }\n}`;
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
