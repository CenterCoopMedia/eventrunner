'use strict';

const { PRESETS, MOTIF_SET_IDS } = require('./presetCatalog.cjs');

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
const THEME_RADIUS_IDS = Object.freeze(['sharp', 'small', 'editorial', 'soft', 'round']);

/** What a preset's `shape.density` may say (brief §4, §6.1). */
const THEME_DENSITIES = Object.freeze(['tight', 'comfortable', 'loose']);

/**
 * Where the site puts its navigation (design brief §6.1, and this review).
 *
 * IT IS A SITE SETTING, NOT A PAGE ONE. The navigation is the part of the
 * shell that tells a reader where they are and what else there is. A reader
 * who meets a top nav on the home page and a side rail on the schedule has
 * been handed two different sites; the nav stops being furniture they can
 * stop noticing, which is the whole job of furniture.
 *
 * So the site's answer lives here, in `config/theme`, beside the rest of
 * what the site is shaped like — the preset, the texture, the radius, the
 * mode policy — and one choice covers every page that does not say
 * otherwise.
 *
 * A PAGE MAY SAY OTHERWISE, and when it does it wins. `layout.navPlacement`
 * on a page document is read FIRST by the shell (apps/web/src/components/
 * Layout.jsx), and the page editor offers it in Advanced: the exception is
 * deliberate work an operator does for one page, not a question every page
 * has to answer. Reading it first is also what keeps a deployment that set
 * it per page, before this setting existed, rendering what it rendered.
 */
const THEME_NAV_PLACEMENTS = Object.freeze(['top', 'side']);

/** What a site with no stated navigation placement renders at. */
const DEFAULT_NAV_PLACEMENT = 'top';

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
 * Where the site puts its navigation.
 *
 * `null` is a real answer and a different one from `'top'`: it means the
 * site has not chosen. The shell asks the page first, this second, and
 * DEFAULT_NAV_PLACEMENT only when neither has anything to say — so
 * reporting "not chosen" as `'top'` here would turn a site that never
 * decided into a site that decided against every page's rail.
 *
 * @param {object} theme
 * @returns {'top'|'side'|null}
 */
function resolveNavPlacement(theme) {
  return THEME_NAV_PLACEMENTS.includes(theme?.navPlacement) ? theme.navPlacement : null;
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
 * What the header shows as the site's identity (#1167): the event name, the
 * primary logo instead of the name, or both. `name` may still carry the
 * square icon beside the name, as it always has.
 */
const THEME_HEADER_LOGOS = Object.freeze(['name', 'logo', 'both']);

/**
 * Where the home hero shows the primary logo (#1167): not at all (the
 * default), above the event name, or instead of it. The event name stays
 * the page's h1 either way.
 */
const THEME_HERO_LOGOS = Object.freeze(['off', 'above', 'instead']);

/**
 * The header identity a theme asks for. A theme that has not chosen keeps
 * the rule the header had before the choice existed: an uploaded primary
 * logo leads the name, otherwise the name stands alone.
 *
 * @param {object} theme
 * @param {boolean} hasLogo whether an uploaded primary logo resolves
 * @returns {'name'|'logo'|'both'}
 */
function resolveHeaderLogo(theme, hasLogo) {
  if (THEME_HEADER_LOGOS.includes(theme?.headerLogo)) return theme.headerLogo;
  return hasLogo ? 'both' : 'name';
}

/**
 * Whether the footer shows a logo. A theme that has not chosen shows one
 * whenever a footer or primary logo is set (#1166).
 *
 * @param {object} theme
 * @returns {boolean}
 */
function resolveFooterLogo(theme) {
  return typeof theme?.footerLogo === 'boolean' ? theme.footerLogo : true;
}

module.exports = {
  THEME_HEADER_LOGOS,
  THEME_HERO_LOGOS,
  resolveHeaderLogo,
  resolveFooterLogo,
  THEME_MODE_POLICIES,
  DEFAULT_MODE_POLICY,
  THEME_TEXTURES,
  DEFAULT_TEXTURE,
  THEME_HEADERS,
  DEFAULT_HEADER,
  resolveHeader,
  THEME_RADIUS_IDS,
  THEME_DENSITIES,
  THEME_NAV_PLACEMENTS,
  DEFAULT_NAV_PLACEMENT,
  resolveMode,
  THEME_PRESET_IDS,
  recommendedConfiguration,
  DEFAULT_PRESET_ID,
  THEME_MOTIF_SET_IDS,
  themePresetId,
  getPreset,
  resolveShape,
  resolveNavPlacement,
  resolveMotifSet,
};
