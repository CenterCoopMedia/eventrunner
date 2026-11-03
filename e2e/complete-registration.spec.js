// Complete your registration (ADR 0008 §5) on the emulators: a signed-in
// ticket holder sees the dashboard reminder, answers the questions in the
// steps, sees them on Review, and the reminder goes away.
import { test, expect } from '@playwright/test';
import { adminDb, ensureUser, signIn } from './helpers.mjs';

test('a ticket holder answers the registration questions from the dashboard reminder', async ({ page }) => {
  const db = adminDb();
  const stamp = Date.now();
  const email = `complete-${stamp}@example.test`;
  const uid = await ensureUser(email);
  const ticketId = `e2e-complete-${stamp}`;
  const formRef = db.collection('config').doc('registration_form');
  await formRef.set({
    revision: 1,
    standard: { organization: { enabled: true, required: true }, photoConsent: { enabled: true, required: false } },
    custom: [{ id: 'q_track', kind: 'one_choice', label: 'Which track interests you most?', help: '', choices: ['Revenue', 'Audience'], required: true }],
  });
  await db.collection('tickets').doc(ticketId).set({
    externalId: ticketId, provider: 'manual', status: 'valid', email, firstName: 'Ada', lastName: 'Complete', ticketClass: 'General', claimedByUid: uid, claimedAt: new Date(),
  });
  try {
    await signIn(page, email);
    await page.goto('/dashboard');
    const reminder = page.getByRole('region', { name: 'Complete your registration' });
    await expect(reminder).toBeVisible({ timeout: 20_000 });
    await reminder.getByRole('link', { name: 'Answer the questions' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Your answers' })).toBeVisible();
    // The shared check names a missing answer before anything is sent.
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(page.getByText('Answer this question.').first()).toBeVisible();
    await page.getByLabel('Organization (required)').fill('Example News');
    await page.getByRole('radio', { name: 'Audience' }).check();
    await page.getByRole('radio', { name: 'Yes' }).check();
    await page.getByRole('button', { name: 'Next: Review' }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Review' })).toBeVisible();
    await expect(page.getByText('Your answers are saved. You can change them until registration closes.')).toBeVisible();
    await expect(page.getByText('Example News')).toBeVisible();
    const stored = (await db.collection('ticket_answers').doc(ticketId).get()).data();
    expect(stored).toMatchObject({ uid, formRevision: 1, answers: { organization: 'Example News', q_track: 'Audience', photoConsent: true } });

    await page.getByRole('link', { name: 'Back to your dashboard' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Complete your registration' })).toHaveCount(0);
  } finally {
    await Promise.all([formRef.delete(), db.collection('tickets').doc(ticketId).delete(), db.collection('ticket_answers').doc(ticketId).delete()]);
  }
});
