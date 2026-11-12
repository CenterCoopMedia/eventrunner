import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { adminDb, adminAuth, ensureUser, signIn } from './helpers.mjs';

async function seed({ status = 'approved', visibility = 'private' } = {}) {
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
  const db = adminDb();
  const stamp = `${Date.now()}-${test.info().retry}`;
  const id = `device-save-${stamp}`;
  const title = `Browser save fixture ${stamp}`;
  const email = `browser-save-${stamp}@example.test`;
  const uid = await ensureUser(email);
  const event = (await db.doc('config/event').get()).data();
  await db.doc(`users/${uid}`).set({ email, displayName: 'Browser save reader',
    profileVisibility: 'private', registrationStatus: status, role: 'attendee' });
  await db.doc(`schedule_shares/${uid}`).set({ scheduleVisibility: visibility, sessionIds: [], displayName: 'Browser save reader' });
  await db.doc(`cmsSchedule/${id}`).set({ title, visible: true, type: 'panel', dayId: event.days[0].id,
    startTime: '16:00', endTime: '16:30', speakerIds: [], order: 900 });
  return {
    db, id, title, email, uid,
    async cleanup() {
      await adminAuth().deleteUser(uid);
      await Promise.all([
        db.doc(`cmsSchedule/${id}`).delete(), db.doc(`sessionBookmarks/${id}`).delete(),
        db.doc(`users/${uid}/bookmarks/${id}`).delete(), db.doc(`users/${uid}`).delete(),
        db.doc(`schedule_shares/${uid}`).delete(), db.doc(`users_public/${uid}`).delete(),
      ]);
    },
  };
}

async function openSession(page, fixture) {
  await page.goto(`/schedule?q=${encodeURIComponent(fixture.title)}`);
  const row = page.locator('.schedule-screen .session-block').filter({ has: page.getByRole('heading', { name: fixture.title }) });
  await expect(row).toBeVisible();
  return row;
}

async function deviceIds(page) {
  return page.evaluate(async () => (await import('/src/lib/deviceBookmarks.js')).getDeviceBookmarks().ids);
}

function countWrites(page) {
  const calls = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/bookmarkSession')) calls.push(1);
  });
  return calls;
}

test('a signed-out reader saves, reloads and removes a session without account writes', async ({ page }) => {
  const fixture = await seed();
  const calls = countWrites(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const row = await openSession(page, fixture);
    await fs.mkdir('test-results/admin-visual-evidence', { recursive: true });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: 'test-results/admin-visual-evidence/browser-save-before-action.png', fullPage: true });
    await row.getByRole('button', { name: /^Bookmark$/ }).click();
    await expect(row.getByRole('button', { name: /^Bookmarked$/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('link', { name: 'My schedule', exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
    await expect(page.getByText(/saved only in this browser/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
    expect(await deviceIds(page)).toEqual([fixture.id]);
    await expect(page.getByLabel('Private note')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Share your schedule' })).toHaveCount(0);
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: 'test-results/admin-visual-evidence/browser-schedule-390.png', fullPage: true });
    await page.getByRole('button', { name: /^Bookmarked$/ }).click();
    await expect(page.getByRole('heading', { name: 'No bookmarked sessions yet' })).toBeVisible();
    expect(calls).toHaveLength(0);
    expect((await fixture.db.doc(`users/${fixture.uid}/bookmarks/${fixture.id}`).get()).exists).toBe(false);
  } finally { await fixture.cleanup(); }
});

test('blocked browser storage keeps the sign-in path', async ({ page }) => {
  await page.addInitScript(() => {
    const write = globalThis.Storage.prototype.setItem;
    globalThis.Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('eventrunner:device-bookmarks:')) throw new Error('Browser storage blocked');
      return Reflect.apply(write, this, [key, value]);
    };
  });
  await page.goto('/schedule');
  await expect(page.getByRole('link', { name: 'Sign in to save sessions' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'My schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to see your schedule' })).toBeVisible();
});

test('feature-off hides the device controls and list without clearing saved ids', async ({ page }) => {
  const fixture = await seed();
  const featuresRef = fixture.db.doc('config/features');
  const original = (await featuresRef.get()).data();
  try {
    const row = await openSession(page, fixture);
    await row.getByRole('button', { name: /^Bookmark$/ }).click();
    await expect(row.getByRole('button', { name: /^Bookmarked$/ })).toBeVisible();
    await featuresRef.set({ ...original, sessionBookmarks: false });
    await expect(page.getByRole('link', { name: 'My schedule', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /^Bookmarked$/ })).toHaveCount(0);
    await page.goto('/schedule/mine');
    await expect(page.getByRole('heading', { name: 'This event doesn’t have a personal schedule' })).toBeVisible();
    await expect(page.getByRole('heading', { name: fixture.title })).toHaveCount(0);
    expect(await deviceIds(page)).toEqual([fixture.id]);
  } finally { await featuresRef.set(original); await fixture.cleanup(); }
});

test('an eligible private import retries a lost response without duplicating membership or count', async ({ page }) => {
  const fixture = await seed();
  let lost = false;
  try {
    const row = await openSession(page, fixture);
    await row.getByRole('button', { name: /^Bookmark$/ }).click();
    await expect(row.getByRole('button', { name: /^Bookmarked$/ })).toBeVisible();
    await page.route('**/bookmarkSession', async (route) => {
      if (lost || route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lost = true;
      await route.abort('connectionfailed');
    });
    await signIn(page, fixture.email);
    const panel = page.getByRole('region', { name: 'Browser-saved sessions' });
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(await deviceIds(page)).toEqual([fixture.id]);
    expect((await fixture.db.doc(`sessionBookmarks/${fixture.id}`).get()).data().count).toBe(1);
    await panel.getByRole('button', { name: 'Add to my account', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(await deviceIds(page)).toEqual([]);
    expect((await fixture.db.collection(`users/${fixture.uid}/bookmarks`).get()).size).toBe(1);
    expect((await fixture.db.doc(`sessionBookmarks/${fixture.id}`).get()).data().count).toBe(1);
    await page.goto('/schedule/mine');
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
  } finally { await fixture.cleanup(); }
});

for (const visibility of ['public', 'attendees_only']) {
  test(`a ${visibility} schedule leaves browser saves untouched until explicit sharing consent`, async ({ page }) => {
    const fixture = await seed({ visibility });
    const calls = countWrites(page);
    try {
      const row = await openSession(page, fixture);
      await row.getByRole('button', { name: /^Bookmark$/ }).click();
      await expect(row.getByRole('button', { name: /^Bookmarked$/ })).toBeVisible();
      await signIn(page, fixture.email);
      const panel = page.getByRole('region', { name: 'Browser-saved sessions' });
      await expect(panel.getByRole('button', { name: 'Add and share these sessions' })).toBeVisible();
      await expect(panel).toContainText('Adding 1 session');
      expect(calls).toHaveLength(0);
      expect((await fixture.db.doc(`users/${fixture.uid}/bookmarks/${fixture.id}`).get()).exists).toBe(false);
      await page.reload();
      await expect(panel.getByRole('button', { name: 'Add and share these sessions' })).toBeVisible();
      expect(await deviceIds(page)).toEqual([fixture.id]);
      expect(calls).toHaveLength(0);
      await panel.getByRole('button', { name: 'Add and share these sessions' }).click();
      await expect(panel).toHaveCount(0);
      expect(calls).toHaveLength(1);
      expect((await fixture.db.doc(`sessionBookmarks/${fixture.id}`).get()).data().count).toBe(1);
      await expect.poll(async () => (await fixture.db.doc(`schedule_shares/${fixture.uid}`).get()).data()?.sessionIds).toEqual([fixture.id]);
    } finally { await fixture.cleanup(); }
  });
}

test('an ineligible account keeps its browser list and issues no bookmark write', async ({ page }) => {
  const fixture = await seed({ status: 'pending' });
  const calls = countWrites(page);
  try {
    const row = await openSession(page, fixture);
    await row.getByRole('button', { name: /^Bookmark$/ }).click();
    await expect(row.getByRole('button', { name: /^Bookmarked$/ })).toBeVisible();
    await signIn(page, fixture.email);
    await page.goto('/profile');
    await expect(page.locator('#displayName')).toHaveValue('Browser save reader');
    await page.goto('/schedule/mine');
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
    await expect(page.getByText(/This account does not have attendee access/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
    expect(await deviceIds(page)).toEqual([fixture.id]);
    expect(calls).toHaveLength(0);
    expect((await fixture.db.doc(`users/${fixture.uid}/bookmarks/${fixture.id}`).get()).exists).toBe(false);
  } finally { await fixture.cleanup(); }
});
