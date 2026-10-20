// Scheduled speaker reminders (issue #518), driven through the real admin
// pages on the emulators: a staff account sets a due date, previews one
// sample per offset, approves and turns the schedule on, reads the next-run
// panel, then saves new reminder wording on the speaker reminders page and
// finds the schedule paused, in words.
//
// The hourly run itself is not triggered here (the unit and rules suites
// cover it); nothing is emailed. The schedule, the saved wording, the
// speaker and the staff grant are removed at the end, so the speaker
// reminders spec still sees the shipped wording.
import { test, expect } from '@playwright/test';
import { adminDb, openAdminGroups, signIn } from './helpers.mjs';

const STAFF_EMAIL = 'e2e-schedules-staff@example.test';

test.describe.serial('Scheduled reminders', () => {
  const stamp = Date.now();
  const speakerId = `e2e-sched-${stamp}`;
  // Sorts first, so the next-run panel lists the name among the first fifty.
  const speakerName = `Aa Sched${stamp}`;
  let seededBootstrap;

  test.beforeAll(async () => {
    const db = adminDb();
    const config = db.collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    await db.collection('reminder_schedules').doc('speakers').delete();
    await db.collection('email_templates').doc('speaker.reminder').delete();
    // Accepted, with no biography and no headshot.
    await db.collection('speakers').doc(speakerId).set({
      firstName: 'Aa', lastName: `Sched${stamp}`, email: `e2e-sched-${stamp}@example.test`, status: 'accepted',
      bio: '', headshotPath: '', createdAt: new Date(), updatedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    const db = adminDb();
    await db.collection('speakers').doc(speakerId).delete();
    await db.collection('reminder_schedules').doc('speakers').delete();
    await db.collection('email_templates').doc('speaker.reminder').delete();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('staff preview, approve, read the next run, and see the pause after a wording edit', async ({ page }) => {
    await signIn(page, STAFF_EMAIL);
    await page.goto('/admin/reminders');
    await expect(page).toHaveURL(/\/admin\/reminders\/scheduled$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Scheduled reminders' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Scheduled reminders' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('schedule-state')).toHaveText('Scheduled speaker reminders are off.');

    // A due date thirty days out, at 17:00 on the event clock.
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const dueField = page.getByRole('group', { name: 'Due date', exact: true });
    await dueField.getByLabel('Date', { exact: true }).fill(due);
    await dueField.getByLabel('Time', { exact: true }).fill('17:00');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeFocused();

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    for (const days of [14, 7, 2]) {
      await expect(page.getByRole('heading', { name: `${days}-day reminder` })).toBeVisible();
    }
    await expect(page.getByTestId('schedule-preview-text-7')).toContainText('Please send them by');
    await expect(page.getByTestId('schedule-preview-text-7')).toContainText('/speaker/dashboard');

    await page.getByRole('button', { name: 'Approve and turn on' }).click();
    await expect(page.getByTestId('schedule-state')).toContainText('Scheduled speaker reminders are on.');
    await expect(page.getByText('Approved. Scheduled speaker reminders are on.')).toBeVisible();
    await expect(page.getByTestId('next-run')).toContainText('Next: the 14-day reminder,');
    await expect(page.getByTestId('next-run')).toContainText('America/New_York');
    await expect(page.getByText(/It would reach \d+ speakers?:/)).toContainText(speakerName);
    await expect(page.getByTestId('last-run')).toHaveText('The schedule has not run yet.');

    // New wording on the speaker reminders page pauses the schedule.
    await page.getByRole('link', { name: 'Speaker reminders' }).click();
    await expect(page).toHaveURL(/\/admin\/speakers\/reminders\/send$/);
    await expect(page.getByText('Saving pauses scheduled reminders until you approve them again.')).toBeVisible();
    await page.getByLabel('Subject').fill(`Still needed for {{event_name}} ${stamp}`);
    await page.getByRole('button', { name: 'Save wording' }).click();
    await expect(page.getByText('Wording saved. The next preview and send use it.')).toBeVisible();

    // Back through the rail: the item sits in the Communications group,
    // which is folded while a Program page is open.
    await openAdminGroups(page);
    await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Scheduled reminders' }).click();
    await expect(page.getByTestId('schedule-state')).toContainText('Scheduled speaker reminders are paused.');
    await expect(page.getByText('Paused: The reminder wording changed after it was approved. Preview the wording, then approve it again.')).toBeVisible();
  });
});
