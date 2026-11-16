// An account change in one tab starts from an empty Firestore cache
// (issue 1017).
//
// Account A, an approved attendee, reads an update for attendees on the
// dashboard. Account B, a new pending account, then signs in in the same
// tab without a navigation by the test. The page reloads, so B's reads
// start from an empty cache, and B never sees A's update. The second test
// repeats the switch while the browser cannot reach Firestore, where a
// cached row would be the only thing a listener could show.
//
// config/features is restored and the update deleted when the file is done.
/* global window */
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { adminAuth, adminDb, adminIdToken, callFunction, ensureUser, signIn } from './helpers.mjs';

const ATTENDEE_EMAIL = 'e2e-account-switch-attendee@example.test';
const PENDING_EMAIL = 'e2e-account-switch-pending@example.test';
const MARKER = '__e2eAccountSwitchMarker';
const authModule = () => `/@fs/${resolve('e2e/browser-auth.js').replaceAll('\\', '/')}`;

/** Sign `uid` in from inside the page, the way a second sign-in in the same tab does. */
async function switchInPage(page, uid) {
  const token = await adminAuth().createCustomToken(uid);
  await page.evaluate(({ moduleUrl, token }) => import(moduleUrl).then((m) => m.signInWithEmulatorToken(token)),
    { moduleUrl: authModule(), token })
    // The reload can end this page's context before the call returns.
    .catch((error) => {
      if (!/context was destroyed|navigation/i.test(String(error))) throw error;
    });
}

/** The page's marker, or 'navigating' while the reload is in progress. */
function marker(page) {
  return page.evaluate((key) => window[key] ?? null, MARKER).catch(() => 'navigating');
}

function signedInUid(page) {
  return page.evaluate((moduleUrl) => import(moduleUrl).then((m) => m.signedInUid()), authModule())
    .catch(() => 'navigating');
}

test.describe.serial('account change in one tab', () => {
  const message = `E2E attendee lounge open ${Date.now()}`;
  let seededFeatures;
  let attendeeUid;
  let pendingUid;
  let updateId;

  test.beforeAll(async () => {
    const config = adminDb().collection('config');
    seededFeatures = (await config.doc('features').get()).data() ?? null;
    await config.doc('features').set({ liveUpdates: true }, { merge: true });

    attendeeUid = await ensureUser(ATTENDEE_EMAIL);
    const attendee = adminDb().collection('users').doc(attendeeUid);
    await expect.poll(async () => (await attendee.get()).exists, { timeout: 20_000 }).toBe(true);
    await attendee.set({
      displayName: 'Account switch attendee',
      profileVisibility: 'private',
      registrationStatus: 'approved',
      approvalSource: 'admin',
    }, { merge: true });
    pendingUid = await ensureUser(PENDING_EMAIL);

    const saved = await callFunction('saveLiveUpdate',
      { update: { message, category: null, audience: 'attendees' } }, await adminIdToken());
    expect(saved.status).toBe(200);
    updateId = saved.body.id;
  });

  test.afterAll(async () => {
    if (updateId) await callFunction('deleteLiveUpdate', { id: updateId }, await adminIdToken());
    const config = adminDb().collection('config');
    if (seededFeatures === null) await config.doc('features').delete();
    else await config.doc('features').set(seededFeatures);
  });

  for (const firestoreReachable of [true, false]) {
    test(`the next account never sees the previous account's update (${firestoreReachable ? 'online' : 'Firestore offline'})`, async ({ browser }) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await signIn(page, ATTENDEE_EMAIL);
        await page.goto('/dashboard');
        await expect(page.getByRole('region', { name: 'Live updates' }).getByText(message)).toBeVisible();

        if (!firestoreReachable) await page.route(/\/\/(127\.0\.0\.1|localhost):8080\//, (route) => route.abort());
        await page.evaluate((key) => { window[key] = 'account A'; }, MARKER);
        await switchInPage(page, pendingUid);

        // A fresh document, so a fresh SDK cache and fresh provider state.
        await expect.poll(() => marker(page), { timeout: 20_000 }).toBeNull();
        await expect.poll(() => signedInUid(page), { timeout: 20_000 }).toBe(pendingUid);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(message)).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});
