// Issue #511's contract is the oracle: an approved attendee posts, a second
// approved attendee replies, both entries are reported and removed through
// the existing moderation endpoint, and a removed root closes replies while
// its replies stay readable. All identities and posts here are fictional
// emulator data; no email is sent.
import { test, expect } from '@playwright/test';
import {
  PROJECT_ID, adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const AUTHOR_EMAIL = 'e2e-thread-author@example.test';
const REPLIER_EMAIL = 'e2e-thread-replier@example.test';
const PENDING_EMAIL = 'e2e-thread-pending@example.test';
const STAFF_EMAIL = 'e2e-thread-staff@example.test';

function syntheticDb() {
  // Must precede adminDb() and every social seed/configuration write.
  if (!process.env.FIRESTORE_EMULATOR_HOST?.trim() || !/^demo-[a-z0-9-]+$/.test(PROJECT_ID)) {
    throw new Error('Thread seeds require FIRESTORE_EMULATOR_HOST and a demo-* project.');
  }
  return adminDb();
}

/** A direct client create through the Firestore REST surface. */
async function directCreate(token, id) {
  return fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/social_posts?documentId=${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: { state: { stringValue: 'active' }, text: { stringValue: 'Direct' } } }),
  });
}

test.describe.serial('attendee posts and threads', () => {
  const stamp = Date.now();
  const rootText = `Fictional root post ${stamp}.`;
  const replyText = `Fictional reply ${stamp}.`;
  let db;
  let features;
  let bootstrap;
  let author;
  let replier;
  let authorUid;
  let replierUid;
  let pendingUid;
  let staffToken;
  let rootId;
  let replyId;
  let secondId;

  test.beforeAll(async ({ browser }) => {
    db = syntheticDb();
    features = (await db.doc('config/features').get()).data();
    bootstrap = (await db.doc('config/bootstrap').get()).data();
    await db.doc('config/bootstrap').set({
      ...bootstrap, staffEmails: [...(bootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    authorUid = await ensureUser(AUTHOR_EMAIL);
    replierUid = await ensureUser(REPLIER_EMAIL);
    pendingUid = await ensureUser(PENDING_EMAIL);
    staffToken = await idTokenFor(await ensureUser(STAFF_EMAIL));
    await db.doc(`users/${authorUid}`).set({ registrationStatus: 'approved', role: 'attendee' });
    await db.doc(`users/${replierUid}`).set({ registrationStatus: 'approved', role: 'attendee' });
    await db.doc(`users/${pendingUid}`).set({ registrationStatus: 'pending', role: 'attendee' });
    await db.doc('config/features').set({ ...features, attendeeDirectory: true, socialFeed: true });
    author = await (await browser.newContext()).newPage();
    replier = await (await browser.newContext()).newPage();
    await signIn(author, AUTHOR_EMAIL);
    await signIn(replier, REPLIER_EMAIL);
  });

  test.afterAll(async () => {
    await author?.context().close();
    await replier?.context().close();
    if (!db) return;
    syntheticDb();
    if (features) await db.doc('config/features').set(features);
    if (bootstrap) await db.doc('config/bootstrap').set(bootstrap);
    for (const id of [rootId, replyId, secondId].filter(Boolean)) {
      await db.doc(`social_posts/${id}`).delete();
      const logs = await db.collection('admin_logs').where('docPath', '==', `social_posts/${id}`).get();
      await Promise.all(logs.docs.map((entry) => entry.ref.delete()));
      const reports = await db.collection('social_reports').where('postId', '==', id).get();
      await Promise.all(reports.docs.map((entry) => entry.ref.delete()));
    }
    for (const uid of [authorUid, replierUid, pendingUid].filter(Boolean)) {
      await db.doc(`users/${uid}`).delete();
    }
  });

  test('an approved attendee posts by keyboard; a dropped answer and its retry store one post', async () => {
    await author.goto('/attendees');
    const field = author.getByRole('textbox', { name: 'Write a post' });
    await expect(field).toBeVisible();
    await field.focus();
    await author.keyboard.type(rootText);
    // The server stores the post, and the browser never hears back.
    let dropped = false;
    await author.route('**/createSocialPost', async (route) => {
      if (dropped || route.request().method() !== 'POST') return route.continue();
      dropped = true;
      await route.fetch();
      return route.abort('failed');
    });
    await author.keyboard.press('Tab');
    await expect(author.getByRole('button', { name: 'Post', exact: true })).toBeFocused();
    await author.keyboard.press('Enter');
    await expect(author.getByRole('alert')).toContainText('was not confirmed');
    await expect(field).toHaveValue(rootText);
    await author.unroute('**/createSocialPost');
    const response = author.waitForResponse((entry) => entry.url().endsWith('/createSocialPost') && entry.request().method() === 'POST');
    await author.getByRole('button', { name: 'Post', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(author.getByText('Posted. Your post is at the top of the feed.')).toBeVisible();
    await expect(field).toHaveValue('');

    const stored = await db.collection('social_posts').where('authorUid', '==', authorUid).get();
    expect(stored.size).toBe(1);
    rootId = stored.docs[0].id;
    expect(stored.docs[0].data()).toMatchObject({ state: 'active', text: rootText, parentPostId: null });
    await expect(author.getByRole('region', { name: 'Attendee feed' }).getByText(rootText)).toBeVisible();
  });

  test('a second approved attendee replies in the thread and reports both entries', async () => {
    await replier.goto('/attendees');
    const entry = replier.getByRole('listitem').filter({ hasText: rootText });
    await entry.getByRole('link', { name: 'View replies', exact: true }).click();
    await expect(replier).toHaveURL(new RegExp(`/attendees/posts/${rootId}$`));
    await expect(replier.getByRole('heading', { level: 1, name: 'Thread' })).toBeVisible();
    expect(await replier.title()).not.toContain(rootText);
    await expect(replier.getByText('No replies yet.')).toBeVisible();

    await replier.getByRole('textbox', { name: 'Your reply' }).fill(replyText);
    await replier.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(replier.getByText('Reply posted.')).toBeVisible();
    await expect(replier.getByText(replyText)).toBeVisible();
    const replies = await db.collection('social_posts').where('parentPostId', '==', rootId).get();
    expect(replies.size).toBe(1);
    replyId = replies.docs[0].id;
    expect(replies.docs[0].data()).toMatchObject({ state: 'active', authorUid: replierUid, text: replyText });

    for (const text of [rootText, replyText]) {
      const item = replier.getByRole('listitem').filter({ hasText: text });
      const trigger = item.getByRole('button', { name: 'Report post', exact: true });
      await trigger.focus();
      await replier.keyboard.press('Enter');
      await expect(item.getByRole('button', { name: 'Send report', exact: true })).toBeFocused();
      await replier.keyboard.press('Enter');
      await expect(item.getByText('Reported. Staff will review this post.')).toBeFocused();
    }
    const reports = await db.collection('social_reports').where('reporterUid', '==', replierUid).get();
    expect(reports.docs.map((report) => report.data().postId).sort()).toEqual([rootId, replyId].sort());

    await replier.setViewportSize({ width: 390, height: 844 });
    expect(await replier.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await replier.setViewportSize({ width: 1280, height: 800 });
  });

  test('pending accounts cannot reply through the page, the endpoint, or Firestore', async ({ page }) => {
    await signIn(page, PENDING_EMAIL);
    await page.goto(`/attendees/posts/${rootId}`);
    await expect(page.getByText('The attendee feed is open to approved attendees and speakers.')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText(rootText)).toHaveCount(0);
    const token = await idTokenFor(pendingUid);
    const refused = await callFunction('createSocialPost', { text: 'No', submissionKey: `pending-${stamp}`, parentPostId: rootId }, token);
    expect(refused.status).toBe(403);
    expect((await directCreate(token, `direct-${stamp}`)).status).toBe(403);
    expect((await directCreate(await idTokenFor(authorUid), `direct-a-${stamp}`)).status).toBe(403);
  });

  test('removing the reply keeps the root; removing the root keeps the reply readable and closes replies', async () => {
    const removedReply = await callFunction('removeSocialPost', { postId: replyId }, staffToken);
    expect(removedReply.status).toBe(200);
    await expect(replier.getByText('Reply removed', { exact: true })).toBeVisible();
    await expect(replier.getByText(replyText)).toHaveCount(0);
    await expect(replier.getByText(rootText)).toBeVisible();

    // A second reply, so a reply outlives its removed root.
    const token = await idTokenFor(replierUid);
    const second = await callFunction('createSocialPost', { text: `${replyText} Second.`, submissionKey: `second-${stamp}`, parentPostId: rootId }, token);
    expect(second.status).toBe(201);
    secondId = second.body.postId;
    await expect(replier.getByText(`${replyText} Second.`)).toBeVisible();

    const removedRoot = await callFunction('removeSocialPost', { postId: rootId }, staffToken);
    expect(removedRoot.status).toBe(200);
    await expect(replier.getByText('Original post removed', { exact: true })).toBeVisible();
    await expect(replier.getByText(rootText)).toHaveCount(0);
    const survivor = replier.getByRole('listitem').filter({ hasText: `${replyText} Second.` });
    await expect(survivor.getByRole('button', { name: 'Report post', exact: true })).toBeVisible();
    await expect(replier.getByText('Replies are closed because the original post was removed.')).toBeVisible();
    await expect(replier.getByRole('textbox')).toHaveCount(0);

    const late = await callFunction('createSocialPost', { text: 'Too late', submissionKey: `late-${stamp}`, parentPostId: rootId }, token);
    expect(late.status).toBe(404);
    expect((await db.doc(`social_posts/${rootId}`).get()).data()).not.toHaveProperty('text');
  });

  test('with the feed off, the thread link is the ordinary not-found page', async () => {
    await db.doc('config/features').set({ ...features, attendeeDirectory: true, socialFeed: false });
    await author.goto(`/attendees/posts/${rootId}`);
    await expect(author.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    await expect(author.getByRole('textbox')).toHaveCount(0);
  });
});
