'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideSessionGrant } = require('./resourceAccess.cjs');
const CASES = require('./__fixtures__/session-grant-cases.json');

// The same cases run against firestore.rules in tests/ticket-session-grants.rules.test.js.
for (const entry of CASES) {
  test(`session grant: ${entry.name}`, () => {
    const decision = decideSessionGrant(entry);
    assert.equal(decision.ok ? 'allow' : decision.code, entry.expected);
  });
}
