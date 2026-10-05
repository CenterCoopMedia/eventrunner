const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readClosesAt } = require('./pitch.cjs');

test('pitch call only accepts real RFC3339 instants with an explicit timezone', () => {
  assert.equal(readClosesAt('2030-11-30T23:59:59-05:00'), '2030-12-01T04:59:59.000Z');
  for (const value of ['2050', '2030-02-30T00:00:00Z', '2030-01-01T00:00:00', null, '2030-01-01T24:01:00Z']) assert.equal(readClosesAt(value), null);
});
