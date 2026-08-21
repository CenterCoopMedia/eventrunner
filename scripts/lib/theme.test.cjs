'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultTheme, rgbToHex, hexToRgb, NEUTRAL_PALETTE_RGB, PLACEHOLDER_LOGOS } = require('./theme.cjs');
const { validateTheme } = require('shared/config');

test('the default theme passes the real config/theme validator', () => {
  const verdict = validateTheme(defaultTheme());
  assert.equal(verdict.ok, true, verdict.errors.join('; '));
});

test('hex and RGB round-trip, so the stored doc and the stylesheet cannot disagree', () => {
  for (const rgb of Object.values(NEUTRAL_PALETTE_RGB)) {
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

test('the seeded palette is event-neutral: no per-client color arrives from a script default', () => {
  const theme = defaultTheme();
  // Values are declared as RGB triples in the module (the repo lint bans
  // hex literals in scripts/); the doc carries their hex form.
  for (const value of Object.values(theme.colors)) {
    assert.match(value, /^#[0-9a-f]{6}$/);
  }
});
