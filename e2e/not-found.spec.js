// Exercise the actual missing-page recovery UI against synthetic event data.
/* global document, window */
import { test, expect } from '@playwright/test';

const missingPath = '/missing-ticket-review-489';
const controlName = 'Swing the decorative ticket';

async function openMissingPage(page) {
  await page.goto(missingPath);
  await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
}

async function settleTicket(page) {
  await page.locator('.not-found__hanging').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
}

test('404 drag remains active at zero angle and keyboard replay preserves focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openMissingPage(page);
  const control = page.getByRole('button', { name: controlName });
  const hanging = page.locator('.not-found__hanging');
  await expect(control).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(hanging).toHaveAttribute('data-dragging', 'true');
  await expect(hanging).toHaveCSS('animation-name', 'none');
  await page.mouse.move(x + 80, y);
  await expect.poll(() => hanging.evaluate((element) => element.style.getPropertyValue('--ticket-angle'))).toBe('8deg');
  await page.mouse.move(x, y);
  await expect.poll(() => hanging.evaluate((element) => element.style.getPropertyValue('--ticket-angle'))).toBe('0deg');
  await expect(hanging).toHaveAttribute('data-dragging', 'true');
  await expect(hanging).toHaveCSS('animation-name', 'none');
  await page.mouse.up();
  await expect(hanging).toHaveAttribute('data-dragging', 'false');
  for (const key of ['Enter', 'Space']) {
    await control.focus();
    await hanging.evaluate((element) => { element.dataset.replayMarker = 'before'; });
    await control.press(key);
    await expect(hanging).not.toHaveAttribute('data-replay-marker', 'before');
    await expect(control).toBeFocused();
  }
  await settleTicket(page);
  await page.locator('.not-found').screenshot({ path: 'test-results/admin-visual-evidence/not-found-desktop.png' });
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('404 reduced motion removes the control and reacts safely during a gesture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMissingPage(page);
  const control = page.getByRole('button', { name: controlName });
  const decoration = page.locator('.not-found__ticket-control[data-static="true"]');
  await expect(control).toHaveCount(0);
  await expect(decoration).toHaveAttribute('aria-hidden', 'true');
  await expect(decoration).not.toHaveAttribute('tabindex');
  await expect(page.locator('.not-found__hanging')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.not-found__hanging')).toHaveCSS('transform', 'none');
  await expect(page.locator('.not-found__hint')).toHaveCount(0);
  await page.locator('.not-found').screenshot({ path: 'test-results/admin-visual-evidence/not-found-reduced-motion.png' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.not-found__hanging')).toHaveAttribute('data-dragging', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(control).toHaveCount(0);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(control).toBeVisible();
  await expect(page.locator('.not-found__hanging')).toHaveAttribute('data-dragging', 'false');
  await expect.poll(() => page.locator('.not-found__hanging').evaluate((element) => element.style.getPropertyValue('--ticket-angle'))).toBe('0deg');
});

for (const width of [390, 320]) {
  test(`404 recovery reflows at ${width}px without blocking pinch zoom`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openMissingPage(page);
    await settleTicket(page);
    await expect(page.getByRole('button', { name: controlName })).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('.not-found').screenshot({ path: `test-results/admin-visual-evidence/not-found-${width}px.png` });
  });
}
