// Read-only Content navigation and responsive evidence against the seeded
// emulator. No page, section, block, or publication state is changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

async function captureWorkspace(page, evidenceDir, name, viewport) {
  await page.setViewportSize(viewport);
  await page.locator('html').evaluate((element) => {
    element.ownerDocument.defaultView.scrollTo(0, 0);
    return element.ownerDocument.fonts.ready;
  });
  const geometry = await page.locator('#admin-content').evaluate((main) => {
    const root = main.ownerDocument.documentElement;
    const visible = (element) => element.getClientRects().length > 0;
    return {
      viewport: root.clientWidth,
      page: root.scrollWidth,
      panelsFit: [...main.querySelectorAll('.admin-content-browser__panel')]
        .every((panel) => panel.scrollWidth <= panel.clientWidth + 1),
      controlsFit: [...main.querySelectorAll('a, input, button')].filter(visible).every((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= -1 && box.right <= root.clientWidth + 1;
      }),
    };
  });
  expect(geometry.page, `${name} page width at ${viewport.width}`).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.panelsFit, `${name} rows contain their content at ${viewport.width}`).toBe(true);
  expect(geometry.controlsFit, `${name} controls fit at ${viewport.width}`).toBe(true);
  await page.screenshot({
    path: path.join(evidenceDir, `${name}-${viewport.width}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

test('Content has readable page and section indexes at desktop and narrow widths, with a keyboard route to a section', async ({ page }) => {
  test.setTimeout(120_000);
  const [live, draft] = await Promise.all([
    adminDb().doc('cmsPages/home').get(),
    adminDb().doc('cmsPages_drafts/home').get(),
  ]);
  const home = draft.exists ? draft.data() : live.data();
  expect(home?.sections?.length, 'the synthetic home page has authored sections').toBeGreaterThan(0);
  const pageName = home.label || 'home';
  const section = home.sections[0];
  const sectionName = section.label || section.id;
  const sectionRoute = `/admin/content/home/${encodeURIComponent(section.id)}`;
  const evidenceDir = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/content');
  await expect(page.getByRole('heading', { level: 1, name: 'Content', exact: true })).toBeVisible();
  const endTour = page.getByRole('button', { name: 'End tour', exact: true });
  if (await endTour.isVisible()) await endTour.click();

  for (const viewport of [
    { width: 1440, height: 1080 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.goto('/admin/content');
    const index = page.getByRole('table', { name: 'Pages, their content sections, and page publication states.' });
    const homeLink = index.getByRole('link', { name: pageName, exact: true });
    await expect(homeLink).toBeVisible();
    await expect(index.getByRole('list', { name: `Sections in ${pageName}`, exact: true }).getByRole('link'))
      .toHaveCount(home.sections.length);
    await expect(page.getByRole('searchbox', { name: 'Search pages and sections' })).toBeVisible();
    await captureWorkspace(page, evidenceDir, 'cms-content-index', viewport);

    await homeLink.click();
    await expect(page.getByRole('heading', { level: 1, name: pageName, exact: true })).toBeVisible();
    const sections = page.getByRole('list', { name: `Sections in ${pageName}`, exact: true });
    await expect(sections.getByRole('listitem')).toHaveCount(home.sections.length);
    await expect(sections.getByText('Loading blocks…', { exact: true })).toHaveCount(0);
    await expect(sections.getByText('Block count unavailable', { exact: true })).toHaveCount(0);
    if (section.description) await expect(sections.getByText(section.description, { exact: true })).toBeVisible();
    await captureWorkspace(page, evidenceDir, 'cms-content-sections', viewport);
  }

  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/admin/content');
  const search = page.getByRole('searchbox', { name: 'Search pages and sections' });
  await search.focus();
  await search.pressSequentially(sectionName);
  const directLink = page.getByRole('table').getByRole('list', { name: `Sections in ${pageName}`, exact: true })
    .getByRole('link').first();
  await expect(directLink).toHaveAttribute('href', sectionRoute);
  await search.press('Tab');
  const clear = page.getByRole('button', { name: 'Clear search', exact: true });
  await expect(clear).toBeFocused();
  await clear.press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await directLink.focus();
  await expect(directLink).toBeFocused();
  const focus = await directLink.evaluate((element) => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThan(0);
  await captureWorkspace(page, evidenceDir, 'cms-content-keyboard', { width: 1440, height: 1080 });
  const destination = new URL(sectionRoute, page.url()).href;
  await directLink.press('Enter');
  await expect(page).toHaveURL(destination);
  await expect(page.getByRole('heading', { level: 1, name: sectionName, exact: true })).toBeVisible();
});
