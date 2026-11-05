// Issue #452. The shared media dialog close control stays an X with a
// stable hit area when the heading is long and the viewport is narrow.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

async function openPrimaryPicker(page) {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await page.getByRole('button', { name: 'Identity', exact: true }).click();
  const primary = page.getByLabel('Primary logo');
  await primary.locator('..').getByRole('button', { name: 'Choose or upload…' }).click();
  await expect(page.getByRole('dialog', { name: /Choose an image/ })).toBeVisible();
}

async function expectCloseFits(page, width) {
  const dialog = page.getByRole('dialog', { name: /Choose an image/ });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(close).toHaveAttribute('title', 'Close dialog');
}

test('the media close control keeps its hit area at phone widths', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 400, height: 700 });
  await openPrimaryPicker(page);
  const dialog = page.getByRole('dialog', { name: /Choose an image/ });
  await expect(dialog).toHaveJSProperty('tagName', 'DIALOG');
  await expect(dialog).toHaveJSProperty('open', true);
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  // A native top-layer dialog cannot leave Tab focus in the editor behind it.
  await expect.poll(() => dialog.evaluate((node) => node.contains(globalThis.document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  for (const width of [400, 390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await expectCloseFits(page, width);
  }
  const evidenceDir = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, 'media-dialog-320.png'), animations: 'disabled' });
  await page.evaluate(() => {
    globalThis.document.documentElement.style.fontSize = '32px';
  });
  await expectCloseFits(page, 320);
  // Focusing the panel dismisses the close button's keyboard tooltip.
  await dialog.focus();
  const opener = page.getByLabel('Primary logo').locator('..').getByRole('button', { name: 'Choose or upload…' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Tab follows a media deletion consequence instead of returning to the dialog header', async ({ page }) => {
  test.setTimeout(120_000);
  const id = 'modal-keyboard-proof';
  const asset = adminDb().doc(`media_assets/${id}`);
  await asset.set({
    path: `cms-images/${id}/room.png`, folder: 'cms-images', filename: 'room.png',
    title: 'Keyboard proof image', alt: '', contentType: 'image/png', size: 1,
    uploadedBy: 'operator@example.test', createdAt: new Date(),
  });
  try {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/media');
    await page.getByRole('button', { name: /Keyboard proof image/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard proof image' });
    await expect(dialog.getByText(/Deleting it is safe/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete this file', exact: true }).click();
    const consequence = dialog.getByRole('heading', { name: 'Delete this file', exact: true });
    await expect(consequence).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Delete this file', exact: true })).toBeFocused();
    await consequence.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
    await consequence.focus();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Delete this file', exact: true })).toBeFocused();
    await expect(consequence).toHaveCount(0);
    await expect(dialog).toBeVisible();
  } finally {
    await asset.delete();
  }
});
