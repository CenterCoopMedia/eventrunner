import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

test('Auth persistence remains writable when hidden and after pagehide', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: /email me a code/i })).toBeVisible();
  const moduleUrl = `/@fs/${resolve('e2e/browser-auth.js').replaceAll('\\', '/')}`;
  const results = await page.evaluate(async (url) => {
    const { clearEmulatorAuthPersistence, signedInUid } = await import(url);
    await signedInUid();
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const outcomes = [];
    try {
      // The upstream regression closed Auth's IndexedDB on this event.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      for (const event of ['hidden', 'pagehide']) {
        if (event === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        try {
          await clearEmulatorAuthPersistence();
          outcomes.push({ event, error: null });
        } catch (error) {
          outcomes.push({ event, error: error.message });
        }
      }
    } finally {
      if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
      else delete document.visibilityState;
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
    }
    await clearEmulatorAuthPersistence();
    return outcomes;
  }, moduleUrl);
  expect(results).toEqual([
    { event: 'hidden', error: null },
    { event: 'pagehide', error: null },
  ]);
});
