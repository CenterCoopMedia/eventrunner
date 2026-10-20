// Speaker reminders, driven through the real admin page: a staff account
// selects one accepted speaker, previews the message, confirms the count,
// and sends. The evidence is the captured mail (the console email provider
// appends one JSON line per message to E2E_MAIL_FILE, e2e/helpers.mjs): the
// speaker's inbox must hold exactly one reminder, with the body the preview
// showed, and the page must show when the speaker was last reminded.
//
// The first test's speaker owns no session. The second test gives the
// speaker one published session for the length of the test, marks it in the
// session editor as needing no materials, and checks the reminder page drops
// the speaker from the "Materials missing" group (issue #332). The speaker,
// the session, its draft, the reminder record and the staff grant are
// removed at the end.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { MAIL_FILE, adminDb, mailFileSize, signIn } from './helpers.mjs';

const STAFF_EMAIL = 'e2e-reminders-staff@example.test';

function remindersSince(since, email) {
  if (!MAIL_FILE || !fs.existsSync(MAIL_FILE)) return [];
  return fs.readFileSync(MAIL_FILE).subarray(since).toString('utf8').split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    })
    .filter((mail) => mail.to === email && mail.tag === 'speaker.reminder');
}

async function waitForReminders(since, email, count, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mails = remindersSince(since, email);
    if (mails.length >= count) return mails;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return remindersSince(since, email);
}

test.describe.serial('Speaker reminders', () => {
  const stamp = Date.now();
  const speakerId = `e2e-remind-${stamp}`;
  const speakerEmail = `e2e-remind-${stamp}@example.test`;
  const speakerName = `Remi Nder${stamp}`;
  const sessionId = `e2e-remind-session-${stamp}`;
  const sessionTitle = `Fireside chat ${stamp}`;
  let seededBootstrap;

  test.beforeAll(async () => {
    const db = adminDb();
    const config = db.collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    // Accepted, with no biography and no headshot.
    await db.collection('speakers').doc(speakerId).set({
      firstName: 'Remi', lastName: `Nder${stamp}`, email: speakerEmail, status: 'accepted',
      bio: '', headshotPath: '', createdAt: new Date(), updatedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    const db = adminDb();
    await db.collection('cmsSchedule').doc(sessionId).delete();
    await db.collection('cmsSchedule_drafts').doc(sessionId).delete();
    await db.collection('speakers').doc(speakerId).delete();
    await db.collection('speaker_reminders').doc(speakerId).delete();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('staff select a speaker, preview the reminder, confirm the count, and send it once', async ({ page }) => {
    await signIn(page, STAFF_EMAIL);
    await page.goto('/admin/speakers');
    await page.getByRole('link', { name: `Remind ${speakerName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/speakers/reminders/send\\?speaker=${speakerId}$`));

    const box = page.getByRole('checkbox', { name: speakerName });
    await expect(box).toBeChecked();
    await expect(page.getByTestId(`last-reminded-${speakerId}`)).toHaveText('Not reminded yet.');
    await expect(page.getByText('1 speaker selected')).toBeVisible();

    await page.getByRole('button', { name: 'Preview reminders' }).click();
    await expect(page.getByText('1 speaker gets a reminder.')).toBeVisible();
    const previewText = await page.getByTestId('reminder-preview-text').textContent();
    expect(previewText).toContain(`Hi ${speakerName},`);
    expect(previewText).toContain('- Add a short biography to your speaker profile.');
    expect(previewText).toContain('- Add a headshot to your speaker profile.');
    expect(previewText).toContain('/speaker/dashboard');

    const since = mailFileSize();
    await page.getByRole('button', { name: 'Send 1 reminder' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Send 1 reminder?' })).toBeVisible();
    await expect(dialog).toContainText(speakerName);
    await dialog.getByRole('button', { name: 'Send 1 reminder' }).click();
    await expect(page.getByText('Sent 1 reminder.')).toBeVisible();

    const mails = await waitForReminders(since, speakerEmail, 1);
    expect(mails, 'the reminder reached the captured inbox').toHaveLength(1);
    expect(mails[0].subject).toMatch(/^Items we still need for /);
    expect(mails[0].text).toBe(previewText);

    await expect(page.getByTestId(`last-reminded-${speakerId}`)).toContainText('Last reminded');
    await expect(page.getByTestId(`last-reminded-${speakerId}`)).toContainText('about Biography, Headshot');

    // A second preview the same day leaves the speaker out and says why.
    await page.getByRole('checkbox', { name: speakerName }).check();
    await page.getByRole('button', { name: 'Preview reminders' }).click();
    await expect(page.getByText('This speaker was reminded less than 24 hours ago.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Send \d+ reminders?$/ })).toHaveCount(0);
    // Nothing more reached the inbox.
    await page.waitForTimeout(1000);
    expect(remindersSince(since, speakerEmail)).toHaveLength(1);
  });

  test('a session marked in the editor as needing no materials leaves its speaker out of the materials group', async ({ page }) => {
    await adminDb().collection('cmsSchedule').doc(sessionId).set({
      title: sessionTitle,
      description: 'A conversation with no slides.',
      dayId: 'day-1',
      startTime: '10:00',
      endTime: '11:00',
      visible: true,
      speakerIds: [speakerId],
      revision: 1,
    });

    await signIn(page, STAFF_EMAIL);
    await page.goto('/admin/speakers/reminders/send?show=materials');
    const box = page.getByRole('checkbox', { name: speakerName });
    await expect(box).toBeVisible();
    const row = page.getByRole('listitem').filter({ has: box });
    await expect(row).toContainText(`Materials (${sessionTitle})`);

    await page.goto(`/admin/sessions/${encodeURIComponent(sessionId)}`);
    const mark = page.getByLabel('This session needs no slides or other materials');
    await expect(page.getByLabel('Public title')).toHaveValue(sessionTitle);
    await expect(mark).not.toBeChecked();
    await mark.check();
    await page.getByRole('button', { name: 'Save and publish' }).click();
    await expect.poll(async () => (await adminDb().collection('cmsSchedule').doc(sessionId).get()).data()?.materialsNotNeeded)
      .toBe(true);

    await page.goto('/admin/speakers/reminders/send?show=materials');
    await expect(page.getByLabel('Show')).toHaveValue('materials');
    // The list has loaded (or is empty) before the speaker's absence counts.
    await expect(page.getByRole('list', { name: 'Accepted speakers' })
      .or(page.getByRole('heading', { name: 'No speaker matches' }))).toBeVisible();
    await expect(page.getByRole('checkbox', { name: speakerName })).toHaveCount(0);
    // Under "Anything missing" the speaker is still listed for the profile
    // items, and materials are no longer named.
    await page.goto('/admin/speakers/reminders/send?show=any');
    const again = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: speakerName }) });
    await expect(again).toContainText('Missing: Biography, Headshot.');
  });
});
