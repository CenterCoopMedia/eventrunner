// Real Firestore transactions and client rules; no provider, payment or live project.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { publishTicketAccessPolicy } = require('../functions/src/ticketing/resourceGrants.cjs');
const { claimTicketsForUser } = require('../functions/src/ticketing/registration.cjs');
const { createOnTicketWritten, recomputeEntitlement } = require('../functions/src/ticketing/entitlement.cjs');
const { applyRevokeUser } = require('../functions/src/users/approval.cjs');
const POLICY = require('../functions/src/ticketing/__fixtures__/resource-policy.json');
const ENV = { EVENT_TICKETING_PROVIDER: 'manual', EVENT_TICKETING_EVENT_ID: POLICY.eventId };
const PROJECT = 'demo-ticket-resource-grants';
let testEnv;
let app;
let db;
const privateGrant = async () => (await db.collection('ticket_access_grants').doc('holder').get()).data();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: PROJECT }, `ticket-resource-grants-${process.pid}`);
  db = getFirestore(app);
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await db.collection('config').doc('event').set({ days: [{ id: 'friday' }, { id: 'saturday' }] });
  await db.collection('config').doc('features').set({ autoApproveTicketHolders: true });
  await db.collection('cmsSchedule').doc('workshop').set({ dayId: 'saturday', visibility: 'public' });
  await db.collection('users').doc('holder').set({ registrationStatus: 'pending', approvalSource: null });
  for (const [id, ticketClassId] of [['day', 'day-pass'], ['workshop', 'workshop-pass']]) {
    await db.collection('tickets').doc(id).set({ externalId: id, ticketClassId, provider: 'manual', eventId: POLICY.eventId,
      status: 'valid', claimedByUid: null, email: 'holder@example.test' });
  }
  await publishTicketAccessPolicy({ db, policy: structuredClone(POLICY), expectedRevision: 0, env: ENV });
});
afterAll(async () => {
  await testEnv?.cleanup();
  if (app) await deleteApp(app);
});

it('claims, refunds and replay converge privately; explicit revocation retains self history and note deletion', async () => {
  const claimed = await claimTicketsForUser({ db, uid: 'holder', email: 'holder@example.test',
    externalIds: ['day', 'workshop'], env: ENV });
  expect(claimed.registrationStatus).toBe('approved');
  expect((await privateGrant()).classIds).toEqual(['day', 'workshop']);
  await db.collection('tickets').doc('workshop').update({ status: 'refunded' });
  const trigger = createOnTicketWritten({ db, env: ENV });
  const stale = { before: null, after: { claimedByUid: 'holder', status: 'valid' } };
  await trigger(stale);
  const remaining = await privateGrant();
  expect(remaining.classIds).toEqual(['day']);
  await trigger(stale);
  expect(await privateGrant()).toEqual(remaining);
  await db.collection('users/holder/bookmarks').doc('workshop').set({ bookmarkedAt: new Date() });
  await db.collection('users/holder/sessionNotes').doc('workshop').set({ text: 'Private synthetic note' });
  await db.collection('sessionReactions/workshop/users').doc('holder').set({ emoji: 'heart' });
  await applyRevokeUser({ db, uid: 'holder' });
  expect(await privateGrant()).toBeUndefined();
  await trigger(stale);
  expect((await privateGrant()).classIds).toEqual([]);
  expect((await db.collection('users').doc('holder').get()).data().revocationReason).toBe('admin_revocation');
  const self = testEnv.authenticatedContext('holder', { email: 'holder@example.test', email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(self, 'users/holder/bookmarks/workshop')));
  await assertSucceeds(getDoc(doc(self, 'sessionReactions/workshop/users/holder')));
  await assertSucceeds(getDoc(doc(self, 'users/holder/sessionNotes/workshop')));
  await assertSucceeds(deleteDoc(doc(self, 'users/holder/sessionNotes/workshop')));
  await assertFails(setDoc(doc(self, 'users/holder/sessionNotes/workshop'), { text: 'New protected write' }));
  await assertFails(getDoc(doc(self, 'ticket_access_grants/holder')));
  await assertFails(setDoc(doc(self, 'ticket_access_policies/current'), { effectiveRevision: 99 }));
});

it('real concurrent claim/refund and a later deliberate policy revision settle from current records', async () => {
  await Promise.all([
    claimTicketsForUser({ db, uid: 'holder', email: 'holder@example.test', externalIds: ['day', 'workshop'], env: ENV }),
    db.collection('tickets').doc('workshop').update({ status: 'cancelled' }),
  ]);
  await recomputeEntitlement({ db, uid: 'holder', env: ENV });
  expect((await privateGrant()).classIds).toEqual(['day']);
  const revised = structuredClone(POLICY);
  revised.revision = 2;
  revised.classes[0].resources.sessions.dayIds = ['saturday'];
  const result = await publishTicketAccessPolicy({ db, policy: revised, expectedRevision: 1, env: ENV });
  expect(result).toEqual({ revision: 2, processed: 1, remaining: 0, complete: true });
  expect((await privateGrant()).policyRevision).toBe(2);
  expect((await privateGrant()).resources.sessions.dayIds).toEqual(['saturday']);
  expect((await db.collection('ticket_access_policies').doc('current').get()).data().effectiveRevision).toBe(2);
  await db.collection('cmsSchedule').doc('workshop').delete();
  await db.collection('config').doc('event').set({ days: [] });
  await db.collection('tickets').doc('day').update({ status: 'refunded' });
  await recomputeEntitlement({ db, uid: 'holder', env: ENV });
  expect((await db.collection('users').doc('holder').get()).data().registrationStatus).toBe('revoked');
  expect((await privateGrant()).classIds).toEqual([]);
  expect((await publishTicketAccessPolicy({ db, policy: revised, expectedRevision: 2, env: ENV })).complete).toBe(true);
});
