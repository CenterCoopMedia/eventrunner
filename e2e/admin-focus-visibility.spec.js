/* global document, getComputedStyle, innerHeight */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, APP_BASE_URL, adminDb, signIn } from './helpers.mjs';

const VIEWPORTS = [
  { width: 640, height: 900 }, { width: 768, height: 900 },
  { width: 1024, height: 900 }, { width: 640, height: 360 },
];
const CONTROLS = 'input:enabled:visible:not([type="hidden"]), textarea:enabled:visible, select:enabled:visible, button:enabled:visible, a[href]:visible:not([tabindex="-1"])';

async function focusGeometry(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const rect = active.getBoundingClientRect();
    const band = document.querySelector('.admin-job-line');
    let boundary = 0;
    if (band && !band.contains(active) && getComputedStyle(band).position === 'sticky') {
      boundary = Math.max(boundary, band.getBoundingClientRect().bottom);
    }
    const table = active.closest('.admin-table-scroll');
    const head = table?.querySelector('thead');
    if (head && !head.contains(active)) {
      boundary = Math.max(boundary, ...Array.from(head.querySelectorAll('th'), (cell) => cell.getBoundingClientRect().bottom));
    }
    // Native textarea focus can retain a caret while part of the control is
    // outside the viewport. The visible portion must clear every sticky head.
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(innerHeight, rect.bottom);
    return {
      clear: visibleBottom > visibleTop && visibleTop >= boundary - 1,
      top: rect.top, bottom: rect.bottom, boundary, viewport: innerHeight,
    };
  });
}

async function reverseThrough(page, region) {
  const controls = region.locator(CONTROLS);
  const count = await controls.count();
  expect(count).toBeGreaterThan(3);
  await controls.last().focus();
  let reachedFirst = false;
  // Native time fields have several keyboard stops inside one input.
  while (await region.evaluate((element) => element !== document.activeElement && element.contains(document.activeElement))) {
    if (await controls.first().evaluate((element) => element === document.activeElement)) reachedFirst = true;
    await expect.poll(() => focusGeometry(page), { message: 'The focused control stays clear of sticky heads' }).toMatchObject({ clear: true });
    await page.keyboard.press('Shift+Tab');
  }
  expect(reachedFirst).toBe(true);
  expect(await region.evaluate((element) => element !== document.activeElement && element.contains(document.activeElement))).toBe(false);
}

for (const kind of ['page', 'invoice', 'session']) {
  test(`${kind} editor keeps reverse-tab focus visible with wrapped title bands`, async ({ page }) => {
    let invoiceId;
    const db = adminDb();
    try {
      await signIn(page, ADMIN_EMAIL);
      if (kind === 'page') {
        await page.goto('/admin/pages/home');
        await page.getByLabel('Navigation label').fill('A guide to attending the local news and information summit with your community');
      } else if (kind === 'invoice') {
        await page.goto('/admin/invoices/new/invoice');
        await page.getByLabel('Name to bill').fill('Example local news and information summit partner organization '.repeat(4).slice(0, 200));
        await page.getByLabel('Line 1 description').fill('Synthetic focus check');
        await page.getByLabel('Line 1 unit price').fill('10.00');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Issue invoice', exact: true })).toBeVisible();
        invoiceId = new URL(page.url()).pathname.split('/').at(-1);
        expect(invoiceId).not.toBe('new');
      } else {
        const sessions = await db.collection('cmsSchedule').limit(1).get();
        expect(sessions.empty).toBe(false);
        await page.goto(`/admin/sessions/${encodeURIComponent(sessions.docs[0].id)}`);
        await page.getByLabel('Public title').fill('Local reporting partnerships that reach every community: Lessons from shared investigations and sustained public service across North Carolina'.padEnd(160, '.'));
      }
      const endTour = page.getByRole('button', { name: 'End tour', exact: true });
      if (await endTour.isVisible()) await endTour.click();
      const form = page.locator('#admin-content form').first();
      const measurements = [];
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.locator('html').evaluate(() => document.fonts.ready);
        await reverseThrough(page, form);
        measurements.push(await page.locator('.admin-job-line').evaluate((element) => ({
          width: document.documentElement.clientWidth, height: innerHeight,
          bandHeight: element.getBoundingClientRect().height, position: getComputedStyle(element).position,
        })));
      }
      if (kind === 'session') {
        await page.getByLabel('Public description').fill('');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByLabel('Public description')).toBeFocused();
        await expect.poll(() => focusGeometry(page)).toMatchObject({ clear: true });
      }
      const directory = path.resolve('test-results/admin-focus-evidence');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${kind}-header-measurements.json`), JSON.stringify(measurements, null, 2));
      console.info(`Admin focus measurements (${kind}): ${JSON.stringify(measurements)}`);
    } finally {
      if (invoiceId) {
        await db.collection('invoices').doc(invoiceId).delete();
        const logs = await db.collection('admin_logs').where('invoiceId', '==', invoiceId).get();
        await Promise.all(logs.docs.map((entry) => entry.ref.delete()));
      }
    }
  });
}

test('reverse-tab focus clears a scrolling table head and admin padding ends at public navigation', async ({ page }) => {
  const headers = { 'access-control-allow-origin': APP_BASE_URL, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck' };
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `focus-log-${index}`, sentAt: Date.now() - index * 60000,
    to: `reader-${index}@example.test`, subject: `Synthetic guide ${index + 1}`,
    source: 'announcement', status: 'sent', bodyStored: false,
  }));
  await page.route('**/listSentEmails', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, json: { rows, nextCursor: null, scanned: rows.length } });
  });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/email-log');
  const table = page.getByRole('region', { name: 'Sent messages', exact: true });
  await expect(table.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(rows.length);
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[3], { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await reverseThrough(page, table);
  }
  await page.setViewportSize(VIEWPORTS[1]);
  await page.getByRole('link', { name: 'Skip to main content', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await page.locator('#admin-content').evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
  await page.setViewportSize(VIEWPORTS[2]);
  await page.getByRole('link', { name: 'View site', exact: true }).click();
  await expect(page.locator('.admin-room')).toHaveCount(0);
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).scrollPaddingTop)).toMatch(/^(auto|0px)$/);
  expect(await page.locator('html').evaluate((element) => element.style.getPropertyValue('--admin-header-scroll-padding'))).toBe('');
});
