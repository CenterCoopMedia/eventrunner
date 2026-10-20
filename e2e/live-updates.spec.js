// Live update audiences, categories, and key dates (issue #200), on the real
// surface.
//
// The seeded operator signs in and posts two live updates from the admin
// form: one for everyone with a category, and one for speakers only. The
// save writes the audience to the row and to its admin_logs entry. Then:
//
//   - A signed-out browser on the home page sees the update for everyone,
//     with its category as a tag, and not the speaker-only update. The
//     card's query asks only for `everyone`; the rules would refuse a wider
//     one (tests/firestore.rules.test.js proves the database side).
//   - An approved attendee on their dashboard sees the same, and not the
//     speaker-only update.
//   - The event's milestones show under "Key dates" in date order, then
//     name order, and they stay when the feed is empty.
//
// config/features and config/event are restored and both updates deleted
// when the file is done, because later specs read the flags and the event.
/* global document, window */
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, ensureUser, signIn } from './helpers.mjs';

const ATTENDEE_EMAIL = 'e2e-live-updates-attendee@example.test';
// Stored out of order on purpose: the card sorts them.
const MILESTONES = [
  { label: 'Speaker slides due', date: '2031-03-10' },
  { label: 'Early rate ends', date: '2031-02-01' },
  { label: 'Agenda published', date: '2031-03-10' },
];
const KEY_DATE_ORDER = ['Early rate ends', 'Agenda published', 'Speaker slides due'];

test.describe.serial('live update audiences and key dates', () => {
  const stamp = Date.now();
  const publicMessage = `E2E doors open ${stamp}`;
  const speakerMessage = `E2E green room moved ${stamp}`;
  let seededFeatures;
  let seededEvent;
  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    const config = adminDb().collection('config');
    seededFeatures = (await config.doc('features').get()).data() ?? null;
    seededEvent = (await config.doc('event').get()).data() ?? null;
    await config.doc('features').set({ liveUpdates: true }, { merge: true });
    await config.doc('event').set({ milestones: MILESTONES }, { merge: true });

    context = await browser.newContext();
    page = await context.newPage();
    await signIn(page, ADMIN_EMAIL);
  });

  test.afterAll(async () => {
    const token = await adminIdToken();
    const rows = await adminDb().collection('live_updates').get();
    for (const row of rows.docs) {
      if (String(row.data().message ?? '').includes(String(stamp))) {
        await callFunction('deleteLiveUpdate', { id: row.id }, token);
      }
    }
    const config = adminDb().collection('config');
    if (seededFeatures === null) await config.doc('features').delete();
    else await config.doc('features').set(seededFeatures);
    if (seededEvent === null) await config.doc('event').delete();
    else await config.doc('event').set(seededEvent);
    await context?.close();
  });

  test('the operator posts one update for everyone and one for speakers only', async () => {
    await page.goto('/admin/live-updates');
    await expect(page.getByRole('heading', { level: 1, name: 'Live updates' })).toBeVisible();

    await page.getByLabel('Message').fill(publicMessage);
    await page.getByLabel('Category').fill('Venue');
    await expect(page.getByLabel('Who can read it')).toHaveValue('everyone');
    await page.getByRole('button', { name: 'Post update' }).click();
    await expect(page.getByText(publicMessage)).toBeVisible();
    // The list can report the new row before the save answers; the form
    // clears on the answer, so wait for that before the second post.
    await expect(page.getByLabel('Message')).toHaveValue('');

    await page.getByLabel('Message').fill(speakerMessage);
    await page.getByLabel('Who can read it').selectOption('speakers');
    await page.getByRole('button', { name: 'Post update' }).click();
    await expect(page.getByText(speakerMessage)).toBeVisible();

    const rowFor = async (message) => (await adminDb().collection('live_updates').where('message', '==', message).get())
      .docs.map((d) => ({ id: d.id, ...d.data() }))[0] ?? null;
    await expect.poll(() => rowFor(publicMessage)).toMatchObject({ audience: 'everyone', category: 'Venue' });
    await expect.poll(() => rowFor(speakerMessage)).toMatchObject({ audience: 'speakers', category: null });
    const speakerRow = await rowFor(speakerMessage);

    // The audit row is written after the row itself, so the list can show
    // the update first.
    const logsFor = async (id) => (await adminDb().collection('admin_logs').where('docPath', '==', `live_updates/${id}`).get())
      .docs.map((d) => d.data());
    await expect.poll(() => logsFor(speakerRow.id)).toContainEqual(expect.objectContaining({
      action: 'saveLiveUpdate',
      email: ADMIN_EMAIL,
      details: { audience: 'speakers', previousAudience: null },
    }));
  });

  test('a signed-out reader sees the update for everyone and the key dates, not the speaker update', async ({ browser }) => {
    const visitor = await browser.newContext();
    const home = await visitor.newPage();
    await home.goto('/');
    const feed = home.getByRole('region', { name: 'Live updates' });
    await expect(feed.getByText(publicMessage)).toBeVisible();
    await expect(feed.getByRole('listitem').filter({ hasText: publicMessage })).toContainText('Venue');
    await expect(home.getByText(speakerMessage)).toHaveCount(0);

    const keyDates = home.getByRole('region', { name: 'Key dates' });
    await expect(keyDates.getByRole('heading', { level: 3 })).toHaveText(KEY_DATE_ORDER);
    await expect(keyDates.locator('time').first()).toHaveAttribute('datetime', '2031-02-01');
    await visitor.close();
  });

  test('an approved attendee does not see the speaker update on their dashboard', async ({ browser }) => {
    const uid = await ensureUser(ATTENDEE_EMAIL);
    const ref = adminDb().collection('users').doc(uid);
    await expect.poll(async () => (await ref.get()).exists, { timeout: 20_000 }).toBe(true);
    await ref.set({
      displayName: 'Live updates attendee',
      profileVisibility: 'private',
      registrationStatus: 'approved',
      approvalSource: 'admin',
    }, { merge: true });

    const attendee = await browser.newContext();
    const dashboard = await attendee.newPage();
    await signIn(dashboard, ATTENDEE_EMAIL);
    await dashboard.goto('/dashboard');
    const feed = dashboard.getByRole('region', { name: 'Live updates' });
    await expect(feed.getByText(publicMessage)).toBeVisible();
    await expect(dashboard.getByText(speakerMessage)).toHaveCount(0);
    await attendee.close();
  });

  test('the operator, an admin, sees the speaker update with its audience in words', async () => {
    await page.goto('/dashboard');
    const row = page.getByRole('region', { name: 'Live updates' }).getByRole('listitem').filter({ hasText: speakerMessage });
    await expect(row).toContainText('For speakers');
  });

  test('the key dates stay when the feed is empty, and fit a phone screen', async ({ browser }) => {
    const token = await adminIdToken();
    const rows = await adminDb().collection('live_updates').get();
    for (const row of rows.docs) {
      const removed = await callFunction('deleteLiveUpdate', { id: row.id }, token);
      expect(removed.status).toBe(200);
    }

    const visitor = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const home = await visitor.newPage();
    await home.goto('/');
    const keyDates = home.getByRole('region', { name: 'Key dates' });
    await expect(keyDates.getByRole('heading', { level: 3 })).toHaveText(KEY_DATE_ORDER);
    await expect(home.getByRole('region', { name: 'Live updates' })).toHaveCount(0);
    const overflow = await home.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await visitor.close();
  });
});
