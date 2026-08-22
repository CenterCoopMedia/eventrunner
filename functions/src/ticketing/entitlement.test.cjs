'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  recomputeEntitlement,
  createOnTicketWritten,
  internals: { affectedUids },
} = require('./entitlement.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-20T10:00:00.000Z');

const config = (features = {}) => async () => ({ bootstrap: { adminEmails: [] }, features });
const autoApproveOn = config({ autoApproveTicketHolders: true });
const autoApproveOff = config({});

function user(overrides = {}) {
  return { uid: 'uid-ada', registrationStatus: 'pending', approvalSource: null, ...overrides };
}

function ticket(overrides = {}) {
  return {
    externalId: 'tkt-1',
    orderId: 'ord-1',
    email: 'attendee@example.com',
    status: 'valid',
    claimedByUid: 'uid-ada',
    ...overrides,
  };
}

const recompute = (db, getConfig = autoApproveOff, uid = 'uid-ada') =>
  recomputeEntitlement({ db, uid, getConfig, now: () => T0 });

// ---------------------------------------------------------------------------
// The §3.4 recomputation matrix.
// ---------------------------------------------------------------------------

test('a claimed valid ticket moves pending → ticketed (§3.4 table)', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user(), 'tickets/tkt-1': ticket() });

  const result = await recompute(db);

  assert.equal(result.action, 'updated');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'ticketed');
  assert.equal(db.read('users', 'uid-ada').approvalSource, null);
});

test('autoApproveTicketHolders carries the same claim to approved, source "ticket"', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user(), 'tickets/tkt-1': ticket() });

  await recompute(db, autoApproveOn);

  const stored = db.read('users', 'uid-ada');
  assert.equal(stored.registrationStatus, 'approved');
  // NEVER 'admin': only an explicit organizer decision may survive a refund
  // (§3.4).
  assert.equal(stored.approvalSource, 'ticket');
});

test('with the flag off a ticketed account stays ticketed, never approved', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'ticketed' }),
    'tickets/tkt-1': ticket(),
  });

  const result = await recompute(db, autoApproveOff);

  assert.equal(result.action, 'unchanged');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'ticketed');
});

test('an account with no ticket at all stays pending — there is no pending → revoked edge', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });

  const result = await recompute(db);

  assert.equal(result.action, 'unchanged');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'pending');
});

test('a refund with no other valid ticket revokes a ticket-approved account', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'approved', approvalSource: 'ticket' }),
    'tickets/tkt-1': ticket({ status: 'refunded' }),
  });

  await recompute(db, autoApproveOn);

  const stored = db.read('users', 'uid-ada');
  assert.equal(stored.registrationStatus, 'revoked');
  // The grant that is gone stops being recorded.
  assert.equal(stored.approvalSource, null);
});

test('an ADMIN grant survives every ticket refund (§3.4)', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'approved', approvalSource: 'admin' }),
    'tickets/tkt-1': ticket({ status: 'refunded' }),
    'tickets/tkt-2': ticket({ externalId: 'tkt-2', status: 'cancelled' }),
  });

  const result = await recompute(db, autoApproveOn);

  assert.equal(result.action, 'unchanged');
  const stored = db.read('users', 'uid-ada');
  assert.equal(stored.registrationStatus, 'approved');
  assert.equal(stored.approvalSource, 'admin');
});

test('the multi-ticket refund case: one refund out of several changes nothing', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'approved', approvalSource: 'ticket' }),
    'tickets/tkt-1': ticket({ status: 'refunded' }),
    'tickets/tkt-2': ticket({ externalId: 'tkt-2', status: 'valid' }),
    'tickets/tkt-3': ticket({ externalId: 'tkt-3', status: 'cancelled' }),
  });

  const result = await recompute(db, autoApproveOn);

  assert.equal(result.action, 'unchanged');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'approved');
});

test('revocation waits for the LAST valid ticket in the set to go', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'approved', approvalSource: 'ticket' }),
    'tickets/tkt-1': ticket({ status: 'refunded' }),
    'tickets/tkt-2': ticket({ externalId: 'tkt-2', status: 'valid' }),
  });

  await recompute(db, autoApproveOn);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'approved');

  await db.collection('tickets').doc('tkt-2').set({ status: 'refunded' }, { merge: true });
  await recompute(db, autoApproveOn);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('a ticket claimed by somebody else does not entitle this account', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'ticketed' }),
    'tickets/tkt-1': ticket({ claimedByUid: 'uid-bob' }),
  });

  await recompute(db, autoApproveOn);

  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('an unclaimed ticket entitles nobody', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'ticketed' }),
    'tickets/tkt-1': ticket({ claimedByUid: null }),
  });

  await recompute(db, autoApproveOn);

  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('revoked is terminal for recomputation — a later valid ticket does not undo it', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'revoked', approvalSource: null }),
    'tickets/tkt-1': ticket(),
  });

  const result = await recompute(db, autoApproveOn);

  assert.equal(result.action, 'unchanged');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('a pending_info ticket HOLDS the account rather than revoking on ignorance', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'ticketed' }),
    'tickets/tkt-1': ticket({ status: 'pending_info' }),
  });

  const result = await recompute(db, autoApproveOn);

  assert.equal(result.action, 'held');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'ticketed');
  // …and once the provider says what it is, the normal rules resume.
  await db.collection('tickets').doc('tkt-1').set({ status: 'cancelled' }, { merge: true });
  await recompute(db, autoApproveOn);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('an account document that does not exist is reported, not created', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': ticket() });

  const result = await recompute(db);

  assert.equal(result.action, 'missing');
  assert.equal(db.ids('users').length, 0);
});

// ---------------------------------------------------------------------------
// Trigger behavior: which uids, and what repeated deliveries do.
// ---------------------------------------------------------------------------

test('affectedUids covers both images so a moved or cleared claim recomputes the old holder', () => {
  assert.deepEqual(affectedUids(null, { claimedByUid: 'uid-ada' }), ['uid-ada']);
  assert.deepEqual(affectedUids({ claimedByUid: 'uid-ada' }, null), ['uid-ada']);
  assert.deepEqual(
    affectedUids({ claimedByUid: 'uid-ada' }, { claimedByUid: 'uid-bob' }),
    ['uid-ada', 'uid-bob'],
  );
  // Unchanged claim: one uid, not two.
  assert.deepEqual(affectedUids({ claimedByUid: 'uid-ada' }, { claimedByUid: 'uid-ada' }), ['uid-ada']);
  assert.deepEqual(affectedUids({ claimedByUid: null }, { claimedByUid: '' }), []);
  assert.deepEqual(affectedUids(undefined, undefined), []);
});

test('a claim that moves recomputes BOTH accounts', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'ticketed' }),
    'users/uid-bob': { uid: 'uid-bob', registrationStatus: 'pending', approvalSource: null },
    'tickets/tkt-1': ticket({ claimedByUid: 'uid-bob' }),
  });
  const trigger = createOnTicketWritten({ db, getConfig: autoApproveOff, now: () => T0, log: QUIET });

  await trigger({ before: { claimedByUid: 'uid-ada' }, after: { claimedByUid: 'uid-bob' } });

  // Ada lost her only ticket; Bob gained one.
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
  assert.equal(db.read('users', 'uid-bob').registrationStatus, 'ticketed');
});

test('a replayed delivery is a no-op — the second run writes nothing', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user(), 'tickets/tkt-1': ticket() });
  const trigger = createOnTicketWritten({ db, getConfig: autoApproveOn, now: () => T0, log: QUIET });
  const event = { before: null, after: { claimedByUid: 'uid-ada' } };

  const first = await trigger(event);
  const writesAfterFirst = db.writes.length;
  const second = await trigger(event);

  assert.equal(first.recomputed[0].action, 'updated');
  assert.equal(second.recomputed[0].action, 'unchanged');
  assert.equal(db.writes.length, writesAfterFirst);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'approved');
});

test('out-of-order deliveries converge on the CURRENT ticket set, not the event payload', async () => {
  const db = makeFakeDb({
    'users/uid-ada': user({ registrationStatus: 'approved', approvalSource: 'ticket' }),
    'tickets/tkt-1': ticket({ status: 'refunded' }),
  });
  const trigger = createOnTicketWritten({ db, getConfig: autoApproveOn, now: () => T0, log: QUIET });

  // The STALE delivery (the ticket as it was when still valid) lands last;
  // the handler re-reads, so it cannot republish the entitlement.
  await trigger({ before: null, after: { claimedByUid: 'uid-ada', status: 'refunded' } });
  await trigger({ before: { claimedByUid: 'uid-ada', status: 'valid' }, after: { claimedByUid: 'uid-ada', status: 'valid' } });

  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('a failing recomputation rethrows so the retry can recover it', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user(), 'tickets/tkt-1': ticket() });
  const boom = new Error('firestore unavailable');
  db.runTransaction = async () => { throw boom; };
  const trigger = createOnTicketWritten({ db, getConfig: autoApproveOff, now: () => T0, log: QUIET });

  await assert.rejects(
    () => trigger({ before: null, after: { claimedByUid: 'uid-ada' } }),
    /firestore unavailable/,
  );
});

test('a trigger for a ticket nobody claimed does no work at all', async () => {
  const db = makeFakeDb({ 'users/uid-ada': user() });
  const trigger = createOnTicketWritten({ db, getConfig: autoApproveOff, now: () => T0, log: QUIET });

  const result = await trigger({ before: { claimedByUid: null }, after: { claimedByUid: null } });

  assert.deepEqual(result.recomputed, []);
  assert.equal(db.writes.length, 0);
});
