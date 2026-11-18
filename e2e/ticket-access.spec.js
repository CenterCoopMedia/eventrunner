import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { deriveTicketResourceGrant } from 'shared/ticketAccess';
import { ADMIN_EMAIL, adminAuth, adminDb, ensureUser } from './helpers.mjs';

const KEYNOTE = { id: 'ticket-access-keynote', title: 'Ticket access keynote', dayId: 'day-1' };
const WORKSHOP = { id: 'ticket-access-workshop', title: 'Ticket access workshop', dayId: 'day-2' };
const PROFILE = { id: 'ticket-access-directory', displayName: 'Ticket access directory attendee' };
const POLICY_PATH = 'ticket_access_policies/current';
const UPDATING = 'Access updating. Try again in a few minutes.';
const EXCLUDED = 'Your ticket does not include this session.';
const authModule = `/@fs/${resolve('e2e/browser-auth.js').replaceAll('\\', '/')}`;
const scope = { provider: 'stripe', eventId: 'ticket-access-e2e', dayIds: [KEYNOTE.dayId, WORKSHOP.dayId],
  sessionIds: [KEYNOTE.id, WORKSHOP.id] };

const resources = (sessions, directory = false) => ({
  sessions: { all: false, dayIds: [], sessionIds: [], ...sessions },
  directory, interactions: true, attendeeUpdates: directory, protectedMaterials: 'existing-embargo',
});
const classes = [
  { id: 'full', resources: resources({ all: true }, true) },
  { id: 'day-pass', resources: resources({ dayIds: [KEYNOTE.dayId] }) },
  { id: 'workshop-pass', resources: resources({ sessionIds: [WORKSHOP.id] }) },
];
const mappings = [
  ['full', 'full'], ['limited', 'day-pass'], ['workshop', 'workshop-pass'],
  ['free', 'day-pass'], ['comp', 'workshop-pass'],
].map(([sourceClassId, classId]) => ({ sourceClassId, classId }));

const cases = [
  { name: 'full', types: ['full'], coverage: [true, true] },
  { name: 'limited', types: ['limited'], coverage: [true, false] },
  { name: 'free', types: ['free'], status: 'ticketed' },
  { name: 'comp', types: ['comp'], status: 'ticketed' },
  { name: 'pending', types: ['full'], status: 'pending', ticketStatus: 'pending_info' },
  { name: 'unknown', types: ['unmapped'], coverage: [false, false] },
  { name: 'refunded', types: ['full'], status: 'revoked', ticketStatus: 'refunded' },
  { name: 'combined', types: ['limited', 'workshop'], coverage: [true, true] },
  { name: 'speaker', status: 'pending', speakerId: 'ticket-access-speaker', coverage: [true, true] },
  { name: 'admin', admin: true, coverage: [true, true] },
];

async function usePolicy(effectiveRevision, candidateRevision = null) {
  await adminDb().doc(POLICY_PATH).set({ effectiveRevision, candidateRevision });
}

async function setGrant(uid, types, registrationStatus = 'approved', ticketStatus = 'valid', revision = 1) {
  const grant = deriveTicketResourceGrant({
    policy: { schemaVersion: 1, lifetime: 'current-policy', provider: scope.provider, eventId: scope.eventId,
      revision, classes, mappings },
    context: scope,
    tickets: types.map((ticketTypeId) => ({ provider: scope.provider, eventId: scope.eventId,
      ticketTypeId, claimedByUid: uid, status: ticketStatus })),
    uid, registration: { registrationStatus },
  });
  expect(grant).not.toBeNull();
  await adminDb().doc(`ticket_access_grants/${uid}`).set(grant);
}

async function seedAccount({ name, types, status = 'approved', ticketStatus, speakerId, admin }) {
  const uid = await ensureUser(admin ? ADMIN_EMAIL : `ticket-access-${name}-${Date.now()}@example.test`);
  fixtureAccounts.set(uid, Boolean(admin));
  if (admin) return uid;
  const account = adminDb().doc(`users/${uid}`);
  await expect.poll(async () => (await account.get()).exists).toBe(true);
  await account.set({ displayName: `Ticket access ${name}`, profileVisibility: 'private',
    registrationStatus: status, approvalSource: status === 'approved' ? 'ticket' : null,
    speakerId: speakerId ?? null, revocationReason: status === 'revoked' ? 'entitlement_lost' : null }, { merge: true });
  if (types) await setGrant(uid, types, status, ticketStatus);
  return uid;
}

async function signInOnPage(page, uid) {
  const token = await adminAuth().createCustomToken(uid);
  await page.evaluate(({ moduleUrl, token }) => import(moduleUrl).then((m) => m.signInWithEmulatorToken(token)),
    { moduleUrl: authModule, token }).catch((error) => {
    if (!/context was destroyed|navigation/i.test(String(error))) throw error;
  });
}

async function openSession(page, session) {
  await page.goto(`/schedule/${session.id}`);
  await expect(page.getByRole('heading', { name: session.title })).toBeVisible();
}

const bookmark = (page) => page.getByRole('button', { name: /^Bookmark$/ });
const reaction = (page) => page.getByRole('button', { name: /^React with 👍/ });
const denial = (page, text) => page.getByRole('status').filter({ hasText: text });

let originalFeatures;
let originalPolicy;
const fixtureAccounts = new Map();
test.beforeAll(async () => {
  const db = adminDb();
  originalFeatures = (await db.doc('config/features').get()).data();
  originalPolicy = (await db.doc(POLICY_PATH).get()).data();
  const batch = db.batch();
  batch.set(db.doc('config/features'), { attendeeDirectory: true }, { merge: true });
  for (const session of [KEYNOTE, WORKSHOP]) {
    batch.set(db.doc(`cmsSchedule/${session.id}`), { ...session, visible: true, type: 'panel',
      startTime: '10:00', endTime: '11:00', speakerIds: [], order: 900 });
  }
  batch.set(db.doc(`users_public/${PROFILE.id}`), { uid: PROFILE.id, displayName: PROFILE.displayName,
    profileVisibility: 'attendees_only', badges: [] });
  await batch.commit();
});

test.beforeEach(async () => usePolicy(1));

test.afterEach(async () => {
  const db = adminDb();
  const batch = db.batch();
  for (const [uid, admin] of fixtureAccounts) {
    for (const { id } of [KEYNOTE, WORKSHOP]) {
      batch.delete(db.doc(`users/${uid}/bookmarks/${id}`));
      batch.delete(db.doc(`users/${uid}/sessionNotes/${id}`));
      batch.delete(db.doc(`sessionReactions/${id}/users/${uid}`));
    }
    if (!admin) {
      batch.delete(db.doc(`ticket_access_grants/${uid}`));
      batch.delete(db.doc(`users/${uid}`));
    }
  }
  for (const { id } of [KEYNOTE, WORKSHOP]) {
    batch.delete(db.doc(`sessionBookmarks/${id}`));
    batch.delete(db.doc(`sessionReactions/${id}`));
  }
  await batch.commit();
  await Promise.all([...fixtureAccounts].filter(([, admin]) => !admin)
    .map(([uid]) => adminAuth().deleteUser(uid)));
  fixtureAccounts.clear();
});

test.afterAll(async () => {
  const db = adminDb();
  const batch = db.batch();
  for (const id of [KEYNOTE.id, WORKSHOP.id]) {
    batch.delete(db.doc(`cmsSchedule/${id}`));
    batch.delete(db.doc(`sessionBookmarks/${id}`));
    batch.delete(db.doc(`sessionReactions/${id}`));
  }
  batch.delete(db.doc(`users_public/${PROFILE.id}`));
  if (originalFeatures) batch.set(db.doc('config/features'), originalFeatures);
  if (originalPolicy) batch.set(db.doc(POLICY_PATH), originalPolicy);
  else batch.delete(db.doc(POLICY_PATH));
  await batch.commit();
});

for (const [device, viewport] of Object.entries({ phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } })) {
  test.describe(device, () => {
    test.use({ viewport, isMobile: device === 'phone', hasTouch: device === 'phone' });

    for (const account of cases) {
      test(`${account.name} gets the proper bookmark and reaction controls`, async ({ page }) => {
        const uid = await seedAccount(account);
        await openSession(page, KEYNOTE);
        await signInOnPage(page, uid);

        if (!account.coverage) {
          await page.goto('/schedule/mine');
          await expect(page.getByText(/This account does not have attendee access/)).toBeVisible();
          await openSession(page, KEYNOTE);
          await expect(reaction(page)).toHaveCount(0);
          await bookmark(page).click();
          await expect(page.getByRole('button', { name: 'Bookmarked', exact: true })).toBeVisible();
          expect((await adminDb().doc(`users/${uid}/bookmarks/${KEYNOTE.id}`).get()).exists).toBe(false);
          return;
        }

        for (const [index, session] of [KEYNOTE, WORKSHOP].entries()) {
          if (index > 0) await openSession(page, session);
          await expect(reaction(page)).toBeVisible();
          await bookmark(page).click();
          if (account.coverage[index]) {
            await expect(page.getByRole('button', { name: 'Bookmarked', exact: true })).not.toHaveAttribute('aria-busy', 'true');
          } else {
            await expect(denial(page, EXCLUDED)).toHaveCount(1);
            await expect(bookmark(page)).toHaveAttribute('aria-pressed', 'false');
          }
          await reaction(page).click();
          if (account.coverage[index]) {
            await expect(reaction(page)).toHaveAttribute('aria-pressed', 'true');
            await expect(reaction(page)).toBeEnabled();
            expect((await adminDb().doc(`users/${uid}/bookmarks/${session.id}`).get()).exists).toBe(true);
            expect((await adminDb().doc(`sessionReactions/${session.id}/users/${uid}`).get()).data()?.emoji).toBe('👍');
          } else {
            await expect(denial(page, EXCLUDED)).toHaveCount(2);
            await expect(reaction(page)).toHaveAttribute('aria-pressed', 'false');
          }
        }
      });
    }

    test('a revision sweep updates the refusal and clears it without replaying a write', async ({ page }) => {
      await page.clock.install();
      const uid = await seedAccount({ name: 'sweep', types: ['limited'] });
      await openSession(page, WORKSHOP);
      await signInOnPage(page, uid);
      await expect(reaction(page)).toBeVisible();
      await bookmark(page).click();
      await expect(denial(page, EXCLUDED)).toHaveCount(1);

      await usePolicy(1, 2);
      await page.clock.fastForward(15_000);
      await expect(denial(page, UPDATING)).toHaveCount(1);
      await reaction(page).click();
      await expect(denial(page, UPDATING)).toHaveCount(2);

      await setGrant(uid, ['full'], 'approved', 'valid', 2);
      await usePolicy(2);
      await page.clock.fastForward(15_000);
      await expect(denial(page, UPDATING)).toHaveCount(0);
      await expect(bookmark(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(reaction(page)).toHaveAttribute('aria-pressed', 'false');
      expect((await adminDb().doc(`users/${uid}/bookmarks/${WORKSHOP.id}`).get()).exists).toBe(false);
      expect((await adminDb().doc(`sessionReactions/${WORKSHOP.id}/users/${uid}`).get()).exists).toBe(false);
    });

    test('a note denied during a sweep survives navigation and saves only on request', async ({ page }) => {
      const uid = await seedAccount({ name: 'note', types: ['full'] });
      const db = adminDb();
      const noteRef = db.doc(`users/${uid}/sessionNotes/${KEYNOTE.id}`);
      await db.doc(`users/${uid}/bookmarks/${KEYNOTE.id}`).set({ bookmarkedAt: new Date() });
      await usePolicy(1, 2);
      await openSession(page, KEYNOTE);
      await signInOnPage(page, uid);
      await page.goto('/schedule/mine');
      const note = page.getByLabel('Private note');
      const text = 'Keep this until the new grant is ready.';
      await note.fill(text);
      await expect(page.getByRole('alert').filter({ hasText: /Access updating, or your ticket/ })).toBeVisible();
      await openSession(page, WORKSHOP);

      await setGrant(uid, ['full'], 'approved', 'valid', 2);
      await usePolicy(2);
      await page.goto('/schedule/mine');
      await expect(note).toHaveValue(text);
      await expect(page.getByText(/Unsaved text from your last visit/)).toBeVisible();
      expect((await noteRef.get()).exists).toBe(false);
      await page.getByRole('button', { name: 'Save now' }).click();
      await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
      expect((await noteRef.get()).data()?.text).toBe(text);
    });

    test('an open attendee profile loses grant-only access and recovers after repair', async ({ page }) => {
      await page.clock.install();
      const uid = await seedAccount({ name: 'directory', types: ['full'] });
      await page.goto(`/attendees/${PROFILE.id}`);
      await signInOnPage(page, uid);
      const name = page.getByRole('heading', { name: PROFILE.displayName });
      const unavailable = page.getByRole('heading', { name: 'This profile isn’t available' });
      await expect(name).toBeVisible();
      await setGrant(uid, ['limited']);
      await page.clock.fastForward(15_000);
      await expect(unavailable).toBeVisible();
      await expect(name).toHaveCount(0);
      await setGrant(uid, ['full']);
      await page.clock.fastForward(15_000);
      await expect(name).toBeVisible();

      const next = await seedAccount({ name: 'switch', status: 'pending' });
      await signInOnPage(page, next);
      await expect(unavailable).toBeVisible();
      await expect(name).toHaveCount(0);
      await page.goto('/signin');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByRole('button', { name: /email me a code/i })).toBeVisible();
      await page.goto(`/attendees/${PROFILE.id}`);
      await expect(unavailable).toBeVisible();
    });
  });
}
