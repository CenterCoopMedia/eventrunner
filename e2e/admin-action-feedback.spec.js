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
      const result = page.getByRole('region', { name: 'Editor action status' }).getByRole('status');
      await expect(result).toHaveText('Draft saved. It is not public until you publish.');
      await expect(page.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
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

// The same Save/Publish coordinates are the requirement, including busy-label
// widths. Controlled responses exercise the actual editor without a timed sleep.
test('editor actions stay anchored through save, newer edits, publish and failure', async ({ page }) => {
  test.setTimeout(120_000);
  const id = `stable-actions-${Date.now()}`;
  const live = adminDb().collection('cmsTimeline').doc(id);
  const draft = adminDb().collection('cmsTimeline_drafts').doc(id);
  const longTitle = 'A long event timeline entry with enough words to check the title beside the editor controls';
  const gates = [];
  const gate = (reply) => {
    const pending = { received: Promise.withResolvers(), release: Promise.withResolvers(), reply };
    gates.push(pending);
    return pending;
  };
  const ok = { status: 200, contentType: 'application/json', body: '{}' };
  let nextSave;
  let nextPublish;
  await page.route('**/cmsUpdateContent', async (route) => {
    if (route.request().method() !== 'POST' || !nextSave) return route.continue();
    const pending = nextSave;
    nextSave = null;
    pending.received.resolve();
    await pending.release.promise;
    await route.fulfill(pending.reply);
  });
  await page.route('**/cmsPublish', async (route) => {
    if (route.request().method() !== 'POST' || !nextPublish) return route.continue();
    const pending = nextPublish;
    nextPublish = null;
    pending.received.resolve();
    await pending.release.promise;
    await route.fulfill(pending.reply);
  });
  async function geometry() {
    return page.evaluate(() => {
      window.scrollTo(0, 0);
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 100) / 100);
      };
      return {
        buttons: [...document.querySelectorAll('.admin-job-line__actions button')].map(rect),
      };
    });
  }
  try {
    await live.set({ year: 2023, title: 'Layout proof', description: 'Synthetic layout content.', visible: false, revision: 1 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto(`/admin/timeline/${id}`);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Layout proof');
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    await page.locator('html').evaluate(() => document.fonts.ready);

    for (const { width, enlarged } of [{ width: 1280 }, { width: 1920 }, { width: 390 }, { width: 768 }, { width: 768, enlarged: true }]) {
      await page.setViewportSize({ width, height: 900 });
      for (const title of ['Layout proof', longTitle]) {
        await page.goto(`/admin/timeline/${id}`);
        await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Layout proof');
        if (enlarged) await page.locator('html').evaluate((element) => { element.style.fontSize = '200%'; });
        await page.getByLabel('Title', { exact: true }).fill(title);
        const titleBox = await page.getByRole('heading', { level: 1, name: title, exact: true }).boundingBox();
        const actionsBox = await page.locator('.admin-job-line__actions').boundingBox();
        await fitsViewport(page, page.locator('.admin-job-line__actions'));
        if (width >= 640) expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionsBox.x);
        const baseline = await geometry();
        const saved = gate(ok);
        nextSave = saved;
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await saved.received.promise;
        await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toHaveAttribute('aria-busy', 'true');
        expect(await geometry()).toEqual(baseline);
        saved.release.resolve();
        const feedback = page.getByRole('region', { name: 'Editor action status' });
        await expect(feedback.getByRole('status')).toHaveText('Draft saved. It is not live until you publish it.');
        expect(await geometry()).toEqual(baseline);
        await page.getByLabel('Description', { exact: true }).fill(`Newer unsaved description at ${width}: ${title}`);
        await expect(feedback.getByRole('status')).toContainText('Newer edits are still unsaved.');
        expect(await geometry()).toEqual(baseline);

        const saveForPublish = gate(ok);
        const publish = gate({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', results: { cmsTimeline: { published: [id], skipped: [] } } }) });
        nextSave = saveForPublish;
        nextPublish = publish;
        await page.getByRole('button', { name: 'Publish', exact: true }).click();
        await saveForPublish.received.promise;
        await expect(page.getByRole('button', { name: 'Publishing…', exact: true })).toHaveAttribute('aria-busy', 'true');
        expect(await geometry()).toEqual(baseline);
        saveForPublish.release.resolve();
        await publish.received.promise;
        expect(await geometry()).toEqual(baseline);
        publish.release.resolve();
        await expect(feedback.getByRole('status')).toHaveText('Published.');
        expect(await geometry()).toEqual(baseline);

        const failure = gate({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Synthetic save refusal. Your changes are still here.' } }) });
        nextSave = failure;
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await failure.received.promise;
        expect(await geometry()).toEqual(baseline);
        failure.release.resolve();
        await expect(page.getByRole('alert')).toContainText('The change could not be saved. Try again.');
        await expect(feedback).toContainText('The action failed. Review the error below.');
        expect(await geometry()).toEqual(baseline);
        // The detailed error is the single alert; the toolbar repeat stays quiet.
        await expect(page.getByRole('alert')).toHaveCount(1);
        await fitsViewport(page, page.locator('.admin-job-line__actions'));
      }
    }
  } finally {
    for (const pending of gates) pending.release.resolve();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await Promise.all([live.delete(), draft.delete()]);
  }
});
