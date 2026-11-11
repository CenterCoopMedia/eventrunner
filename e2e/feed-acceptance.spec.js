// #507 switch-on acceptance, including #511's composer and thread view.
// Fictional emulator data only; posts and replies use the attendee UI.
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, PROJECT_ID, adminAuth, adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

function syntheticDb() {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.trim()
      || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim()
      || !/^demo-[a-z0-9-]+$/.test(PROJECT_ID)) {
    throw new Error('Feed acceptance requires Firestore/Auth emulators and a demo-* project.');
  }
  return adminDb();
}

test.describe.serial('attendee feed switch-on acceptance', () => {
  const stamp = Date.now();
  const staffEmail = `feed-staff-${stamp}@example.test`;
  const readerEmail = `feed-reader-${stamp}@example.test`;
  const authorEmail = `feed-author-${stamp}@example.test`;
  const authorName = `Fictional feed author ${stamp}`;
  const reportedText = `Fictional reported post ${stamp}.`;
  const accountText = `Fictional account cleanup post ${stamp}.`;
  const replyText = `Fictional account cleanup reply ${stamp}.`;
  const survivorText = `Fictional surviving reply ${stamp}.`;
  const cleanupText = `Fictional flag-off cleanup post ${stamp}.`;
  const posts = [];
  const identities = [];
  const contexts = [];
  let db;
  let features;
  let bootstrap;
  let operator;
  let reader;
  let staff;
  let author;
  let staffUid;
  let readerUid;
  let authorUid;
  let authorToken;
  let readerToken;
  let reportedId;
  let accountId;
  let replyId;
  let survivorId;
  let cleanupId;
  let removedPost;

  async function composePost(page, text, parentPostId = null) {
    const field = page.getByRole('textbox', { name: parentPostId ? 'Your reply' : 'Write a post', exact: true });
    await field.fill(text);
    const response = page.waitForResponse((entry) => entry.url().endsWith('/createSocialPost') && entry.request().method() === 'POST');
    await page.getByRole('button', { name: parentPostId ? 'Post reply' : 'Post', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(201);
    const body = await result.json();
    expect(body).toEqual({ postId: expect.any(String), state: 'active' });
    posts.push(body.postId);
    await expect(field).toHaveValue('');
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    expect((await db.doc(`social_posts/${body.postId}`).get()).data()).toMatchObject({
      text, parentPostId, state: 'active',
    });
    return body.postId;
  }

  async function saveFlags(enabled) {
    await operator.goto('/admin/features');
    await expect(operator.getByRole('heading', { name: 'Features', exact: true })).toBeVisible();
    // Observe the previously saved state before changing the form.
    await expect(operator.getByRole('switch', { name: 'Attendee directory', exact: true })).toBeChecked({ checked: !enabled });
    await expect(operator.getByRole('switch', { name: 'Attendee feed', exact: true })).toBeChecked({ checked: !enabled });
    await operator.getByRole('switch', { name: 'Attendee directory', exact: true }).setChecked(enabled);
    await operator.getByRole('switch', { name: 'Attendee feed', exact: true }).setChecked(enabled);
    await operator.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(operator.getByRole('status').filter({ hasText: 'Features saved.' })).toBeVisible();
    expect((await db.doc('config/features').get()).data()).toMatchObject({
      attendeeDirectory: enabled, socialFeed: enabled,
    });
  }

  async function reportInFeed(text) {
    const row = reader.getByRole('region', { name: 'Attendee feed', exact: true })
      .getByRole('listitem').filter({ hasText: text });
    await expect(row.getByText(text, { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Report post', exact: true }).click();
    await row.getByRole('button', { name: 'Send report', exact: true }).click();
    await expect(row.getByRole('status')).toHaveText('Reported. Staff will review this post.');
  }

  async function removeInModeration(postId, text) {
    await staff.goto('/admin/feed-moderation');
    const row = staff.getByRole('listitem').filter({ hasText: `Post ${postId}` });
    await expect(row.getByText(text, { exact: true })).toBeVisible();
    const original = (await db.doc(`social_posts/${postId}`).get()).data();
    await row.getByRole('button', { name: 'Remove post', exact: true }).click();
    await row.getByRole('button', { name: 'Remove this post', exact: true }).click();
    await expect(row.getByText('Post removed.', { exact: true })).toBeVisible();
    await expect(row.getByText(text, { exact: true })).toHaveCount(0);
    const stored = (await db.doc(`social_posts/${postId}`).get()).data();
    expect(Object.keys(stored).sort()).toEqual(['createdAt', 'parentPostId', 'removedAt', 'state']);
    expect(stored).toMatchObject({ state: 'removed', parentPostId: null, createdAt: original.createdAt });
    expect(stored.removedAt.toMillis()).toBeGreaterThanOrEqual(original.createdAt.toMillis());
    const logs = await db.collection('admin_logs').where('docPath', '==', `social_posts/${postId}`).get();
    expect(logs.size).toBe(1);
    expect(Object.keys(logs.docs[0].data()).sort()).toEqual(['action', 'at', 'docPath', 'email', 'uid']);
    expect(logs.docs[0].data()).toMatchObject({
      action: 'removeSocialPost', docPath: `social_posts/${postId}`, uid: staffUid, email: staffEmail,
    });
    return stored;
  }

  test.beforeAll(async ({ browser }) => {
    // Guard precedes every seed/configuration write, even on a misconfigured run.
    db = syntheticDb();
    features = (await db.doc('config/features').get()).data();
    bootstrap = (await db.doc('config/bootstrap').get()).data();
    await db.doc('config/features').set({ ...features, attendeeDirectory: false, socialFeed: false });
    await db.doc('config/bootstrap').set({
      ...bootstrap, staffEmails: [...(bootstrap.staffEmails ?? []), staffEmail],
    });
    for (const email of [staffEmail, readerEmail, authorEmail]) {
      const uid = await ensureUser(email);
      identities.push(uid);
      await expect.poll(async () => (await db.doc(`users/${uid}`).get()).exists).toBe(true);
    }
    [staffUid, readerUid, authorUid] = identities;
    for (const [uid, displayName] of [[readerUid, 'Fictional feed reader'], [authorUid, authorName]]) {
      await db.doc(`users/${uid}`).set({ displayName, registrationStatus: 'approved', profileVisibility: 'attendees_only' }, { merge: true });
    }
    authorToken = await idTokenFor(authorUid);
    readerToken = await idTokenFor(readerUid);
    for (let index = 0; index < 4; index += 1) contexts.push(await browser.newContext());
    // Only this operator context sees the future switch. Never change the
    // source constant, other specs, or a production build for acceptance.
    await contexts[0].route('**/src/admin/socialFeedRelease.js*', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source).toContain('SOCIAL_FEED_RELEASED = false');
      await route.fulfill({ response, body: source.replace('SOCIAL_FEED_RELEASED = false', 'SOCIAL_FEED_RELEASED = true') });
    });
    [operator, reader, staff, author] = await Promise.all(contexts.map((context) => context.newPage()));
    await signIn(operator, ADMIN_EMAIL);
    await signIn(reader, readerEmail);
    await signIn(staff, staffEmail);
    await signIn(author, authorEmail);
  });

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()));
    if (!db) return;
    syntheticDb();
    if (features) await db.doc('config/features').set(features);
    if (bootstrap) await db.doc('config/bootstrap').set(bootstrap);
    for (const id of posts) {
      await db.doc(`social_posts/${id}`).delete();
      for (const [collection, field, value] of [
        ['social_reports', 'postId', id], ['admin_logs', 'docPath', `social_posts/${id}`],
      ]) {
        const rows = await db.collection(collection).where(field, '==', value).get();
        await Promise.all(rows.docs.map((row) => row.ref.delete()));
      }
    }
    for (const uid of identities) {
      await adminAuth().deleteUser(uid).catch((error) => {
        if (error.code !== 'auth/user-not-found') throw error;
      });
      await db.doc(`users/${uid}`).delete();
      await db.doc(`users_public/${uid}`).delete();
      const logs = await db.collection('admin_logs').where('docPath', '==', `users/${uid}`).get();
      await Promise.all(logs.docs.map((row) => row.ref.delete()));
    }
  });

  test('operator switches on both flags; approved attendees compose posts', async () => {
    await saveFlags(true);
    await author.goto('/attendees');
    reportedId = await composePost(author, reportedText);
    accountId = await composePost(author, accountText);
    await reader.goto('/attendees');
    cleanupId = await composePost(reader, cleanupText);
    const authorReport = await callFunction('reportSocialPost', { postId: cleanupId }, authorToken);
    expect(authorReport.status).toBe(201);
  });

  test('attendees open a thread and compose replies; the reader reports a root from the feed', async () => {
    for (const [page, text] of [[author, replyText], [reader, survivorText]]) {
      const row = page.getByRole('region', { name: 'Attendee feed', exact: true })
        .getByRole('listitem').filter({ hasText: accountText });
      await row.getByRole('link', { name: 'View replies', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/attendees/posts/${accountId}$`));
      await expect(page.getByRole('heading', { name: 'Thread', exact: true, level: 1 })).toBeVisible();
      const id = await composePost(page, text, accountId);
      if (page === author) replyId = id;
      else survivorId = id;
    }
    await expect(reader.getByText(replyText, { exact: true })).toBeVisible();
    await reader.getByRole('link', { name: 'Back to the attendee feed', exact: true }).click();
    await expect(reader.getByText(accountText, { exact: true })).toBeVisible();
    await expect(reader.getByText(replyText, { exact: true })).toHaveCount(0);
    await reportInFeed(reportedText);
    const reports = await db.collection('social_reports').where('postId', '==', reportedId).get();
    expect(reports.size).toBe(1);
    expect(Object.keys(reports.docs[0].data()).sort()).toEqual(['createdAt', 'postId', 'reporterUid']);
    expect(reports.docs[0].data()).toMatchObject({ postId: reportedId, reporterUid: readerUid });
  });

  test('staff removes the reported post; live attendee feed loses it and the audit retains no content', async () => {
    removedPost = await removeInModeration(reportedId, reportedText);
    await expect(reader.getByText(reportedText, { exact: true })).toHaveCount(0);
    await expect(reader.getByText(accountText, { exact: true })).toBeVisible();
  });

  test('account removal clears its active roots, replies and submitted reports while retaining the tombstone', async () => {
    await staff.goto('/admin/attendees');
    await staff.getByLabel('Search', { exact: true }).fill(authorName);
    await staff.getByRole('button', { name: 'Edit attendee record', exact: true }).click();
    const panel = staff.getByRole('region', { name: `Record for ${authorName}` });
    await panel.getByRole('button', { name: 'Delete account', exact: true }).click();
    await panel.getByRole('button', { name: 'Delete this account', exact: true }).click();
    await expect(staff.getByRole('status').filter({ hasText: 'Deleted the account for' }))
      .toHaveText(`Deleted the account for ${authorName}.`);
    expect((await db.doc(`users/${authorUid}`).get()).exists).toBe(false);
    await expect(adminAuth().getUser(authorUid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    for (const id of [accountId, replyId]) expect((await db.doc(`social_posts/${id}`).get()).exists).toBe(false);
    expect((await db.collection('social_posts').where('authorUid', '==', authorUid).get()).empty).toBe(true);
    expect((await db.collection('social_reports').where('reporterUid', '==', authorUid).get()).empty).toBe(true);
    expect((await db.doc(`social_posts/${reportedId}`).get()).data()).toEqual(removedPost);
    expect((await db.doc(`social_posts/${cleanupId}`).get()).data()).toMatchObject({ state: 'active', authorUid: readerUid });
    await expect(reader.getByText(accountText, { exact: true })).toHaveCount(0);
    await reader.goto(`/attendees/posts/${accountId}`);
    await expect(reader.getByText('Original post removed', { exact: true })).toBeVisible();
    await expect(reader.getByText(survivorText, { exact: true })).toBeVisible();
    await expect(reader.getByText(replyText, { exact: true })).toHaveCount(0);
    await expect(reader.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveCount(0);
    expect((await db.doc(`social_posts/${survivorId}`).get()).data()).toMatchObject({
      state: 'active', authorUid: readerUid, parentPostId: accountId,
    });
    await reader.getByRole('link', { name: 'Back to the attendee feed', exact: true }).click();
    await reportInFeed(cleanupText);
  });

  test('operator turns both flags off; attendee loses the feed and staff still removes a reported post', async () => {
    await saveFlags(false);
    await expect(reader.getByRole('region', { name: 'Attendee feed', exact: true })).toHaveCount(0);
    await expect(reader.getByRole('textbox', { name: 'Write a post', exact: true })).toHaveCount(0);
    await reader.goto(`/attendees/posts/${accountId}`);
    await expect(reader.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    await expect(reader.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveCount(0);
    await expect(reader.getByText(survivorText, { exact: true })).toHaveCount(0);
    expect((await callFunction('createSocialPost', {
      text: 'Fictional closed-feed post.', submissionKey: `acceptance-${stamp}-closed`,
    }, readerToken)).status).toBe(404);
    expect((await callFunction('reportSocialPost', { postId: cleanupId }, readerToken)).status).toBe(404);
    await removeInModeration(cleanupId, cleanupText);
    expect((await db.doc('config/features').get()).data()).toMatchObject({ attendeeDirectory: false, socialFeed: false });
  });
});
