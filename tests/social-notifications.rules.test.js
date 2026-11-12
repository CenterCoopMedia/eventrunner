// Issue #542: notification persistence, retries and deletion use real transactions.
// Auth, Storage, config loading and the clock are test doubles; Firestore uses
// the emulator. Expected fields and outcomes come from issue #542.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { createCreateSocialPostHandler, createMarkSocialNotificationReadHandler,
  createRemoveSocialPostHandler } = require('../functions/src/social/feed.cjs');
const { createDeleteAttendeeHandler } = require('../functions/src/users/records.cjs');
const PROJECT_ID = 'demo-run-of-show';
const AT = new Date('2026-11-12T18:00:00Z');
const LATER = new Date('2026-11-12T19:00:00Z');
const FLAGS = { socialFeed: true, attendeeDirectory: true };
const OPERATOR = 'notice-operator@example.test';
const QUIET = { error() {}, warn() {}, info() {} };
const uid = (name) => `notice-${name}`;
const idFor = (name, key = 'notice_intent_1') => createHash('sha256').update(`${uid(name)}\0${key}`).digest('hex');
const auth = {
  async verifyIdToken(token, revoked) {
    expect(revoked).toBe(true);
    if (!['owner', 'reply', 'other', 'pending', 'speaker', 'operator'].includes(token)) throw new Error('invalid token');
    return { uid: uid(token), email: `${uid(token)}@example.test`, email_verified: true };
  },
  async getUser(id) { return { uid: id, email: `${id}@example.test` }; },
  async deleteUser() {}, // Keep verifying old tokens to exercise the account fence.
};
let testEnv;
let adminApp;
let db;
const noticeRef = (id, owner = 'owner') => db.collection('users').doc(uid(owner)).collection('notifications').doc(id);
const postRef = (id) => db.collection('social_posts').doc(id);

async function call(factory, token, body, deps = {}, request = {}) {
  const res = { statusCode: null, body: null, set() { return this; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await factory({ db, auth, now: () => AT, log: QUIET,
    getConfig: async () => ({ bootstrap: { adminEmails: [OPERATOR] } }),
    getBucket: () => ({ async getFiles() { return [[]]; } }), ...deps })(
    { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body, ...request }, res,
  );
  return res;
}
const reply = (name = 'reply', overrides = {}, deps) => call(createCreateSocialPostHandler, name,
  { text: 'Private reply text.', parentPostId: 'root', submissionKey: 'notice_intent_1', ...overrides }, deps);
const mark = (name, id, extra = {}, deps, request) => call(createMarkSocialNotificationReadHandler, name,
  { notificationId: id, action: 'read', ...extra }, deps, request);
const remove = (deps) => call(createRemoveSocialPostHandler, 'operator', { postId: 'root' }, deps);
const deleteOwner = (deps) => call(createDeleteAttendeeHandler, 'operator', { uid: uid('owner') }, deps);
const notices = async () => (await db.collectionGroup('notifications').get()).docs;

// Pause before a real transaction starts; all database reads/retries/commits
// remain real. The competing operation commits in a known order, without sleeps.
function pausedTransaction() {
  let entered;
  let release;
  const arrived = new Promise((resolve) => { entered = resolve; });
  const resumed = new Promise((resolve) => { release = resolve; });
  let first = true;
  const held = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return async (...args) => {
      if (first) { first = false; entered(); await resumed; }
      return target.runTransaction(...args);
    };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { db: held, arrived, release };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `social-notices-${process.pid}`);
  db = getFirestore(adminApp);
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  const batch = db.batch();
  batch.set(db.collection('config').doc('bootstrap'), { adminEmails: [OPERATOR] });
  batch.set(db.collection('config').doc('features'), FLAGS);
  for (const name of ['owner', 'reply', 'other', 'pending', 'speaker']) {
    batch.set(db.collection('users').doc(uid(name)), {
      uid: uid(name), email: `${uid(name)}@example.test`,
      registrationStatus: ['pending', 'speaker'].includes(name) ? 'pending' : 'approved',
      speakerId: name === 'speaker' ? 'speaker-1' : null,
    });
  }
  batch.set(postRef('root'), { state: 'active', authorUid: uid('owner'), text: 'Root text.', parentPostId: null, createdAt: AT });
  await batch.commit();
});
afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('private reply notification creation', () => {
  it('stores one text-free item only for the root author, atomically with the reply', async () => {
    const res = await reply();
    expect(res.statusCode).toBe(201);
    const rows = await notices();
    expect(rows).toHaveLength(1);
    expect(rows[0].ref.path).toBe(`users/${uid('owner')}/notifications/${res.body.postId}`);
    const data = rows[0].data();
    expect(Object.keys(data).sort()).toEqual(['createdAt', 'kind', 'readAt', 'replyPostId', 'rootPostId']);
    expect(data).toMatchObject({ kind: 'post_reply', rootPostId: 'root', replyPostId: idFor('reply'), readAt: null });
    expect(data.createdAt.toMillis()).toBe(AT.getTime());
    expect((await postRef(res.body.postId).get()).data().createdAt.toMillis()).toBe(AT.getTime());
  });

  it('keeps the original notification and read time on exact and concurrent retries', async () => {
    const responses = await Promise.all([reply(), reply()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(await notices()).toHaveLength(1);
    expect((await mark('owner', idFor('reply'))).statusCode).toBe(200);
    const before = (await noticeRef(idFor('reply')).get()).data();
    expect((await reply('reply', {}, { now: () => LATER })).statusCode).toBe(200);
    expect((await noticeRef(idFor('reply')).get()).data()).toEqual(before);
    expect((await reply('reply', { text: 'Changed intent.' })).statusCode).toBe(409);
    expect((await noticeRef(idFor('reply')).get()).data()).toEqual(before);
  });

  it('does not notify a self-reply, root post, or a refused caller', async () => {
    expect((await reply('owner')).statusCode).toBe(201);
    expect((await reply('reply', { parentPostId: null })).statusCode).toBe(201);
    expect((await reply('pending')).statusCode).toBe(403);
    expect(await notices()).toHaveLength(0);
  });

  it('refuses a root whose author no longer exists, even before root cleanup', async () => {
    await db.collection('users').doc(uid('owner')).delete();
    expect((await reply()).statusCode).toBe(404);
    expect((await postRef(idFor('reply')).get()).exists).toBe(false);
    expect(await notices()).toHaveLength(0);
  });

  it('keeps both stores unchanged when the notification write cannot commit', async () => {
    await noticeRef(idFor('reply')).set({ kind: 'post_reply', rootPostId: 'old', replyPostId: idFor('reply'), createdAt: AT, readAt: null });
    const before = (await noticeRef(idFor('reply')).get()).data();
    expect((await reply()).statusCode).toBe(500);
    expect((await postRef(idFor('reply')).get()).exists).toBe(false);
    expect((await noticeRef(idFor('reply')).get()).data()).toEqual(before);
  });

  it('orders root removal before a reply and preserves only text-free history when removal follows', async () => {
    const held = pausedTransaction();
    const pending = reply('reply', {}, { db: held.db });
    await held.arrived;
    expect((await remove()).statusCode).toBe(200);
    held.release();
    expect((await pending).statusCode).toBe(404);
    expect(await notices()).toHaveLength(0);
    await postRef('root').set({ state: 'active', authorUid: uid('owner'), text: 'Restored test fixture.', parentPostId: null, createdAt: AT });
    expect((await reply()).statusCode).toBe(201);
    expect((await remove()).statusCode).toBe(200);
    expect(await notices()).toHaveLength(1);
    expect(Object.keys((await notices())[0].data()).sort()).toEqual(['createdAt', 'kind', 'readAt', 'replyPostId', 'rootPostId']);
  });

  it('orders recipient deletion against creation in both commit orders', async () => {
    const held = pausedTransaction();
    const pending = reply('reply', {}, { db: held.db });
    await held.arrived;
    expect((await deleteOwner()).statusCode).toBe(200);
    held.release();
    expect((await pending).statusCode).toBe(404);
    expect(await notices()).toHaveLength(0);
    // A separate synthetic owner is recreated only to exercise the inverse order.
    await db.collection('users').doc(uid('owner')).set({ registrationStatus: 'approved' });
    await postRef('root').set({ state: 'active', authorUid: uid('owner'), text: 'Root fixture.', parentPostId: null, createdAt: AT });
    expect((await reply()).statusCode).toBe(201);
    expect(await notices()).toHaveLength(1);
    expect((await deleteOwner()).statusCode).toBe(200);
    expect(await notices()).toHaveLength(0);
  });
});

describe('owner notification read action', () => {
  it('changes only readAt once and returns the same server time on retry', async () => {
    await reply();
    const id = idFor('reply');
    const before = (await noticeRef(id).get()).data();
    expect((await mark('owner', id)).body).toEqual({ notificationId: id, readAt: AT.toISOString() });
    const after = (await noticeRef(id).get()).data();
    expect(after).toEqual({ ...before, readAt: expect.anything() });
    expect(after.readAt.toMillis()).toBe(AT.getTime());
    expect((await mark('owner', id, {}, { now: () => LATER })).body).toEqual({ notificationId: id, readAt: AT.toISOString() });
    expect((await noticeRef(id).get()).data()).toEqual(after);
  });

  it('permits the current speaker owner without using a staff grant', async () => {
    await reply();
    await db.collection('users').doc(uid('owner')).update({ registrationStatus: 'pending', speakerId: 'speaker-1' });
    expect((await mark('owner', idFor('reply'))).statusCode).toBe(200);
  });

  it('rejects forged recipients, times, unread actions and arbitrary fields', async () => {
    await reply();
    const id = idFor('reply');
    for (const extra of [{ uid: uid('owner') }, { recipientUid: uid('owner') }, { readAt: AT.toISOString() }, { action: 'unread' }, { arbitrary: true }]) {
      expect((await mark('owner', id, extra)).statusCode).toBe(400);
    }
    expect((await noticeRef(id).get()).data().readAt).toBeNull();
    expect((await mark('owner', id, {}, {}, { method: 'GET' })).statusCode).toBe(405);
    expect((await mark('owner', id, {}, {}, { rawBody: Buffer.alloc(1025) })).statusCode).toBe(413);
  });

  it('refuses another owner, missing item, stale account, expired grant and disabled flags', async () => {
    await reply();
    const id = idFor('reply');
    expect((await mark('other', id)).statusCode).toBe(404);
    expect((await mark('owner', 'missing')).statusCode).toBe(404);
    expect((await mark('operator', id)).statusCode).toBe(403);
    expect((await mark(null, id)).statusCode).toBe(401);
    for (const registrationStatus of ['pending', 'revoked', 'ticketed']) {
      await db.collection('users').doc(uid('owner')).update({ registrationStatus, speakerId: null });
      expect((await mark('owner', id)).statusCode).toBe(403);
    }
    await db.collection('users').doc(uid('owner')).update({ registrationStatus: 'approved' });
    for (const flags of [{}, { socialFeed: true }, { attendeeDirectory: true }, { ...FLAGS, socialFeed: false }, { ...FLAGS, attendeeDirectory: false }]) {
      await db.collection('config').doc('features').set(flags);
      expect((await mark('owner', id)).statusCode).toBe(404);
    }
    await db.collection('config').doc('features').set(FLAGS);
    await db.collection('users').doc(uid('owner')).delete();
    expect((await mark('owner', id)).statusCode).toBe(403);
    expect((await noticeRef(id).get()).data().readAt).toBeNull();
  });
});
