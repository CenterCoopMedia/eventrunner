// The updates editor (issue #190) and the update category and featured
// flag (issue #191), on the real surface.
//
// The seeded operator signs in through the real sign-in page and writes an
// update in the admin: a title, a text, and a date a year ahead. "Save
// draft" writes the draft only, so the database holds a dirty draft and no
// live doc, and a second, signed-out browser on the public Updates page
// sees the seeded posts and not the new one. The operator then gives the
// update a category of the longest length allowed and features it, saves
// the draft with Enter, and reloads the editor to find both kept. "Save and
// publish" runs cmsPublish from the same editor, and the signed-out browser
// finds the new update on a reload, at the head of the page under
// "Featured", with its category as a tag that stays inside a 320 pixel
// screen. The date a year ahead holds nothing back.
//
// config/features is restored and the update deleted when the file is
// done, because later specs read the flags and count the collection.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

// A post the demo seed publishes (scripts/lib/demo-updates.json). Waiting
// for it proves the public page's live listener has reported.
const SEEDED_TITLE = 'The three-day program is ready';
// Twenty-four characters, the most a category takes (shared/update).
const CATEGORY = 'Travel and arrival notes';

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

    // The list shows the draft on the proof ground, each word under its own
    // head, and Enter on its title opens the editor again.
    await page.goto('/admin/updates');
    const row = page.locator('tbody tr', { has: page.getByRole('link', { name: title }) });
    await expect(row.getByRole('cell').nth(1)).toHaveText('Draft');
    await expect(row.getByRole('cell').nth(2)).toHaveText(`October 15, ${nextYear}`);
    await expect(row.getByRole('cell').first()).toHaveClass(/admin-proof-row/);
    for (const [index, head] of ['Update', 'State', 'Date', 'Category', 'Placement'].entries()) {
      const headBox = await page.getByRole('columnheader', { name: head, exact: true }).boundingBox();
      const cellBox = await row.getByRole('cell').nth(index).boundingBox();
      expect(Math.abs(cellBox.x - headBox.x), `${head} lines up with its head`).toBeLessThan(1);
    }
    await row.getByRole('link', { name: title }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/updates/${updateId}$`));
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title);

    // A signed-out reader sees the seeded posts and not the draft.
    await publicPage.goto('/updates');
    await expect(publicPage.getByRole('link', { name: SEEDED_TITLE })).toBeVisible();
    await expect(publicPage.getByRole('link', { name: title })).toHaveCount(0);
  });

  test('a category and the featured flag survive a save and a reload of the editor', async () => {
    expect(CATEGORY).toHaveLength(24);
    const category = page.getByLabel('Category', { exact: true });
    await category.fill(CATEGORY);
    await page.getByLabel('Feature this update at the head of the list').check();
    // Enter in a one-line field saves a draft.
    await category.press('Enter');
    const draftRef = adminDb().collection('cmsUpdates_drafts').doc(updateId);
    await expect.poll(async () => (await draftRef.get()).data()?.category).toBe(CATEGORY);
    expect((await draftRef.get()).data()).toMatchObject({ featured: true, status: 'dirty' });

    await page.reload();
    await expect(page.getByLabel('Category', { exact: true })).toHaveValue(CATEGORY);
    await expect(page.getByLabel('Feature this update at the head of the list')).toBeChecked();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title);
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue(day);
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
    expect(live.data()).toMatchObject({ title, visible: true, category: CATEGORY, featured: true });

    await publicPage.reload();
    await expect(publicPage.getByRole('link', { name: SEEDED_TITLE })).toBeVisible();
    await expect(publicPage.getByRole('link', { name: title })).toBeVisible();

    // The featured update leads the list, under the first head, with its
    // category as its tag.
    const firstRun = publicPage.locator('.update-feed > section').first();
    await expect(publicPage.locator('.update-feed h2').first()).toHaveText('Featured');
    await expect(firstRun.getByRole('link')).toHaveText([title]);
    const tag = firstRun.locator('.update-feed__entry span', { hasText: CATEGORY });
    await expect(tag).toHaveCount(1);
    await expect(publicPage.getByRole('link', { name: title })).toHaveCount(1);

    // The tag never wraps, so at the narrowest screen it must still end
    // inside the viewport.
    await publicPage.setViewportSize({ width: 320, height: 800 });
    await expect(tag).toBeVisible();
    const box = await tag.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
});
