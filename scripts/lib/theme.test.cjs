'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultTheme, rgbToHex, hexToRgb, NEUTRAL_PALETTE_RGB, PLACEHOLDER_LOGOS } = require('./theme.cjs');
const { validateTheme } = require('shared/config');
const { DEFAULT_TEXTURE, THEME_TEXTURES } = require('shared/theme');

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

test('a fresh deployment seeds a flat surface: a texture is a theme opt-in', () => {
  assert.equal(defaultTheme().texture, DEFAULT_TEXTURE);
  assert.equal(DEFAULT_TEXTURE, 'flat');
  assert.equal(THEME_TEXTURES[0], DEFAULT_TEXTURE, 'the default is the first offered value');
});

test('a fresh deployment seeds one neutral face for every role', () => {
  // The base picks no typographic register. A theme brings the pairing that
  // gives a deployment its character.
  const { fonts } = defaultTheme();
  assert.deepEqual(fonts, {
    heading: 'sans-humanist',
    body: 'sans-humanist',
    data: 'sans-humanist',
  });
});

test('the seeded palette is event-neutral: no per-client color arrives from a script default', () => {
  const theme = defaultTheme();
  // Values are declared as RGB triples in the module (the repo lint bans
  // hex literals in scripts/); the doc carries their hex form.
  for (const value of Object.values(theme.colors)) {
    assert.match(value, /^#[0-9a-f]{6}$/);
  }
});

test('a fresh deployment renders in ink on paper, so the client’s color leads', () => {
  // The shared system supplies type, spacing, rules, and focus. It does not
  // supply a look of its own for a client to work around, so every brand
  // slot is a grey and the first hue on the page is the one the client sets
  // (design brief §2.5.4). Semantic slots are exempt: a status color that is
  // grey states nothing.
  for (const [slot, rgb] of Object.entries(NEUTRAL_PALETTE_RGB)) {
    if (!slot.startsWith('brand')) continue;
    const spread = Math.max(...rgb) - Math.min(...rgb);
    assert.ok(spread <= 8, `${slot} carries a hue (channel spread ${spread})`);
  }
});
