import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

for (const width of [1440, 390]) {
  test(`paired page wording stays in the draft until the existing publish action (${width}px)`, async ({ page }) => {
    const id = `paired-content-${width}`;
    const db = adminDb();
    const live = db.collection('cmsPages').doc(id);
    const draft = db.collection('cmsPages_drafts').doc(id);
    try {
      await live.set({ id, label: 'Visit', title: 'Plan your visit', path: `/${id}`, icon: null,
        order: 999, visible: true, systemPage: false, sections: [], revision: 1 });
      await page.setViewportSize({ width, height: 1050 });
      await signIn(page, ADMIN_EMAIL);
      await page.goto(`/admin/pages/${id}`);
      await expect(page.getByLabel('Navigation label', { exact: true })).toHaveValue('Visit');
      const endTour = page.getByRole('button', { name: 'End tour', exact: true });
      if (await endTour.isVisible()) await endTour.click();
      const disclosure = page.getByRole('button', { name: 'Spanish translation', exact: true });
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toBeFocused();
      await page.getByLabel('Spanish navigation label', { exact: true }).fill('Visita');
      await page.getByLabel('Spanish page heading', { exact: true }).fill('Planifica tu visita');
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect.poll(async () => (await draft.get()).data()?.translations).toEqual({ es: { label: 'Visita', title: 'Planifica tu visita' } });
      expect((await live.get()).data().translations).toBeUndefined();
      expect((await live.get()).data().label).toBe('Visit');
      await expect(page.getByRole('button', { name: 'Save and publish', exact: true })).toBeEnabled();
      await disclosure.scrollIntoViewIfNeeded();
      const evidence = path.resolve('test-results/admin-visual-evidence');
      await fs.mkdir(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, `paired-content-${width}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Save and publish', exact: true }).click();
      await expect.poll(async () => (await live.get()).data()?.translations).toEqual({ es: { label: 'Visita', title: 'Planifica tu visita' } });
      expect((await live.get()).data().path).toBe(`/${id}`);
      expect((await live.get()).data().title).toBe('Plan your visit');
    } finally {
      await Promise.all([live.delete(), draft.delete()]);
      const repaired = await callFunction('cmsEnsurePendingCounts', { force: true }, await adminIdToken());
      expect(repaired.status).toBe(200);
    }
  });
}
