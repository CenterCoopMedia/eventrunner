// Issues #543 and #207: the private reply inbox against the real Auth,
// Firestore and Functions emulators. All people and content are synthetic.
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import {
  PROJECT_ID, adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const OWNER = 'e2e-notification-owner@example.test';
const REPLIER = 'e2e-notification-replier@example.test';
const THIRD = 'e2e-notification-third@example.test';

function syntheticDb() {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.trim() || !/^demo-[a-z0-9-]+$/.test(PROJECT_ID)) {
    throw new Error('Notification seeds require FIRESTORE_EMULATOR_HOST and a demo-* project.');
  }
  return adminDb();
}

async function clear(ref) {
  const snapshot = await ref.get();
  await Promise.all(snapshot.docs.map((entry) => entry.ref.delete()));
}

async function capture(page, name, testInfo) {
  const directory = 'test-results/admin-visual-evidence';
  await mkdir(directory, { recursive: true });
  const path = `${directory}/notification-inbox-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe.serial('reply notification inbox', () => {
  const stamp = Date.now();
  const rootText = `Private fictional root ${stamp}.`;
  const replyText = `Private fictional reply ${stamp}.`;
  const pageIds = Array.from({ length: 21 }, (_, index) => `notice-${stamp}-${String(index).padStart(2, '0')}`);
  const newerIds = Array.from({ length: 25 }, (_, index) => `newer-${stamp}-${String(index).padStart(2, '0')}`);
  const lateId = `late-${stamp}`;
  const missingId = `missing-${stamp}`;
  let db;
  let savedFeatures;
  let savedBootstrap;
  let openFeatures;
  let ownerUid;
  let replierUid;
  let thirdUid;
  let ownerToken;
  let rootId;
  let replyId;
  let ownerPage;
  let replierPage;
  let thirdPage;

  const panel = (page) => page.getByRole('region', { name: 'Reply notifications' });
  const list = (page) => panel(page).getByRole('list', { name: 'Reply notifications' });
  const rowForRoot = (page, id) => list(page).getByRole('listitem').filter({
    has: page.locator(`a[href="/attendees/posts/${id}"]`),
  });

  test.beforeAll(async ({ browser }) => {
    db = syntheticDb();
    const [features, bootstrap] = await Promise.all([
      db.doc('config/features').get(), db.doc('config/bootstrap').get(),
    ]);
    savedFeatures = { exists: features.exists, data: features.data() };
    savedBootstrap = { exists: bootstrap.exists, data: bootstrap.data() };
    openFeatures = { ...(features.data() ?? {}), socialFeed: true, attendeeDirectory: true };
    await db.doc('config/features').set(openFeatures);
    await db.doc('config/bootstrap').set({
      ...(bootstrap.data() ?? {}),
      staffEmails: [...new Set([...(bootstrap.data()?.staffEmails ?? []), OWNER])],
    });
    [ownerUid, replierUid, thirdUid] = await Promise.all([OWNER, REPLIER, THIRD].map(ensureUser));
    await Promise.all([ownerUid, replierUid, thirdUid].map((uid) =>
      db.doc(`users/${uid}`).set({ registrationStatus: 'approved', speakerId: null, role: 'attendee' })));
    // Account switching must not race the separate profile-setup redirect.
    await db.doc(`users/${thirdUid}`).set({
      displayName: 'Fictional third attendee', profileVisibility: 'private',
    }, { merge: true });
    await Promise.all([ownerUid, replierUid, thirdUid].map((uid) =>
      clear(db.collection(`users/${uid}/notifications`))));
    ownerToken = await idTokenFor(ownerUid);
    const root = await callFunction('createSocialPost', {
      text: rootText, submissionKey: `inbox-root-${stamp}`,
    }, ownerToken);
    expect(root.status).toBe(201);
    rootId = root.body.postId;
    const reply = await callFunction('createSocialPost', {
      text: replyText, parentPostId: rootId, submissionKey: `inbox-reply-${stamp}`,
    }, await idTokenFor(replierUid));
    expect(reply.status).toBe(201);
    replyId = reply.body.postId;
    const contexts = await Promise.all([OWNER, REPLIER, THIRD].map(async (email) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, email);
      return page;
    }));
    [ownerPage, replierPage, thirdPage] = contexts;
  });

  test.afterAll(async () => {
    await Promise.all([ownerPage, replierPage, thirdPage].filter(Boolean).map((page) => page.context().close()));
    if (!db) return;
    syntheticDb();
    await Promise.all([ownerUid, replierUid, thirdUid].filter(Boolean).map((uid) =>
      clear(db.collection(`users/${uid}/notifications`))));
    await Promise.all([rootId, replyId].filter(Boolean).map((id) => db.doc(`social_posts/${id}`).delete()));
    await Promise.all([ownerUid, replierUid, thirdUid].filter(Boolean).map((uid) => db.doc(`users/${uid}`).delete()));
    if (savedFeatures?.exists) await db.doc('config/features').set(savedFeatures.data);
    else if (savedFeatures) await db.doc('config/features').delete();
    if (savedBootstrap?.exists) await db.doc('config/bootstrap').set(savedBootstrap.data);
    else if (savedBootstrap) await db.doc('config/bootstrap').delete();
  });

  test('only the root owner receives the reply notification', async ({ browserName }, testInfo) => {
    await Promise.all([ownerPage, replierPage, thirdPage].map((page) => page.goto('/dashboard')));
    await expect(list(ownerPage).getByRole('listitem')).toHaveCount(1);
    await expect(rowForRoot(ownerPage, rootId)).toContainText('Someone replied to your post.');
    await expect(panel(ownerPage).getByText(rootText)).toHaveCount(0);
    await expect(panel(ownerPage).getByText(replyText)).toHaveCount(0);
    for (const page of [replierPage, thirdPage]) {
      await expect(panel(page)).toContainText('No reply notifications yet.');
    }
    await db.doc('config/features').set({ ...openFeatures, socialFeed: false, attendeeDirectory: false });
    await expect(panel(ownerPage)).toHaveCount(0);
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await capture(ownerPage, `phone-baseline-flags-off-${browserName}`, testInfo);
    await ownerPage.setViewportSize({ width: 1280, height: 800 });
    await capture(ownerPage, `desktop-baseline-flags-off-${browserName}`, testInfo);
    await db.doc('config/features').set(openFeatures);
    await expect(rowForRoot(ownerPage, rootId)).toBeVisible();
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await capture(ownerPage, `phone-result-${browserName}`, testInfo);
    await ownerPage.setViewportSize({ width: 1280, height: 800 });
    await capture(ownerPage, `desktop-result-${browserName}`, testInfo);
  });

  test('keyboard read survives a retry and reload', async () => {
    const row = rowForRoot(ownerPage, rootId);
    let refused = false;
    await ownerPage.route('**/markSocialNotificationRead', (route) => {
      if (refused || route.request().method() !== 'POST') return route.continue();
      refused = true;
      return route.abort('failed');
    });
    await row.getByRole('button', { name: 'Mark as read' }).focus();
    await ownerPage.keyboard.press('Enter');
    await expect(row.getByRole('alert')).toContainText('read state was not confirmed');
    await expect(panel(ownerPage).getByRole('button', { name: 'Try loading again' })).toHaveCount(0);
    await ownerPage.unroute('**/markSocialNotificationRead');
    await row.getByRole('button', { name: 'Mark as read' }).focus();
    await ownerPage.keyboard.press('Enter');
    await expect(row).toContainText('Read');
    await expect(row.getByRole('link', { name: 'Open thread' })).toBeFocused();
    const firstRead = (await db.doc(`users/${ownerUid}/notifications/${replyId}`).get()).data().readAt.toMillis();
    expect((await callFunction('markSocialNotificationRead', { notificationId: replyId, action: 'read' }, ownerToken)).status).toBe(200);
    expect((await db.doc(`users/${ownerUid}/notifications/${replyId}`).get()).data().readAt.toMillis()).toBe(firstRead);
    await ownerPage.reload();
    await expect(rowForRoot(ownerPage, rootId)).toContainText('Read');
  });

  test('switching accounts on one page clears the owner inbox', async () => {
    await ownerPage.goto('/signin');
    await ownerPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await signIn(ownerPage, THIRD);
    await ownerPage.goto('/dashboard');
    await expect(panel(ownerPage)).toContainText('No reply notifications yet.');
    await ownerPage.goto('/signin');
    await ownerPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await signIn(ownerPage, OWNER);
    await ownerPage.goto('/dashboard');
    await expect(rowForRoot(ownerPage, rootId)).toContainText('Read');
  });

  test('either feed flag closes the inbox and drops a late read answer', async () => {
    await db.doc(`users/${ownerUid}/notifications/${lateId}`).set({
      kind: 'post_reply', rootPostId: lateId, replyPostId: lateId,
      createdAt: new Date('2027-01-01T12:00:00.000Z'), readAt: null,
    });
    for (const flag of ['socialFeed', 'attendeeDirectory']) {
      await db.doc('config/features').set({ ...openFeatures, [flag]: false });
      await expect(panel(ownerPage)).toHaveCount(0);
      await db.doc('config/features').set(openFeatures);
      await expect(rowForRoot(ownerPage, rootId)).toContainText('Read');
    }
    let held;
    await ownerPage.route('**/markSocialNotificationRead', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      held = route;
    });
    await rowForRoot(ownerPage, lateId).getByRole('button', { name: 'Mark as read' }).click();
    await expect.poll(() => Boolean(held)).toBe(true);
    await db.doc('config/features').set({ ...openFeatures, socialFeed: false });
    await expect(panel(ownerPage)).toHaveCount(0);
    await held.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ notificationId: lateId, readAt: '2027-01-01T12:01:00.000Z' }),
    });
    await ownerPage.unroute('**/markSocialNotificationRead');
    await db.doc('config/features').set(openFeatures);
    await expect(rowForRoot(ownerPage, lateId).getByRole('button', { name: 'Mark as read' })).toBeVisible();
    await db.doc(`users/${ownerUid}/notifications/${lateId}`).delete();
  });

  test('a retained staff grant cannot keep the owner inbox after the attendee grant ends', async () => {
    await db.doc(`users/${ownerUid}`).set({ registrationStatus: 'pending', speakerId: null }, { merge: true });
    await expect(panel(ownerPage)).toHaveCount(0);
    await ownerPage.goto('/attendees');
    await expect(ownerPage.getByRole('region', { name: 'Attendee feed' })).toBeVisible();
    await expect(ownerPage.getByRole('textbox', { name: 'Write a post' })).toHaveCount(0);
    await ownerPage.goto('/dashboard');
    await expect(panel(ownerPage)).toHaveCount(0);
    await db.doc(`users/${ownerUid}`).set({ registrationStatus: 'approved' }, { merge: true });
    await expect(rowForRoot(ownerPage, rootId)).toContainText('Read');
  });

  test('equal-time notifications paginate once in document-id order', async () => {
    const createdAt = new Date('2031-01-01T12:00:00.000Z');
    const batch = db.batch();
    for (const id of pageIds) batch.set(db.doc(`users/${ownerUid}/notifications/${id}`), {
      kind: 'post_reply', rootPostId: `root-${id}`, replyPostId: id, createdAt, readAt: null,
    });
    await batch.commit();
    await expect(list(ownerPage).getByRole('listitem')).toHaveCount(20);
    const expected = pageIds.slice().reverse().map((id) => `/attendees/posts/root-${id}`);
    expect(await list(ownerPage).getByRole('link', { name: 'Open thread' }).evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(expected.slice(0, 20));
    await panel(ownerPage).getByRole('button', { name: 'Show older notifications' }).click();
    await expect(list(ownerPage).getByRole('listitem')).toHaveCount(22);
    const hrefs = await list(ownerPage).getByRole('link', { name: 'Open thread' }).evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs.slice(0, 21)).toEqual(expected);
    expect(new Set(hrefs).size).toBe(22);
  });

  test('a full newer head resets pagination without losing older rows', async () => {
    const batch = db.batch();
    for (const id of newerIds) batch.set(db.doc(`users/${ownerUid}/notifications/${id}`), {
      kind: 'post_reply', rootPostId: `root-${id}`, replyPostId: id,
      createdAt: new Date('2033-01-01T12:00:00.000Z'), readAt: null,
    });
    await batch.commit();
    await expect(list(ownerPage).getByRole('listitem')).toHaveCount(20);
    await expect(panel(ownerPage).getByRole('button', { name: 'Show older notifications' })).toBeVisible();
    await panel(ownerPage).getByRole('button', { name: 'Show older notifications' }).click();
    await expect(list(ownerPage).getByRole('listitem')).toHaveCount(40);
    await panel(ownerPage).getByRole('button', { name: 'Show older notifications' }).click();
    await expect(list(ownerPage).getByRole('listitem')).toHaveCount(47);
    const hrefs = await list(ownerPage).getByRole('link', { name: 'Open thread' })
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(47);
    expect(hrefs.slice(0, 25)).toEqual(newerIds.slice().reverse().map((id) => `/attendees/posts/root-${id}`));
    expect(hrefs.slice(25, 46)).toEqual(pageIds.slice().reverse().map((id) => `/attendees/posts/root-${id}`));
    expect(hrefs[46]).toBe(`/attendees/posts/${rootId}`);
  });

  test('denied reads close until reload, and dead roots open a text-free placeholder', async () => {
    await db.doc(`users/${ownerUid}/notifications/${missingId}`).set({
      kind: 'post_reply', rootPostId: missingId, replyPostId: missingId,
      createdAt: new Date('2034-01-01T12:00:00.000Z'), readAt: null,
    });
    await expect(rowForRoot(ownerPage, missingId)).toBeVisible();
    await ownerPage.route('**/markSocialNotificationRead', (route) => route.request().method() !== 'POST' ? route.continue() : route.fulfill({
      status: 404, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: { code: 'not-found', message: 'This notification is not available.' } }),
    }));
    await rowForRoot(ownerPage, missingId).getByRole('button', { name: 'Mark as read' }).click();
    await expect(panel(ownerPage).getByRole('button', { name: 'Reload inbox' })).toBeVisible();
    await ownerPage.unroute('**/markSocialNotificationRead');
    await panel(ownerPage).getByRole('button', { name: 'Reload inbox' }).click();
    await expect(rowForRoot(ownerPage, missingId)).toBeVisible();

    expect((await callFunction('removeSocialPost', { postId: rootId }, ownerToken)).status).toBe(200);
    await panel(ownerPage).getByRole('button', { name: 'Show older notifications' }).click();
    await panel(ownerPage).getByRole('button', { name: 'Show older notifications' }).click();
    await rowForRoot(ownerPage, rootId).getByRole('link', { name: 'Open thread' }).click();
    await expect(ownerPage.getByText('Original post removed', { exact: true })).toBeVisible();
    await expect(ownerPage.getByText(rootText)).toHaveCount(0);
    await ownerPage.goto('/dashboard');
    await rowForRoot(ownerPage, missingId).getByRole('link', { name: 'Open thread' }).click();
    await expect(ownerPage.getByText('Original post removed', { exact: true })).toBeVisible();
    await expect(ownerPage.getByText(replyText)).toHaveCount(0);
  });
});
