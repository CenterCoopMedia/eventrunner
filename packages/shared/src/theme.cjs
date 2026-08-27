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
 * `accent` is NOT a role any more. `--font-accent` stays for one release as
 * an alias of `--font-heading` so ported components keep rendering; PR2
 * removes the alias.
 */
const THEME_FONT_ROLES = Object.freeze(['heading', 'body', 'data', 'mono']);

/** The retired role name `--font-accent` still aliases (removed in PR2). */
const LEGACY_FONT_ROLE = 'accent';

/**
 * The bundled font-set ids (spec §7.4). A client names a set id. A client
 * never supplies a font URL, so anything outside this list is rejected at
 * the validator rather than ignored downstream.
 */
const THEME_FONT_SET_IDS = Object.freeze(['serif-editorial', 'sans-humanist', 'script-casual']);

/**
 * What `config/theme.texture` may say (spec §7.2). `flat` is first because
 * it is the base default: a texture is a theme opt-in, never a base
 * treatment (design brief §2.5).
 */
const THEME_TEXTURES = Object.freeze(['flat', 'paper']);

/** The texture a theme document without a `texture` field renders. */
const DEFAULT_TEXTURE = 'flat';

/** What `config/theme.radius` may say (spec §7.2). */
const THEME_RADIUS_IDS = Object.freeze(['sharp', 'soft', 'round']);

/** The branding slots `config/theme.logos` may fill (spec §7.2). */
const THEME_LOGO_SLOTS = Object.freeze(['primary', 'mark', 'footer', 'ogDefault', 'favicon']);

/** Every top-level field a `config/theme` document may carry. */
const THEME_DOC_KEYS = Object.freeze([
  'colors', 'fonts', 'texture', 'radius', 'mode', 'logos', 'placeholderLogos',
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

module.exports = {
  THEME_MODES,
  THEME_MODE_POLICIES,
  DEFAULT_MODE_POLICY,
  THEME_FONT_ROLES,
  LEGACY_FONT_ROLE,
  THEME_FONT_SET_IDS,
  THEME_TEXTURES,
  DEFAULT_TEXTURE,
  THEME_RADIUS_IDS,
  THEME_LOGO_SLOTS,
  THEME_DOC_KEYS,
  THEME_COLOR_KEYS,
  THEME_COLOR_KEY_ALIASES,
  canonicalColorKey,
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
