// Hosted browser proof for the eager command menu; emulator identities only.
/* global window, HTMLDialogElement, getComputedStyle */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';

test.use({ hasTouch: true });

async function endTour(page) {
  const button = page.getByRole('button', { name: 'End tour', exact: true });
  if (await button.isVisible()) await button.click();
}

async function screenshot(page, name) {
  const directory = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name) });
}

test('first press, dirty-form choices and rich-editor shortcuts use the native menu without motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    let started = null;
    const timings = [];
    window.__commandOpenTimings = timings;
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) started = performance.now();
    }, true);
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      const result = showModal.call(this);
      if (this.hasAttribute('data-admin-command-menu') && started !== null) {
        timings.push(performance.now() - started);
        started = null;
      }
      return result;
    };
  });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/pages/home');
  const field = page.getByLabel('Navigation label', { exact: true });
  await expect(field).toBeVisible();
  await endTour(page);
  const shortcut = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta+k' : 'Control+k');
  const menu = page.getByRole('dialog', { name: 'Find work', exact: true });
  await field.focus();
  await page.keyboard.press(shortcut);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('combobox')).toBeFocused();
  expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await screenshot(page, 'command-menu-desktop-1440.png');
  await page.keyboard.press('Escape');
  await expect(field).toBeFocused();

  const edited = `${await field.inputValue()} local command proof`;
  await field.fill(edited);
  for (const choice of ['Stay', 'Discard changes']) {
    await page.keyboard.press(shortcut);
    await menu.getByRole('combobox').fill('Sessions');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    const guard = page.getByRole('alertdialog', { name: 'Unsaved changes', exact: true });
    await expect(guard).toBeVisible();
    await page.keyboard.press(shortcut);
    await expect(menu).toBeHidden();
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: choice, exact: true }).click();
    if (choice === 'Stay') {
      await expect(field).toHaveValue(edited);
      await expect(page).toHaveURL(/\/admin\/pages\/home$/);
      await field.focus();
    }
  }
  await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();
  const firstTimings = await page.evaluate(() => window.__commandOpenTimings);
  expect(firstTimings).toHaveLength(3);
  expect(firstTimings.every((ms) => ms < 100), JSON.stringify(firstTimings)).toBe(true);
  console.log('command-menu first/document open ms:', JSON.stringify(firstTimings));
  await testInfo.attach('first-and-editor-command-open-ms', { body: JSON.stringify(firstTimings), contentType: 'application/json' });

  await page.goto('/admin/content/city_guide/city_guide_intro/welcome');
  const editor = page.locator('.ql-editor').first();
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press(shortcut);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await page.getByRole('button', { name: 'Hide menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show menu', exact: true })).toBeVisible();
  await editor.focus();
  await page.keyboard.press(shortcut);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();

  const timings = await page.evaluate(() => window.__commandOpenTimings);
  expect(timings).toHaveLength(2);
  // The hard navigation starts a new document: both rich-editor presses are
  // recorded here. The first document's samples are checked before leaving it.
  expect(timings.every((ms) => ms < 100), JSON.stringify(timings)).toBe(true);
  console.log('command-menu rich-editor open ms:', JSON.stringify(timings));
  await testInfo.attach('rich-editor-command-open-ms', { body: JSON.stringify(timings), contentType: 'application/json' });
});

test('the phone control closes the docket first, restores focus and leaves Mac Control+K alone', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/pages/home');
  const field = page.getByLabel('Navigation label', { exact: true });
  await expect(field).toBeVisible();
  await endTour(page);
  const docket = page.locator('details.admin-mobile-docket');
  const summary = docket.locator(':scope > summary');
  await summary.tap();
  await page.getByRole('button', { name: 'Find work', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: 'Find work', exact: true });
  await expect(menu).toBeVisible();
  await expect(docket).not.toHaveAttribute('open');
  await expect(page.locator('#admin-content')).not.toHaveAttribute('inert');
  await expect(menu.getByRole('combobox')).toBeFocused();
  expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  const bounds = await menu.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await screenshot(page, 'command-menu-touch-390.png');
  await menu.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(summary).toBeFocused();
  await field.focus();
  await page.keyboard.press('Control+k');
  await expect(menu).toBeHidden();
  await field.focus();
  await page.keyboard.press('Meta+k');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(field).toBeFocused();
});
