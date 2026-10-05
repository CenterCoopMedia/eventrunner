// Responsive theme proof and mobile admin regressions (issue #316).
//
// The proof must own a real browsing context. A fixed-width element cannot
// activate viewport media queries, and a scoped variable block cannot reset
// color inherited from the surrounding admin. These checks run in Chromium
// because jsdom does not implement iframe viewport geometry or CSS layout.
/* global document, getComputedStyle */
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

const THEMES = ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine'];

function rgbFromChannels(channels) {
  const values = channels.trim().split(/\s+/).map(Number);
  return `rgb(${values.join(', ')})`;
}

function contrastRatio(foreground, background) {
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

async function openPhoneProof(page) {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  // The editor first paints from the committed snapshot, then adopts the
  // live config/theme document. Measure only after that adoption so the
  // candidate and the public page are the same saved document.
  await expect(page.getByLabel('Site style')).toHaveValue('civic');
  await page.getByRole('button', { name: 'Phone (390px)' }).click();
  const iframe = page.locator('iframe[title="Home preview, light mode, 390px wide"]');
  await expect(iframe).toBeVisible();
  return iframe;
}

test('phone proof uses its own viewport and public inheritance for every theme and mode', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  let iframe = await openPhoneProof(page);
  const renderedContrast = [];

  for (const theme of THEMES) {
    await page.getByLabel('Site style').selectOption(theme);
    for (const mode of ['light', 'dark']) {
      await page.getByRole('button', {
        name: mode === 'light' ? 'Light' : 'Dark',
        exact: true,
      }).click();
      iframe = page.locator(
        `iframe[title="Home preview, ${mode} mode, 390px wide"]`,
      );
      await expect(iframe).toBeVisible();
      const frame = page.frameLocator(`iframe[title="Home preview, ${mode} mode, 390px wide"]`);
      await expect(frame.locator('.event-hero__title')).toBeVisible();

      const metrics = await iframe.evaluate((element) => {
        const view = element.contentWindow;
        const doc = element.contentDocument;
        const rootStyle = view.getComputedStyle(doc.documentElement);
        const surface = doc.querySelector('.page-surface');
        return {
          innerWidth: view.innerWidth,
          clientWidth: doc.documentElement.clientWidth,
          scrollWidth: doc.documentElement.scrollWidth,
          theme: doc.documentElement.dataset.theme,
          mode: doc.documentElement.dataset.mode,
          surfaceColor: view.getComputedStyle(surface).color,
          surfaceBackground: view.getComputedStyle(surface).backgroundColor,
          primaryChannels: rootStyle.getPropertyValue('--color-text-primary-rgb'),
          titleSize: Number.parseFloat(
            view.getComputedStyle(doc.querySelector('.event-hero__title')).fontSize,
          ),
        };
      });

      expect(metrics.innerWidth).toBe(390);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.theme).toBe(theme);
      expect(metrics.mode).toBe(mode);
      expect(metrics.surfaceColor).toBe(rgbFromChannels(metrics.primaryChannels));
      expect(metrics.titleSize).toBeLessThanOrEqual(54);
      const ratio = contrastRatio(metrics.surfaceColor, metrics.surfaceBackground);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      renderedContrast.push({
        theme,
        mode,
        foreground: metrics.surfaceColor,
        background: metrics.surfaceBackground,
        ratio: Number(ratio.toFixed(2)),
      });

      // The long title and dense schedule are the preview's two hostile
      // fixtures. Exercise both while every theme/mode pair is active so a
      // preset cannot pass on the short demo copy alone.
      await page.getByRole('button', { name: 'Stress test' }).click();
      const stressedHome = page.frameLocator(
        `iframe[title="Home preview, ${mode} mode, 390px wide"]`,
      );
      await expect(stressedHome.locator('.event-hero__title')).toBeVisible();
      expect(await iframe.evaluate((element) => ({
        clientWidth: element.contentDocument.documentElement.clientWidth,
        scrollWidth: element.contentDocument.documentElement.scrollWidth,
      }))).toEqual({ clientWidth: 390, scrollWidth: 390 });

      await page.getByRole('button', { name: 'Schedule' }).click();
      const stressedSchedule = page.frameLocator(
        `iframe[title="Schedule preview, ${mode} mode, 390px wide"]`,
      );
      await expect(stressedSchedule.locator('.event-hero__title')).toContainText(
        'The Fifteenth Annual Regional Convening',
      );
      await expect(stressedSchedule.locator('.session-block')).toHaveCount(28);
      const stressedScheduleFrame = page.locator(
        `iframe[title="Schedule preview, ${mode} mode, 390px wide"]`,
      );
      expect(await stressedScheduleFrame.evaluate((element) => ({
        clientWidth: element.contentDocument.documentElement.clientWidth,
        scrollWidth: element.contentDocument.documentElement.scrollWidth,
      }))).toEqual({ clientWidth: 390, scrollWidth: 390 });

      await page.getByRole('button', { name: 'Home' }).click();
      await page.getByRole('button', { name: 'Real content' }).click();
    }
  }

  await testInfo.attach('rendered-phone-preview-contrast.json', {
    body: Buffer.from(`${JSON.stringify(renderedContrast, null, 2)}\n`),
    contentType: 'application/json',
  });
});

test('phone proof matches the public phone geometry and uses the narrow Schedule view', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const iframe = await openPhoneProof(page);
  const previewMetrics = await iframe.evaluate((element) => {
    const view = element.contentWindow;
    const doc = element.contentDocument;
    const title = doc.querySelector('.event-hero__title');
    return {
      titleWidth: title.getBoundingClientRect().width,
      titleSize: view.getComputedStyle(title).fontSize,
      titleFamily: view.getComputedStyle(title).fontFamily,
      titleLineHeight: view.getComputedStyle(title).lineHeight,
      titleColor: view.getComputedStyle(title).color,
      clientWidth: doc.documentElement.clientWidth,
      scrollWidth: doc.documentElement.scrollWidth,
    };
  });

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto('/');
    await expect(publicPage.locator('html')).toHaveAttribute('data-theme', 'civic');
    await expect(publicPage.locator('.event-hero__title')).toBeVisible();
    const publicMetrics = await publicPage.evaluate(() => {
      const title = document.querySelector('.event-hero__title');
      return {
        titleWidth: title.getBoundingClientRect().width,
        titleSize: getComputedStyle(title).fontSize,
        titleFamily: getComputedStyle(title).fontFamily,
        titleLineHeight: getComputedStyle(title).lineHeight,
        titleColor: getComputedStyle(title).color,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(previewMetrics).toEqual(publicMetrics);
  } finally {
    await publicContext.close();
  }

  await page.getByRole('button', { name: 'Actual size' }).click();
  expect(await iframe.evaluate((element) => element.contentWindow.innerWidth)).toBe(390);
  await page.getByRole('button', { name: 'Compare light and dark' }).click();
  for (const mode of ['light', 'dark']) {
    const compared = page.locator(`iframe[title="Home preview, ${mode} mode, 390px wide"]`);
    await expect(compared).toBeVisible();
    expect(await compared.evaluate((element) => ({
      innerWidth: element.contentWindow.innerWidth,
      clientWidth: element.contentDocument.documentElement.clientWidth,
      scrollWidth: element.contentDocument.documentElement.scrollWidth,
    }))).toEqual({ innerWidth: 390, clientWidth: 390, scrollWidth: 390 });
  }
  await page.getByRole('button', { name: 'Light', exact: true }).click();

  await page.getByRole('button', { name: 'Schedule' }).click();
  const scheduleFrame = page.frameLocator(
    'iframe[title="Schedule preview, light mode, 390px wide"]',
  );
  await expect(scheduleFrame.locator('.schedule-screen')).toBeVisible();
  await expect(scheduleFrame.locator('.schedule-grid')).toHaveCount(0);
  await expect(scheduleFrame.locator('.event-hero')).toHaveClass(/event-hero--compact/);
});

test('a light proof keeps public inheritance inside a dark admin', async ({ page }) => {
  test.setTimeout(90_000);
  const themeRef = adminDb().doc('config/theme');
  const snapshot = await themeRef.get();
  const saved = snapshot.exists ? snapshot.data() : null;
  try {
    await themeRef.set({ ...saved, mode: 'dark' });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/branding');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
    await page.getByRole('button', { name: 'Phone (390px)' }).click();
    await page.getByRole('button', { name: 'Light', exact: true }).click();

    const iframe = page.locator('iframe[title="Home preview, light mode, 390px wide"]');
    await expect(iframe).toBeVisible();
    const preview = await iframe.evaluate((element) => {
      const view = element.contentWindow;
      const doc = element.contentDocument;
      const surface = doc.querySelector('.page-surface');
      const rootStyle = view.getComputedStyle(doc.documentElement);
      return {
        mode: doc.documentElement.dataset.mode,
        color: view.getComputedStyle(surface).color,
        background: view.getComputedStyle(surface).backgroundColor,
        primaryChannels: rootStyle.getPropertyValue('--color-text-primary-rgb'),
      };
    });
    const adminColor = await page.locator('.admin-room').evaluate((element) => getComputedStyle(element).color);

    expect(preview.mode).toBe('light');
    expect(preview.color).toBe(rgbFromChannels(preview.primaryChannels));
    expect(preview.color).not.toBe(adminColor);
    expect(contrastRatio(preview.color, preview.background)).toBeGreaterThanOrEqual(4.5);
  } finally {
    if (saved) await themeRef.set(saved);
    else await themeRef.delete();
  }
});

test('phone admin opens on the work and keeps populated controls inside the viewport', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 400, height: 606 });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();

  const docket = page.locator('details.admin-mobile-docket');
  await expect(docket).not.toHaveAttribute('open', '');
  await expect(docket.locator('summary')).toContainText('Branding');
  const populatedBrandColor = `#${[18, 52, 86]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
  await page.getByLabel('Main brand colour').fill(populatedBrandColor);
  await expect(page.getByLabel('Main brand colour picker')).toBeVisible();
  await page.getByLabel('Primary logo').fill(
    'branding/a-populated-logo-path-with-a-long-unbroken-file-name-for-phone-width.svg',
  );
  await page.getByLabel('Square icon').fill(
    'branding/a-populated-square-icon-path-with-a-long-unbroken-file-name.png',
  );
  await page.getByRole('button', { name: 'Show the advanced settings' }).click();

  const measurements = await page.evaluate(() => {
    const visibleControls = [...document.querySelectorAll('input, select, button')]
      .filter((element) => element.getClientRects().length > 0);
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      railHeight: document.querySelector('.admin-rail').getBoundingClientRect().height,
      jobPosition: getComputedStyle(document.querySelector('.admin-job-line')).position,
      actionPadding: Number.parseFloat(
        getComputedStyle(document.querySelector('.admin-job-line__actions > *')).paddingLeft,
      ),
      controlsInside: visibleControls.every((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= document.documentElement.clientWidth;
      }),
    };
  });

  expect(measurements.scrollWidth).toBe(measurements.clientWidth);
  expect(measurements.railHeight).toBeLessThan(180);
  expect(measurements.jobPosition).toBe('static');
  expect(measurements.actionPadding).toBe(8);
  expect(measurements.controlsInside).toBe(true);
});
