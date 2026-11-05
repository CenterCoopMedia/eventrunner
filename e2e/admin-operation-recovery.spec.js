// Real long-page action handoffs, with one controlled network failure.
/* global document */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, APP_BASE_URL, adminDb, mailFileSize, signIn } from './helpers.mjs';

const RUN = Date.now().toString(36);
const IDS = Array.from({ length: 16 }, (_, i) => `operation-feedback-${RUN}-${i}`);
const HEADERS = { 'access-control-allow-origin': APP_BASE_URL, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck' };
const EVIDENCE = path.resolve('test-results/admin-visual-evidence');

async function capture(page, name) {
  await page.locator('html').evaluate((root) => root.ownerDocument.fonts.ready);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), animations: 'disabled' });
}

test('a phone edit opens the composer, keeps a failed draft and exposes its retry outcome', async ({ page }) => {
  test.setTimeout(120_000);
  const db = adminDb();
  let releaseHeld;
  await fs.mkdir(EVIDENCE, { recursive: true });
  await Promise.all(IDS.map((id, i) => db.collection('live_updates').doc(id).set({
    message: `Event desk update ${i + 1}: the registration desk can help with directions and session questions.`,
    category: 'Event desk', audience: 'everyone', pinned: false,
    postedAt: new Date(Date.now() - i * 60_000),
  })));
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, ADMIN_EMAIL);
    const mailBefore = mailFileSize();
    await page.goto('/admin/live-updates');
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    await page.getByRole('button', { name: 'Take the tour', exact: true }).click();
    await endTour.click();

    const lastRow = page.getByRole('listitem').filter({ hasText: 'Event desk update 16:' });
    await lastRow.getByRole('button', { name: 'Edit', exact: true }).click();
    const message = page.getByLabel('Message', { exact: true });
    await expect(message).toBeFocused();
    await expect(message).toBeInViewport();
    await page.locator('html').evaluate((root) => root.ownerDocument.defaultView.scrollTo(0, 0));
    await capture(page, 'operations-live-editor-desktop');

    await page.setViewportSize({ width: 390, height: 844 });
    await lastRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(message).toBeFocused();
    await expect(message).toBeInViewport();
    await message.fill('The closing session now starts at 4:30 PM in the main hall.');

    const held = new Promise((resolve) => { releaseHeld = resolve; });
    await page.route('**/saveLiveUpdate', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: HEADERS });
      await held;
      return route.fulfill({ status: 503, headers: HEADERS, json: { error: { code: 'unavailable', message: 'The update could not be saved. Try again.' } } });
    });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(message).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    releaseHeld();
    const refusal = page.getByRole('alert').filter({ hasText: 'The update could not be saved. Try again.' });
    await expect(refusal).toBeFocused();
    await expect(refusal).toBeInViewport();
    await expect(message).toHaveValue('The closing session now starts at 4:30 PM in the main hall.');
    await capture(page, 'operations-live-retry-phone');

    await page.unroute('**/saveLiveUpdate');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const composer = page.locator('form').filter({ has: message });
    await expect(composer.getByRole('status')).toHaveText('Live update saved.');
    await expect.poll(async () => (await db.collection('live_updates').doc(IDS[15]).get()).data().message).toBe('The closing session now starts at 4:30 PM in the main hall.');
    await expect(message).toHaveValue('');
    await composer.getByRole('status').scrollIntoViewIfNeeded();
    await capture(page, 'operations-live-saved-phone');
    expect(mailFileSize()).toBe(mailBefore);
  } finally {
    releaseHeld?.();
    await Promise.all(IDS.map((id) => db.collection('live_updates').doc(id).delete()));
  }
});

test('a long import form moves keyboard focus to its real preview outcome on a phone', async ({ page }) => {
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/import');
  const endTour = page.getByRole('button', { name: 'End tour', exact: true });
  if (await endTour.isVisible()) await endTour.click();
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click();
  await endTour.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Record type').selectOption('organizations');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'event-partners.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`external_id,name,slug,tier,website,description,order\nRECOVERY-${RUN},Community Newsroom,recovery-${RUN},Partner,https://example.org,A local journalism partner.,1\n`),
  });
  await page.getByRole('button', { name: 'Preview import' }).click();
  const result = page.getByRole('status').filter({ hasText: 'Nothing is saved yet.' });
  await expect(result).toBeInViewport();
  await expect(result.locator('..')).toBeFocused();
  await expect(page.getByRole('region', { name: 'Preview: organizations' })).toBeVisible();
  await capture(page, 'operations-import-result-phone');
  expect((await adminDb().doc(`cmsOrganizations_drafts/recovery-${RUN}`).get()).exists).toBe(false);
});
