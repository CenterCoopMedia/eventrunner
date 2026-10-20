// Announcement email (issues #202, #203, #490) on the real surface: the
// composer on the Announcements page, the functions emulator, the email
// core and the console provider, whose captured-mail file is the inbox.
//
// The journey: compose, preview with the recipient count, send a test to
// the signed-in operator, confirm the count, send, find the send in the
// history and in the email log, then unsubscribe one recipient through the
// one-click link in the List-Unsubscribe header and see the next preview
// leave that address out.
//
// The second journey (issues #496, #497): save a message, reopen the page,
// load it into a new draft (cancel, then confirm, the replacement of a
// draft with edits), rename it and remove it, with no mail sent. Then open
// the first send's frozen content from the history, an audited read, and
// follow it to that send's recipient rows in the email log.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, FUNCTIONS_ORIGIN, MAIL_FILE, adminDb, mailFileSize, signIn } from './helpers.mjs';

const RUN = Date.now().toString(36);
const RECIPIENTS = [`announce-a-${RUN}@example.test`, `announce-b-${RUN}@example.test`];
const SUBJECT = `Doors open at nine ${RUN}`;
const SAVED_NAME = `Weekly note ${RUN}`;
const SAVED_SUBJECT = `This week ${RUN}`;
const RENAMED = `Old weekly note ${RUN}`;

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

  test('save, load, rename and remove a saved message; open a send from the history', async ({ page }) => {
    const db = adminDb();
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/announcements');
    const saved = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Saved messages' }) });
    await expect(saved).toBeVisible();
    const beforeSaved = mailFileSize();

    // Save a message under a name.
    await page.getByLabel('Subject').fill(SAVED_SUBJECT);
    await page.getByLabel('Email message').fill('Saved words.\n\nSecond paragraph.');
    await page.getByLabel('Name for this message').fill(SAVED_NAME);
    await page.getByRole('button', { name: 'Save as a new message' }).click();
    const row = saved.locator('li', { hasText: SAVED_NAME });
    await expect(row.getByText(SAVED_SUBJECT)).toBeVisible();
    const stored = await db.collection('announcement_messages').where('name', '==', SAVED_NAME).get();
    expect(stored.size).toBe(1);
    const savedId = stored.docs[0].id;
    // Content only: no audience, recipient, or send state.
    expect(Object.keys(stored.docs[0].data()).sort()).toEqual(['createdAt', 'linkLabel', 'linkUrl', 'message', 'name', 'subject', 'updatedAt']);

    // Reopen the page; the message is still there. A draft with edits asks first.
    await page.reload();
    await expect(row).toBeVisible();
    await page.getByLabel('Subject').fill('Words I have not saved');
    await row.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByRole('heading', { name: `Replace your draft with "${SAVED_NAME}"?` })).toBeFocused();
    await page.getByRole('button', { name: 'Keep my draft' }).click();
    await expect(page.getByLabel('Subject')).toHaveValue('Words I have not saved');
    await expect(row.getByRole('button', { name: 'Load' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Replace draft' }).click();
    await expect(page.getByLabel('Subject')).toHaveValue(SAVED_SUBJECT);
    await expect(page.getByLabel('Email message')).toHaveValue('Saved words.\n\nSecond paragraph.');
    await expect(page.getByLabel('Subject')).toBeFocused();

    // An edit to the loaded draft leaves the saved message as it was.
    await page.getByLabel('Subject').fill(`${SAVED_SUBJECT} edited`);
    await page.reload();
    await row.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByLabel('Subject')).toHaveValue(SAVED_SUBJECT);
    expect((await db.collection('announcement_messages').doc(savedId).get()).data().subject).toBe(SAVED_SUBJECT);

    // Rename with the keyboard; the id stays the same.
    await row.getByRole('button', { name: 'Rename' }).click();
    const nameField = saved.getByLabel('New name');
    await expect(nameField).toBeFocused();
    await nameField.fill(RENAMED);
    await nameField.press('Enter');
    const renamed = saved.locator('li', { hasText: RENAMED });
    await expect(renamed).toBeVisible();
    expect((await db.collection('announcement_messages').doc(savedId).get()).data().name).toBe(RENAMED);

    // Remove it; the loaded copy stays in the form.
    await renamed.getByRole('button', { name: 'Remove' }).click();
    await saved.getByRole('button', { name: `Remove "${RENAMED}"` }).click();
    await expect(saved.getByText(RENAMED)).toHaveCount(0);
    expect((await db.collection('announcement_messages').doc(savedId).get()).exists).toBe(false);
    await expect(page.getByLabel('Subject')).toHaveValue(SAVED_SUBJECT);
    // Saving, loading, renaming and removing sent nothing.
    expect(mailSince(beforeSaved)).toHaveLength(0);
    const changes = await db.collection('admin_logs').where('docPath', '==', `announcement_messages/${savedId}`).get();
    expect(changes.docs.map((d) => d.data().action).sort())
      .toEqual(['createAnnouncementMessage', 'removeAnnouncementMessage', 'renameAnnouncementMessage']);

    // The first journey's send: its recipient rows carry its id.
    const record = (await db.collection('announcement_sends').where('subject', '==', SUBJECT).get()).docs[0];
    const rows = await db.collection('sent_emails').where('subject', '==', SUBJECT).get();
    expect(rows.size).toBeGreaterThanOrEqual(RECIPIENTS.length);
    expect(rows.docs.every((d) => d.data().sendId === record.id)).toBe(true);

    // Open its frozen content from the history: an audited read.
    const historyRow = page.locator('li', { has: page.getByRole('button', { name: 'Show details' }) }).filter({ hasText: SUBJECT });
    await historyRow.getByRole('button', { name: 'Show details' }).click();
    const details = page.getByRole('region', { name: `${SUBJECT}: details` });
    await expect(details.frameLocator('iframe[title="Email preview"]').getByText('Bring your badge.')).toBeVisible();
    await expect(details.getByText(/unsubscribe\?test=1/)).toBeAttached();
    await expect.poll(async () => (await db.collection('admin_logs')
      .where('docPath', '==', `announcement_sends/${record.id}`).where('action', '==', 'view-announcement-send').get()).size)
      .toBeGreaterThanOrEqual(1);

    // Its recipient rows in the email log, by its send id.
    await details.getByRole('link', { name: 'Open the recipient messages in the email log' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/email-log\\?send=${record.id}$`));
    await expect(page.getByText('This list shows only the messages of one announcement send.')).toBeVisible();
    for (const address of RECIPIENTS) {
      await expect(page.getByRole('row').filter({ hasText: address })).toContainText(SUBJECT);
    }
  });
});
