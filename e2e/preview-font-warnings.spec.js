// Issue #450. The page proof must drop a missing-font warning after the
// preview document's own faces load, and keep one when a face fails.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';

async function openPageStyle(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await page.getByRole('button', { name: 'Page style', exact: true }).click();
  await expect(page.frameLocator('iframe[data-theme-proof]').first().locator('.event-hero__title')).toBeVisible();
}

test('a delayed preview font clears its loading warning without a theme change', async ({ page }) => {
  test.setTimeout(120_000);
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/*.woff2', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await openPageStyle(page);
    const style = page.getByLabel('Site style');
    const chosen = await style.inputValue();
    await expect(page.getByText(/still loading, so the/).first()).toBeVisible();
    release();
    await expect(page.getByText(/still loading, so the/)).toHaveCount(0);
    await expect(page.getByText(/did not load, so the/)).toHaveCount(0);
    await expect(style).toHaveValue(chosen);
  } finally {
    release();
  }
});

test('a failed preview font keeps a warning', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/*.woff2', (route) => route.abort());
  await openPageStyle(page);
  await expect(page.getByText(/did not load, so the/).first()).toBeVisible();
});

test('compare mode clears the loading warning after both frames load', async ({ page }) => {
  test.setTimeout(120_000);
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/*.woff2', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await openPageStyle(page);
    await page.getByRole('button', { name: 'Compare light and dark', exact: true }).click();
    await expect(page.locator('iframe[data-theme-proof]')).toHaveCount(2);
    await expect(page.getByText(/still loading, so the/).first()).toBeVisible();
    release();
    await expect(page.getByText(/still loading, so the/)).toHaveCount(0);
    await expect(page.getByText(/did not load, so the/)).toHaveCount(0);
    await expect(page.locator('iframe[data-theme-proof]')).toHaveCount(2);
  } finally {
    release();
  }
});
