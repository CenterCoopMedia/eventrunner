// #789's contract is the oracle: cleanup ignores the feed flags, live
// grants enforce access, and removal replaces content with one audited
// tombstone. All identities and posts here are fictional emulator data.
import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, PROJECT_ID, adminDb, adminIdToken, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const STAFF_EMAIL = 'e2e-moderation-staff@example.test';
const ATTENDEE_EMAIL = 'e2e-moderation-attendee@example.test';

function syntheticDb() {
  // Must precede adminDb() and every social seed/configuration write.
  if (!process.env.FIRESTORE_EMULATOR_HOST?.trim() || !/^demo-[a-z0-9-]+$/.test(PROJECT_ID)) {
    throw new Error('Feed moderation seeds require FIRESTORE_EMULATOR_HOST and a demo-* project.');
  }
  return adminDb();
}

async function reportRead(token) {
  return fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/social_reports?pageSize=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test.describe.serial('private feed moderation', () => {
  const stamp = Date.now();
  const postId = `moderation-${stamp}`;
  const repeatedId = `moderation-repeat-${stamp}`;
  const revokedId = `moderation-revoked-${stamp}`;
  const text = `Fictional report target ${stamp}.`;
  let db;
  let features;
  let bootstrap;
  let staff;
  let staffToken;
  let attendeeToken;
  let staffUid;
  let attendeeUid;
  let reportIds = [];

  test.beforeAll(async ({ browser }) => {
    db = syntheticDb();
    features = (await db.doc('config/features').get()).data();
    bootstrap = (await db.doc('config/bootstrap').get()).data();
    await db.doc('config/bootstrap').set({
      ...bootstrap, staffEmails: [...(bootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    staffUid = await ensureUser(STAFF_EMAIL);
    attendeeUid = await ensureUser(ATTENDEE_EMAIL);
    staffToken = await idTokenFor(staffUid);
    attendeeToken = await idTokenFor(attendeeUid);
    await db.doc(`users/${attendeeUid}`).set({ registrationStatus: 'approved', role: 'attendee' });
    await db.doc('config/features').set({ ...features, attendeeDirectory: true, socialFeed: true });
    for (const id of [postId, repeatedId, revokedId]) {
      await db.doc(`social_posts/${id}`).set({
        state: 'active', authorUid: attendeeUid, text: id === postId ? text : `Fictional ${id}`,
        createdAt: new Date(), parentPostId: null,
      });
      const report = await callFunction('reportSocialPost', { postId: id }, attendeeToken);
      expect(report.status).toBe(201);
      expect(report.body).toEqual({ postId: id, reported: true });
    }
    const reports = await db.collection('social_reports').where('reporterUid', '==', attendeeUid).get();
    reportIds = reports.docs.map((entry) => entry.id);
    expect(reports.size).toBe(3);
    for (const entry of reports.docs) {
      expect(Object.keys(entry.data()).sort()).toEqual(['createdAt', 'postId', 'reporterUid']);
    }
    // Equal timestamps exercise the document-id tie-break at the real
    // Firestore cursor boundary. These older reports must remain reachable.
    const batch = db.batch();
    for (let index = 0; index < 51; index += 1) {
      const id = `moderation-overflow-${stamp}-${String(index).padStart(2, '0')}`;
      reportIds.push(id);
      batch.set(db.doc(`social_reports/${id}`), {
        postId: revokedId, reporterUid: `fictional-reporter-${index}`, createdAt: new Date('2020-01-01T00:00:00Z'),
      });
    }
    await batch.commit();
    await db.doc('config/features').set({ ...features, attendeeDirectory: false, socialFeed: false });
    staff = await (await browser.newContext()).newPage();
    await signIn(staff, STAFF_EMAIL);
  });

  test.afterAll(async () => {
    await staff?.context().close();
    if (!db) return;
    syntheticDb();
    if (features) await db.doc('config/features').set(features);
    if (bootstrap) await db.doc('config/bootstrap').set(bootstrap);
    for (const id of [postId, repeatedId, revokedId]) {
      await db.doc(`social_posts/${id}`).delete();
      const logs = await db.collection('admin_logs').where('docPath', '==', `social_posts/${id}`).get();
      await Promise.all(logs.docs.map((entry) => entry.ref.delete()));
    }
    await Promise.all(reportIds.map((id) => db.doc(`social_reports/${id}`).delete()));
    if (attendeeUid) await db.doc(`users/${attendeeUid}`).delete();
  });

  test('staff reach the docket with both flags off, cancel by keyboard, and retain the post after a network failure', async () => {
    await staff.goto('/admin/feed-moderation');
    await expect(staff.getByRole('heading', { level: 1, name: 'Feed moderation' })).toBeVisible();
    await expect(staff.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Feed moderation', exact: true })).toBeVisible();
    const row = staff.getByRole('listitem').filter({ hasText: `Post ${postId}` });
    await expect(row.getByText(text, { exact: true })).toBeVisible();
    await expect(row).not.toContainText(attendeeUid);
    const trigger = row.getByRole('button', { name: 'Remove post', exact: true });
    await trigger.focus();
    await staff.keyboard.press('Enter');
    await expect(row.getByRole('heading', { name: 'Remove this post?' })).toBeFocused();
    await staff.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await staff.route('**/removeSocialPost', (route) => route.abort('failed'));
    await trigger.click();
    await row.getByRole('button', { name: 'Remove this post', exact: true }).click();
    await expect(row.getByRole('alert')).toContainText('You can try again.');
    await expect(row.getByText(text, { exact: true })).toBeVisible();
    expect((await db.doc(`social_posts/${postId}`).get()).data().state).toBe('active');
    expect((await db.collection('admin_logs').where('docPath', '==', `social_posts/${postId}`).get()).size).toBe(0);
    await staff.unroute('**/removeSocialPost');
  });

  test('retry removes the content and leaves exactly one metadata-only audit, on desktop and phone', async () => {
    const row = staff.getByRole('listitem').filter({ hasText: `Post ${postId}` });
    await fs.mkdir('test-results/admin-visual-evidence', { recursive: true });
    await staff.screenshot({ path: 'test-results/admin-visual-evidence/feed-moderation-desktop.png', animations: 'disabled' });
    await row.getByRole('button', { name: 'Remove this post', exact: true }).click();
    await expect(row.getByText('Post removed.', { exact: true })).toBeVisible();
    await expect(row.getByText(text, { exact: true })).toHaveCount(0);
    await expect(row.getByRole('heading', { name: `Post ${postId}`, exact: true })).toBeFocused();
    const stored = (await db.doc(`social_posts/${postId}`).get()).data();
    expect(Object.keys(stored).sort()).toEqual(['createdAt', 'parentPostId', 'removedAt', 'state']);
    expect(stored.state).toBe('removed');
    const logs = await db.collection('admin_logs').where('docPath', '==', `social_posts/${postId}`).get();
    expect(logs.size).toBe(1);
    expect(Object.keys(logs.docs[0].data()).sort()).toEqual(['action', 'at', 'docPath', 'email', 'uid']);
    expect(logs.docs[0].data()).toMatchObject({ action: 'removeSocialPost', uid: staffUid, email: STAFF_EMAIL });
    expect(JSON.stringify(logs.docs[0].data())).not.toContain(text);
    expect(JSON.stringify(logs.docs[0].data())).not.toContain(attendeeUid);
    await staff.setViewportSize({ width: 390, height: 844 });
    await expect(row.getByText('Removed', { exact: true })).toBeVisible();
    expect(await staff.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await staff.screenshot({ path: 'test-results/admin-visual-evidence/feed-moderation-phone.png', animations: 'disabled' });
    await staff.goto('/admin/features');
    await expect(staff.getByRole('heading', { name: 'This section needs operator access' })).toBeVisible();
  });

  test('bounded report pages reach older reports even when timestamps tie', async () => {
    await staff.goto('/admin/feed-moderation');
    await expect(staff.getByRole('button', { name: 'Older reports', exact: true })).toBeVisible();
    await staff.getByRole('button', { name: 'Older reports', exact: true }).click();
    await expect(staff.getByText('4 reports in this list', { exact: true })).toBeVisible();
    await expect(staff.getByRole('listitem')).toHaveCount(1);
    await expect(staff.getByRole('button', { name: 'Older reports', exact: true })).toHaveCount(0);
    await staff.getByRole('button', { name: 'Newest reports', exact: true }).click();
    await expect(staff.getByRole('listitem')).toHaveCount(3);
    await expect(staff.getByText('Removed', { exact: true })).toBeVisible();
  });

  test('an operator can clean up with flags off; a concurrent already-removed response keeps no text', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/feed-moderation');
    const row = page.getByRole('listitem').filter({ hasText: `Post ${repeatedId}` });
    await expect(row.getByText(`Fictional ${repeatedId}`, { exact: true })).toBeVisible();
    const token = await adminIdToken();
    // Hold only the HTTP boundary. The real operator transaction wins,
    // then the original request reaches the real already-removed path.
    await page.route('**/removeSocialPost', async (route) => {
      const first = await callFunction('removeSocialPost', { postId: repeatedId }, token);
      expect(first.body).toEqual({ postId: repeatedId, removed: true, alreadyRemoved: false });
      await route.continue();
    });
    const response = page.waitForResponse((entry) => entry.url().endsWith('/removeSocialPost') && entry.request().method() === 'POST');
    await row.getByRole('button', { name: 'Remove post', exact: true }).click();
    await row.getByRole('button', { name: 'Remove this post', exact: true }).click();
    expect(await (await response).json()).toEqual({ postId: repeatedId, removed: true, alreadyRemoved: true });
    await expect(row.getByText('This post was already removed.', { exact: true })).toBeVisible();
    await expect(row.getByText(`Fictional ${repeatedId}`, { exact: true })).toHaveCount(0);
    expect((await db.collection('admin_logs').where('docPath', '==', `social_posts/${repeatedId}`).get()).size).toBe(1);
  });

  test('attendees cannot read reports or remove posts, and a revoked staff token fails at the live boundary', async () => {
    expect((await reportRead(attendeeToken)).status).toBe(403);
    expect((await reportRead(null)).status).toBe(403);
    const denied = await callFunction('removeSocialPost', { postId: revokedId }, attendeeToken);
    expect(denied.status).toBe(403);
    await staff.goto('/admin/feed-moderation');
    await expect(staff.getByText(`Fictional ${revokedId}`, { exact: true })).toBeVisible();
    await db.doc('config/bootstrap').set(bootstrap);
    const revoked = await callFunction('removeSocialPost', { postId: revokedId }, staffToken);
    expect(revoked.status).toBe(403);
    expect((await reportRead(staffToken)).status).toBe(403);
    expect((await db.doc(`social_posts/${revokedId}`).get()).data().state).toBe('active');
    expect((await db.collection('admin_logs').where('docPath', '==', `social_posts/${revokedId}`).get()).size).toBe(0);
    await expect(staff.getByRole('list', { name: 'Reported posts' })).toHaveCount(0);
  });
});
