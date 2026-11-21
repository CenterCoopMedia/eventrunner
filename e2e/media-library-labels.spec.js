import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';
import { expectControlFits, expectTextFits, setReflowProfile } from './reflow.mjs';

test.use({ trace: 'off', screenshot: 'off' });

test('a narrow image picker shows the full title and filename', async ({ page }) => {
  const title = 'Conference photos from the opening reception, west entrance';
  const filename = 'conferenceOpeningReceptionWestEntrancePhotograph.png';
  const assetPath = `branding/picker-label-proof/${filename}`;
  const asset = adminDb().doc('media_assets/picker-label-proof');
  await asset.set({
    path: assetPath, folder: 'branding', filename, title, alt: '',
    contentType: 'image/png', size: 1, uploadedBy: 'operator@example.test', createdAt: new Date(),
  });
  try {
    await page.setViewportSize({ width: 320, height: 700 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/branding');
    await page.getByRole('button', { name: 'Identity', exact: true }).click();
    const primaryLogo = page.getByRole('textbox', { name: 'Primary logo' });
    await primaryLogo.locator('..').getByRole('button', { name: 'Choose or upload…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose an image', exact: true });
    const tile = dialog.getByRole('button', { pressed: false, name: title });
    for (const profile of [{ width: 320 }, { width: 720, rootSize: 32 }]) {
      await setReflowProfile(page, profile);
      await expectTextFits(tile.getByText(title, { exact: true }));
      await expectTextFits(tile.getByText(filename, { exact: true }));
      await expectControlFits(tile);
      await expect.poll(() => dialog.evaluate((node) => node.scrollWidth - node.clientWidth))
        .toBeLessThanOrEqual(1);
    }
    await tile.click();
    await expect(dialog).toHaveCount(0);
    await expect(primaryLogo).toHaveValue(assetPath);
  } finally {
    await asset.delete();
  }
});
