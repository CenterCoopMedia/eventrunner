// The unpublished changes page and the admin banner (issue #196), on the
// real surface.
//
// The done line: saving a block without publishing raises the count,
// publishing clears it, a failed publish run is still visible as failed,
// and the banner and the page never disagree. Only the emulators prove it
// whole: the seeded operator signs in through the real sign-in page, saves
// a block through the block editor's own "Save draft", reads the banner on
// that screen, follows it to the page, publishes from there, and watches
// the count leave. The failed run is written in the exact shape cmsPublish
// writes when a chunk throws (functions/src/cms/publish.cjs), because a
// real mid-run failure cannot be caused from a browser.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

const banner = (page) => page.getByRole('complementary', { name: 'Unpublished changes' });
const figure = (page) => page.locator('main p[data-pending-total]');

/** The page that lists section `hero`, read the way the block editor finds it. */
async function heroPageId() {
  const pages = await adminDb().collection('cmsPages').get();
  const owner = pages.docs.find((doc) => (doc.data().sections ?? []).some((section) => section?.id === 'hero'));
  if (!owner) throw new Error('The emulator seed has no page that lists the hero section.');
  return owner.id;
}

/** Open the hero subtitle's block editor, change its value, and save a draft. */
async function saveSubtitle(page, pageId, value) {
  await page.goto(`/admin/content/${pageId}/hero/subtitle`);
  await expect(page.getByRole('heading', { level: 1, name: 'subtitle' })).toBeVisible();
  const field = page.getByLabel(/^value/);
  // The editor adopts the stored block once both listeners answer; typing
  // before that would be overwritten.
  await expect(field).not.toHaveValue('');
  await field.fill(value);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved. It is not public until you publish.')).toBeVisible();
}

test.describe.serial('unpublished changes', () => {
  let pageId;
  let failedRef;

  test.beforeAll(async () => {
    // Start from nothing unpublished, so every count below is this spec's.
    const published = await callFunction('cmsPublish', { all: true }, await adminIdToken());
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    pageId = await heroPageId();
  });

  test.afterAll(async () => {
    if (failedRef) await failedRef.delete();
  });

  test('a saved block raises the count on the banner and the page, and a publish from the page clears it', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const subtitle = `E2E unpublished subtitle ${Date.now()}`;
    await signIn(page, ADMIN_EMAIL);

    // (a) Save without publishing: the banner on the same screen counts it.
    await saveSubtitle(page, pageId, subtitle);
    await expect(banner(page)).toHaveAttribute('data-pending-total', '1');
    await expect(banner(page)).toContainText('1 unpublished change: 1 content block.');
    // Above the title band, never under it.
    const bannerBox = await banner(page).boundingBox();
    const bandBox = await page.locator('main header.admin-job-line').boundingBox();
    expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(bandBox.y + 0.5);

    // (d) The page states the same count, from the same source.
    const bannerText = await banner(page).locator('p').evaluate((node) => node.firstChild.textContent);
    await banner(page).getByRole('link', { name: 'Review unpublished changes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Unpublished changes' })).toBeVisible();
    await expect(figure(page)).toHaveAttribute('data-pending-total', '1');
    await expect(figure(page)).toHaveText(bannerText.trim());
    await expect(banner(page)).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Content blocks with unpublished changes, newest first' });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('hero__subtitle');
    await expect(rows.first()).toContainText('Live with unpublished changes');
    await expect(page.locator('main table tbody tr')).toHaveCount(1);

    // (b) Publish from the page: the count leaves the page and the banner.
    await page.getByRole('button', { name: 'Publish 1 content block' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing is waiting to be published' })).toBeVisible();
    await expect(page.locator('main').getByText('Published. The public site picks it up live.')).toBeVisible();
    await expect(figure(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Pages', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    // And the change is live: a visitor with no admin session reads it.
    const visitor = await browser.newContext();
    try {
      const home = await visitor.newPage();
      await home.goto('/');
      await expect(home.locator('article[data-content-source="live"]')).toBeVisible();
      await expect(home.locator('article[data-content-source] > section').first().locator('p').last()).toHaveText(subtitle);
    } finally {
      await visitor.close();
    }
  });

  test('a failed publish run stays listed as Failed while later runs finish', async ({ page }) => {
    test.setTimeout(90_000);
    // The shape cmsPublish leaves when a chunk commit throws.
    failedRef = adminDb().collection('cmsPublishQueue').doc();
    await failedRef.set({
      status: 'failed',
      error: 'E2E: the second chunk commit failed.',
      request: { cmsContent: ['hero__subtitle'] },
      progress: {},
      requestedBy: ADMIN_EMAIL,
      requestedAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/unpublished');
    const runs = page.getByRole('list', { name: 'Publish runs' });
    const failedRow = runs.locator(`[data-run="${failedRef.id}"]`);
    await expect(failedRow).toContainText('Failed');
    await expect(failedRow).toContainText('0 of 1 published before it stopped.');
    await expect(failedRow).toContainText('E2E: the second chunk commit failed.');
    await expect(failedRow.getByRole('button', { name: 'Resume publish' })).toBeVisible();

    // A later save and publish: a new Done run leads, and the failed run
    // still reads Failed.
    await saveSubtitle(page, pageId, `E2E unpublished again ${Date.now()}`);
    await expect(banner(page)).toHaveAttribute('data-pending-total', '1');
    await banner(page).getByRole('link', { name: 'Review unpublished changes' }).click();
    await page.getByRole('button', { name: 'Publish 1 content block' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing is waiting to be published' })).toBeVisible();
    const first = runs.getByRole('listitem').first();
    await expect(first).toContainText('Done');
    await expect(first).toContainText('1 of 1 published.');
    await expect(first).not.toHaveAttribute('data-run', failedRef.id);
    await expect(failedRow).toContainText('Failed');
    await expect(failedRow.getByRole('button', { name: 'Resume publish' })).toBeVisible();
    expect((await failedRef.get()).data().status).toBe('failed');
  });
});
