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
      await expect(stressedHome.locator('.event-hero__title')).toContainText(
        'The Fifteenth Annual Regional Convening',
      );
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
      const optionalControls = stressedSchedule.locator('.schedule-optional-controls');
      await expect(optionalControls).not.toHaveAttribute('open', '');
      const filtersSummary = optionalControls.locator('summary');
      await expect(filtersSummary).toBeVisible();
      expect((await filtersSummary.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await filtersSummary.press('Enter');
      await expect(stressedSchedule.getByText('Format', { exact: true })).toBeVisible();
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

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 606 } });
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

    await publicPage.goto('/schedule');
    await expect(publicPage.locator('.session-block').first()).toBeVisible();
    const firstPublicSession = await publicPage.locator('.session-block').first().evaluate(
      (element) => ({
        top: element.getBoundingClientRect().top,
        viewportHeight: element.ownerDocument.defaultView.innerHeight,
      }),
    );
    expect(firstPublicSession.viewportHeight).toBe(606);
    expect(firstPublicSession.top).toBeLessThan(firstPublicSession.viewportHeight);
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

  await page.getByLabel('Site style').selectOption('newsroom');
  await page.getByRole('button', { name: 'Schedule' }).click();
  const scheduleFrame = page.frameLocator(
    'iframe[title="Schedule preview, light mode, 390px wide"]',
  );
  await expect(scheduleFrame.locator('.schedule-screen')).toBeVisible();
  await expect(scheduleFrame.locator('.schedule-grid')).toHaveCount(0);
  await expect(scheduleFrame.locator('.event-hero')).toHaveClass(/event-hero--compact/);
  await expect(scheduleFrame.locator('.schedule-optional-controls')).not.toHaveAttribute('open', '');
  const firstSession = await scheduleFrame.locator('.session-block').first().evaluate(
    (element) => ({
      top: element.getBoundingClientRect().top,
      viewportHeight: element.ownerDocument.defaultView.innerHeight,
    }),
  );
  expect(firstSession.top).toBeLessThan(firstSession.viewportHeight);
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

test('phone admin uses a compact bar and full-width sheet on every page', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 412, height: 844 });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();

  const docket = page.locator('details.admin-mobile-docket');
  await expect(docket).not.toHaveAttribute('open', '');
  const summary = docket.locator('summary');
  await expect(page.locator('.admin-rail')).toContainText('E2E Summit');
  await expect(summary).toContainText('Branding');
  await expect(summary).toContainText('Menu');

  await summary.click();
  await expect(docket).toHaveAttribute('open', '');
  const links = docket.getByRole('navigation', { name: 'Admin sections' }).getByRole('link');
  await expect(links).toHaveCount(25);
  await expect(docket.getByText(ADMIN_EMAIL)).toBeVisible();
  await expect(docket.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('#admin-content')).toHaveAttribute('inert', '');
  const pageScroll = await page.evaluate(() => document.defaultView.scrollY);
  await summary.press('PageDown');
  await expect.poll(() => page.evaluate(() => document.defaultView.scrollY)).toBe(pageScroll);

  const drawerEvidence = await page.evaluate(() => {
    const sheetElement = document.querySelector('.admin-mobile-docket__content');
    const navLinks = [...sheetElement.querySelectorAll('nav a')];
    const box = sheetElement.getBoundingClientRect();
    return {
      position: getComputedStyle(sheetElement).position,
      top: box.top,
      bottom: box.bottom,
      viewportHeight: document.defaultView.innerHeight,
      groupLabels: [...sheetElement.querySelectorAll('.admin-folio')].map((label) => label.textContent),
      rows: navLinks.map((link) => ({
        label: link.textContent.trim(),
        href: link.getAttribute('href'),
        height: link.getBoundingClientRect().height,
        width: link.getBoundingClientRect().width,
        parentWidth: link.parentElement.getBoundingClientRect().width,
      })),
    };
  });
  expect(drawerEvidence.position).toBe('fixed');
  expect(drawerEvidence.top).toBe(56);
  expect(drawerEvidence.bottom).toBe(drawerEvidence.viewportHeight);
  expect(drawerEvidence.groupLabels).toEqual(['Content', 'People', 'Operations', 'System']);
  for (const row of drawerEvidence.rows) {
    expect(row.height, row.label).toBeGreaterThanOrEqual(44);
    expect(row.width, row.label).toBe(row.parentWidth);
  }
  await testInfo.attach('phone-admin-drawer.json', {
    body: Buffer.from(`${JSON.stringify(drawerEvidence, null, 2)}\n`),
    contentType: 'application/json',
  });

  const destinations = await links.evaluateAll((elements) => elements.map((link) => ({
    label: link.textContent.trim(),
    href: link.getAttribute('href'),
  })));
  await docket.getByRole('button', { name: 'Take the tour' }).click();
  await expect(docket).not.toHaveAttribute('open', '');
  await expect(page.locator('#admin-content')).not.toHaveAttribute('inert', '');
  const tour = page.getByRole('complementary', { name: 'Admin tour' });
  await expect(tour).toBeVisible();
  await expect(tour.getByRole('heading', { name: 'Welcome to the admin panel' })).toBeFocused();
  await tour.getByRole('button', { name: 'End tour' }).click();

  await summary.click();
  const overviewLink = docket.getByRole('link', { name: 'Overview', exact: true });
  await overviewLink.focus();
  await overviewLink.press('Enter');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(docket).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();

  const pageEvidence = [];
  for (const destination of destinations) {
    await page.goto(destination.href);
    await expect(page.locator('.admin-room')).toBeVisible();
    const routeDocket = page.locator('details.admin-mobile-docket');
    await expect(routeDocket).not.toHaveAttribute('open', '');
    await expect(routeDocket.locator('summary [title]')).toHaveAttribute('title', destination.label);
    const metrics = await page.evaluate(() => {
      const railBox = document.querySelector('.admin-rail').getBoundingClientRect();
      const mainBox = document.querySelector('#admin-content').getBoundingClientRect();
      return {
        railHeight: railBox.height,
        mainTop: mainBox.top,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(metrics.railHeight, destination.label).toBe(56);
    expect(metrics.mainTop, destination.label).toBe(56);
    expect(metrics.scrollWidth, destination.label).toBe(metrics.clientWidth);
    pageEvidence.push({ ...destination, ...metrics });
  }
  await testInfo.attach('phone-admin-pages.json', {
    body: Buffer.from(`${JSON.stringify(pageEvidence, null, 2)}\n`),
    contentType: 'application/json',
  });

  await page.goto('/admin/branding');
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
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
  expect(measurements.railHeight).toBe(56);
  expect(measurements.jobPosition).toBe('static');
  expect(measurements.actionPadding).toBe(8);
  expect(measurements.controlsInside).toBe(true);
});
