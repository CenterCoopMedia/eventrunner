import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';
import { expectPageFits, expectTextFits, setReflowProfile } from './reflow.mjs';

test.use({ trace: 'off', screenshot: 'off' });

test('staff can read full pitch details in the queue at narrow widths and enlarged text', async ({ page }) => {
  const title = 'Pitch with a long contact address';
  const contact = 'community-reporting-submissions-and-public-events@example.test';
  const ref = adminDb().doc('session_pitches/pitch-ui-queue-details');
  await ref.set({ title, email: contact, format: 'Workshop', track: 'Community reporting', status: 'new' });
  try {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/pitches');
    await expect(page.getByRole('heading', { name: 'Session pitches', exact: true })).toBeVisible();
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();

    const queue = page.getByRole('list', { name: 'Session pitches' });
    const details = queue.getByText(`${contact} · Workshop · Community reporting`, { exact: true });
    for (const profile of [{ width: 320 }, { width: 720, rootSize: 32 }]) {
      await setReflowProfile(page, profile);
      await expectTextFits(details);
      await expectPageFits(page);
    }

    await queue.getByRole('link', { name: `Review ${title}`, exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/admin\/pitches\/pitch-ui-queue-details$/);
  } finally {
    await ref.delete();
  }
});
