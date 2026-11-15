// Note-write rules mirror of the server session grant (#557); synthetic data only.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const CASES = require('../functions/src/ticketing/__fixtures__/session-grant-cases.json');
const POLICY = require('../functions/src/ticketing/__fixtures__/resource-policy.json');
const { publishTicketAccessPolicy } = require('../functions/src/ticketing/resourceGrants.cjs');
const { claimTicketsForUser } = require('../functions/src/ticketing/registration.cjs');
const { recomputeEntitlement } = require('../functions/src/ticketing/entitlement.cjs');
const ENV = { EVENT_TICKETING_PROVIDER: 'manual', EVENT_TICKETING_EVENT_ID: POLICY.eventId };
const PROJECT = 'demo-ticket-session-grants';
let testEnv;
let app;
let db;

const writeNote = (uid, sessionId) => setDoc(doc(testEnv.authenticatedContext(uid,
  { email: `${uid}@example.test`, email_verified: true }).firestore(), `users/${uid}/sessionNotes/${sessionId}`),
{ text: 'Synthetic note' });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: PROJECT }, `ticket-session-grants-${process.pid}`);
  db = getFirestore(app);
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});
afterAll(async () => {
  await testEnv?.cleanup();
  if (app) await deleteApp(app);
});

// Reactions are server-only writes; the interactions cases run in resourceAccess.test.cjs.
for (const entry of CASES.filter((item) => !item.interactions)) {
  it(`note write: ${entry.name}`, async () => {
    await db.collection('users').doc('reader').set(entry.account);
    await db.collection('cmsSchedule').doc(entry.sessionId).set(entry.session);
    if (entry.control) await db.collection('ticket_access_policies').doc('current').set(entry.control);
    if (entry.grant) await db.collection('ticket_access_grants').doc('reader').set(entry.grant);
    const write = writeNote('reader', entry.sessionId);
    await (entry.expected === 'allow' ? assertSucceeds(write) : assertFails(write));
  });
}

it('a migrated limited pass gains only its day after backfill and recompute', async () => {
  await db.collection('config').doc('event').set({ days: [{ id: 'friday' }, { id: 'saturday' }] });
  await db.collection('config').doc('features').set({ autoApproveTicketHolders: true });
  await db.collection('cmsSchedule').doc('keynote').set({ dayId: 'friday', visibility: 'public' });
  await db.collection('cmsSchedule').doc('workshop').set({ dayId: 'saturday', visibility: 'public' });
  await db.collection('users').doc('holder').set({ registrationStatus: 'pending', approvalSource: null });
  // A historical import with no class ID: unknown until an approved backfill.
  await db.collection('tickets').doc('legacy').set({ externalId: 'legacy', provider: 'manual', eventId: POLICY.eventId,
    status: 'valid', claimedByUid: null, email: 'holder@example.test' });
  const claimed = await claimTicketsForUser({ db, uid: 'holder', email: 'holder@example.test',
    externalIds: ['legacy'], env: ENV });
  expect(claimed.registrationStatus).toBe('approved');
  await assertSucceeds(writeNote('holder', 'workshop'));

  await publishTicketAccessPolicy({ db, policy: structuredClone(POLICY), expectedRevision: 0, env: ENV });
  await assertFails(writeNote('holder', 'keynote'));

  await db.collection('tickets').doc('legacy').update({ ticketClassId: 'day-pass' });
  await recomputeEntitlement({ db, uid: 'holder', env: ENV });
  await assertSucceeds(writeNote('holder', 'keynote'));
  await assertFails(writeNote('holder', 'workshop'));
});

it('bootstrap staff keep note writes after publication without a covering grant', async () => {
  await db.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: ['staffer@example.test'] });
  await db.collection('users').doc('staffer').set({ registrationStatus: 'approved', approvalSource: 'ticket' });
  await db.collection('users').doc('reader').set({ registrationStatus: 'approved', approvalSource: 'ticket' });
  await db.collection('cmsSchedule').doc('workshop').set({ dayId: 'saturday' });
  await db.collection('ticket_access_policies').doc('current').set({ effectiveRevision: 1, candidateRevision: null });
  await assertSucceeds(writeNote('staffer', 'workshop'));
  await assertFails(writeNote('reader', 'workshop'));
});
