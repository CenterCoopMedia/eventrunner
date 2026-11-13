// Registration answers (ADR 0008 §4) on the emulators: a ticket holder
// saves answers through saveTicketAnswers, someone else cannot, and staff
// see the counts and the attendee's own answers on the Attendees page.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, callFunction, ensureUser, idTokenFor, signIn } from './helpers.mjs';

test('a ticket holder saves registration answers, and staff see them on the Attendees page', async ({ page }) => {
  const db = adminDb();
  const stamp = Date.now();
  const email = `answers-${stamp}@example.test`;
  const uid = await ensureUser(email);
  const otherUid = await ensureUser(`answers-other-${stamp}@example.test`);
  const ticketId = `e2e-answers-${stamp}`;
  const formRef = db.collection('config').doc('registration_form');
  await formRef.set({
    revision: 1,
    standard: { organization: { enabled: true, required: true }, phone: { enabled: true }, dietary: { enabled: true, required: false }, accessNeeds: { enabled: true, required: false } },
    custom: [],
  });
  await db.collection('tickets').doc(ticketId).set({
    externalId: ticketId, provider: 'manual', status: 'valid', email, firstName: 'Ada', lastName: 'Answers', claimedByUid: uid, claimedAt: new Date(),
  });
  // The account document comes from onUserCreated.
  await expect.poll(async () => (await db.collection('users').doc(uid).get()).exists, { timeout: 20_000 }).toBe(true);
  await db.collection('users').doc(uid).set({ displayName: `Ada Answers ${stamp}` }, { merge: true });
  try {
    const answers = { organization: 'Example News', phone: '(201) 555-0123', dietary: { choices: ['Vegan', 'Other'], other: 'Low sodium' }, accessNeeds: 'A step-free route to the stage.' };
    const refused = await callFunction('saveTicketAnswers', { ticketId, formRevision: 1, answers }, await idTokenFor(otherUid));
    expect(refused.status).toBe(403);
    const saved = await callFunction('saveTicketAnswers', { ticketId, formRevision: 1, answers }, await idTokenFor(uid));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const stored = (await db.collection('ticket_answers').doc(ticketId).get()).data();
    expect(stored).toMatchObject({ uid, formRevision: 1, answers: { organization: 'Example News', accessNeeds: 'A step-free route to the stage.' } });
    const stale = await callFunction('saveTicketAnswers', { ticketId, formRevision: 0, answers }, await idTokenFor(uid));
    expect(stale.body.error.code).toBe('form-changed');

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/attendees');
    const summary = page.getByRole('heading', { level: 2, name: 'Registration answers' }).locator('xpath=ancestor::section[1]');
    await expect(summary.getByText('Vegan: 1')).toBeVisible({ timeout: 20_000 });
    await expect(summary.getByText(/Low sodium/)).toBeVisible();
    await expect(summary.getByText(/told you about access needs/)).toBeVisible();
    await expect(summary.getByText('A step-free route to the stage.')).toHaveCount(0);
    await page.getByLabel('Search').fill(`Ada Answers ${stamp}`);
    await page.getByRole('button', { name: 'Edit attendee record' }).first().click();
    const record = page.getByRole('region', { name: 'Registration answers' });
    await expect(record.getByText('A step-free route to the stage.')).toBeVisible();
    await expect(record.getByText('Vegan; Other: Low sodium')).toBeVisible();
    await expect(record.getByText('Phone number (private)', { exact: true })).toBeVisible();
    await expect(record.getByText('(201) 555-0123', { exact: true })).toBeVisible();
  } finally {
    await Promise.all([
      formRef.delete(),
      db.collection('tickets').doc(ticketId).delete(),
      db.collection('ticket_answers').doc(ticketId).delete(),
    ]);
  }
});
