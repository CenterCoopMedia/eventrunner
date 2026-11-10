'use strict';

// The CLI's own suite (scripts/lib/answers.test.cjs) covers the answer
// rules through the seed wrapper. This file covers what the shared module
// adds: the injected theme base, and that it loads without the scripts tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfigDocs, mergeTheme, buildFeatures } = require('./answers.cjs');

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

// CodeQL on #581: the module is a shared library now, and the console will
// pass it strings from strangers.
const { parseEmailList, internals } = require('./answers.cjs');

test('email lists are checked without backtracking on hostile input', () => {
  const hostile = `!@!.${'!.'.repeat(25_000)}@`;
  const started = Date.now();
  assert.ok(parseEmailList(hostile) instanceof Error);
  const result = buildConfigDocs({
    answers: { adminEmails: [hostile] },
    tierA,
    baseTheme: { colors: {}, fonts: {}, logos: {}, placeholderLogos: [] },
  });
  assert.ok(result.errors.some((e) => e.startsWith('adminEmails:') && e.includes('is not an email address')));
  assert.ok(Date.now() - started < 500, 'both checks finish quickly');
  // The same addresses are still accepted.
  assert.deepEqual(parseEmailList('A@Example.org, b@sub.example.org'), ['a@example.org', 'b@sub.example.org']);
});

test('setPath refuses a prototype key in the path', () => {
  for (const path of ['__proto__.polluted', 'event.constructor.prototype.polluted', 'event.__proto__']) {
    assert.throws(() => internals.setPath({}, path, 'x'), /not allowed/);
  }
  assert.equal({}.polluted, undefined);
  const target = {};
  internals.setPath(target, 'event.venue.name', 'Hall');
  assert.deepEqual(target, { event: { venue: { name: 'Hall' } } });
});


test('new sites enable features that need no setup and keep explicit off values', () => {
  const keys = ['badges', 'customBadges', 'liveUpdates', 'changeRequests'];
  const overrides = Object.fromEntries(keys.map((key) => [key, false]));
  for (const key of keys) {
    assert.equal(buildFeatures().features[key], true, key);
    assert.equal(buildFeatures(overrides).features[key], false, key);
  }
  assert.equal(buildFeatures().features.updates, false);
});

// Issue #506: a new site starts with the attendee feed off, and an explicit
// answer is kept.
test('new sites start with the attendee feed off', () => {
  assert.equal(buildFeatures().features.socialFeed, false);
  assert.equal(buildFeatures({ socialFeed: true }).features.socialFeed, true);
});
