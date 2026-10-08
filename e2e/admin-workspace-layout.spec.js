// Read-only synthetic workspace evidence: real geometry across admin tasks.
/* global document */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

async function firstId(collection) {
  const snapshot = await adminDb().collection(collection).limit(1).get();
  expect(snapshot.empty, `the synthetic ${collection} fixture exists`).toBe(false);
  return snapshot.docs[0].id;
}

test('admin workspaces fill desktop width and group readable cards without narrow overflow', async ({ page }) => {
  test.setTimeout(180_000);
  const [sessionId, organizationId, speakerId, event] = await Promise.all([
    firstId('cmsSchedule'), firstId('cmsOrganizations'), firstId('speakers'),
    adminDb().doc('config/event').get(),
  ]);
  await signIn(page, ADMIN_EMAIL);
  const evidenceDir = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  const tasks = [
    { name: 'page-editor', route: '/admin/pages/home', ready: '.admin-page-basics', cards: '.admin-page-basics > .admin-panel', count: 2 },
    { name: 'content-editor', route: '/admin/content/home/hero/title', ready: '.admin-content-editor-layout', cards: '.admin-content-editor-layout > .admin-panel', count: 2 },
    { name: 'session-editor', route: `/admin/sessions/${encodeURIComponent(sessionId)}`, ready: '.admin-editor-layout--session', cards: '.admin-editor-layout--session .admin-panel', count: 4 },
    { name: 'speaker-editor', route: `/admin/speakers/${encodeURIComponent(speakerId)}`, ready: '.admin-editor-layout--speaker', cards: '.admin-editor-layout--speaker > .admin-panel', count: 3 },
    { name: 'organization-editor', route: `/admin/organizations/${encodeURIComponent(organizationId)}`, ready: '.admin-editor-layout--organization', cards: '.admin-editor-layout--organization .admin-panel', count: 3 },
    { name: 'event-settings', route: '/admin/settings', ready: '.admin-settings-groups' },
    { name: 'feature-settings', route: '/admin/features', ready: '.admin-feature-groups' },
    { name: 'branding', route: '/admin/branding', ready: '.admin-branding-workspace' },
  ];
  for (const task of tasks) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(task.route);
    await expect(page.locator(task.ready)).toBeVisible();
    if (task.cards) await expect(page.locator(task.cards)).toHaveCount(task.count);
    if (task.name === 'event-settings') {
      await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(event.data().name);
      // An additional unsaved day exercises nested row-card widths; no save occurs.
      await page.getByRole('button', { name: 'Add day', exact: true }).click();
    }
    if (task.name === 'content-editor') await page.getByRole('button', { name: 'Edit block settings', exact: true }).click();
    if (task.name === 'branding') {
      await expect(page.getByLabel('Site style')).toHaveValue('civic');
      await page.getByRole('button', { name: 'Page style', exact: true }).click();
      await expect(page.frameLocator('iframe[data-theme-proof]').first().locator('.event-hero__title')).toBeVisible();
    }
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    if (task.name === 'page-editor') {
      await page.locator('.admin-rail').evaluate((element) => { element.scrollTop = 0; });
      await page.locator('html').evaluate((element) => element.ownerDocument.fonts.ready);
      await page.screenshot({ path: path.join(evidenceDir, 'page-editor-collapsed-desktop-1920.png'), fullPage: true, animations: 'disabled' });
      await page.locator('.admin-page-section-list > li > .admin-editor-disclosure > h3 > button').first().click();
      await page.getByRole('button', { name: /Allowed block types Choose/ }).first().click();
    }
    for (const viewport of [
      { name: 'desktop', width: 1920, height: 1080 },
      { name: 'ultrawide', width: 2560, height: 1440 },
      { name: 'narrow', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.locator('.admin-rail').evaluate((element) => { element.scrollTop = 0; });
      await page.locator('html').evaluate((element) => {
        element.ownerDocument.defaultView.scrollTo(0, 0);
        return element.ownerDocument.fonts.ready;
      });
      const geometry = await page.evaluate(() => {
        const main = document.getElementById('admin-content').getBoundingClientRect();
        const canvas = document.querySelector('.admin-stone').getBoundingClientRect();
        const controls = [...document.querySelectorAll('#admin-content input, #admin-content select, #admin-content textarea, #admin-content button')]
          .filter((control) => control.getClientRects().length > 0);
        return {
          canvasWidth: canvas.width, mainWidth: main.width,
          viewportWidth: document.documentElement.clientWidth, pageWidth: document.documentElement.scrollWidth,
          cardsFit: [...document.querySelectorAll('#admin-content .admin-panel')]
            .filter((card) => card.getClientRects().length > 0)
            .every((card) => card.scrollWidth <= card.clientWidth + 1),
          controlsFitCards: controls.every((control) => {
            const card = control.closest('.admin-settings-row-card, .admin-panel');
            if (!card) return true;
            const box = control.getBoundingClientRect();
            const boundary = card.getBoundingClientRect();
            return box.left >= boundary.left - 1 && box.right <= boundary.right + 1;
          }),
          timeInputsReadable: controls.filter((control) => control.matches('input[type="time"]'))
            .every((control) => control.getBoundingClientRect().width >= 128),
          controlsInside: controls.every((control) => {
            const box = control.getBoundingClientRect();
            return box.left >= -1 && box.right <= document.documentElement.clientWidth + 1;
          }),
        };
      });
      expect(Math.abs(geometry.canvasWidth - geometry.mainWidth), `${task.name} uses its whole workspace`).toBeLessThanOrEqual(1);
      expect(geometry.pageWidth, `${task.name} page overflow at ${viewport.width}`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.cardsFit, `${task.name} cards contain their content at ${viewport.width}`).toBe(true);
      expect(geometry.controlsFitCards, `${task.name} controls fit their cards at ${viewport.width}`).toBe(true);
      expect(geometry.timeInputsReadable, `${task.name} native time controls remain readable at ${viewport.width}`).toBe(true);
      expect(geometry.controlsInside, `${task.name} controls fit at ${viewport.width}`).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `${task.name}-${viewport.name}-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
});
