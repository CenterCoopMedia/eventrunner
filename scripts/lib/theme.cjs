'use strict';

/**
 * The default `config/theme` document (spec §2.2, §7.2) and the font/radius
 * vocabularies the CSS generator resolves it against.
 *
 * A fresh deployment starts on the **Newsroom modern** preset. Brief §4.2
 * names it: "Use it as the default preset for new deployments." That
 * replaces the hand-written teal-on-warm-paper palette this file used to
 * carry — a preset IS the designed neutral starting point, and it brings a
 * designed dark palette with it, which a single light palette never could.
 *
 * The seeded `colors` map is materialized from that preset by the one shared
 * resolver, exactly as `updateTheme` materializes it on every publish
 * (brief §5.2). `functions/src/email/render.cjs` and
 * `functions/src/schedule/pdf.cjs` read `config/theme.colors` directly, so a
 * fresh deployment must have one from the first seed, not from the first
 * publish.
 *
 * No hex color literal appears here. The repo lint bans them outside the
 * spec §7.6 allowlist (eslint.config.mjs) and `scripts/**` is not on it, so
 * every channel arrives as a number from `design/tokens/` and the hex form
 * `validateTheme` requires is computed.
 */

const {
  DEFAULT_MODE_POLICY,
  DEFAULT_PRESET_ID,
  getPreset,
  hexToRgb,
  resolveLegacyColors,
  rgbToHex,
} = require('shared/theme');

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
 * self-hosted woff2 faces it needs.
 *
 * `faces` is the list of `@font-face` blocks the set emits: one entry per
 * file, each naming the weight that file really carries. A variable face
 * clipped to the 400–700 range is one entry declaring `400 700`; a family
 * with no weight axis ships one entry per weight. `apps/web/public/fonts/
 * README.md` records how each file was prepared and under which licence.
 *
 * A set with no `faces` is system fonts only, so no `@font-face` block is
 * emitted for it.
 *
 * The generator DECLARES every set here, because config/theme arrives live
 * and a role can be remapped to any of them without a rebuild. Declaring is
 * not downloading — `@font-face` is lazy — so brief §4 still holds: a reader
 * fetches only the faces the rendered preset and its picked options use.
 * See the header of `scripts/lib/tokens.cjs`.
 */
const FONT_SETS = Object.freeze({
  'serif-editorial': Object.freeze({
    family: 'Source Serif 4',
    faces: Object.freeze([{ file: 'source-serif-4-latin', weight: '400 700' }]),
    stack: "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  }),
  'sans-humanist': Object.freeze({
    family: 'Source Sans 3',
    faces: Object.freeze([{ file: 'source-sans-3-latin', weight: '400 700' }]),
    stack: "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
  }),
  'script-casual': Object.freeze({
    family: 'Caveat',
    faces: Object.freeze([{ file: 'caveat-latin', weight: '400' }]),
    stack: "'Caveat', 'Segoe Script', 'Bradley Hand', cursive",
  }),
  'caslon-display': Object.freeze({
    family: 'Libre Caslon Display',
    faces: Object.freeze([{ file: 'libre-caslon-display-latin', weight: '400' }]),
    stack: "'Libre Caslon Display', 'Libre Caslon Text', Georgia, 'Times New Roman', serif",
  }),
  'caslon-text': Object.freeze({
    family: 'Libre Caslon Text',
    faces: Object.freeze([
      { file: 'libre-caslon-text-400-latin', weight: '400' },
      { file: 'libre-caslon-text-700-latin', weight: '700' },
    ]),
    stack: "'Libre Caslon Text', Georgia, 'Times New Roman', serif",
  }),
  baskerville: Object.freeze({
    family: 'Libre Baskerville',
    faces: Object.freeze([{ file: 'libre-baskerville-latin', weight: '400 700' }]),
    stack: "'Libre Baskerville', Baskerville, Georgia, 'Times New Roman', serif",
  }),
  spectral: Object.freeze({
    family: 'Spectral',
    faces: Object.freeze([{ file: 'spectral-600-latin', weight: '600' }]),
    stack: "'Spectral', 'Source Serif 4', Georgia, serif",
  }),
  fraunces: Object.freeze({
    family: 'Fraunces',
    faces: Object.freeze([{ file: 'fraunces-latin', weight: '400 700' }]),
    stack: "'Fraunces', 'Source Serif 4', Georgia, serif",
  }),
  newsreader: Object.freeze({
    family: 'Newsreader',
    faces: Object.freeze([{ file: 'newsreader-latin', weight: '400 700' }]),
    stack: "'Newsreader', 'Source Serif 4', Georgia, serif",
  }),
  'plex-sans': Object.freeze({
    family: 'IBM Plex Sans',
    faces: Object.freeze([{ file: 'ibm-plex-sans-latin', weight: '400 700' }]),
    stack: "'IBM Plex Sans', 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
  }),
  'plex-mono': Object.freeze({
    family: 'IBM Plex Mono',
    faces: Object.freeze([
      { file: 'ibm-plex-mono-400-latin', weight: '400' },
      { file: 'ibm-plex-mono-600-latin', weight: '600' },
    ]),
    stack: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  }),
  'archivo-condensed': Object.freeze({
    family: 'Archivo Condensed',
    faces: Object.freeze([{ file: 'archivo-condensed-latin', weight: '400 700' }]),
    stack: "'Archivo Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  }),
  merriweather: Object.freeze({
    family: 'Merriweather',
    faces: Object.freeze([
      { file: 'merriweather-400-latin', weight: '400' },
      { file: 'merriweather-700-latin', weight: '700' },
    ]),
    stack: "'Merriweather', Georgia, 'Times New Roman', serif",
  }),
  'public-sans': Object.freeze({
    family: 'Public Sans',
    faces: Object.freeze([{ file: 'public-sans-latin', weight: '400 700' }]),
    stack: "'Public Sans', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, system-ui, sans-serif",
  }),
  karrik: Object.freeze({
    family: 'Karrik',
    faces: Object.freeze([{ file: 'karrik-latin', weight: '400' }]),
    stack: "'Karrik', 'Arial Black', Impact, sans-serif",
  }),
  bagnard: Object.freeze({
    family: 'Bagnard',
    faces: Object.freeze([{ file: 'bagnard-latin', weight: '400' }]),
    stack: "'Bagnard', Georgia, 'Times New Roman', serif",
  }),
  avara: Object.freeze({
    family: 'Avara',
    faces: Object.freeze([{ file: 'avara-latin', weight: '700' }]),
    stack: "'Avara', Georgia, 'Times New Roman', serif",
  }),
  'fragment-mono': Object.freeze({
    family: 'Fragment Mono',
    faces: Object.freeze([{ file: 'fragment-mono-latin', weight: '400' }]),
    stack: "'Fragment Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  }),
  besley: Object.freeze({
    family: 'Besley',
    faces: Object.freeze([{ file: 'besley-latin', weight: '400 700' }]),
    stack: "'Besley', 'Clarendon', Georgia, 'Times New Roman', serif",
  }),
  vollkorn: Object.freeze({
    family: 'Vollkorn',
    faces: Object.freeze([{ file: 'vollkorn-latin', weight: '400 700' }]),
    stack: "'Vollkorn', Georgia, 'Times New Roman', serif",
  }),
  overpass: Object.freeze({
    family: 'Overpass',
    faces: Object.freeze([{ file: 'overpass-latin', weight: '400 700' }]),
    stack: "'Overpass', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, system-ui, sans-serif",
  }),
  'overpass-mono': Object.freeze({
    family: 'Overpass Mono',
    faces: Object.freeze([{ file: 'overpass-mono-latin', weight: '400 700' }]),
    stack: "'Overpass Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  }),
  'libre-franklin': Object.freeze({
    family: 'Libre Franklin',
    faces: Object.freeze([{ file: 'libre-franklin-latin', weight: '400 700' }]),
    stack: "'Libre Franklin', 'Franklin Gothic', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  }),
});

/**
 * Radius scale ids (spec §7.2) → the two emitted lengths.
 *
 * `small` is the 2px-to-4px step Newsroom modern and Civic ask for
 * (brief §4.2, §4.4): a corner that is present without becoming a card.
 */
const RADIUS_SCALES = Object.freeze({
  sharp: Object.freeze({ base: '0', large: '2px' }),
  small: Object.freeze({ base: '2px', large: '4px' }),
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
  const preset = getPreset(DEFAULT_PRESET_ID);
  return {
    // The base look (design brief §4). Every other field below either comes
    // from it or refines it.
    preset: DEFAULT_PRESET_ID,
    // The materialized legacy palette. For a preset document `colors` is an
    // OUTPUT, not an input: the resolver writes it so email and PDF have a
    // palette to read, and it is re-materialized on every publish.
    colors: resolveLegacyColors({ preset: DEFAULT_PRESET_ID }),
    // Font ROLES, never family names (design brief §3.2). Left empty on
    // purpose: the preset's type map names all four roles, and a role named
    // here would override the preset for no reason. The advanced path in
    // the theme editor is what fills this in.
    fonts: {},
    // The curated option groups (brief §4). An empty pick takes each
    // group's designed default.
    optionPicks: {},
    // Per-mode raw token overrides, the advanced path (brief §5.2).
    tokens: {},
    texture: preset.shape.texture,
    radius: preset.shape.radius,
    // The motif set the root element switches to (brief §3.8). Newsroom
    // ships with none; Field Guide and Atlas turn one on.
    motifSet: preset.motifSet,
    // Mode policy (design brief §3.3): 'light' | 'dark' | 'system'. A fresh
    // deployment starts light, which is what every deployment made before
    // the field existed also renders.
    mode: DEFAULT_MODE_POLICY,
    logos: { ...PLACEHOLDER_LOGOS },
    placeholderLogos: Object.keys(PLACEHOLDER_LOGOS),
  };
}

module.exports = {
  CSS_VARIABLE_STEM,
  FONT_SETS,
  RADIUS_SCALES,
  PLACEHOLDER_LOGOS,
  // Re-exported from shared/theme, which owns the one implementation. The
  // seed path and its tests read them from here because that is where they
  // have always been.
  rgbToHex,
  hexToRgb,
  defaultTheme,
};
