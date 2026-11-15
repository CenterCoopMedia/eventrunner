// Directory and attendee-update rules mirror of the server resource grant (#1004, #1005); synthetic data only.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const CASES = require('../functions/src/ticketing/__fixtures__/resource-grant-cases.json');
const PROJECT = 'demo-ticket-directory-update-grants';
let testEnv;
let app;
let db;

const reader = (uid = 'reader') => testEnv.authenticatedContext(uid,
  { email: `${uid}@example.test`, email_verified: true }).firestore();
const directoryQuery = (store) => query(collection(store, 'users_public'),
  where('profileVisibility', 'in', ['public', 'attendees_only']));
const updatesQuery = (store, audiences) => query(collection(store, 'live_updates'),
  where('audience', 'in', audiences), orderBy('postedAt', 'desc'));

// Every provisioned deployment has config/bootstrap (scripts/init-event.cjs).
async function seed({ account, control = null, grant = null, uid = 'reader' }) {
  await db.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: [] }, { merge: true });
  await db.collection('users').doc(uid).set(account);
  if (control) await db.collection('ticket_access_policies').doc('current').set(control);
  if (grant) await db.collection('ticket_access_grants').doc(uid).set(grant);
  await db.collection('users_public').doc('listed').set({ profileVisibility: 'attendees_only', displayName: 'Listed' });
  await db.collection('users_public').doc('open').set({ profileVisibility: 'public', displayName: 'Open' });
  await db.collection('schedule_shares').doc('listed').set({ scheduleVisibility: 'attendees_only', sessionIds: [] });
  await db.collection('schedule_shares').doc('open').set({ scheduleVisibility: 'public', sessionIds: [] });
  await db.collection('live_updates').doc('for-attendees').set({ audience: 'attendees', postedAt: new Date(2000) });
  await db.collection('live_updates').doc('for-everyone').set({ audience: 'everyone', postedAt: new Date(1000) });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: PROJECT }, `ticket-directory-update-grants-${process.pid}`);
  db = getFirestore(app);
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});
afterAll(async () => {
  await testEnv?.cleanup();
  if (app) await deleteApp(app);
});

for (const entry of CASES.filter((item) => item.resource === 'directory')) {
  it(`directory: ${entry.name}`, async () => {
    await seed(entry);
    const store = reader();
    const check = entry.expected === 'allow' ? assertSucceeds : assertFails;
    await check(getDoc(doc(store, 'users_public/listed')));
    await check(getDoc(doc(store, 'schedule_shares/listed')));
    await check(getDocs(directoryQuery(store)));
    // Public profiles and schedules never depend on the grant.
    await assertSucceeds(getDoc(doc(store, 'users_public/open')));
    await assertSucceeds(getDoc(doc(store, 'schedule_shares/open')));
  });
}

for (const entry of CASES.filter((item) => item.resource === 'attendeeUpdates')) {
  it(`attendee updates: ${entry.name}`, async () => {
    await seed(entry);
    const store = reader();
    const check = entry.expected === 'allow' ? assertSucceeds : assertFails;
    await check(getDoc(doc(store, 'live_updates/for-attendees')));
    await check(getDocs(updatesQuery(store, ['everyone', 'attendees'])));
    // The browser's narrower query stays provable for every reader.
    await assertSucceeds(getDocs(updatesQuery(store, ['everyone'])));
  });
}

it('bootstrap staff keep the directory and attendee updates without a grant', async () => {
  await seed({ uid: 'staffer', account: { registrationStatus: 'approved', approvalSource: 'ticket', speakerId: null },
    control: { effectiveRevision: 1, candidateRevision: null } });
  await db.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: ['staffer@example.test'] });
  const store = reader('staffer');
  await assertSucceeds(getDocs(directoryQuery(store)));
  await assertSucceeds(getDoc(doc(store, 'schedule_shares/listed')));
  await assertSucceeds(getDocs(updatesQuery(store, ['everyone', 'attendees'])));
});

it('a pending account stays outside the directory and attendee updates in legacy mode', async () => {
  await seed({ account: { registrationStatus: 'pending', approvalSource: null, speakerId: null } });
  const store = reader();
  await assertFails(getDoc(doc(store, 'users_public/listed')));
  await assertFails(getDoc(doc(store, 'schedule_shares/listed')));
  await assertFails(getDocs(updatesQuery(store, ['everyone', 'attendees'])));
  await assertSucceeds(getDocs(updatesQuery(store, ['everyone'])));
});
