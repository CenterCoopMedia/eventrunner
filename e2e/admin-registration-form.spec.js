// Settings → Registration form (ADR 0008 §4): an operator turns on a
// standard question, writes one of their own, sees both in the preview,
// and saves. The saved record carries the revision guard.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

test('an operator writes the registration questions, previews them, and saves them', async ({ page }) => {
  const db = adminDb();
  const ref = db.collection('config').doc('registration_form');
  await ref.delete();
  try {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/registration-form');
    await expect(page.getByRole('heading', { level: 1, name: 'Registration form' })).toBeVisible({ timeout: 20_000 });
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    const preview = page.getByRole('region', { name: "Preview of the attendee's questions" });
    await expect(page.getByText('No questions are asked. Attendees give their name and email only.')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Ask: Organization' }).check();
    await page.getByRole('checkbox', { name: 'Required: Organization' }).check();
    await page.getByRole('button', { name: 'Add a question' }).click();
    await page.getByRole('textbox', { name: /^Question/ }).fill('T-shirt size');
    await page.getByLabel('Answer type').selectOption('one_choice');
    await page.getByLabel('Choices').fill('S\nM\nL');
    await expect(preview.getByLabel('Organization (required)')).toBeVisible();
    await expect(preview.getByRole('group', { name: 'T-shirt size' })).toBeVisible();

    await page.getByRole('button', { name: 'Save registration form' }).click();
    await expect(page.getByText('Registration form saved. New registrations use it now.')).toBeVisible();
    await expect(page.getByText('Revision 1')).toBeVisible();
    const stored = (await ref.get()).data();
    expect(stored.revision).toBe(1);
    expect(stored.standard.organization).toEqual({ enabled: true, required: true });
    expect(stored.custom).toHaveLength(1);
    expect(stored.custom[0]).toMatchObject({ kind: 'one_choice', label: 'T-shirt size', choices: ['S', 'M', 'L'], required: false });
  } finally {
    await ref.delete();
  }
});
