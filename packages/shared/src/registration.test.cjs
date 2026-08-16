'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REGISTRATION_STATUSES,
  isValidTransition,
  computeEntitlement,
  hasAttendeeAccess,
} = require('./registration.cjs');

test('status vocabulary is exactly the four spec values', () => {
  assert.deepEqual(REGISTRATION_STATUSES, ['pending', 'ticketed', 'approved', 'revoked']);
});

test('every allowed transition in the spec table', () => {
  const allowed = [
    [null, 'pending', 'account_created'],
    [undefined, 'pending', 'account_created'],
    ['pending', 'ticketed', 'ticket_claimed'],
    ['ticketed', 'approved', 'admin_approval'],
    ['ticketed', 'approved', 'auto_approve'],
    ['pending', 'approved', 'admin_approval'],
    ['approved', 'revoked', 'admin_revocation'],
    ['approved', 'revoked', 'entitlement_lost'],
    ['ticketed', 'revoked', 'admin_revocation'],
    ['ticketed', 'revoked', 'entitlement_lost'],
    ['revoked', 'approved', 'admin_reapproval'],
  ];
  for (const [from, to, trigger] of allowed) {
    assert.equal(isValidTransition(from, to, trigger), true, `${from} -> ${to} (${trigger})`);
  }
});

test('disallowed transitions are rejected', () => {
  const disallowed = [
    ['pending', 'approved', 'auto_approve'],       // auto-approve only from ticketed
    ['pending', 'revoked', 'admin_revocation'],    // nothing to revoke
    ['revoked', 'ticketed', 'ticket_claimed'],     // re-entry is via admin_reapproval only
    ['revoked', 'approved', 'admin_approval'],     // wrong trigger for re-entry
    ['approved', 'ticketed', 'ticket_claimed'],    // no downgrade
    ['ticketed', 'approved', 'ticket_claimed'],    // wrong trigger
    [null, 'approved', 'admin_approval'],          // accounts start at pending
    ['pending', 'pending', 'account_created'],
    ['registered', 'approved', 'admin_approval'],  // legacy value does not exist in v1
  ];
  for (const [from, to, trigger] of disallowed) {
    assert.equal(isValidTransition(from, to, trigger), false, `${from} -> ${to} (${trigger})`);
  }
});

test('computeEntitlement: ticket or admin grant', () => {
  assert.equal(computeEntitlement({ hasValidTicket: true, approvalSource: 'ticket' }), true);
  assert.equal(computeEntitlement({ hasValidTicket: false, approvalSource: 'ticket' }), false);
  // the load-bearing case: admin approval survives every ticket refund
  assert.equal(computeEntitlement({ hasValidTicket: false, approvalSource: 'admin' }), true);
  assert.equal(computeEntitlement({ hasValidTicket: false, approvalSource: null }), false);
  assert.equal(computeEntitlement({}), false);
  assert.equal(computeEntitlement(null), false);
});

test('hasAttendeeAccess: approved, speaker, admin; everyone else false', () => {
  assert.equal(hasAttendeeAccess({ registrationStatus: 'approved' }), true);
  assert.equal(hasAttendeeAccess({ registrationStatus: 'pending', speakerId: 'spk_1' }), true);
  assert.equal(hasAttendeeAccess({ registrationStatus: 'pending', role: 'admin' }), true);
  assert.equal(hasAttendeeAccess({ registrationStatus: 'revoked', role: 'super_admin' }), true);
  assert.equal(hasAttendeeAccess({ registrationStatus: 'pending' }), false);
  assert.equal(hasAttendeeAccess({ registrationStatus: 'ticketed' }), false);
  assert.equal(hasAttendeeAccess({ registrationStatus: 'revoked' }), false);
  assert.equal(hasAttendeeAccess({ speakerId: null }), false);
  assert.equal(hasAttendeeAccess(null), false);
  assert.equal(hasAttendeeAccess(undefined), false);
});
