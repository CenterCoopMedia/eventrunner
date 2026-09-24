// The updates editor (issue #190), on the real surface.
//
// The seeded operator signs in through the real sign-in page and writes an
// update in the admin: a title, a text, and a date a year ahead. "Save
// draft" writes the draft only, so the database holds a dirty draft and no
// live doc, and a second, signed-out browser on the public Updates page
// sees the seeded posts and not the new one. "Save and publish" then runs
// cmsPublish from the same editor, and the signed-out browser finds the
// new update on a reload. The date a year ahead holds nothing back.
//
// config/features is restored and the update deleted when the file is
// done, because later specs read the flags and count the collection.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

// A post the demo seed publishes (scripts/lib/demo-updates.json). Waiting
// for it proves the public page's live listener has reported.
const SEEDED_TITLE = 'The three-day program is ready';

test.describe.serial('the updates editor', () => {
  const stamp = Date.now();
  const title = `E2E update ${stamp}`;
  const nextYear = new Date().getUTCFullYear() + 1;
  const day = `${nextYear}-10-15`;
  let updateId = null;
  let seededFeatures;
  let adminContext;
  let page;
  let publicContext;
  let publicPage;

  test.beforeAll(async ({ browser }) => {
    const features = adminDb().collection('config').doc('features');
    seededFeatures = (await features.get()).data() ?? null;
    if (seededFeatures?.updates !== true) await features.set({ updates: true }, { merge: true });

    adminContext = await browser.newContext();
    page = await adminContext.newPage();
    await signIn(page, ADMIN_EMAIL);
    publicContext = await browser.newContext();
    publicPage = await publicContext.newPage();
  });

  test.afterAll(async () => {
    if (updateId) {
      const removed = await callFunction('cmsDeleteUpdate', { id: updateId }, await adminIdToken());
      expect(removed.status, `cmsDeleteUpdate answered 200 (${JSON.stringify(removed.body)})`).toBe(200);
    }
    const features = adminDb().collection('config').doc('features');
    if (seededFeatures === null) await features.delete();
    else if (seededFeatures.updates !== true) await features.set(seededFeatures);
    await adminContext?.close();
    await publicContext?.close();
  });

  test('a new update is saved as a draft and stays off the public page', async () => {
    await page.goto('/admin/updates');
    await expect(page.getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Updates', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Write an update' }).first().click();
    await expect(page).toHaveURL(/\/admin\/updates\/new\/update$/);
    await expect(page.getByRole('heading', { level: 1, name: 'New update' })).toBeVisible();

    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Text', { exact: true }).fill('The workshop list for next year is on the schedule page.');
    await page.getByLabel('Date', { exact: true }).fill(day);
    await page.getByRole('button', { name: 'Save draft' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Draft saved. It is not live until you publish it.' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/updates\/[A-Za-z0-9_-]{8,}$/);
    updateId = new URL(page.url()).pathname.split('/').pop();
    await expect(page.locator('[data-record-state]')).toHaveText('Draft');

    // The database holds a dirty draft and no live doc.
    const draft = await adminDb().collection('cmsUpdates_drafts').doc(updateId).get();
    expect(draft.exists).toBe(true);
    expect(draft.data()).toMatchObject({ title, status: 'dirty', pinned: false, visible: true });
    expect((await adminDb().collection('cmsUpdates').doc(updateId).get()).exists).toBe(false);

    // A signed-out reader sees the seeded posts and not the draft.
    await publicPage.goto('/updates');
    await expect(publicPage.getByRole('link', { name: SEEDED_TITLE })).toBeVisible();
    await expect(publicPage.getByRole('link', { name: title })).toHaveCount(0);
  });

  test('the update appears on the public page after the editor publishes it', async () => {
    const publish = page.getByRole('button', { name: 'Save and publish' });
    // A date a year ahead never disables the publish action.
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByRole('status').filter({ hasText: 'Published. The public site picks it up live.' })).toBeVisible();
    await expect(page.locator('[data-record-state]')).toHaveText('Live');

    const live = await adminDb().collection('cmsUpdates').doc(updateId).get();
    expect(live.exists).toBe(true);
    expect(live.data()).toMatchObject({ title, visible: true });

    await publicPage.reload();
    await expect(publicPage.getByRole('link', { name: SEEDED_TITLE })).toBeVisible();
    await expect(publicPage.getByRole('link', { name: title })).toBeVisible();
  });
});
