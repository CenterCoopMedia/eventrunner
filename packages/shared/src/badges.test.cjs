'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { validateBadgeSelection, validateCustomBadges, MAX_TOTAL_BADGES } = require('./badges.cjs');

const CONFIG = {
  categories: [
    { id: 'craft', maxPicks: 2, badges: [{ id: 'writer' }, { id: 'editor' }, { id: 'coder' }] },
    { id: 'fun', maxPicks: 1, badges: [{ id: 'night-owl' }, { id: 'early-bird-badge' }] },
  ],
};

test('intersection: unknown ids rejected, configured ids kept', () => {
  const result = validateBadgeSelection(['writer', 'made-up', 'night-owl'], CONFIG);
  assert.deepEqual(result, { valid: ['writer', 'night-owl'], rejected: ['made-up'] });
});

test('per-category maxPicks: first N kept in given order, overflow rejected', () => {
  const result = validateBadgeSelection(['writer', 'editor', 'coder', 'night-owl'], CONFIG);
  assert.deepEqual(result.valid, ['writer', 'editor', 'night-owl']);
  assert.deepEqual(result.rejected, ['coder']);
  // caps are per category, not global
  const fun = validateBadgeSelection(['night-owl', 'early-bird-badge'], CONFIG);
  assert.deepEqual(fun, { valid: ['night-owl'], rejected: ['early-bird-badge'] });
});

test('duplicates are rejected, first occurrence wins', () => {
  const result = validateBadgeSelection(['writer', 'writer'], CONFIG);
  assert.deepEqual(result, { valid: ['writer'], rejected: ['writer'] });
});

test('degrades safely on garbage input', () => {
  assert.deepEqual(validateBadgeSelection(null, CONFIG), { valid: [], rejected: [] });
  assert.deepEqual(validateBadgeSelection(['writer'], null), { valid: [], rejected: ['writer'] });
  assert.deepEqual(validateBadgeSelection([42, 'writer'], CONFIG), { valid: ['writer'], rejected: [42] });
});

// firestore.rules cannot `require()` this module, so its badges-array size
// cap is a hand-written literal (validBadgesList()) rather than an import
// of MAX_TOTAL_BADGES. This pins the two numbers equal so a change to one
// without the other fails loudly here instead of surfacing as a config an
// admin can save but an attendee can never fully select (see
// config/schema.cjs's validateBadgesConfig, which enforces the same bound
// on the config side).
test('MAX_TOTAL_BADGES matches the literal cap hand-written into firestore.rules', () => {
  const rulesPath = path.join(__dirname, '..', '..', '..', 'firestore.rules');
  const rulesText = readFileSync(rulesPath, 'utf8');
  const match = rulesText.match(/badges\.size\(\)\s*<=\s*(\d+)/);
  assert.ok(match, 'expected to find badges.size() <= N in firestore.rules');
  assert.equal(Number(match[1]), MAX_TOTAL_BADGES);
});

// --- free-text custom badges (issue #176) -----------------------------------

test('custom badges: trims, collapses whitespace, and keeps good words', () => {
  const result = validateCustomBadges(['  First   Timers  ', 'scholarship']);
  assert.deepEqual(result, { valid: ['First Timers', 'scholarship'], rejected: [] });
});

test('custom badges: rejects empties, non-strings, and bad characters', () => {
  const result = validateCustomBadges(['   ', 42, 'a<script>', 'bad😀word']);
  assert.deepEqual(result.valid, []);
  assert.equal(result.rejected.length, 4);
});

test('custom badges: caps length at 24 characters', () => {
  const result = validateCustomBadges(['x'.repeat(24), 'x'.repeat(25)]);
  assert.deepEqual(result.valid, ['x'.repeat(24)]);
  assert.equal(result.rejected.length, 1);
});

test('custom badges: caps the count at three, overflow rejected in order', () => {
  const result = validateCustomBadges(['one', 'two', 'three', 'four']);
  assert.deepEqual(result.valid, ['one', 'two', 'three']);
  assert.deepEqual(result.rejected, ['four']);
});

test('custom badges: duplicates rejected case-insensitively', () => {
  const result = validateCustomBadges(['First Timers', 'first timers']);
  assert.deepEqual(result.valid, ['First Timers']);
  assert.deepEqual(result.rejected, ['first timers']);
});

test('custom badges: the default word list blocks role impersonation', () => {
  const result = validateCustomBadges(['Admin', 'Speaker', 'volunteers']);
  assert.deepEqual(result.valid, []);
  assert.equal(result.rejected.length, 3);
});

test('custom badges: an operator block list extends the defaults, matched in a phrase', () => {
  const result = validateCustomBadges(['crypto Fan', 'first timers'], {
    blockList: ['crypto'],
  });
  assert.deepEqual(result.valid, ['first timers']);
  assert.deepEqual(result.rejected, ['crypto Fan']);
});

test('custom badges: a missing or malformed list validates to nothing', () => {
  assert.deepEqual(validateCustomBadges(null), { valid: [], rejected: [] });
  assert.deepEqual(validateCustomBadges('word'), { valid: [], rejected: [] });
});
