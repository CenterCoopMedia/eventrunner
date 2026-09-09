'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REGISTRATION_STATUSES,
  isValidTransition,
  computeEntitlement,
  hasAttendeeAccess,
  resolveRegistrationAction,
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

// THE REGISTRATION ACTION (M7 issue 8). One reader for three surfaces: the
// control on the home lead, the control in the header, and the button in
// the registration email a ticket provider sends. They each used to read
// the field for themselves, which is how a destination the page refused
// still reached a reader in an email.
test('resolveRegistrationAction: an https destination, with the label the client wrote', () => {
  assert.deepEqual(
    resolveRegistrationAction({
      registration: {
        externalUrl: '  https://register.example.org/summit  ',
        actionLabel: ' Get a ticket ',
      },
    }),
    { url: 'https://register.example.org/summit', label: 'Get a ticket' },
  );
});

test('resolveRegistrationAction: no label of its own, so each surface states its default', () => {
  for (const registration of [
    { externalUrl: 'https://register.example.org' },
    { externalUrl: 'https://register.example.org', actionLabel: null },
    { externalUrl: 'https://register.example.org', actionLabel: '   ' },
    { externalUrl: 'https://register.example.org', actionLabel: 42 },
  ]) {
    assert.equal(resolveRegistrationAction({ registration }).label, null);
  }
});

test('resolveRegistrationAction: nothing to send anybody to reads as nothing', () => {
  for (const eventConfig of [
    undefined,
    null,
    {},
    { registration: null },
    { registration: {} },
    { registration: { externalUrl: null } },
    { registration: { externalUrl: '   ' } },
    // A label with no destination is not an action.
    { registration: { actionLabel: 'Register' } },
  ]) {
    assert.equal(resolveRegistrationAction(eventConfig), null);
  }
});

test('resolveRegistrationAction: refuses every destination that is not https', () => {
  for (const externalUrl of [
    'http://register.example.org',
    'javascript:alert(1)',
    'data:text/html,<p>hi</p>',
    'mailto:hello@example.org',
    'register.example.org',
    42,
    {},
  ]) {
    assert.equal(
      resolveRegistrationAction({ registration: { externalUrl } }),
      null,
      `expected ${JSON.stringify(externalUrl)} to be refused`,
    );
  }
});

// Codex review of the configured registration action (P2). Two halves of
// one bug: what the reader ACCEPTS, and what it hands back.
//
// `new URL('https:register.example.org').protocol` is 'https:' — the WHATWG
// parser reads a special scheme with no `//` as a relative reference — so a
// protocol test alone let a string through that is not an absolute URL at
// all. In an `href` it resolves against the page it sits on, and a reader
// clicking Register lands on the event's own domain; in an email it is
// worse, because nobody sees the address before they click.
test('resolveRegistrationAction: a destination with no authority is not a destination', () => {
  for (const externalUrl of [
    'https:register.example.org',
    'https:/register.example.org',
    'http:register.example.org',
    '//register.example.org',
  ]) {
    assert.equal(
      resolveRegistrationAction({ registration: { externalUrl } }),
      null,
      `expected ${JSON.stringify(externalUrl)} to be refused`,
    );
  }
});

test('resolveRegistrationAction: hands back the canonical href, not the raw string', () => {
  // What the page puts in an `href` and what the email puts in its button
  // is exactly the string this reader approved — host lower-cased, path
  // present, every component encoded the way the parser read it. Handing
  // back the raw text is what lets a value validate as one URL and resolve
  // as another.
  assert.equal(
    resolveRegistrationAction({
      registration: { externalUrl: '  HTTPS://Register.Example.ORG  ' },
    }).url,
    'https://register.example.org/',
  );
  assert.equal(
    resolveRegistrationAction({
      registration: { externalUrl: 'https://register.example.org/summit tickets' },
    }).url,
    'https://register.example.org/summit%20tickets',
  );
});
