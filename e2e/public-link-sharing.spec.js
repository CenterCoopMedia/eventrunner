// Hosted browser integration. The OS share sheet is replaced at its API
// boundary; this checks the real page, trusted press and recovery action,
// rather than claiming to exercise iOS or Android system UI.
import { test, expect } from '@playwright/test';
import { adminDb } from './helpers.mjs';

test('a public session shares its current route and offers copy after a share failure', async ({ page }) => {
  const records = await adminDb().collection('cmsSchedule').get();
  const session = records.docs.map((doc) => ({ ...doc.data(), id: doc.id }))
    .find((row) => row.visible && row.title && row.type !== 'break');
  expect(session).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    globalThis.shareCalls = [];
    globalThis.copyCalls = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
      globalThis.shareCalls.push({ ...data, activated: navigator.userActivation.isActive });
      if (globalThis.rejectShare) throw new DOMException('Unavailable', 'NotAllowedError');
    } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => {
      globalThis.copyCalls.push({ text, activated: navigator.userActivation.isActive });
    } } });
  });
  const route = `/schedule/${encodeURIComponent(session.id)}`;
  await page.goto(`${route}?day=one`);
  await expect(page.getByRole('heading', { level: 1, name: session.title, exact: true })).toBeVisible();
  await page.evaluate(() => {
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = '/previous-page';
    document.head.append(canonical);
  });
  const share = page.getByRole('button', { name: 'Share session', exact: true });
  await share.focus();
  await page.keyboard.press('Enter');
  const url = new URL(route, page.url()).href;
  await expect.poll(() => page.evaluate(() => globalThis.shareCalls)).toEqual([{ title: session.title, url, activated: true }]);
  await expect(share).toBeEnabled();
  await page.evaluate(() => { globalThis.rejectShare = true; });
  await share.click();
  await expect(page.getByText('Sharing is unavailable. Copy the link instead.')).toBeVisible();
  expect(await page.evaluate(() => globalThis.copyCalls)).toEqual([]);
  await page.getByRole('button', { name: 'Copy session link', exact: true }).click();
  await expect(page.getByText('Link copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => globalThis.copyCalls)).toEqual([{ text: url, activated: true }]);
});
