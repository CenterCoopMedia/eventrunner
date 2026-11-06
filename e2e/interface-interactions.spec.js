// Real public components with controlled responses; GitHub-hosted CI only.
// No feedback leaves the browser: every submission is intercepted here.
/* global getComputedStyle, window */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, APP_BASE_URL, signIn } from './helpers.mjs';

const EVIDENCE = path.resolve('test-results/admin-visual-evidence');
const THEMES = ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine'];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function capture(page, name) {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `interface-${name}.png`) });
}

async function openFeedback(page) {
  await page.goto('/specimen');
  const opener = page.getByRole('button', { name: 'Open the real dialog', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Share feedback' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
  return { dialog, opener };
}

for (const width of [1440, 390, 320]) {
  test(`feedback retains focus, work and its result at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.emulateMedia({ reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    const first = deferred();
    const payloads = [];
    await page.route('**/submitFeedback', async (route) => {
      const headers = {
        'access-control-allow-origin': APP_BASE_URL,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      payloads.push(route.request().postDataJSON());
      if (payloads.length === 1) {
        await first.promise;
        return route.fulfill({ status: 503, headers, json: { error: { message: 'We could not confirm receipt. Try again.' } } });
      }
      return route.fulfill({ headers, json: { id: 'feedback-browser-proof' } });
    });

    try {
      const { dialog, opener } = await openFeedback(page);
      const message = dialog.getByRole('textbox', { name: 'Message', exact: true });
      const email = dialog.getByRole('textbox', { name: 'Email (optional)' });
      const category = dialog.getByRole('combobox', { name: 'What is this about?' });
      const send = dialog.getByRole('button', { name: 'Send feedback', exact: true });

      // Native modality and shared boundary handling keep both directions
      // inside the dialog, including browsers that otherwise focus the page.
      await send.focus();
      await page.keyboard.press('Tab');
      await expect(category).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(send).toBeFocused();
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
      if (width === 320) await expect(dialog).toHaveCSS('animation-name', 'none');

      await message.fill('Please make the room directions easier to find on the schedule.');
      await email.fill('reader@example.test');
      await capture(page, `feedback-form-${width}`);
      await send.click();
      const sending = dialog.getByRole('button', { name: 'Sending feedback…', exact: true });
      await expect(sending).toHaveAttribute('aria-busy', 'true');
      await expect(sending).toBeFocused();
      await expect(message).toHaveAttribute('readonly', '');
      await expect(email).toHaveAttribute('readonly', '');
      await expect(category).toBeDisabled();
      await expect(dialog.getByRole('status')).toContainText('Sending your feedback');
      await page.keyboard.press('Tab');
      await expect(message).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(sending).toBeFocused();
      // Pending controls remain keyboard reachable, but cannot repeat or
      // discard an unresolved submission.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await expect.poll(() => payloads.length).toBe(1);
      await expect(dialog.locator('.loading-status__activity')).toBeVisible();
      await capture(page, `feedback-pending-${width}`);

      first.resolve();
      await expect(dialog.getByRole('alert')).toHaveText('We could not confirm receipt. Try again.');
      await expect(message).toHaveValue('Please make the room directions easier to find on the schedule.');
      await expect(email).toHaveValue('reader@example.test');
      await expect(message).not.toHaveAttribute('readonly');
      await capture(page, `feedback-retry-${width}`);
      await send.click();
      const receipt = page.getByRole('heading', { name: 'Thanks for letting us know' });
      await expect(receipt).toBeFocused();
      await expect(page.getByText('We got your feedback.', { exact: false })).toBeVisible();
      expect(payloads).toHaveLength(2);
      expect(payloads[1].submissionKey).toBe(payloads[0].submissionKey);
      await capture(page, `feedback-receipt-${width}`);
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    } finally {
      first.resolve();
    }
  });
}

function contrast(foreground, background) {
  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

for (const width of [1440, 390, 320]) {
  test(`loading previews explain elapsed waits and keep each shape usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/specimen');
    const preview = page.locator('[data-loading-preview]');
    const stage = preview.getByLabel('Loading preview stage');
    const layout = preview.getByLabel('Loading preview layout');
    const indicator = preview.locator('.loading-status__activity');
    await expect(stage).toHaveValue('initial');
    await expect(preview.getByRole('status')).toHaveText('Loading the schedule…');
    await expect(indicator).toHaveCount(0);
    await stage.selectOption('active');
    await expect(indicator).toHaveCSS('animation-name', 'loading-status-turn');
    await stage.selectOption('slow');
    await expect(preview.getByRole('status')).toContainText('longer than usual');
    await expect(preview.getByRole('progressbar')).toHaveCount(0);

    for (const shape of ['rows', 'schedule', 'directory']) {
      await layout.selectOption(shape);
      const placeholder = preview.locator('.loading-state__placeholder');
      await expect(placeholder).toHaveAttribute('aria-hidden', 'true');
      await expect(placeholder).toHaveAttribute('data-loading-shape', shape);
      expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (shape === 'directory') {
        // auto-fit exposes collapsed zero-width tracks in computed CSS.
        // Count the occupied tracks, rather than mistaking those for columns.
        const columns = await placeholder.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter((size) => Number.parseFloat(size) > 0).length);
        expect(columns).toBe(width === 1440 ? 3 : 1);
      }
      await preview.scrollIntoViewIfNeeded();
      await capture(page, `loading-${shape}-${width}`);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(indicator).toHaveCSS('animation-name', 'none');
    await expect(preview.getByRole('status')).toContainText('longer than usual');
    await stage.selectOption('prolonged');
    await expect(preview.getByRole('status')).toContainText('after a minute');
    await expect(preview.getByRole('button')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(indicator).toHaveCSS('animation-name', 'none');
    await capture(page, `loading-continued-wait-${width}`);
  });
}

test('shared public controls keep readable edges across generated presets and modes', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { dialog } = await openFeedback(page);
  const results = [];
  for (const theme of THEMES) {
    for (const mode of ['light', 'dark']) {
      // The shipped scoped preset selectors override inherited root brand
      // tokens on this dialog. Changing only html data-theme would keep the
      // live event's more-specific runtime palette and measure it six times.
      // Runtime branding is covered by theme-responsive.spec.js. No stored
      // config changes, and live provider updates cannot race this scope.
      await dialog.evaluate((element, { selectedTheme, selectedMode }) => {
        element.dataset.theme = selectedTheme;
        element.dataset.mode = selectedMode;
      }, { selectedTheme: theme, selectedMode: mode });
      const colors = await dialog.evaluate((element) => {
        const secondary = getComputedStyle(element.querySelector('button[type="button"]'));
        const primary = getComputedStyle(element.querySelector('button[type="submit"]'));
        return {
          secondaryInk: secondary.color, secondaryGround: secondary.backgroundColor,
          secondaryEdge: secondary.borderTopColor,
          primaryInk: primary.color, primaryGround: primary.backgroundColor,
        };
      });
      const ratios = {
        theme, mode,
        palette: `${colors.primaryGround}|${colors.secondaryGround}|${colors.secondaryEdge}`,
        edge: contrast(colors.secondaryEdge, colors.secondaryGround),
        secondaryText: contrast(colors.secondaryInk, colors.secondaryGround),
        primaryText: contrast(colors.primaryInk, colors.primaryGround),
      };
      expect(ratios.edge, `${theme}/${mode} secondary boundary`).toBeGreaterThanOrEqual(3);
      expect(ratios.secondaryText, `${theme}/${mode} secondary label`).toBeGreaterThanOrEqual(4.5);
      expect(ratios.primaryText, `${theme}/${mode} primary label`).toBeGreaterThanOrEqual(4.5);
      results.push(ratios);
    }
  }
  expect(new Set(results.map((result) => result.palette)).size).toBeGreaterThan(2);
  await testInfo.attach('shared-control-contrast', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});

test('press motion disappears under reduced motion and focus stays visible in forced colors', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const { dialog } = await openFeedback(page);
  const send = dialog.getByRole('button', { name: 'Send feedback', exact: true });
  await send.scrollIntoViewIfNeeded();
  const box = await send.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(send).not.toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(send).toHaveCSS('transform', 'none');
  await expect(send).toHaveCSS('transition-duration', '0s');
  // Move away before release so this proof does not submit an empty form.
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.emulateMedia({ forcedColors: 'active' });
  await send.focus();
  await page.keyboard.press('Tab');
  const category = dialog.getByRole('combobox', { name: 'What is this about?' });
  await expect(category).toBeFocused();
  expect(await category.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
  await capture(page, 'feedback-forced-colors');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('touch admin fields retain readable type without disabling browser zoom', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL: APP_BASE_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/settings');
    const field = page.getByLabel('Event name', { exact: true });
    await expect(field).toBeVisible();
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/);
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    await capture(page, 'admin-touch-fields-390');
  } finally {
    await context.close();
  }
});
