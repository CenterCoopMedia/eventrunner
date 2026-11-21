import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';
import { expectPageFits, expectTextFits, setReflowProfile } from './reflow.mjs';

test.use({ trace: 'off', screenshot: 'off' });

test('the Pages list shows the full destination of a custom navigation link', async ({ page }) => {
  const id = 'navigation-address-reflow';
  const label = 'Parking directions';
  const url = 'https://example.test/parking/accessibilityInstructionsForTheWestEntranceAndOverflowLot';
  const draft = adminDb().collection('cmsPages_drafts').doc(id);
  await draft.set({
    id, label, url, order: 999, visible: true, systemPage: false, status: 'dirty', basedOnRevision: null,
  });

  try {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/pages');
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();

    const title = page.getByRole('link', { name: label, exact: true });
    const row = page.getByRole('main').getByRole('listitem').filter({ has: title });
    const address = row.getByText(url, { exact: true });
    const evidence = path.resolve('test-results/admin-visual-evidence');
    await fs.mkdir(evidence, { recursive: true });

    for (const profile of [{ width: 1440 }, { width: 320 }, { width: 720, rootSize: 32 }]) {
      await setReflowProfile(page, profile);
      await expectTextFits(address);
      expect(await address.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      await expectPageFits(page);
      await row.screenshot({ path: path.join(evidence, `pages-link-address-${profile.width}.png`), animations: 'disabled' });
    }

    await title.press('Enter');
    await expect(page.getByRole('textbox', { name: 'HTTPS URL' })).toHaveValue(url);
  } finally {
    await draft.delete();
  }
});
