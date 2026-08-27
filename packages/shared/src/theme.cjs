'use strict';

/**
 * Theme vocabulary and color math (design brief §3.2, §3.3, §3.7).
 *
 * One module, three readers: the token generator (`scripts/lib/tokens.cjs`),
 * the config validator (`packages/shared/src/config/schema.cjs`), and the
 * browser runtime (`apps/web/src/lib/themeRuntime.js`). Both sides of the
 * wire read the same lists, so the admin panel can never offer a mode or a
 * font role the server rejects.
 *
 * No hex color literal appears here. The repo lint bans them outside the
 * spec §7.6 allowlist, and this file is not on it, so every channel is a
 * number.
 */

/** The two rendered modes. `data-mode` on <html> carries one of these. */
const THEME_MODES = Object.freeze(['light', 'dark']);

/**
 * What `config/theme.mode` may say (brief §3.3). `system` follows the
 * `prefers-color-scheme` media query and updates when it changes.
 */
const THEME_MODE_POLICIES = Object.freeze(['light', 'dark', 'system']);

/**
 * The policy a theme document without a `mode` field gets. Existing
 * deployments predate the field, so the default must be the behavior they
 * already have: always light.
 */
const DEFAULT_MODE_POLICY = 'light';

/**
 * Font roles (brief §3.2). Tokens name a role, never a family.
 *
 * `data` carries tabular data and captions. `mono` carries figures,
 * timestamps, and code. They are two roles, not one: a preset normally
 * pairs a sans for captions with a mono for numbers, and one token cannot
 * say both. Until PR2 bundles a mono face, `mono` falls back to the data
 * face.
 *
 * `accent` is NOT a role. PR2 removed the `--font-accent` alias and the
 * grandfathered `accent` key with it (brief §3.2, §7). Zine's handwritten
 * callout runs on the component token `--callout-font` instead, which is a
 * component contract, not a fifth role.
 */
const THEME_FONT_ROLES = Object.freeze(['heading', 'body', 'data', 'mono']);

/**
 * The bundled font-set ids (spec §7.4). A client names a set id. A client
 * never supplies a font URL, so anything outside this list is rejected at
 * the validator rather than ignored downstream.
 *
 * `apps/web/public/fonts/README.md` records the file, the weights, the
 * designer, and the licence behind each id. `scripts/lib/theme.cjs` holds
 * the stacks and the faces; `themeRuntime.parity.test.js` fails if the
 * three lists drift.
 */
const THEME_FONT_SET_IDS = Object.freeze([
  'serif-editorial', 'sans-humanist', 'script-casual',
  'caslon-display', 'caslon-text', 'baskerville', 'spectral',
  'fraunces', 'newsreader', 'plex-sans', 'plex-mono', 'archivo-condensed',
  'merriweather', 'public-sans',
  'karrik', 'bagnard', 'avara', 'fragment-mono',
  'besley', 'vollkorn', 'overpass', 'overpass-mono', 'libre-franklin',
]);

/**
 * What `config/theme.texture` may say (spec §7.2). `flat` is first because
 * it is the base default: a texture is a theme opt-in, never a base
 * treatment (design brief §2.5).
 */
const THEME_TEXTURES = Object.freeze(['flat', 'paper']);

/** The texture a theme document without a `texture` field renders. */
const DEFAULT_TEXTURE = 'flat';

/**
 * What `config/theme.header` may say (design brief §2.1). The active theme
 * names the default header for its deployment; `standard` is the base.
 */
const THEME_HEADERS = Object.freeze(['standard', 'masthead', 'compact', 'minimal']);

/** The header a theme that names none renders. */
const DEFAULT_HEADER = 'standard';

/**
 * Resolve the header a page renders. The theme supplies the default and a
 * page's stated header wins over it; anything unrecognized falls to the base
 * rather than rendering no header at all.
 *
 * @param {unknown} themeHeader what `config/theme.header` says
 * @param {unknown} [pageHeader] what the page's `layout.header` says
 * @returns {'standard'|'masthead'|'compact'|'minimal'}
 */
function resolveHeader(themeHeader, pageHeader) {
  if (THEME_HEADERS.includes(pageHeader)) return pageHeader;
  if (THEME_HEADERS.includes(themeHeader)) return themeHeader;
  return DEFAULT_HEADER;
}

/**
 * What `config/theme.radius` may say (spec §7.2). `small` is the 2px-to-4px
 * step Newsroom modern and Civic ask for (brief §4.2, §4.4).
 */
const THEME_RADIUS_IDS = Object.freeze(['sharp', 'small', 'soft', 'round']);

/** What a preset's `shape.density` may say (brief §4, §6.1). */
const THEME_DENSITIES = Object.freeze(['tight', 'comfortable', 'loose']);

/**
 * What each density step is worth, as a multiplier the stylesheet can do
 * arithmetic with.
 *
 * `--density` is the word, and a word is not something CSS can measure: a
 * custom property holding `tight` cannot set a padding. So the generator
 * emits this beside it, and the public devices multiply their own spacing
 * contract by it — one step for the whole page, rather than a per-component
 * table nobody can keep in step.
 *
 * The spread is deliberately small. A style already states its own spacing
 * in its tier-3 tokens (Broadsheet sets a smaller session-card padding than
 * Institutional does), so this is the reader's adjustment ON TOP of the
 * style's, not a second design. A wider spread would either crush a tight
 * style or let a loose one drift off the page.
 *
 * The ADMIN never reads this. The room has one fixed identity and a client
 * does not get to set its measure (brief §5.2), which is why the step is
 * applied at the public device rules in index.css rather than to the shared
 * `--space-*` scale both surfaces draw on.
 */
const THEME_DENSITY_STEPS = Object.freeze({
  tight: '0.85',
  comfortable: '1',
  loose: '1.15',
});

/** The branding slots `config/theme.logos` may fill (spec §7.2). */
const THEME_LOGO_SLOTS = Object.freeze(['primary', 'mark', 'footer', 'ogDefault', 'favicon']);

/**
 * Every top-level field a `config/theme` document may carry.
 *
 * PR2 adds four (brief §4, §5.2): `preset` names the base look, `optionPicks`
 * records which curated option the operator chose in each group, `tokens`
 * carries the advanced per-mode token overrides, and `motifSet` names the
 * motif set the root element switches to.
 *
 * `brandColor` is the owner review's one colour decision: the client's main
 * brand colour, from which the supporting brand steps are DERIVED in both
 * modes (`deriveBrandSteps`). `adminAccent` is gone with the same change —
 * the admin position marker now derives from the resolved brand colour and
 * keeps its legibility floor, so there is no second colour to pick and no
 * way to pick one that renders as nothing.
 */
const THEME_DOC_KEYS = Object.freeze([
  'colors', 'fonts', 'texture', 'radius', 'density', 'mode', 'header',
  'logos', 'placeholderLogos', 'preset', 'optionPicks', 'tokens', 'motifSet',
  'brandColor',
]);

/**
 * The `config/theme.colors` keys the dark derivation covers. Order is the
 * order the generator emits.
 */
const THEME_COLOR_KEYS = Object.freeze([
  'primary', 'primaryDark', 'primaryLight', 'accent',
  'surface', 'surfaceAlt', 'ink', 'inkMuted',
  'success', 'warning', 'danger', 'highlight', 'keynote',
]);

/**
 * The second spelling `config/theme.colors` is written in, mapped to the
 * canonical role key above.
 *
 * The seed path (`scripts/lib/theme.cjs`, `scripts/lib/demo-event.cjs`)
 * writes `brandPrimary`; the admin Branding tab writes `primary`. Both
 * reach the same stored document, so anything that reads the palette has
 * to accept both. Normalizing here means one list serves the generator and
 * the browser runtime alike.
 */
const THEME_COLOR_KEY_ALIASES = Object.freeze({
  brandPrimary: 'primary',
  brandPrimaryDark: 'primaryDark',
  brandPrimaryLight: 'primaryLight',
  brandAccent: 'accent',
  brandSurface: 'surface',
  brandSurfaceAlt: 'surfaceAlt',
  brandInk: 'ink',
  brandInkMuted: 'inkMuted',
  semanticSuccess: 'success',
  semanticWarning: 'warning',
  semanticDanger: 'danger',
  semanticHighlight: 'highlight',
  semanticKeynote: 'keynote',
});

/**
 * @param {string} key a `config/theme.colors` key in either spelling
 * @returns {string} the canonical role key
 */
function canonicalColorKey(key) {
  return Object.prototype.hasOwnProperty.call(THEME_COLOR_KEY_ALIASES, key)
    ? THEME_COLOR_KEY_ALIASES[key]
    : key;
}

/**
 * Canonical color role → the tier 2 custom property it writes.
 *
 * This is the map the advanced per-mode override path edits: an operator
 * naming a raw token in `config/theme.tokens` names one of these property
 * names, and the validator resolves it back to the role. Naming the role
 * directly works too, so both spellings reach the same token.
 */
const THEME_COLOR_PROPERTIES = Object.freeze({
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
});

/** The reverse map: custom property name → canonical color role. */
const THEME_PROPERTY_COLOR_KEYS = Object.freeze(
  Object.fromEntries(Object.entries(THEME_COLOR_PROPERTIES).map(([role, prop]) => [prop, role])),
);

/**
 * Resolve either spelling of an overridable color token to its role.
 *
 * @param {string} name a canonical role, a stored alias, or a `--…-rgb` name
 * @returns {string|null} the canonical role, or null when it names nothing
 */
function overrideTokenKey(name) {
  if (typeof name !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(THEME_PROPERTY_COLOR_KEYS, name)) {
    return THEME_PROPERTY_COLOR_KEYS[name];
  }
  const role = canonicalColorKey(name);
  return Object.prototype.hasOwnProperty.call(THEME_COLOR_PROPERTIES, role) ? role : null;
}

/**
 * The dark ground and the ink that sits on it (brief §3.3: "Dark mode is
 * its own palette").
 *
 * These four are DESIGNED, not derived. A dark ground computed from a
 * client's light surface would land wherever that surface happened to be —
 * a warm tan surface would give a brown ground. So PR1 pins one neutral
 * dark ground, slightly cool and never pure black, with a warm off-white
 * ink on it. PR2 replaces these per preset.
 *
 * Measured against each other: ink on surface is 14.6:1, muted ink on
 * surface is 7.9:1, and both clear the bar on the alternate surface too.
 * `theme.test.cjs` re-measures them so a retune cannot quietly drop below
 * the bar.
 */
const DARK_GROUND_RGB = Object.freeze({
  surface: Object.freeze([24, 27, 32]),
  surfaceAlt: Object.freeze([35, 39, 45]),
  ink: Object.freeze([238, 236, 231]),
  inkMuted: Object.freeze([170, 176, 184]),
});

/** The contrast a derived dark color must reach against the dark ground. */
const DARK_MIN_CONTRAST = 4.5;

/**
 * How much ink each rule weight carries (brief §3.7). A rule is structure,
 * so its color is ink mixed into the surface rather than a palette entry of
 * its own — that keeps a rule readable in both modes with no extra tokens.
 *
 * The hairline is deliberately low contrast: it separates without drawing
 * the eye. The strong rule is a section divider a reader should see, so it
 * carries enough ink to clear the 3:1 non-text bar on either ground.
 *
 * `control` is not a rule at all — no component draws a border at this
 * width — but it shares the same "ink mixed into the surface" derivation, so
 * it rides the same table. A form control's boundary (WCAG 1.4.11) needs
 * that same 3:1 non-text bar, and the hairline share is nowhere near it
 * (~1.3:1 to ~1.5:1 across the two grounds and both modes). `control` mixes
 * in enough ink to clear 3:1 against BOTH `surface` and `surfaceAlt`, in
 * both modes, with a margin — a plain `border` swaps its background often
 * enough that the hairline share, tuned only for the section-divider case,
 * cannot be trusted to still clear the bar underneath it.
 */
const RULE_INK_SHARE = Object.freeze({
  hairline: 0.14,
  control: 0.52,
  strong: 0.55,
  nameplate: 1,
});

/** @param {unknown} v @returns {boolean} true for three 0-255 numbers */
function isRgb(v) {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255)
  );
}

/** @param {number} c @returns {number} channel rounded into 0-255 */
function clampChannel(c) {
  return Math.max(0, Math.min(255, Math.round(c)));
}

/**
 * WCAG relative luminance of an sRGB color.
 *
 * @param {readonly number[]} rgb `[r, g, b]`, each 0-255
 * @returns {number} 0 (black) to 1 (white)
 */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = clampChannel(channel) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two sRGB colors. Symmetric: the order of the
 * arguments does not matter.
 *
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {number} 1 to 21
 */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Blend `from` toward `to`.
 *
 * @param {readonly number[]} from
 * @param {readonly number[]} to
 * @param {number} amount 0 keeps `from`, 1 returns `to`
 * @returns {number[]}
 */
function mixRgb(from, to, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return from.map((channel, i) => clampChannel(channel + (to[i] - channel) * t));
}

/**
 * Lighten a color until it holds the wanted contrast on a ground.
 *
 * The blend runs toward white in small, fixed steps and stops at the first
 * step that clears the bar, so the result is deterministic and the color
 * keeps as much of its own chroma as the bar allows. A color that already
 * clears the bar comes back unchanged.
 *
 * @param {readonly number[]} rgb the color to lift
 * @param {readonly number[]} ground the background it must read on
 * @param {number} [minContrast]
 * @returns {number[]}
 */
function liftToContrast(rgb, ground, minContrast = DARK_MIN_CONTRAST) {
  const white = [255, 255, 255];
  const start = rgb.map(clampChannel);
  if (contrastRatio(start, ground) >= minContrast) return start;
  for (let step = 1; step <= 200; step += 1) {
    const candidate = mixRgb(start, white, step / 200);
    if (contrastRatio(candidate, ground) >= minContrast) return candidate;
  }
  return white;
}

/**
 * The contrast a color that only ever decorates must reach. Non-text user
 * interface holds the 3:1 bar, not the 4.5:1 text bar.
 */
const DARK_MIN_CONTRAST_UI = 3;

/** How far the emphasis step lifts off the brand color on a dark ground. */
const DARK_EMPHASIS_STEP = 0.22;

/** How far the soft step settles back toward the dark ground. */
const DARK_SOFT_STEP = 0.35;

/**
 * Derive the dark palette from the light one (brief §3.3, PR1 rule).
 *
 * Grounds and ink are replaced with the designed dark set above. Every
 * other role keeps its hue and is lifted until it clears
 * DARK_MIN_CONTRAST on the dark ground, so a client's brand color still
 * reads as their brand color in dark mode and still passes contrast.
 *
 * The three brand steps are derived as a ladder rather than one at a time,
 * because lifting each of them on its own scrambles their order: a light
 * palette's darkest step needs the biggest lift and can end up the
 * brightest. So `primary` is lifted first, and the other two are steps off
 * it. The ladder mirrors on a dark ground, which is what it should do —
 * `primaryDark` means "more emphasis", and more emphasis on a dark ground
 * is brighter, not darker.
 *
 * Presets bring hand-designed dark palettes in PR2. This is the
 * conservative derivation that makes dark mode complete in PR1.
 *
 * @param {Record<string, readonly number[]>} light role → `[r, g, b]`
 * @returns {Record<string, number[]>} the same roles, dark values
 */
function deriveDarkColors(light) {
  const ground = DARK_GROUND_RGB.surface;
  const white = [255, 255, 255];
  const dark = {};

  const primary = isRgb(light?.primary) ? liftToContrast(light.primary, ground) : null;

  for (const key of THEME_COLOR_KEYS) {
    const source = light?.[key];
    if (!isRgb(source)) continue;
    if (Object.prototype.hasOwnProperty.call(DARK_GROUND_RGB, key)) {
      dark[key] = [...DARK_GROUND_RGB[key]];
    } else if (key === 'primaryDark' && primary) {
      dark[key] = liftToContrast(mixRgb(primary, white, DARK_EMPHASIS_STEP), ground);
    } else if (key === 'primaryLight' && primary) {
      dark[key] = liftToContrast(
        mixRgb(primary, ground, DARK_SOFT_STEP),
        ground,
        DARK_MIN_CONTRAST_UI,
      );
    } else {
      dark[key] = liftToContrast(source, ground);
    }
  }
  return dark;
}

/* -------------------------------------------------------------------------
 * The brand colour and the supporting steps derived from it (owner review,
 * 2026-08-27).
 * ---------------------------------------------------------------------- */

/**
 * How far the emphasis step moves further from the ground than `primary`.
 * Small on purpose: `primaryDark` is a hover state and a link, so it has to
 * read as the same colour with more weight, not as a different colour.
 */
const BRAND_EMPHASIS_STEP = 0.22;

/** How far the soft step settles back toward the ground. */
const BRAND_SOFT_STEP = 0.42;

/** The bar a brand step that carries TEXT must clear on its own ground. */
const BRAND_MIN_CONTRAST = 4.5;

/**
 * The bar the soft step must clear. It never carries text — it is a fill, a
 * chart band, a hairline tint — so it holds the WCAG 1.4.11 non-text bar.
 */
const BRAND_MIN_CONTRAST_UI = 3;

/**
 * The direction that ADDS contrast on a ground: toward black on a light
 * ground, toward white on a dark one.
 *
 * @param {readonly number[]} ground
 * @returns {number[]}
 */
function contrastDirection(ground) {
  return relativeLuminance(ground) > 0.5 ? [0, 0, 0] : [255, 255, 255];
}

/**
 * Move a colour away from a ground, in fixed steps, until it clears a bar.
 *
 * The general form of `liftToContrast`, which only ever lightens: this one
 * picks its direction from the ground, so the same call works on a light
 * page and on a dark one. A colour that already clears the bar comes back
 * untouched, so a brand colour that is already legible is used exactly as
 * the client gave it.
 *
 * @param {readonly number[]} rgb
 * @param {readonly number[]} ground
 * @param {number} minContrast
 * @returns {number[]}
 */
function stepToContrast(rgb, ground, minContrast) {
  const start = rgb.map(clampChannel);
  if (contrastRatio(start, ground) >= minContrast) return start;
  const target = contrastDirection(ground);
  for (let step = 1; step <= 200; step += 1) {
    const candidate = mixRgb(start, target, step / 200);
    if (contrastRatio(candidate, ground) >= minContrast) return candidate;
  }
  return target;
}

/**
 * The three brand steps a client's main brand colour resolves to on one
 * ground — CONTRAST-SAFE BY CONSTRUCTION.
 *
 * A client picks one colour. Asking them to pick three more that hold
 * against each other in two modes is asking them to do colour science, and
 * what actually happened is that they picked three and one of them failed
 * the publish gate. So the supporting steps are derived:
 *
 *   1. `primary` is the brand colour itself, moved away from the ground only
 *      as far as the 4.5:1 text bar requires. A legible brand colour is
 *      returned unchanged, so a client who picked well sees their own value.
 *   2. `primaryDark` is one emphasis step further from the ground, then held
 *      at the same 4.5:1 bar. It is the hover fill under a `surface` label
 *      and it is a link on `surface`, and contrast is symmetric, so one bar
 *      covers both readings.
 *   3. `primaryLight` settles back toward the ground and is then pushed out
 *      until it clears the 3:1 non-text bar. It carries no text.
 *
 * Every step ends at least at its bar, and moving away from a ground can
 * only raise contrast, so the loop cannot leave a value below its bar: the
 * extreme is pure black on white or pure white on black. That is what
 * "safe by construction" means here — `findThemeContrastFailures` cannot
 * report a brand pair for a derived palette, and `theme.test.cjs` measures
 * every style against a set of deliberately awful brand colours to say so.
 *
 * The hue is never rotated and the chroma is never boosted. Blending toward
 * black or white only, in fixed steps, keeps the result the client's colour.
 *
 * @param {readonly number[]} brand the client's main brand colour
 * @param {readonly number[]} ground the surface it must read on
 * @returns {{ primary: number[], primaryDark: number[], primaryLight: number[] }}
 */
function deriveBrandSteps(brand, ground) {
  const away = contrastDirection(ground);
  const primary = stepToContrast(brand, ground, BRAND_MIN_CONTRAST);
  return {
    primary,
    primaryDark: stepToContrast(
      mixRgb(primary, away, BRAND_EMPHASIS_STEP),
      ground,
      BRAND_MIN_CONTRAST,
    ),
    primaryLight: stepToContrast(
      mixRgb(primary, ground, BRAND_SOFT_STEP),
      ground,
      BRAND_MIN_CONTRAST_UI,
    ),
  };
}

/**
 * A palette with its three brand steps replaced by the ones derived from a
 * client brand colour. Returns the palette untouched when the document names
 * no brand colour, or when the palette has no ground to measure against.
 *
 * The accent and the five semantic roles are NOT derived. They belong to the
 * style — Field Guide's clay, Newsroom's desk blue, the one red that means
 * danger — and deriving them from a client's brand would make the six styles
 * one style in six hues.
 *
 * @param {Record<string, number[]>} palette
 * @param {readonly number[]|null} brand
 * @returns {Record<string, number[]>}
 */
function withBrandSteps(palette, brand) {
  if (!isRgb(brand) || !isRgb(palette?.surface)) return palette;
  return { ...palette, ...deriveBrandSteps(brand, palette.surface) };
}

/**
 * The rule colors for one mode (brief §3.7), one per `RULE_INK_SHARE`
 * weight — the three named rules plus `control`, the form-control border
 * share.
 *
 * @param {{ ink: readonly number[], surface: readonly number[] }} palette
 * @returns {Record<string, number[]>} weight → `[r, g, b]`
 */
function deriveRuleColors({ ink, surface }) {
  const colors = {};
  for (const [weight, share] of Object.entries(RULE_INK_SHARE)) {
    colors[weight] = mixRgb(surface, ink, share);
  }
  return colors;
}

/**
 * Resolve a mode policy to the mode that should render.
 *
 * @param {unknown} policy `light`, `dark`, `system`, or anything else
 * @param {boolean} prefersDark what `prefers-color-scheme: dark` reports
 * @returns {'light'|'dark'}
 */
function resolveMode(policy, prefersDark) {
  const chosen = THEME_MODE_POLICIES.includes(policy) ? policy : DEFAULT_MODE_POLICY;
  if (chosen === 'system') return prefersDark ? 'dark' : 'light';
  return chosen;
}

/* -------------------------------------------------------------------------
 * Presets (brief §4) and the one publish-time resolver (brief §5.2).
 * ---------------------------------------------------------------------- */

const { PRESETS, ADMIN_TOKENS, MOTIF_SET_IDS } = require('./presetCatalog.cjs');

/** The six preset ids (brief §4). `data-theme` carries one of these. */
const THEME_PRESET_IDS = Object.freeze(Object.keys(PRESETS));

/**
 * ALL SIX STYLES ARE FIRST-CLASS (owner calibration, 2026-08-27).
 *
 * An earlier pass split the catalog into a `stable` launch surface and an
 * `experimental` group. That is withdrawn. Every style is complete,
 * accessible, responsive, and offered without a warning label. What replaces
 * the tier is progressive disclosure:
 *
 *   - `THEME_PRESET_IDS` is the picker order, and order is the only ranking.
 *     It is a recommendation, not a verdict.
 *   - Every style ships ONE recommended configuration — the option defaults
 *     in its preset file — that works the moment it is picked.
 *     `recommendedConfiguration` builds the `config/theme` a fresh pick
 *     produces, and `theme.test.cjs` measures all six against the contrast
 *     bar in both modes.
 *   - Everything past that first excellent configuration lives behind the
 *     editor's Advanced disclosure.
 */

/**
 * The `config/theme` a staff member gets the moment they pick a style: the
 * style id and its recommended option picks, nothing else.
 *
 * @param {string} id a preset id
 * @returns {{ preset: string, optionPicks: Record<string, string> }|null}
 */
function recommendedConfiguration(id) {
  const preset = getPreset(id);
  if (!preset) return null;
  const optionPicks = {};
  for (const [group, spec] of Object.entries(preset.options || {})) {
    optionPicks[group] = spec.default;
  }
  return { preset: id, optionPicks };
}

/**
 * The style a new deployment gets (owner review, 2026-08-27; kept by the
 * calibration).
 *
 * The brief §4.2 named Newsroom. Institutional is the onboarding default
 * instead: it is the plainest of the six, it targets the highest
 * accessibility bar, and it is the look a client is least likely to have to
 * undo. That is a decision about where a client STARTS, not a ranking of the
 * six. The demo fixture stays on Newsroom, which is the story written for
 * exactly that event.
 */
const DEFAULT_PRESET_ID = 'civic';

/** The motif sets `config/theme.motifSet` may name (brief §3.8). */
const THEME_MOTIF_SET_IDS = Object.freeze([...MOTIF_SET_IDS]);

/** Hex digits, so a hex string is computed and never written (spec §7.6). */
const HEX_DIGITS = '0123456789abcdef';

/** @param {unknown} hex `#rgb`, `#rrggbb`, or the same without the hash @returns {number[]|null} */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let body = hex.trim().toLowerCase().replace(/^#/, '');
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  if (body.length === 8) body = body.slice(0, 6);
  if (body.length !== 6) return null;
  const channels = [];
  for (let i = 0; i < 6; i += 2) {
    const hi = HEX_DIGITS.indexOf(body[i]);
    const lo = HEX_DIGITS.indexOf(body[i + 1]);
    if (hi === -1 || lo === -1) return null;
    channels.push(hi * 16 + lo);
  }
  return channels;
}

/** @param {readonly number[]} rgb @returns {string} `#rrggbb`, computed digit by digit */
function rgbToHex(rgb) {
  const digits = rgb.map(clampChannel).map((c) => HEX_DIGITS[Math.floor(c / 16)] + HEX_DIGITS[c % 16]);
  return `#${digits.join('')}`;
}

/** @param {unknown} v @returns {boolean} */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The preset a `config/theme` document runs.
 *
 * A document that names no preset is a deployment made before presets
 * existed. It keeps the pre-preset behavior: its stored `colors` map is the
 * whole light palette and the dark palette is derived from it. Naming a
 * preset switches the base to that preset's two authored palettes.
 *
 * @param {object} theme
 * @returns {string|null} preset id, or null for a pre-preset document
 */
function themePresetId(theme) {
  const id = theme?.preset;
  return THEME_PRESET_IDS.includes(id) ? id : null;
}

/**
 * @param {string} id
 * @returns {object|null} the preset design data, frozen
 */
function getPreset(id) {
  return Object.prototype.hasOwnProperty.call(PRESETS, id) ? PRESETS[id] : null;
}

/**
 * Which curated option is picked in each of a preset's option groups
 * (brief §4). A group the document does not name, or names with an id the
 * preset does not offer, resolves to that group's default — so a stale pick
 * degrades to the designed look rather than to nothing.
 *
 * @param {object} theme
 * @returns {Record<string, string>} group id → choice id
 */
function resolveOptionPicks(theme) {
  const preset = getPreset(themePresetId(theme));
  if (!preset) return {};
  const stored = isPlainObject(theme?.optionPicks) ? theme.optionPicks : {};
  const picks = {};
  for (const [group, spec] of Object.entries(preset.options || {})) {
    const offered = (spec.choices || []).map((choice) => choice.id);
    picks[group] = offered.includes(stored[group]) ? stored[group] : spec.default;
  }
  return picks;
}

/** The picked choice objects, in the preset's group order. */
function pickedChoices(theme) {
  const preset = getPreset(themePresetId(theme));
  if (!preset) return [];
  const picks = resolveOptionPicks(theme);
  const chosen = [];
  for (const [group, spec] of Object.entries(preset.options || {})) {
    const choice = (spec.choices || []).find((c) => c.id === picks[group]);
    if (choice) chosen.push(choice);
  }
  return chosen;
}

/**
 * The bundled font-set id each role resolves to.
 *
 * Three layers, each winning over the one before it: the preset's type map,
 * then the picked options (a heading-face option remaps the heading role),
 * then any role `config/theme.fonts` names outright — the advanced path,
 * and the only path a pre-preset document has.
 *
 * @param {object} theme
 * @returns {Record<string, string>} role → font-set id
 */
function resolveFontRoles(theme) {
  const preset = getPreset(themePresetId(theme));
  const roles = {};
  if (preset) {
    for (const role of THEME_FONT_ROLES) {
      if (THEME_FONT_SET_IDS.includes(preset.fonts?.[role])) roles[role] = preset.fonts[role];
    }
    for (const choice of pickedChoices(theme)) {
      for (const [role, setId] of Object.entries(choice.fonts || {})) {
        if (THEME_FONT_ROLES.includes(role) && THEME_FONT_SET_IDS.includes(setId)) {
          roles[role] = setId;
        }
      }
    }
  }
  for (const role of THEME_FONT_ROLES) {
    const setId = theme?.fonts?.[role];
    if (THEME_FONT_SET_IDS.includes(setId)) roles[role] = setId;
  }
  return roles;
}

/**
 * Component-token font faces the preset asks for, beyond the four roles.
 * Zine's `--callout-font` is the only one at launch (brief §4.3).
 *
 * @param {object} theme
 * @returns {Record<string, string>} custom property → font-set id
 */
function resolveComponentFonts(theme) {
  const preset = getPreset(themePresetId(theme));
  const fonts = {};
  for (const [name, setId] of Object.entries(preset?.componentFonts || {})) {
    if (THEME_FONT_SET_IDS.includes(setId)) fonts[name] = setId;
  }
  return fonts;
}

/**
 * Non-color token remaps: the preset's own, then the picked options'. Every
 * name here already exists in `design/tokens/components.json`, because an
 * option remaps tokens and never adds a property name (brief §3.4).
 *
 * @param {object} theme
 * @returns {Record<string, string>} custom property → CSS value
 */
function resolvePresetTokens(theme) {
  const preset = getPreset(themePresetId(theme));
  if (!preset) return {};
  const tokens = { ...(preset.tokens || {}) };
  for (const choice of pickedChoices(theme)) Object.assign(tokens, choice.tokens || {});
  return tokens;
}

/**
 * The shape settings that render: the preset's, with anything
 * `config/theme` names outright winning.
 *
 * @param {object} theme
 * @returns {{ radius: string|null, texture: string|null, density: string|null }}
 */
function resolveShape(theme) {
  const shape = getPreset(themePresetId(theme))?.shape || {};
  const pick = (value, fallback, allowed) => {
    if (allowed.includes(value)) return value;
    if (allowed.includes(fallback)) return fallback;
    return null;
  };
  return {
    radius: pick(theme?.radius, shape.radius, THEME_RADIUS_IDS),
    texture: pick(theme?.texture, shape.texture, THEME_TEXTURES),
    // Density is an Advanced setting like the other two (owner review,
    // 2026-08-27): the style states one, and a client may name another. A
    // document that names neither — one made before presets existed — takes
    // the middle step, which is what those surfaces already render.
    density: pick(theme?.density, shape.density, THEME_DENSITIES) || 'comfortable',
  };
}

/**
 * The motif set the root element switches to (brief §3.8). The client's
 * choice wins; otherwise the preset's default; otherwise `none`.
 *
 * @param {object} theme
 * @returns {string}
 */
function resolveMotifSet(theme) {
  if (THEME_MOTIF_SET_IDS.includes(theme?.motifSet)) return theme.motifSet;
  const preset = getPreset(themePresetId(theme));
  if (preset && THEME_MOTIF_SET_IDS.includes(preset.motifSet)) return preset.motifSet;
  return 'none';
}

/**
 * Read a stored palette map (either spelling of the keys, hex values) into
 * canonical roles.
 *
 * @param {unknown} colors
 * @returns {Record<string, number[]>}
 */
function readPaletteMap(colors) {
  const palette = {};
  if (!isPlainObject(colors)) return palette;
  for (const [key, hex] of Object.entries(colors)) {
    const role = overrideTokenKey(key);
    const rgb = hexToRgb(hex);
    if (role && rgb) palette[role] = rgb;
  }
  return palette;
}

/**
 * THE resolver (brief §5.2: "One resolver serves the browser runtime, the
 * generator, and the publish path. Never add a second.").
 *
 * Resolve one `config/theme` document down to the palette that renders in
 * each mode.
 *
 * WHICH FIELD IS THE PALETTE depends on one thing: whether the document
 * names a preset.
 *
 *   - **A document that names a preset.** The preset's two authored
 *     palettes are the base, and `tokens.light` / `tokens.dark` — the
 *     advanced per-mode override path from the theme editor (brief §5.2) —
 *     are the only overrides. `colors` is IGNORED on the way in: for a
 *     preset document it is an OUTPUT, the materialized legacy map that
 *     `resolveLegacyColors` writes back on publish so email and PDF keep
 *     rendering. Reading it back in would pin a client to whatever palette
 *     their previous preset happened to leave behind, and switching presets
 *     would do nothing. Nothing is derived here: both palettes are designed.
 *
 *   - **A document that names no preset.** This is a deployment made before
 *     presets existed, and it keeps exactly the behavior it has: `colors`
 *     is the light palette, `colors.dark` writes the dark mode where the
 *     document uses the per-mode shape, and anything the dark mode does not
 *     name is DERIVED from the resolved light palette. `tokens` still
 *     overrides last, so the advanced path works there too.
 *
 * @param {object} theme config/theme
 * @returns {{ light: Record<string, number[]>, dark: Record<string, number[]> }}
 */
function resolveThemePalettes(theme) {
  const preset = getPreset(themePresetId(theme));
  const overrides = isPlainObject(theme?.tokens) ? theme.tokens : {};
  const brand = hexToRgb(theme?.brandColor);

  if (preset) {
    return {
      light: { ...withBrandSteps(preset.palette.light, brand), ...readPaletteMap(overrides.light) },
      dark: { ...withBrandSteps(preset.palette.dark, brand), ...readPaletteMap(overrides.dark) },
    };
  }

  const stored = isPlainObject(theme?.colors) ? theme.colors : {};
  const perMode = isPlainObject(stored.light) || isPlainObject(stored.dark);
  const light = {
    // A pre-preset document takes the brand steps too, on its own stored
    // ground. Its dark palette is derived from the resolved light one, so
    // the brand colour reaches dark mode through that same path.
    ...withBrandSteps(readPaletteMap(perMode ? stored.light : stored), brand),
    ...readPaletteMap(overrides.light),
  };
  const dark = {
    ...deriveDarkColors(light),
    ...readPaletteMap(perMode ? stored.dark : null),
    ...readPaletteMap(overrides.dark),
  };
  return { light, dark };
}

/**
 * The foreground/background pairs a published theme must clear (brief §5.2,
 * §8.1).
 *
 * "Where a defined token pair names a foreground and a background, the pair
 * must clear the §8.1 bar in both modes." These are those pairs. Text holds
 * 4.5:1. A form control's boundary is non-text user interface under WCAG
 * 1.4.11, so it holds 3:1 — against every ground an input actually renders
 * on, which is why it appears twice.
 *
 * Contrast is measured against the actual rendered background, not the page
 * background (interface guidelines, Colors), so each text role is measured
 * on both surfaces it can sit on.
 *
 * `primaryDark` is here for the same reason `primary` is: it is a rendered
 * text pair, not a decoration. Two components put it against `surface` and
 * they pull in opposite directions —
 *
 *   - `CtaBlock` paints it as the HOVER BACKGROUND of a filled button whose
 *     label is `surface`, so the pair is surface-on-primaryDark;
 *   - `LinkGroupBlock` (and the admin's own links, and
 *     `SessionMaterialsList`) render it as TEXT on `surface`.
 *
 * Contrast is symmetric, so one pair covers both, and it has to hold at the
 * 4.5:1 text bar in both directions. Without it a client could publish a
 * palette whose emphasis step read fine as a background and vanished as a
 * link — the publish gate measured `primary` and let `primaryDark` through.
 */
const THEME_CONTRAST_PAIRS = Object.freeze([
  Object.freeze({ foreground: 'ink', background: 'surface', min: 4.5 }),
  Object.freeze({ foreground: 'ink', background: 'surfaceAlt', min: 4.5 }),
  Object.freeze({ foreground: 'inkMuted', background: 'surface', min: 4.5 }),
  Object.freeze({ foreground: 'inkMuted', background: 'surfaceAlt', min: 4.5 }),
  Object.freeze({ foreground: 'primary', background: 'surface', min: 4.5 }),
  Object.freeze({ foreground: 'primaryDark', background: 'surface', min: 4.5 }),
  Object.freeze({ foreground: 'control', background: 'surface', min: 3 }),
  Object.freeze({ foreground: 'control', background: 'surfaceAlt', min: 3 }),
]);

/**
 * Every contrast failure in a `config/theme` document, in both modes.
 *
 * A contrast failure is an ERROR at publish, not a warning (brief §5.2). The
 * message names the pair, the mode, and the measured ratio, because those
 * three facts are what an operator needs to fix it. `updateTheme` rejects
 * the write; the theme editor shows the same failure inline in the control
 * that caused it, and keeps rendering the preview.
 *
 * A draft may hold a failing value. A published document may not.
 *
 * @param {object} theme config/theme
 * @returns {Array<{ foreground: string, background: string, mode: string,
 *                   min: number, ratio: number, message: string }>}
 */
function findThemeContrastFailures(theme) {
  const palettes = resolveThemePalettes(theme);
  const failures = [];
  for (const mode of THEME_MODES) {
    const palette = palettes[mode];
    if (!isRgb(palette.ink) || !isRgb(palette.surface)) continue;
    const rules = deriveRuleColors({ ink: palette.ink, surface: palette.surface });
    const read = (role) => (role === 'control' ? rules.control : palette[role]);
    for (const pair of THEME_CONTRAST_PAIRS) {
      const fg = read(pair.foreground);
      const bg = read(pair.background);
      if (!isRgb(fg) || !isRgb(bg)) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio >= pair.min) continue;
      failures.push({
        foreground: pair.foreground,
        background: pair.background,
        mode,
        min: pair.min,
        ratio,
        message:
          `theme contrast: ${pair.foreground} on ${pair.background} in ${mode} mode is ` +
          `${ratio.toFixed(2)}:1, below the ${pair.min}:1 bar`,
      });
    }
  }
  return failures;
}

/**
 * The legacy `config/theme.colors` map, materialized (brief §5.2).
 *
 * `functions/src/email/render.cjs` and `functions/src/schedule/pdf.cjs`
 * render outside a browser and read `config/theme.colors` directly. A
 * client running a preset with no overrides stores no colors, so those two
 * consumers would render from nothing. `updateTheme` calls this on publish
 * and writes the result into the stored document.
 *
 * The map is the LIGHT palette: email and PDF are light-mode surfaces, and
 * that is the mode `colors` has always meant.
 *
 * @param {object} theme config/theme
 * @returns {Record<string, string>} canonical role → `#rrggbb`
 */
function resolveLegacyColors(theme) {
  const { light } = resolveThemePalettes(theme);
  const colors = {};
  for (const key of THEME_COLOR_KEYS) {
    if (isRgb(light[key])) colors[key] = rgbToHex(light[key]);
  }
  return colors;
}

/**
 * The fixed admin token set (admin story part 6). Emitted once per mode,
 * never once per (theme, mode) pair.
 */
const ADMIN_TOKEN_SET = ADMIN_TOKENS;

/** The contrast the admin position marker must clear: it is non-text UI. */
const ADMIN_ACCENT_MIN_CONTRAST = DARK_MIN_CONTRAST_UI;

/**
 * The admin position marker's colour, and its legibility floor (admin story
 * part 6f, owner review 2026-08-27).
 *
 * THERE IS NO SEPARATE ADMIN MARKER COLOUR ANY MORE. The editable
 * `config/theme.adminAccent` field is gone. The admin's two client-owned
 * slots — the marker beside the section you are in, and the mark on the
 * page-header rule — take the RESOLVED brand colour for the mode, which is
 * the same value the site paints. One colour decision, used in both places,
 * so the admin cannot drift from the site it is editing and nobody has to
 * pick a second colour whose only job is to sit on an admin ground.
 *
 * The floor is unchanged and still does the work. The brand colour is
 * measured against `--admin-ground` in the mode; a marker is non-text user
 * interface, so it holds 3:1. When it fails, both slots fall back to
 * `--admin-ink` and the editor says so. Nothing is clamped: the site keeps
 * painting the client's colour, and it is only the admin marker that steps
 * aside.
 *
 * @param {object} theme config/theme
 * @param {'light'|'dark'} mode
 * @returns {{ rgb: number[]|null, ratio: number|null, fellBack: boolean }}
 *   `rgb` null means the document resolves no brand colour at all, so the
 *   token keeps its declared default of `--admin-ink-rgb`.
 */
function resolveAdminAccent(theme, mode) {
  const palette = resolveThemePalettes(theme)[mode];
  const accent = isRgb(palette?.primary) ? palette.primary.map(clampChannel) : null;
  if (!accent) return { rgb: null, ratio: null, fellBack: false };
  const ground = ADMIN_TOKENS.colors['--admin-ground-rgb'][mode];
  const ink = ADMIN_TOKENS.colors['--admin-ink-rgb'][mode];
  const ratio = contrastRatio(accent, ground);
  if (ratio < ADMIN_ACCENT_MIN_CONTRAST) return { rgb: [...ink], ratio, fellBack: true };
  return { rgb: accent, ratio, fellBack: false };
}

module.exports = {
  THEME_MODES,
  THEME_MODE_POLICIES,
  DEFAULT_MODE_POLICY,
  THEME_FONT_ROLES,
  THEME_FONT_SET_IDS,
  THEME_TEXTURES,
  DEFAULT_TEXTURE,
  THEME_HEADERS,
  DEFAULT_HEADER,
  resolveHeader,
  THEME_RADIUS_IDS,
  THEME_DENSITIES,
  THEME_DENSITY_STEPS,
  THEME_LOGO_SLOTS,
  THEME_DOC_KEYS,
  THEME_COLOR_KEYS,
  THEME_COLOR_KEY_ALIASES,
  THEME_COLOR_PROPERTIES,
  THEME_PROPERTY_COLOR_KEYS,
  canonicalColorKey,
  overrideTokenKey,
  THEME_PRESET_IDS,
  recommendedConfiguration,
  DEFAULT_PRESET_ID,
  THEME_MOTIF_SET_IDS,
  PRESETS,
  ADMIN_TOKEN_SET,
  ADMIN_ACCENT_MIN_CONTRAST,
  getPreset,
  themePresetId,
  resolveOptionPicks,
  pickedChoices,
  resolveFontRoles,
  resolveComponentFonts,
  resolvePresetTokens,
  resolveShape,
  resolveMotifSet,
  resolveThemePalettes,
  resolveLegacyColors,
  THEME_CONTRAST_PAIRS,
  findThemeContrastFailures,
  resolveAdminAccent,
  hexToRgb,
  rgbToHex,
  BRAND_EMPHASIS_STEP,
  BRAND_SOFT_STEP,
  BRAND_MIN_CONTRAST,
  BRAND_MIN_CONTRAST_UI,
  stepToContrast,
  deriveBrandSteps,
  withBrandSteps,
  DARK_GROUND_RGB,
  DARK_MIN_CONTRAST,
  DARK_MIN_CONTRAST_UI,
  RULE_INK_SHARE,
  isRgb,
  clampChannel,
  relativeLuminance,
  contrastRatio,
  mixRgb,
  liftToContrast,
  deriveDarkColors,
  deriveRuleColors,
  resolveMode,
};
