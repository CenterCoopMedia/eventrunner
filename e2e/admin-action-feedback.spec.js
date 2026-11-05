/* global document, window */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

async function fitsViewport(page, locator) {
  await expect(locator).toBeInViewport();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
}

test('long CMS pages keep save and row outcomes with the action at desktop and phone widths', async ({ page }) => {
  test.setTimeout(180_000);
  const id = `feedback-proof-${Date.now()}`;
  const sectionId = `${id}-section-0`;
  const db = adminDb();
  const pageRef = db.collection('cmsPages').doc(id);
  const draftPageRef = db.collection('cmsPages_drafts').doc(id);
  const blocks = Array.from({ length: 18 }, (_, index) => ({
    id: `${sectionId}__block-${index}`,
    section: sectionId, field: `block-${index}`, blockType: 'text',
    value: `Feedback block ${index + 1}`, order: index, visible: true,
    status: 'dirty', basedOnRevision: null,
  }));
  const evidenceDir = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  try {
    await pageRef.set({
      label: 'Feedback evidence', path: `/${id}`, order: 999, visible: false, systemPage: false, revision: 1,
      sections: Array.from({ length: 12 }, (_, index) => ({
        id: `${id}-section-${index}`, label: `Evidence section ${index + 1}`,
        description: 'Synthetic content for the action feedback check.', allowedBlocks: ['text'],
        maxBlocks: 24, reorderable: true, defaultBlocks: [],
      })),
    });
    await Promise.all(blocks.map(({ id: blockId, ...data }) => db.collection('cmsContent_drafts').doc(blockId).set(data)));
    await signIn(page, ADMIN_EMAIL);
    await page.goto(`/admin/pages/${id}`);
    await expect(page.getByLabel('Navigation label')).toHaveValue('Feedback evidence');
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByLabel('Navigation label').fill(`Feedback evidence ${width}`);
      await page.locator('[data-editor-section]').last().scrollIntoViewIfNeeded();
      if (width >= 640) {
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
        await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport();
      }
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/cmsSavePage') && response.request().method() === 'POST'),
        page.getByRole('button', { name: 'Save draft', exact: true }).click(),
      ]);
      const result = page.locator('.admin-job-line__actions').getByRole('status');
      await expect(result).toHaveText('Draft saved. It is not public until you publish.');
      await fitsViewport(page, result);
      await page.locator('html').evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(evidenceDir, `editor-save-feedback-${width}.png`), animations: 'disabled' });
    }

    // The browser receives a genuine refused-publish shape after a controlled
    // pending interval. The fixture remains a private draft throughout.
    let received;
    let release;
    await page.route('**/cmsPublish', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      received(body);
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'done', results: { cmsContent: { published: [], skipped: [{ docId: body.docIds[0], reason: 'conflict' }] } },
      }) });
    });
    await page.goto(`/admin/content/${id}/${sectionId}`);
    const row = page.getByRole('link', { name: 'Feedback block 18', exact: true }).locator('xpath=ancestor::li[1]');
    await expect(row).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await row.scrollIntoViewIfNeeded();
      const request = new Promise((resolve) => { received = resolve; });
      const publish = row.getByRole('button', { name: 'Publish', exact: true });
      if (width === 320) {
        await publish.focus();
        await page.keyboard.press('Enter');
      } else await publish.click();
      expect(await request).toEqual({ collection: 'cmsContent', docIds: [blocks.at(-1).id] });
      await expect(row.getByRole('button', { name: 'Publishing…' })).toHaveAttribute('aria-busy', 'true');
      await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
      release();
      const result = row.getByRole('alert');
      await expect(result).toContainText('was edited while publishing');
      await fitsViewport(page, result);
      await expect(row.getByRole('button', { name: 'Publish', exact: true })).toBeFocused();
      await page.screenshot({ path: path.join(evidenceDir, `content-row-feedback-${width}.png`), animations: 'disabled' });
    }
  } finally {
    await Promise.all([pageRef.delete(), draftPageRef.delete(), ...blocks.flatMap((block) => [
      db.collection('cmsContent').doc(block.id).delete(), db.collection('cmsContent_drafts').doc(block.id).delete(),
    ])]);
    // Direct fixture cleanup bypasses the CMS store's count transaction.
    // Rebuild it so later emulator scenarios see only their own drafts.
    const repaired = await callFunction('cmsEnsurePendingCounts', { force: true }, await adminIdToken());
    expect(repaired.status, JSON.stringify(repaired.body)).toBe(200);
  }
});
