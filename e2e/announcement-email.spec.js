// Announcement email (issues #202, #203, #490) on the real surface: the
// composer on the Announcements page, the functions emulator, the email
// core and the console provider, whose captured-mail file is the inbox.
//
// The journey: compose, preview with the recipient count, send a test to
// the signed-in operator, confirm the count, send, find the send in the
// history and in the email log, then unsubscribe one recipient through the
// one-click link in the List-Unsubscribe header and see the next preview
// leave that address out.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, FUNCTIONS_ORIGIN, MAIL_FILE, adminDb, mailFileSize, signIn } from './helpers.mjs';

const RUN = Date.now().toString(36);
const RECIPIENTS = [`announce-a-${RUN}@example.test`, `announce-b-${RUN}@example.test`];
const SUBJECT = `Doors open at nine ${RUN}`;

/** Every captured message appended since byte offset `since`. */
function mailSince(since) {
  const text = fs.readFileSync(MAIL_FILE).subarray(since).toString('utf8');
  return text.split('\n').filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

async function waitForMessages(since, predicate, count) {
  await expect.poll(() => mailSince(since).filter(predicate).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(count);
  return mailSince(since).filter(predicate);
}

test.describe.serial('announcement email', () => {
  test.beforeAll(async () => {
    const db = adminDb();
    for (const [index, email] of RECIPIENTS.entries()) {
      await db.collection('users').doc(`announce-${RUN}-${index}`).set({
        email,
        displayName: `Announcement reader ${index + 1}`,
        registrationStatus: 'approved',
        approvalSource: 'admin',
        speakerId: null,
        role: 'attendee',
      });
    }
  });

  test.afterAll(async () => {
    const db = adminDb();
    for (const index of RECIPIENTS.keys()) await db.collection('users').doc(`announce-${RUN}-${index}`).delete();
    const suppressions = await db.collection('email_suppressions').get();
    await Promise.all(suppressions.docs.map((doc) => doc.ref.delete()));
  });

  test('compose, preview, test, confirm, send, history, and unsubscribe', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/announcements');
    await expect(page.getByRole('heading', { level: 2, name: 'Email an announcement' })).toBeVisible();

    await page.getByLabel('Audience').selectOption({ label: 'Approved attendees' });
    await page.getByLabel('Subject').fill(SUBJECT);
    await page.getByLabel('Email message').fill('Doors open at nine.\n\nBring your badge.');
    await page.getByLabel('Button link (optional)').fill('https://example.org/schedule');
    await page.getByLabel('Button label (optional)').fill('Read the schedule');

    const beforePreview = mailFileSize();
    await page.getByRole('button', { name: 'Preview email' }).click();
    const previewHeading = page.getByRole('heading', { name: 'Preview', exact: true });
    await expect(previewHeading).toBeFocused();
    const toLine = page.getByText(/^\d+ recipients?: Approved attendees$/);
    await expect(toLine).toBeVisible();
    const count = Number((await toLine.textContent()).match(/^(\d+)/)[1]);
    expect(count).toBeGreaterThanOrEqual(RECIPIENTS.length);
    await expect(page.frameLocator('iframe[title="Email preview"]').getByText('Bring your badge.')).toBeVisible();
    // A preview sends nothing.
    expect(mailSince(beforePreview)).toHaveLength(0);

    // A test goes to the signed-in operator only.
    await page.getByRole('button', { name: 'Send a test to me' }).click();
    const [testMail] = await waitForMessages(beforePreview, (m) => m.subject === `Test: ${SUBJECT}`, 1);
    expect(testMail.to).toBe(ADMIN_EMAIL);
    expect(testMail.text).toContain('/unsubscribe?test=1');

    // The first send button opens the confirmation; it repeats the count.
    const plural = count === 1 ? 'recipient' : 'recipients';
    await page.getByRole('button', { name: `Send to ${count} ${plural}` }).click();
    const confirm = page.getByRole('heading', { name: `Send this email to ${count} ${plural}?` });
    await expect(confirm).toBeFocused();
    const beforeSend = mailFileSize();
    await page.locator('section', { has: confirm }).getByRole('button', { name: `Send to ${count} ${plural}` }).click();
    await expect(page.getByText(/^The send is complete\. Sent to \d+ recipients? of \d+ address(es)?\./)).toBeVisible({ timeout: 60_000 });

    const sent = await waitForMessages(beforeSend, (m) => m.subject === SUBJECT, count);
    expect(sent).toHaveLength(count);
    for (const address of RECIPIENTS) {
      const message = sent.find((m) => m.to === address);
      expect(message, `mail for ${address}`).toBeTruthy();
      expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(message.messageStream).toBe('announcements');
    }

    // The history lists the send with its count.
    const historyRow = page.locator('li', { hasText: SUBJECT });
    await expect(historyRow.getByText('Sent', { exact: true })).toBeVisible();
    await expect(historyRow.getByText(`Sent to ${count} ${plural} of ${count} address${count === 1 ? '' : 'es'}.`)).toBeVisible();

    // One recipient unsubscribes with the one-click POST a mail client makes.
    const first = sent.find((m) => m.to === RECIPIENTS[0]);
    const link = new URL(first.headers['List-Unsubscribe'].slice(1, -1));
    const response = await fetch(`${FUNCTIONS_ORIGIN}/emailUnsubscribe${link.search}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('You are unsubscribed');

    // The next preview leaves that address out.
    await page.getByLabel('Subject').fill(`${SUBJECT} again`);
    await page.getByLabel('Email message').fill('A second note.');
    await page.getByRole('button', { name: 'Preview email' }).click();
    await expect(page.getByText(`${count - 1} recipient${count - 1 === 1 ? '' : 's'}: Approved attendees`)).toBeVisible();
    await expect(page.getByText('1 address is left out because they unsubscribed.')).toBeVisible();

    // The send is in the email log under its own source.
    await page.goto('/admin/email-log?source=announcement');
    await page.getByRole('searchbox', { name: 'Search recipient or subject' }).fill(RECIPIENTS[1]);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const logRow = page.getByRole('row').filter({ hasText: RECIPIENTS[1] });
    await expect(logRow).toContainText('Announcement');
    await expect(logRow).toContainText(SUBJECT);
  });
});
