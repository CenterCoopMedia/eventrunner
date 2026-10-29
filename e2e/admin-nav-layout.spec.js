// Issue #477. The admin rail folds its groups and hides on a wide screen,
// and the Branding editor and preview share the row by a bar the reader
// moves. Each is checked by keyboard, in a real browser, at real widths.
/* global document, getComputedStyle */
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';

const pageWidth = (page) =>
  page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

test('the rail folds and hides by keyboard, and remembers it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/pages');
  await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
  const endTour = page.getByRole('button', { name: 'End tour', exact: true });
  if (await endTour.isVisible()) await endTour.click();

  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  const content = nav.getByRole('button', { name: 'Content', exact: true });
  const program = nav.getByRole('button', { name: 'Program', exact: true });
  await expect(content).toHaveAttribute('aria-expanded', 'true');
  await expect(program).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Sessions', exact: true })).toBeHidden();

  // Open Program from the keyboard, then follow a link in it.
  await program.focus();
  await page.keyboard.press('Enter');
  await expect(program).toHaveAttribute('aria-expanded', 'true');
  await expect(program).toBeFocused();
  const outline = await program.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline, 'the group head shows its focus').not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Sessions', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Sessions', exact: true })).toHaveAttribute('aria-current', 'page');

  // Close Content: the Pages page is not current now, so nothing names it.
  await content.click();
  await expect(content).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  await expect(content).toHaveAttribute('aria-expanded', 'false');
  await expect(program).toHaveAttribute('aria-expanded', 'true');

  // The rail's toggle is the first stop after the skip link.
  const toggle = page.getByRole('button', { name: 'Hide menu' });
  await page.locator('body').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const wideMain = (await page.locator('#admin-content').boundingBox()).width;
  await page.keyboard.press('Enter');
  const show = page.getByRole('button', { name: 'Show menu' });
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(nav).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/sessions$/);
  const railBox = await page.locator('.admin-rail').boundingBox();
  expect(railBox.width).toBeLessThan(120);
  expect((await page.locator('#admin-content').boundingBox()).width).toBeGreaterThan(wideMain + 100);
  // The global reduce block disables transitions, so the width changes immediately.
  const motion = await page.locator('.admin-rail').evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(motion)).toBeLessThanOrEqual(0.0001);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Show menu' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Show menu' }).click();
  await expect(nav).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide menu' })).toBeFocused();
});

test('the Branding bar resizes the panes by keyboard, keeps the frame width, and stacks on a phone', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  const endTour = page.getByRole('button', { name: 'End tour', exact: true });
  if (await endTour.isVisible()) await endTour.click();

  const bar = page.getByRole('separator', { name: 'Resize the editor and the preview' });
  const editor = page.locator('#admin-branding-editor');
  const preview = page.locator('.admin-branding-preview');
  await expect(bar).toHaveAttribute('aria-valuenow', '50');
  const before = (await editor.boundingBox()).width;
  await bar.focus();
  await expect(bar).toBeFocused();
  await page.keyboard.press('End');
  await expect(bar).toHaveAttribute('aria-valuenow', '70');
  // A key press on the bar makes its focus a keyboard focus, and it shows.
  const outline = await bar.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline, 'the bar shows its focus').not.toBe('none');
  const wider = (await editor.boundingBox()).width;
  expect(wider).toBeGreaterThan(before + 100);
  await page.keyboard.press('Home');
  await expect(bar).toHaveAttribute('aria-valuenow', '30');
  const narrow = (await editor.boundingBox()).width;
  expect(narrow).toBeLessThan(before - 100);
  // The minimum keeps both panes usable.
  expect(narrow).toBeGreaterThanOrEqual(300);
  expect((await preview.boundingBox()).width).toBeGreaterThanOrEqual(300);
  // The frame renders at the CSS width the operator picked, whatever its pane.
  await expect(page.locator('iframe[data-theme-proof]').first()).toHaveAttribute('width', '1440');

  // A drag moves it too, and a reload keeps the share.
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + 40, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(await bar.getAttribute('aria-valuenow'));
  expect(dragged).toBeGreaterThan(30);
  await page.reload();
  await expect(bar).toHaveAttribute('aria-valuenow', String(dragged));
  await page.getByRole('button', { name: 'Reset widths' }).click();
  await expect(bar).toHaveAttribute('aria-valuenow', '50');
  await expect(bar).toBeFocused();

  // Compare light and dark: one more bar, between the two frames.
  await page.getByLabel('Mode', { exact: true }).selectOption('compare');
  const frames = page.getByRole('separator', { name: 'Resize the light and dark previews' });
  await frames.focus();
  await page.keyboard.press('ArrowRight');
  await expect(frames).toHaveAttribute('aria-valuenow', '55');
  await expect(page.locator('iframe[data-theme-proof]')).toHaveCount(2);
  for (const frame of await page.locator('iframe[data-theme-proof]').all()) {
    await expect(frame).toHaveAttribute('width', '1440');
  }
  await page.keyboard.press('Enter');
  await expect(frames).toHaveAttribute('aria-valuenow', '50');

  // A screen at 200% zoom, and a 320px phone: the panes stack, the editor's
  // bar is gone, and nothing scrolls sideways.
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(bar).toHaveCount(0);
    const widths = await pageWidth(page);
    expect(widths.scroll, `no sideways scroll at ${width}`).toBeLessThanOrEqual(widths.client + 1);
  }
  // On a phone the Menu sheet holds the same folding groups.
  await page.locator('details.admin-mobile-docket > summary').click();
  const sheetNav = page.getByRole('navigation', { name: 'Admin sections' });
  const operations = sheetNav.getByRole('button', { name: 'Operations', exact: true });
  await operations.focus();
  await page.keyboard.press('Enter');
  await expect(operations).toHaveAttribute('aria-expanded', 'true');
  const link = sheetNav.getByRole('link', { name: 'Feedback', exact: true });
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(321);
  expect((await operations.boundingBox()).height).toBeGreaterThanOrEqual(44);
});
