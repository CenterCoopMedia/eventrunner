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

const { decideResourceGrant } = require('./resourceAccess.cjs');
const RESOURCE_CASES = require('./__fixtures__/resource-grant-cases.json');

// The interactions cases also run against firestore.rules in tests/social-interaction-grants.rules.test.js.
for (const entry of RESOURCE_CASES) {
  test(`resource grant: ${entry.name}`, () => {
    const decision = decideResourceGrant(entry);
    assert.equal(decision.ok ? 'allow' : decision.code, entry.expected);
  });
}

test('resource grant: an unknown resource is a caller error', () => {
  assert.throws(() => decideResourceGrant({ control: null, account: null, grant: null, resource: 'sessions' }), TypeError);
});
