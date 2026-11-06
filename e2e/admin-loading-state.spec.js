// Hold one real emulator response so the pending state can be inspected;
// no production delays, fake progress, or test-only application flags.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';

test('CMS loading activity is labelled, motion-aware, and removed when the request finishes', async ({ page }) => {
  test.setTimeout(90_000);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/getEventStats', async (route) => {
    if (route.request().method() === 'POST') await pending;
    await route.continue();
  });

  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/overview');
    const loading = page.getByRole('status', { name: 'Loading the event figures…' });
    await expect(loading).toBeVisible();
    await expect(loading).toContainText('Loading the event figures…');
    const spinner = page.locator('.admin-loading-state .loading-status__activity');
    await expect(spinner).toHaveAttribute('aria-hidden', 'true');
    await expect(spinner).toHaveCSS('animation-name', 'loading-status-turn');
    await expect(spinner).toHaveCSS('animation-duration', '1.2s');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(spinner).toHaveCSS('animation-name', 'none');
    await expect(loading).toContainText('Loading the event figures…');
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    const evidenceDir = path.resolve('test-results/admin-visual-evidence');
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'admin-loading-390-reduced-motion.png'), fullPage: true });

    release();
    await expect(page.getByRole('heading', { name: 'Event figures', exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.admin-loading-state .loading-status__activity')).toHaveCount(0);
  } finally {
    release();
  }
});
