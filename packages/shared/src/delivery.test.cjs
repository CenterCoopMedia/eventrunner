'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NOTICE_STATES, deliveryStateOf } = require('./delivery.cjs');

test('reads the legacy unknown state as uncertain and keeps every current state', () => {
  assert.equal(deliveryStateOf('unknown'), 'uncertain');
  for (const state of NOTICE_STATES) assert.equal(deliveryStateOf(state), state);
  assert.equal(deliveryStateOf(undefined), undefined);
});
