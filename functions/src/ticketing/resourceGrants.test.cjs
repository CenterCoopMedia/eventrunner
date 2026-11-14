'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { publishTicketAccessPolicy } = require('./resourceGrants.cjs');
const { recomputeEntitlement, createOnTicketWritten } = require('./entitlement.cjs');
const { applyTicketClaimToUser, claimTicketsForUser } = require('./registration.cjs');
const { upsertTickets } = require('./sync.cjs');
const { applyRevokeUser } = require('../users/approval.cjs');
const POLICY = require('./__fixtures__/resource-policy.json');
const ENV = { EVENT_TICKETING_PROVIDER: 'manual', EVENT_TICKETING_EVENT_ID: POLICY.eventId };
const T0 = new Date('2026-11-14T12:00:00Z');
const policy = (revision = 1) => ({ ...structuredClone(POLICY), revision });
const ticket = (id, classId, patch = {}) => ({ externalId: id, provider: 'manual', eventId: POLICY.eventId,
  ticketClassId: classId, email: 'holder@example.test', status: 'valid', claimedByUid: 'holder', ...patch });
const account = (patch = {}) => ({ registrationStatus: 'approved', approvalSource: 'ticket', ...patch });
function seed(extra = {}) {
  return makeFakeDb({
    'config/event': { days: [{ id: 'friday' }, { id: 'saturday' }] },
    'config/features': { autoApproveTicketHolders: true },
    'cmsSchedule/workshop': { dayId: 'saturday' },
    'ticket_access_policies/current': { effectiveRevision: 1, candidateRevision: null, cursor: null, processed: 0, remaining: 0 },
    'ticket_access_policies/revision-1': { policy: policy() },
    'users/holder': account(), ...extra,
  });
}
const recompute = (db, uid = 'holder') => recomputeEntitlement({ db, uid, env: ENV, now: () => T0 });
const grant = (db, uid = 'holder') => db.read('ticket_access_grants', uid);

test('synchronous claims and delayed ticket events derive the complete same union', async () => {
  const db = seed({ 'users/holder': account({ registrationStatus: 'pending', approvalSource: null }),
    'tickets/day': ticket('day', 'day-pass', { claimedByUid: null }),
    'tickets/workshop': ticket('workshop', 'workshop-pass', { claimedByUid: null }) });
  const result = await claimTicketsForUser({ db, uid: 'holder', email: 'holder@example.test',
    externalIds: ['day', 'workshop'], env: ENV, now: () => T0 });
  assert.deepEqual(result.claimed, ['day', 'workshop']);
  assert.deepEqual(grant(db).resources.sessions, { all: false, dayIds: ['friday'], sessionIds: ['workshop'] });
  assert.deepEqual(grant(db).classIds, ['day', 'workshop']);
  const writes = db.writes.length;
  await createOnTicketWritten({ db, env: ENV })({ before: null, after: { claimedByUid: 'holder', status: 'valid' } });
  assert.equal(db.writes.length, writes, 'replay does not rewrite either grant or account');
  assert.ok(db.writes.every((write) => !/^(users_public|schedule_shares|cms)/.test(write.path)));
  assert.doesNotMatch(JSON.stringify(grant(db)), /holder@example|claimedByUid|orderId|payment/);
});

test('refund, pending information, class change and reassignment remove only the affected contribution', async () => {
  const db = seed({ 'tickets/day': ticket('day', 'day-pass'), 'tickets/workshop': ticket('workshop', 'workshop-pass'),
    'users/other': account({ registrationStatus: 'pending', approvalSource: null }) });
  await recompute(db);
  const trigger = createOnTicketWritten({ db, env: ENV });
  await db.collection('tickets').doc('workshop').set({ status: 'pending_info' }, { merge: true });
  await trigger({ before: ticket('workshop', 'workshop-pass'), after: { claimedByUid: 'holder' } });
  assert.deepEqual(grant(db).classIds, ['day']);
  await db.collection('tickets').doc('workshop').set({ status: 'valid', claimedByUid: 'other' }, { merge: true });
  await trigger({ before: { claimedByUid: 'holder' }, after: { claimedByUid: 'other' } });
  assert.deepEqual(grant(db).classIds, ['day']);
  assert.deepEqual(grant(db, 'other').classIds, ['workshop']);
  await upsertTickets({ db, providerName: 'manual', eventId: POLICY.eventId,
    tickets: [ticket('day', 'workshop-pass', { claimedByUid: null, ticketClass: 'Renamed display label' })] });
  assert.equal(db.read('tickets', 'day').claimedByUid, 'holder');
  await recompute(db);
  assert.deepEqual(grant(db).classIds, ['workshop']);
  await db.collection('tickets').doc('day').set({ status: 'refunded' }, { merge: true });
  await trigger({ before: { claimedByUid: 'holder', status: 'valid' }, after: { claimedByUid: 'holder', status: 'valid' } });
  assert.deepEqual(grant(db).classIds, [], 'stale valid event cannot restore a current refund');
  assert.equal(db.read('users', 'holder').registrationStatus, 'revoked');
});

test('pending-only status is held while its former granular rights settle to empty', async () => {
  const db = seed({ 'tickets/day': ticket('day', 'day-pass') });
  await recompute(db);
  await db.collection('tickets').doc('day').set({ status: 'pending_info' }, { merge: true });
  await recompute(db);
  assert.equal(db.read('users', 'holder').registrationStatus, 'approved');
  assert.deepEqual(grant(db).classIds, []);
  assert.equal((await recompute(db)).action, 'held');
});

test('claim/refund, new matching tickets, class changes and admin revocation retry the same transaction', async () => {
  for (const [change, expected] of [
    [async (db) => db.collection('tickets').doc('day').set({ status: 'refunded' }, { merge: true }), []],
    [async (db) => db.collection('tickets').doc('day').set({ ticketClassId: 'workshop-pass' }, { merge: true }), ['workshop']],
    [async (db) => db.collection('tickets').doc('added').set(ticket('added', 'workshop-pass')), ['day', 'workshop']],
    [async (db) => applyRevokeUser({ db, uid: 'holder' }), []],
  ]) {
    const db = seed({ 'tickets/day': ticket('day', 'day-pass') });
    db.beforeCommit = () => change(db);
    await applyTicketClaimToUser({ db, uid: 'holder', env: ENV });
    assert.deepEqual(grant(db).classIds, expected);
  }
});

test('explicit approval survives refunds; explicit revocation clears the cache and remains authoritative', async () => {
  const db = seed({ 'users/holder': account({ approvalSource: 'admin' }), 'tickets/day': ticket('day', 'day-pass') });
  await recompute(db);
  await db.collection('tickets').doc('day').set({ status: 'refunded' }, { merge: true });
  await recompute(db);
  assert.equal(db.read('users', 'holder').approvalSource, 'admin');
  assert.deepEqual(grant(db).classIds, []);
  await db.collection('tickets').doc('day').set({ status: 'valid' }, { merge: true });
  await recompute(db);
  await applyRevokeUser({ db, uid: 'holder' });
  assert.equal(grant(db), undefined);
  await recompute(db);
  assert.deepEqual(grant(db).classIds, []);
  assert.equal(db.read('users', 'holder').revocationReason, 'admin_revocation');
});

test('publication resumes after a failed page, reports counts and publishes only after every page', async () => {
  const db = seed();
  await db.collection('ticket_access_policies').doc('current').delete();
  await db.collection('ticket_access_policies').doc('revision-1').delete();
  for (let i = 0; i < 205; i++) await db.collection('users').doc(`person-${String(i).padStart(3, '0')}`).set(account());
  const transact = db.runTransaction.bind(db);
  db.runTransaction = (fn) => transact((tx) => {
    const get = tx.get.bind(tx);
    tx.get = (ref) => {
      if (ref.path === 'users/person-100') throw new Error('temporary publication failure');
      return get(ref);
    };
    return fn(tx);
  });
  await assert.rejects(publishTicketAccessPolicy({ db, policy: policy(), expectedRevision: 0, env: ENV }), (error) => {
    assert.deepEqual(error.progress, { revision: 1, processed: 100, remaining: 106, complete: false });
    return /temporary publication failure/.test(error.message);
  });
  assert.equal(db.read('ticket_access_policies', 'current').effectiveRevision, 0);
  assert.equal(grant(db).policyRevision, 1, 'candidate grants do not publish the effective pointer');
  db.runTransaction = transact;
  await db.collection('config').doc('event').set({ days: [{ id: 'friday' }, { id: 'friday' }] });
  await assert.rejects(publishTicketAccessPolicy({ db, policy: policy(), expectedRevision: 0, env: ENV }), (error) => {
    assert.equal(error.progress.complete, false);
    assert.equal(error.progress.processed, 100);
    return /grant could not be derived/.test(error.message);
  });
  await db.collection('cmsSchedule').doc('workshop').delete();
  await db.collection('config').doc('event').set({ days: [{ id: 'saturday' }] });
  await db.collection('users').doc('a-new').set(account({ registrationStatus: 'pending', approvalSource: null }));
  await db.collection('tickets').doc('new-claim').set(ticket('new-claim', 'day-pass', { claimedByUid: null }));
  await claimTicketsForUser({ db, uid: 'a-new', email: 'holder@example.test', externalIds: ['new-claim'], env: ENV });
  assert.deepEqual(grant(db, 'a-new').classIds, ['day'], 'new accounts behind the cursor derive the candidate at claim time');
  assert.deepEqual(grant(db, 'a-new').resources.sessions.dayIds, [], 'deleted canonical days have no membership');
  const complete = await publishTicketAccessPolicy({ db, policy: policy(), expectedRevision: 0, env: ENV });
  assert.deepEqual(complete, { revision: 1, processed: 206, remaining: 0, complete: true });
  const writes = db.writes.length;
  assert.deepEqual(await publishTicketAccessPolicy({ db, policy: policy(), expectedRevision: 0, env: ENV }), complete);
  assert.equal(db.writes.length, writes);
  const changed = policy(); changed.classes[0].resources.directory = false;
  await assert.rejects(publishTicketAccessPolicy({ db, policy: changed, expectedRevision: 1, env: ENV }), /immutable/);
});

test('invalid granular data clears its cache while legacy binary reconciliation continues', async () => {
  for (const mutate of [
    async (db) => db.collection('ticket_access_policies').doc('revision-1').set({ policy: { ...policy(), eventId: 'foreign' } }),
    async (db) => db.collection('ticket_access_policies').doc('current').set({ effectiveRevision: 1 }),
    async (db) => db.collection('ticket_access_policies').doc('revision-1').delete(),
  ]) {
    const db = seed({ 'tickets/day': ticket('day', 'day-pass', { status: 'refunded' }),
      'ticket_access_grants/holder': { policyRevision: 1, resources: { directory: true } } });
    await mutate(db);
    const result = await recompute(db);
    assert.equal(result.grantStatus, 'invalid');
    assert.equal(grant(db), undefined);
    assert.equal(db.read('users', 'holder').registrationStatus, 'revoked');
  }
});

test('CMS deletion removes membership without blocking claims, refunds or publication replay', async () => {
  const db = seed({ 'tickets/day': ticket('day', 'day-pass'), 'tickets/workshop': ticket('workshop', 'workshop-pass') });
  await recompute(db);
  await db.collection('cmsSchedule').doc('workshop').delete();
  await db.collection('config').doc('event').set({ days: [{ id: 'saturday' }] });
  await applyTicketClaimToUser({ db, uid: 'holder', env: ENV });
  assert.deepEqual(grant(db).resources.sessions, { all: false, dayIds: [], sessionIds: [] });
  for (const id of ['day', 'workshop']) await db.collection('tickets').doc(id).set({ status: 'refunded' }, { merge: true });
  await recompute(db);
  assert.equal(db.read('users', 'holder').registrationStatus, 'revoked');
  assert.deepEqual(grant(db).classIds, []);
  await publishTicketAccessPolicy({ db, policy: policy(), expectedRevision: 1, env: ENV });
});

test('Firestore map key order cannot change immutable policy identity or rewrite an equal grant', async () => {
  const reorder = (value) => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const db = seed({ 'tickets/day': ticket('day', 'day-pass') });
  await recompute(db);
  await db.collection('ticket_access_grants').doc('holder').set(reorder(grant(db)));
  await db.collection('ticket_access_policies').doc('revision-1').set({ policy: reorder(policy()) });
  const writes = db.writes.length;
  await recompute(db);
  await publishTicketAccessPolicy({ db, policy: policy(), expectedRevision: 1, env: ENV });
  assert.equal(db.writes.length, writes);
});

test('a deliberate new revision recomputes current claims without modifying purchased records', async () => {
  const db = seed({ 'tickets/day': ticket('day', 'day-pass'),
    'ticket_orders/purchase': { totalAmount: 2500, lines: [{ name: 'Original name', unitAmount: 2500 }] } });
  const purchase = db.read('ticket_orders', 'purchase');
  const next = policy(2); next.classes[0].resources.sessions.dayIds = ['saturday'];
  const result = await publishTicketAccessPolicy({ db, policy: next, expectedRevision: 1, env: ENV });
  assert.equal(result.complete, true);
  assert.equal(grant(db).policyRevision, 2);
  assert.deepEqual(grant(db).resources.sessions.dayIds, ['saturday']);
  assert.deepEqual(db.read('ticket_orders', 'purchase'), purchase);
  await assert.rejects(publishTicketAccessPolicy({ db, policy: policy(3), expectedRevision: 1, env: ENV }), /revision changed/);
});

test('real free and comp persistence contributes only the selected Stripe classes without staff auto-approval', async () => {
  const { setup, checkout, PERSON, ADA } = require('./commerceTestKit.cjs');
  const { createCompOrder } = require('./stripeCheckout.cjs');
  const { db, deps } = setup({ catalogPatch: { ticketTypes: [
    { id: 'general', name: 'Free pass', unitAmount: 0, capacity: 100 },
    { id: 'student', name: 'Workshop pass', unitAmount: 1000, capacity: 100 },
  ] } });
  const free = await checkout(deps);
  const comp = await createCompOrder({ ...deps, actorUid: 'organizer', ticketTypeId: 'student', attendees: [PERSON],
    requestId: 'resource-comp-request-001', reason: 'Synthetic comp' });
  assert.equal(free.statusCode, 200);
  const stripePolicy = { ...policy(), provider: 'stripe', eventId: deps.provider.externalEventId };
  const env = { EVENT_TICKETING_PROVIDER: 'stripe', EVENT_TICKETING_EVENT_ID: stripePolicy.eventId };
  await db.collection('config').doc('event').set({ days: [{ id: 'friday' }] }, { merge: true });
  await db.collection('cmsSchedule').doc('workshop').set({ dayId: 'friday' });
  await publishTicketAccessPolicy({ db, policy: stripePolicy, expectedRevision: 0, env });
  await claimTicketsForUser({ db, uid: ADA.uid, email: ADA.email, env,
    externalIds: [...free.body.ticketIds, ...comp.ticketIds] });
  assert.deepEqual(grant(db, ADA.uid).classIds, ['day', 'workshop']);
  assert.equal(grant(db, ADA.uid).resources.sessions.all, false);
  assert.equal(db.read('users', ADA.uid).registrationStatus, 'ticketed');
  assert.equal(db.read('users', ADA.uid).approvalSource, null);
});
