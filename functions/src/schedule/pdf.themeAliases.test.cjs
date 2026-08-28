'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  internals: { hexToRgb01, resolveThemeColors },
} = require('./pdf.cjs');

const hex = (digits) => `#${digits}`;

test('resolveThemeColors accepts seeded color aliases', () => {
  const resolved = resolveThemeColors({
    colors: {
      brandPrimary: hex('102030'),
      brandInk: hex('203040'),
      brandInkMuted: hex('304050'),
      brandSurface: hex('f0f1f2'),
      brandAccent: hex('506070'),
    },
  });

  assert.deepEqual(resolved.primary, hexToRgb01(hex('102030')));
  assert.deepEqual(resolved.ink, hexToRgb01(hex('203040')));
  assert.deepEqual(resolved.inkMuted, hexToRgb01(hex('304050')));
  assert.deepEqual(resolved.surface, hexToRgb01(hex('f0f1f2')));
  assert.deepEqual(resolved.accent, hexToRgb01(hex('506070')));
});

test('resolveThemeColors gives canonical keys precedence', () => {
  const resolved = resolveThemeColors({
    colors: {
      primary: hex('a0b0c0'),
      brandPrimary: hex('102030'),
    },
  });

  assert.deepEqual(resolved.primary, hexToRgb01(hex('a0b0c0')));
});
