'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLogistics, readLogistics, MAX_LOGISTICS_LENGTH } = require('./speakerLogistics.cjs');

test('logistics answers are optional text, trimmed, with empty answers as null', () => {
  assert.deepEqual(checkLogistics({ travel: '  Train from Newark. ', accessNeeds: '', avNeeds: undefined }), {
    ok: true, logistics: { travel: 'Train from Newark.', accessNeeds: null, avNeeds: null },
  });
  assert.deepEqual(checkLogistics({}), { ok: true, logistics: { travel: null, accessNeeds: null, avNeeds: null } });
});

test('logistics refuses unknown keys, wrong types and long answers by name', () => {
  const bad = checkLogistics({ travel: 7, avNeeds: 'x'.repeat(MAX_LOGISTICS_LENGTH + 1), dietary: 'none' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.sort(), [
    `logistics.avNeeds: must be at most ${MAX_LOGISTICS_LENGTH} characters`,
    'logistics.dietary: is not a logistics field',
    'logistics.travel: must be text',
  ]);
  assert.deepEqual(checkLogistics(null), { ok: false, errors: ['logistics: must be an object'] });
});

test('a stored record reads safely', () => {
  assert.deepEqual(readLogistics({ travel: 'Car', accessNeeds: 3 }), { travel: 'Car', accessNeeds: null, avNeeds: null });
  assert.deepEqual(readLogistics(undefined), { travel: null, accessNeeds: null, avNeeds: null });
});
