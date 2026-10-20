// Speaker email wording (issue #204), driven through the real admin page: a
// staff account tries an unknown token and is refused, saves a new
// invitation subject, previews it, and the next invitation the server sends
// carries that subject. Then "Use the shipped wording" deletes the saved
// wording. The evidence is the captured mail (the console email provider
// appends one JSON line per message to E2E_MAIL_FILE, e2e/helpers.mjs).
//
// The speaker, the saved wording and the staff grant are removed at the
// end, so the other specs see the shipped invitation.
import { test, expect } from '@playwright/test';
import {
  adminDb, adminIdToken, callFunction, mailFileSize, signIn, waitForTaggedMail,
} from './helpers.mjs';

const STAFF_EMAIL = 'e2e-mail-wording-staff@example.test';

test.describe.serial('Speaker email wording', () => {
  const stamp = Date.now();
  const speakerEmail = `e2e-wording-${stamp}@example.test`;
  const subject = `Join us, edition ${stamp}, at {{event_name}}`;
  let speakerId;
  let seededBootstrap;

  test.beforeAll(async () => {
    const config = adminDb().collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
  });

  test.afterAll(async () => {
    const db = adminDb();
    if (speakerId) await db.collection('speakers').doc(speakerId).delete();
    await db.collection('email_templates').doc('speaker.invite').delete();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('staff save new invitation wording, and the next invitation uses it', async ({ page }) => {
    await signIn(page, STAFF_EMAIL);
    await page.goto('/admin/speakers');
    await page.getByRole('link', { name: 'Edit email wording' }).click();
    await expect(page).toHaveURL(/\/admin\/speakers\/mail\/wording$/);

    const form = page.getByRole('form', { name: 'Invitation wording' });
    await expect(form.getByText('The shipped wording is in use.')).toBeVisible();

    // An unknown token is refused at save, and focus goes to the field.
    const text = form.getByLabel('Plain text body');
    const shippedText = await text.inputValue();
    await text.fill(`${shippedText}\n{{not_a_token}}`);
    await form.getByRole('button', { name: 'Save wording' }).click();
    await expect(form.getByRole('alert')).toContainText('text: unknown token {{not_a_token}}');
    await expect(text).toHaveAttribute('aria-invalid', 'true');
    await expect(text).toBeFocused();
    expect((await adminDb().collection('email_templates').doc('speaker.invite').get()).exists).toBe(false);

    await text.fill(shippedText);
    await form.getByLabel('Subject').fill(subject);
    // The keyboard path: Enter in the subject field submits the form.
    await form.getByLabel('Subject').press('Enter');
    await expect(form.getByRole('status')).toHaveText('Invitation wording saved. The next email uses it.');
    await expect(form.getByText(/Saved wording is in use, last changed .* by e2e-mail-wording-staff@example\.test\./)).toBeVisible();

    await form.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByRole('region', { name: 'Invitation preview' });
    await expect(preview.getByText('The saved wording', { exact: true })).toBeVisible();
    const previewSubject = await preview.getByTestId('mail-preview-subject').textContent();
    expect(previewSubject).toMatch(new RegExp(`^Join us, edition ${stamp}, at .+$`));
    await expect(preview.getByTestId('mail-preview-text')).toContainText('/speaker/accept?token=sample-invite-code');

    // The next invitation the server sends.
    const idToken = await adminIdToken();
    const created = await callFunction('createSpeaker', {
      speaker: { firstName: 'Wording', lastName: `Check ${stamp}`, email: speakerEmail, status: 'draft' },
    }, idToken);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    speakerId = created.body.speakerId;
    const since = mailFileSize();
    const sent = await callFunction('sendSpeakerInvite', { speakerId }, idToken);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const mail = await waitForTaggedMail(since, speakerEmail, 'speaker.invite', 30_000);
    expect(mail.subject).toBe(previewSubject);
    expect(`${mail.text}`).toMatch(/\/speaker\/accept\?token=[0-9a-f]{64}/);

    // Back to the shipped wording.
    await form.getByRole('button', { name: 'Use the shipped wording' }).click();
    await form.getByRole('button', { name: 'Delete the saved wording' }).click();
    await expect(form.getByRole('status')).toHaveText('Invitation uses the shipped wording again.');
    await expect(form.getByText('The shipped wording is in use.')).toBeVisible();
    expect((await adminDb().collection('email_templates').doc('speaker.invite').get()).exists).toBe(false);
  });
});
