'use strict';

// The CLI's own suite (scripts/lib/answers.test.cjs) covers the answer
// rules through the seed wrapper. This file covers what the shared module
// adds: the injected theme base, and that it loads without the scripts tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfigDocs, mergeTheme } = require('./answers.cjs');

const tierA = { emailProvider: 'console', ticketingProvider: 'none', publicUrl: 'https://example.org' };

test('buildConfigDocs refuses a call without a theme base', () => {
  assert.throws(() => buildConfigDocs({ answers: {}, tierA }), /baseTheme/);
  assert.throws(() => buildConfigDocs({ answers: {}, tierA, baseTheme: null }), /baseTheme/);
});

test('buildConfigDocs overlays the answers on the injected theme base', () => {
  const baseTheme = { colors: { a: 1, b: 2 }, fonts: {}, logos: { primary: 'x' }, placeholderLogos: ['primary'] };
  const theme = mergeTheme(baseTheme, { colors: { b: 3 } });
  assert.deepEqual(theme.colors, { a: 1, b: 3 });
  assert.deepEqual(baseTheme.colors, { a: 1, b: 2 }, 'the base is not changed');
});

test('buildConfigDocs reports a missing operator without throwing', () => {
  const result = buildConfigDocs({ answers: {}, tierA, baseTheme: { colors: {}, fonts: {}, logos: {}, placeholderLogos: [] } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('adminEmails:')));
});
