import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';
import { expectControlFits, expectNoOverlap, expectPageFits, expectTextFits, setReflowProfile } from './reflow.mjs';

test.use({ trace: 'off', screenshot: 'off' });

test('the admin header shows the full event name and keeps the phone menu below it', async ({ page }) => {
  const event = adminDb().doc('config/event');
  const originalName = (await event.get()).get('shortName');
  const eventName = 'CommunityNewsAndNeighborhoodReporting Summit';
  try {
    await event.update({ shortName: eventName });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/unpublished');
    await expect(page.getByRole('heading', { level: 1, name: 'Unpublished changes' })).toBeVisible();
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();

    const rail = page.locator('.admin-rail');
    const name = rail.getByText(eventName, { exact: true });
    const summary = rail.locator('summary');
    const sheet = rail.locator('#admin-docket');
    await setReflowProfile(page, { width: 1280 });
    await expectTextFits(name);
    await expectNoOverlap(name, rail.getByRole('button', { name: 'Hide menu' }));

    await setReflowProfile(page, { width: 320 });
    await expectControlFits(summary);
    await summary.press('Enter');
    await expect(summary).toHaveAccessibleName('Close menu');
    for (const profile of [{ width: 320 }, { width: 768, rootSize: 32 }]) {
      await setReflowProfile(page, profile);
      await expectTextFits(name);
      await expectTextFits(summary.getByText('Unpublished changes', { exact: true }));
      await expectNoOverlap(name, summary);
      await expectPageFits(page);
      await expect.poll(async () => {
        const [barBox, sheetBox] = await Promise.all([rail.boundingBox(), sheet.boundingBox()]);
        return Math.abs(barBox.y + barBox.height - sheetBox.y);
      }).toBeLessThanOrEqual(1);
    }

    await expect(sheet.getByRole('link', { name: 'Unpublished changes' })).toHaveAttribute('aria-current', 'page');
    await summary.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(summary).toBeFocused();
  } finally {
    await event.update({ shortName: originalName });
  }
});
