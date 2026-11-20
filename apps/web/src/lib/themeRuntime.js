// Theme controls and preview diagnostics used by the Branding editor.
import {
  THEME_MODES,
  THEME_MODE_POLICIES,
  THEME_FONT_ROLES,
  THEME_TEXTURES,
  THEME_DENSITIES,
  THEME_PRESET_IDS,
  recommendedConfiguration,
  THEME_MOTIF_SET_IDS,
  THEME_NAV_PLACEMENTS,
  DEFAULT_MODE_POLICY,
  DEFAULT_PRESET_ID,
  ADMIN_TOKEN_SET,
  resolveAdminAccent,
  ADMIN_SCHEME_IDS as THEME_ADMIN_SCHEME_IDS,
  DEFAULT_ADMIN_SCHEME as THEME_DEFAULT_ADMIN_SCHEME,
  resolveFontRoles,
  themePresetId,
} from 'shared/theme';
import { COLOR_PROPS, FONT_SETS, RADIUS_SCALES } from './themeCss.js';

// The preview uses the same CSS and attributes as the live site.
export { buildRuntimeThemeCss, resolveRootAttributes } from './themeCss.js';

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
/** config/theme.density values (brief §4, §6.1). */
export const DENSITY_IDS = Object.freeze([...THEME_DENSITIES]);
/** config/theme.mode values (brief §3.3). */
export const MODE_POLICY_IDS = Object.freeze([...THEME_MODE_POLICIES]);
/** The mode policy a document without a `mode` field renders as. */
export { DEFAULT_MODE_POLICY };
/**
 * The six style ids, in picker order (brief §4). `data-theme` carries one of
 * these. All six are first-class: the order is a recommendation and there is
 * no second tier (owner calibration, 2026-08-27).
 */
export const PRESET_IDS = Object.freeze([...THEME_PRESET_IDS]);
/** The `config/theme` a style produces the moment it is picked. */
export { recommendedConfiguration };
/** The style a new deployment starts on. */
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
 * The first family in a set's stack — the bundled face — and the rest, which
 * is what a reader sees if that face has not arrived.
 *
 * @param {string} setId
 * @returns {{ family: string, fallback: string }|null}
 */
export function fontSetFaces(setId) {
  const stack = FONT_SETS[setId];
  if (!stack) return null;
  const families = stack.split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, ''));
  return { family: families[0], fallback: families.slice(1).join(', ') };
}

/**
 * Whether a font family is available to render right now.
 *
 * `document.fonts.check` answers for the whole stack of loaded and system
 * faces, which is exactly the question. Where the API is missing — jsdom, an
 * old browser — the answer is "assume it is there": a preview must never
 * invent a warning it cannot substantiate.
 *
 * @param {string} family
 * @returns {boolean}
 */
function isFontAvailable(family) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts || typeof fonts.check !== 'function') return true;
  try {
    return fonts.check(`16px "${family}"`);
  } catch {
    return true;
  }
}

/** "400 700" covers both ends. One number, or a CSS name, is that one weight. */
function weightsInSpec(value) {
  const raw = String(value || '400').trim().toLowerCase();
  if (raw === 'normal') return [400];
  if (raw === 'bold') return [700];
  const parts = raw.split(/\s+/).map(Number).filter((part) => Number.isFinite(part));
  if (parts.length === 0) return [400];
  if (parts.length === 1) return [parts[0]];
  return [parts[0], parts[parts.length - 1]];
}

function faceCoversWeight(face, weight) {
  const spec = weightsInSpec(face?.weight);
  if (spec.length === 1) return spec[0] === weight;
  return weight >= spec[0] && weight <= spec[1];
}

/**
 * Weights the preview document declares for this family.
 * null means the styles could not be read. An empty list means no bundled face.
 */
function declaredFontWeights(doc, family) {
  const sheets = doc?.styleSheets;
  if (!sheets) return null;
  const found = new Set();
  let readable = false;
  for (const sheet of sheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    readable = true;
    for (const rule of rules) {
      if (rule?.type !== 5 || !rule.style?.getPropertyValue) continue;
      const declared = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (declared !== family) continue;
      for (const weight of weightsInSpec(rule.style.getPropertyValue('font-weight'))) {
        found.add(weight);
      }
    }
  }
  if (!readable) return null;
  return [...found].sort((a, b) => a - b);
}

function facesFor(fonts, family) {
  const list = [];
  if (typeof fonts?.forEach !== 'function') return list;
  fonts.forEach((face) => {
    const name = String(face?.family || '').replace(/["']/g, '').trim();
    if (name === family) list.push(face);
  });
  return list;
}

/**
 * ready: every requested weight can paint.
 * loading: a requested weight is downloading and has not failed.
 * unavailable: a requested weight failed, or a loaded face still cannot paint.
 * An unloaded face has not been requested. check() does not start that
 * download, so it is not a warning.
 * A missing Font Loading API cannot support a warning, so it counts as ready.
 */
function documentFontState(doc, family) {
  const fonts = doc?.fonts;
  if (!fonts || typeof fonts.check !== 'function') return { state: 'ready' };
  const declared = declaredFontWeights(doc, family);
  const weights = declared === null ? [400] : declared;
  if (weights.length === 0) return { state: 'ready' };
  const loading = [];
  const missing = [];
  for (const weight of weights) {
    let ready = true;
    try {
      ready = fonts.check(`${weight} 16px "${family}"`);
    } catch {
      return { state: 'ready' };
    }
    if (ready) continue;
    const faces = facesFor(fonts, family).filter((face) => faceCoversWeight(face, weight));
    if (faces.some((face) => face.status === 'error')) missing.push(weight);
    else if (faces.some((face) => face.status === 'loading')) loading.push(weight);
    else if (faces.some((face) => face.status === 'loaded')) missing.push(weight);
  }
  if (missing.length > 0) return { state: 'unavailable', weights: missing };
  if (loading.length > 0) return { state: 'loading', weights: loading };
  return { state: 'ready' };
}

function combineFontState(documents, family) {
  const loading = new Set();
  const missing = new Set();
  for (const doc of documents) {
    const result = documentFontState(doc, family);
    if (result.state === 'unavailable') result.weights.forEach((weight) => missing.add(weight));
    else if (result.state === 'loading') result.weights.forEach((weight) => loading.add(weight));
  }
  if (missing.size > 0) return { state: 'unavailable', weights: [...missing].sort((a, b) => a - b) };
  if (loading.size > 0) return { state: 'loading', weights: [...loading].sort((a, b) => a - b) };
  return { state: 'ready' };
}

/**
 * What this document asks for that will NOT render as asked, in plain words
 * (owner review, 2026-08-27).
 *
 * The page preview shows the truth about a candidate, and two kinds of
 * request fall back silently:
 *
 *   • A COLOUR the resolver cannot read. `config/theme` carries hex strings
 *     as data, and anything that is not `#RGB` or `#RRGGBB` is skipped —
 *     the style's own value renders instead, and nothing on screen says so.
 *   • A FONT the preview document cannot paint yet. A role resolves to a
 *     bundled family. While that face is loading, say so. Once it is ready,
 *     say nothing. If a declared weight fails, say that it did not load.
 *
 * @param {object} themeDoc
 * @param {{ fontAvailable?: (family: string) => boolean|'loading', documents?: Document[] }} [options]
 * @returns {Array<{ kind: 'color'|'font', field: string, message: string }>}
 */
export function themeFallbackWarnings(themeDoc, { fontAvailable, documents } = {}) {
  const warnings = [];
  if (!isPlainObject(themeDoc)) return warnings;

  const colorWarning = (field, value, instead) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (hexToChannels(value) !== null) return;
    warnings.push({
      kind: 'color',
      field,
      message: `${field} is not a colour this system can read (${value.trim()}). ${instead}`,
    });
  };

  colorWarning(
    'Main brand colour',
    themeDoc.brandColor,
    'The style\u2019s own colour is showing instead.',
  );
  for (const mode of THEME_MODES) {
    for (const [key, value] of Object.entries(themeDoc.tokens?.[mode] ?? {})) {
      colorWarning(
        `${key} (${mode})`,
        value,
        'The worked-out value is showing instead.',
      );
    }
  }
  if (!themePresetId(themeDoc)) {
    for (const [key, value] of Object.entries(themeDoc.colors ?? {})) {
      colorWarning(key, value, 'The value this deployment was built with is showing instead.');
    }
  }

  const roles = resolveFontRoles(themeDoc);
  const seen = new Set();
  for (const role of THEME_FONT_ROLES) {
    const faces = fontSetFaces(roles[role]);
    if (!faces || seen.has(faces.family)) continue;
    seen.add(faces.family);
    let result;
    if (typeof fontAvailable === 'function') {
      const answer = fontAvailable(faces.family);
      if (answer === 'loading') result = { state: 'loading' };
      else if (answer === false) result = { state: 'unavailable' };
      else result = { state: 'ready' };
    } else if (Array.isArray(documents)) {
      result = documents.length === 0 ? { state: 'ready' } : combineFontState(documents, faces.family);
    } else if (isFontAvailable(faces.family)) {
      result = { state: 'ready' };
    } else {
      result = { state: 'unavailable' };
    }
    if (result.state === 'ready') continue;
    const instead = faces.fallback || 'the browser\u2019s own face';
    const weights = result.weights ?? [];
    const weightLabel = weights.length === 0
      ? ''
      : ` ${weights.length === 1 ? 'weight' : 'weights'} ${weights.join(' and ')}`;
    const name = `${faces.family}${weightLabel}`;
    const loadingVerb = weights.length > 1 ? 'are' : 'is';
    warnings.push({
      kind: 'font',
      field: role,
      message: result.state === 'loading'
        ? `${name} ${loadingVerb} still loading, so the ${role} text is showing in ${instead} for now.`
        : `${name} did not load, so the ${role} text is showing in ${instead}.`,
    });
  }
  return warnings;
}

/**
 * Whether the resolved brand colour clears the admin title band in a mode,
 * and what the page-header mark actually renders (admin story part 6f, owner
 * review 2026-08-27, desk amendment 2026-09-10). There is no separate admin
 * marker colour: the mark is the site's own brand colour, and the floor is
 * the only thing that can move it. The theme editor states that in words;
 * nothing is clamped.
 *
 * @param {object} themeDoc
 * @param {'light'|'dark'} mode
 * @returns {{ rgb: number[]|null, ratio: number|null, fellBack: boolean, floor: number }}
 */
export function adminAccentVerdict(themeDoc, mode) {
  return { ...resolveAdminAccent(themeDoc, mode), floor: ADMIN_ACCENT_FLOOR };
}

/** The contrast the admin page-header mark must clear: it is non-text UI. */
const ADMIN_ACCENT_FLOOR = 3;

/** The admin token set, for the editor's own preview surfaces. */
export { ADMIN_TOKEN_SET };

/** What the Branding tab may name as the admin's colours: the brand colour, or a house scheme. */
export const ADMIN_SCHEME_IDS = Object.freeze([...THEME_ADMIN_SCHEME_IDS]);

/** The admin colours a document that names none renders: the brand colour. */
export const DEFAULT_ADMIN_SCHEME = THEME_DEFAULT_ADMIN_SCHEME;

/**
 * What each admin colour scheme is called on the Branding tab. The default
 * says what it follows, so a staff member who has never opened the setting
 * can read what the admin is doing from the one line.
 */
export const ADMIN_SCHEME_LABELS = Object.freeze({
  brand: 'Follow the main brand colour',
  navy: 'Navy',
  graphite: 'Graphite',
  forest: 'Forest',
  oxblood: 'Oxblood',
  teal: 'Teal',
  plum: 'Plum',
});
