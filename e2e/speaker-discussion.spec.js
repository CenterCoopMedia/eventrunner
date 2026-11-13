// Synthetic owner flow against the emulator and its console email provider.
import { test, expect } from '@playwright/test';
import { adminAuth, adminDb, callFunction, ensureUser, idTokenFor, signIn } from './helpers.mjs';

test.describe.serial('speaker discussion points', () => {
  const stamp = Date.now();
  const email = `e2e-discussion-${stamp}@example.test`;
  const speakerId = `e2e-discussion-${stamp}`;
  const sessions = [`${speakerId}-one`, `${speakerId}-two`];
  let uid;
  let otherUid;

  test.beforeAll(async () => {
    uid = await ensureUser(email);
    otherUid = await ensureUser(`e2e-discussion-other-${stamp}@example.test`);
    const db = adminDb();
    const at = new Date();
    await db.collection('users').doc(uid).set({
      uid, email, displayName: 'Discussion Speaker', visibility: 'private',
      registrationStatus: 'approved', speakerId, createdAt: at, updatedAt: at,
    });
    await db.collection('speakers').doc(speakerId).set({
      firstName: 'Discussion', lastName: 'Speaker', slug: speakerId, email,
      status: 'approved', uid, createdAt: at, updatedAt: at,
    });
    for (const [index, id] of sessions.entries()) {
      await db.collection('cmsSchedule').doc(id).set({
        title: `Discussion session ${index + 1}`, speakerIds: [speakerId],
        dayId: 'day-1', startTime: '10:00', endTime: '11:00',
        visible: true, order: index, description: 'Synthetic discussion-points session.',
      });
    }
  });

  test.afterAll(async () => {
    const db = adminDb();
    for (const id of sessions) await db.collection('cmsSchedule').doc(id).delete();
    await db.collection('speakers').doc(speakerId).delete();
    if (uid) {
      await db.collection('users').doc(uid).delete();
      await adminAuth().deleteUser(uid);
    }
    if (otherUid) await adminAuth().deleteUser(otherUid);
  });

  for (const width of [1280, 390]) {
    test(`owner saves, returns and replaces with keyboard at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, email);
      await page.goto('/speaker/dashboard');
      await expect(page.getByRole('heading', { name: 'Speaker dashboard' })).toBeVisible();
      const details = page.getByRole('tab', { name: 'Details', exact: true });
      await details.focus();
      await page.keyboard.press('End');
      const discussion = page.getByRole('tab', { name: 'Discussion points' });
      await expect(discussion).toBeFocused();
      await expect(discussion).toHaveAttribute('aria-selected', 'true');
      const field = page.getByRole('textbox', { name: 'Discussion points' });
      await expect(field).toBeEnabled();
      const text = `Synthetic opening question at ${width}px.`;
      await field.fill(text);
      await page.getByRole('tab', { name: 'Details', exact: true }).click();
      await page.getByRole('combobox', { name: 'Session', exact: true }).selectOption(sessions[1]);
      await discussion.click();
      await expect(field).toHaveValue(text);

      await field.focus();
      await page.keyboard.press('Tab');
      // A prior saved submission adds a disclosure between the field/action.
      if (await page.getByText('Last confirmed submission', { exact: true }).count()) await page.keyboard.press('Tab');
      const save = page.getByRole('button', { name: /^(Save discussion points|Replace saved discussion points)$/ });
      await expect(save).toBeFocused();
      const focus = await save.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      expect(focus.width).toBeGreaterThan(0);
      expect(focus.style).not.toBe('none');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status').filter({ hasText: 'Your discussion points are saved.' })).toBeVisible();
      await page.reload();
      await discussion.click();
      await expect(field).toHaveValue(text);
      await field.fill(`${text}\nA replacement question.`);
      await page.getByRole('button', { name: 'Replace saved discussion points' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Your discussion points are saved.' })).toBeVisible();

      const token = await idTokenFor(uid);
      const read = await callFunction('getSpeakerDiscussionPoints', { speakerId }, token);
      expect(read.status).toBe(200);
      expect(read.body.submission.text).toBe(`${text}\nA replacement question.`);
      const stored = (await adminDb().collection('speakers').doc(speakerId).get()).data();
      expect(stored.discussionPoints.text).toBe(read.body.submission.text);
      expect(stored.pendingEdits).toBeUndefined();
      const publicProfile = (await adminDb().collection('speakers_public').doc(speakerId).get()).data();
      expect(publicProfile?.discussionPoints).toBeUndefined();
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
      await testInfo.attach(`discussion-${width}px`, {
        body: await page.screenshot({ path: `test-results/admin-visual-evidence/speaker-discussion-${width}.png`, fullPage: true }),
        contentType: 'image/png',
      });
    });
  }

  test('an accepted speaker with no visible session can save at phone width', async ({ page }) => {
    for (const id of sessions) await adminDb().collection('cmsSchedule').doc(id).update({ visible: false });
    await adminDb().collection('speakers').doc(speakerId).update({ status: 'accepted' });
    await page.setViewportSize({ width: 390, height: 900 });
    await signIn(page, email);
    await page.goto('/speaker/dashboard');
    await expect(page.getByText('No sessions are assigned to you.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Discussion points' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', { name: 'Session', exact: true })).toHaveCount(0);
    const field = page.getByRole('textbox', { name: 'Discussion points' });
    await expect(field).toBeEnabled();
    await field.fill('Discussion points before my session is public.');
    await page.getByRole('button', { name: 'Replace saved discussion points' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your discussion points are saved.' })).toBeVisible();
    const read = await callFunction('getSpeakerDiscussionPoints', { speakerId }, await idTokenFor(uid));
    expect(read.status).toBe(200);
    expect(read.body.submission.text).toBe('Discussion points before my session is public.');
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/admin-visual-evidence/speaker-discussion-unassigned-390.png', fullPage: true });
  });

  test('another account cannot read or replace the submission', async () => {
    const token = await idTokenFor(otherUid);
    const before = (await adminDb().collection('speakers').doc(speakerId).get()).data().discussionPoints;
    const read = await callFunction('getSpeakerDiscussionPoints', { speakerId }, token);
    expect(read.status).toBe(403);
    const save = await callFunction('saveSpeakerDiscussionPoints', {
      speakerId, text: 'Foreign replacement must fail.', expectedRevision: before.revision,
      requestId: 'request_foreign_12345678',
    }, token);
    expect(save.status).toBe(403);
    const after = (await adminDb().collection('speakers').doc(speakerId).get()).data().discussionPoints;
    expect(after).toEqual(before);
  });
});
