// Issue #454. Preview choices stay available and keep a 44px target when
// the branding column is narrow or the text is enlarged.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';

test('preview choices stay usable at phone widths and enlarged text', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  const pageChoice = page.getByLabel('Page', { exact: true });
  const phone = page.getByRole('button', { name: 'Phone', exact: true });
  const publish = page.getByRole('button', { name: 'Publish the theme' });
  for (const width of [1280, 400, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await pageChoice.scrollIntoViewIfNeeded();
    await expect(pageChoice).toBeVisible();
    await expect(phone).toBeVisible();
    await expect(page.getByLabel('Mode', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Stress test' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actual size' })).toBeVisible();
    const box = await phone.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
  await page.evaluate(() => {
    globalThis.document.documentElement.style.fontSize = '32px';
  });
  await phone.scrollIntoViewIfNeeded();
  const enlarged = await phone.boundingBox();
  expect(enlarged.height).toBeGreaterThanOrEqual(44);
  expect(enlarged.x + enlarged.width).toBeLessThanOrEqual(321);
  await publish.scrollIntoViewIfNeeded();
  await expect(publish).toBeVisible();
});
