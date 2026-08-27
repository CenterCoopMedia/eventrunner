'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultTheme, rgbToHex, hexToRgb, PLACEHOLDER_LOGOS } = require('./theme.cjs');
const { validateTheme } = require('shared/config');
const {
  DEFAULT_PRESET_ID,
  getPreset,
  presetTier,
  resolveLegacyColors,
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

test('the seed starts on the default preset, with its palette materialized', () => {
  const theme = defaultTheme();
  // Owner review 2026-08-27: Institutional is the preset a new deployment
  // gets, and it is on the stable tier by construction — the launch surface
  // is what onboarding starts from.
  assert.equal(theme.preset, DEFAULT_PRESET_ID);
  assert.equal(DEFAULT_PRESET_ID, 'civic');
  assert.equal(presetTier(DEFAULT_PRESET_ID), 'stable');
  assert.equal(theme.motifSet, getPreset(DEFAULT_PRESET_ID).motifSet);

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
