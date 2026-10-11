// Issue #452. The shared media dialog close control stays an X with a
// stable hit area when the heading is long and the viewport is narrow.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';

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
  for (const width of [400, 390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await expectCloseFits(page, width);
  }
  await page.evaluate(() => {
    globalThis.document.documentElement.style.fontSize = '32px';
  });
  await expectCloseFits(page, 320);
  const opener = page.getByLabel('Primary logo').locator('..').getByRole('button', { name: 'Choose or upload…' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});
