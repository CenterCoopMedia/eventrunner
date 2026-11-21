/* global getComputedStyle */
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
    const identity = rail.locator('.admin-rail__job');
    const name = identity.getByText(eventName, { exact: true });
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

    const names = [
      'Rehearsal',
      'CommunityNewsAndNeighborhoodReporting Summit on Local Information, Civic Engagement and Public Media in 2027',
    ];
    const height = 568;
    for (const headerName of names) {
      await event.update({ shortName: headerName });
      const header = identity.getByText(headerName, { exact: true });
      await expect(header).toBeVisible();
      await expect(identity.locator('img')).toBeVisible();

      for (const rootSize of [32, 16]) {
        for (const width of [320, 390, 768]) {
          await test.step(`${width} px at ${rootSize}px root: ${headerName}`, async () => {
            await setReflowProfile(page, { width, height, rootSize });
            await header.evaluate((element) => element.ownerDocument.fonts.ready.then(() => undefined));
            await expect(header).toHaveCSS('-webkit-line-clamp', rootSize === 32 ? '3' : 'none');
            await expect(summary).toHaveAccessibleName('Open menu');

            const bar = await rail.boundingBox();
            const control = await summary.boundingBox();
            const nameBox = await header.boundingBox();
            expect(control.x).toBeGreaterThanOrEqual(0);
            expect(control.x + control.width).toBeLessThanOrEqual(width);
            expect(control.y).toBeGreaterThanOrEqual(0);
            expect(control.y + control.height).toBeLessThanOrEqual(height);
            expect(control.height).toBeGreaterThanOrEqual(44);
            if (rootSize === 32) {
              expect(bar.height).toBeLessThanOrEqual(Math.ceil(height / 3));
              if (width < 768) expect(nameBox.width).toBeGreaterThanOrEqual(160);
              const lineHeight = await header.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
              expect(nameBox.height).toBeLessThanOrEqual(lineHeight * 3 + 1);
            }
            await expect(header).toHaveAttribute('title', headerName);
            await expect(header).toMatchAriaSnapshot(`- paragraph: "${headerName}"`);

            await summary.click();
            await expect(summary).toHaveAccessibleName('Close menu');
            await expect(sheet).toBeVisible();
            await expect.poll(async () => {
              const [barBox, sheetBox] = await Promise.all([rail.boundingBox(), sheet.boundingBox()]);
              return Math.max(
                Math.abs(barBox.y + barBox.height - sheetBox.y),
                Math.abs(sheetBox.y + sheetBox.height - height),
              );
            }).toBeLessThanOrEqual(1);
            const fullName = sheet.getByText(headerName, { exact: true });
            if (rootSize === 32 && width < 768 && headerName === names[1]) {
              await expect(fullName).toBeVisible();
            } else if (rootSize === 16 || headerName === names[0]) {
              await expect(fullName).toBeHidden();
            }
            if (rootSize === 32) {
              await expect(sheet.getByRole('link', { name: 'Overview', exact: true })).toBeInViewport({ ratio: 1 });
            }
            await summary.press('Escape');
            await expect(sheet).toBeHidden();
          });
        }
      }
    }
  } finally {
    await event.update({ shortName: originalName });
  }
});
