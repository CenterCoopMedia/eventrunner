'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultTheme, rgbToHex, hexToRgb, PLACEHOLDER_LOGOS } = require('./theme.cjs');
const { validateTheme } = require('shared/config');
const {
  DEFAULT_PRESET_ID,
  DEFAULT_TEXTURE,
  THEME_PRESET_IDS,
  THEME_TEXTURES,
  getPreset,
  resolveLegacyColors,
  resolveShape,
} = require('shared/theme');

test('the default theme passes the real config/theme validator', () => {
  const verdict = validateTheme(defaultTheme());
  assert.equal(verdict.ok, true, verdict.errors.join('; '));
});

test('hex and RGB round-trip, so the stored doc and the stylesheet cannot disagree', () => {
  for (const rgb of Object.values(getPreset(DEFAULT_PRESET_ID).palette.light)) {
    assert.deepEqual(hexToRgb(rgbToHex(rgb)), [...rgb]);
  }
  // Built rather than written out: the repo lint bans hex literals here.
  assert.deepEqual(hexToRgb(`#${'abc'}`), [170, 187, 204], 'three-digit hex expands');
  assert.equal(hexToRgb('not a color'), null);
});

test('every logo slot starts as a placeholder the readiness branding row can see', () => {
  const theme = defaultTheme();
  assert.deepEqual(theme.placeholderLogos.sort(), Object.keys(PLACEHOLDER_LOGOS).sort());
  for (const slot of theme.placeholderLogos) {
    assert.match(theme.logos[slot], /^branding\//);
  }
});

test('a fresh deployment paints a flat surface: a texture is a style\u2019s to state', () => {
  // The seed names no texture, so the STYLE decides — and Institutional,
  // the style a fresh deployment starts on, is flat. The rule the base
  // branch wrote still holds; it is now read through the style rather than
  // copied into the document (owner review, 2026-08-27, §0).
  assert.equal(defaultTheme().texture, undefined);
  assert.equal(resolveShape(defaultTheme()).texture, 'flat');
  assert.equal(DEFAULT_TEXTURE, 'flat');
  assert.equal(THEME_TEXTURES[0], DEFAULT_TEXTURE, 'the default is the first offered value');
});

test('the seed starts on the default preset, with its palette materialized', () => {
  const theme = defaultTheme();
  // Owner review 2026-08-27: Institutional is the style a new deployment
  // gets, and it is the style the picker leads with. All six are offered
  // without a tier (owner calibration), so leading the list is the whole of
  // what "recommended" means here.
  assert.equal(theme.preset, DEFAULT_PRESET_ID);
  assert.equal(DEFAULT_PRESET_ID, 'civic');
  assert.equal(THEME_PRESET_IDS[0], DEFAULT_PRESET_ID);

  // Texture, corners, spacing, and illustrations are the STYLE's to state.
  // A seed that copied them in would pin the first style's shape onto every
  // later one (owner review, 2026-08-27).
  for (const field of ['texture', 'radius', 'density', 'motifSet']) {
    assert.equal(theme[field], undefined, `${field} is the style's to decide`);
  }

  // `colors` is an OUTPUT for a preset document: the one shared resolver
  // materializes it here exactly as updateTheme does on every publish, so
  // email and PDF have a palette from the first seed (brief §5.2).
  assert.deepEqual(theme.colors, resolveLegacyColors({ preset: DEFAULT_PRESET_ID }));

  // Values are declared as RGB triples in design/tokens (the repo lint bans
  // hex literals in scripts/); the doc carries their hex form.
  for (const value of Object.values(theme.colors)) {
    assert.match(value, /^#[0-9a-f]{6}$/);
  }

  // No per-client color arrives from a script default: the palette is the
  // preset's, and the preset ships no client's brand.
  assert.equal(theme.fonts.heading, undefined, 'the preset names the type map, not the seed');
});

test('the seed supplies a style, never a client’s own identity', () => {
  // Client identity leads (design brief §2.5.4). The seed used to hold that
  // by shipping a grey palette; §0's owner review moved it, because a fresh
  // deployment now starts on a real style rather than on nothing. The rule
  // is the same and the measurement moved with it: what a client sets —
  // their brand colour and their marks — is what the seed must NOT invent.
  // Everything else on the page is the style's to state.
  const theme = defaultTheme();
  assert.equal(theme.brandColor, undefined, 'the brand colour is the client’s to set');
  assert.deepEqual(theme.fonts, {}, 'the type map is the style’s to name');
  assert.deepEqual(
    theme.placeholderLogos.sort(),
    Object.keys(theme.logos).sort(),
    'every logo slot is still a placeholder, so no mark is shipped as the client’s',
  );
});
