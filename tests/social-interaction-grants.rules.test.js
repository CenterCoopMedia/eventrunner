// Ticket interaction grants on the attendee feed (#1006) against the real
// Firestore emulator: the feed and notification read rules and the post,
// reply, report and mark-read handlers. Only Auth is a fake. Expected values
// come from #1006 and the decideResourceGrant cases in
// functions/src/ticketing/__fixtures__/resource-grant-cases.json; synthetic data only.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const CASES = require('../functions/src/ticketing/__fixtures__/resource-grant-cases.json');
const {
  createCreateSocialPostHandler, createReportSocialPostHandler, createMarkSocialNotificationReadHandler,
} = require('../functions/src/social/feed.cjs');

const PROJECT_ID = 'demo-social-interaction-grants';
const STAFF = 'grant-staff@example.test';
const AT = new Date('2026-11-15T18:00:00Z');
const QUIET = { error() {}, warn() {}, info() {} };
const FEED_ON = { socialFeed: true, attendeeDirectory: true };
const PUBLISHED = { effectiveRevision: 1, candidateRevision: null };
const TICKET = { registrationStatus: 'approved', approvalSource: 'ticket', speakerId: null };
const grantWith = (interactions, policyRevision = 1) => ({
  policyRevision,
  resources: { sessions: { all: true, dayIds: [], sessionIds: [] }, directory: true, attendeeUpdates: true, interactions },
});
const NAMES = ['reader', 'author', 'speaker', 'staff', 'pending'];
const uid = (name) => `grant-${name}`;
const email = (name) => (name === 'staff' ? STAFF : `${uid(name)}@example.test`);
const auth = {
  async verifyIdToken(token) {
    if (!NAMES.includes(token)) throw new Error('invalid token');
    return { uid: uid(token), email: email(token), email_verified: true };
  },
};
let testEnv;
let adminApp;
let db;

async function call(factory, token, body) {
  const res = { statusCode: null, body: null, set() { return this; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await factory({ db, auth, now: () => AT, log: QUIET })(
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res,
  );
  return res;
}
const post = (token = 'reader', key = 'grant_intent_1') => call(createCreateSocialPostHandler, token,
  { text: 'Synthetic post.', submissionKey: key });
const reply = (token = 'reader') => call(createCreateSocialPostHandler, token,
  { text: 'Synthetic reply.', submissionKey: 'grant_reply_1', parentPostId: 'root' });
const report = (token = 'reader') => call(createReportSocialPostHandler, token, { postId: 'root' });
const mark = (token = 'author') => call(createMarkSocialNotificationReadHandler, token,
  { notificationId: 'notice', action: 'read' });
const replyId = (token) => createHash('sha256').update(`${uid(token)}\0grant_reply_1`).digest('hex');

const client = (name) => testEnv.authenticatedContext(uid(name), {
  email: email(name), email_verified: true,
}).firestore();
const rootFeed = (firestore) => getDocs(query(collection(firestore, 'social_posts'),
  where('state', '==', 'active'), where('parentPostId', '==', null), orderBy('createdAt', 'desc'), limit(20)));
const ownNotice = (name) => getDoc(doc(client(name), `users/${uid(name)}/notifications/notice`));

const setControl = (control) => db.collection('ticket_access_policies').doc('current').set(control);
const setGrant = (name, grant) => db.collection('ticket_access_grants').doc(uid(name)).set(grant);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `social-interaction-grants-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  const batch = db.batch();
  batch.set(db.collection('config').doc('features'), FEED_ON);
  batch.set(db.collection('config').doc('bootstrap'), { adminEmails: [], staffEmails: [STAFF] });
  batch.set(db.collection('users').doc(uid('reader')), TICKET);
  batch.set(db.collection('users').doc(uid('author')), TICKET);
  batch.set(db.collection('users').doc(uid('staff')), TICKET);
  batch.set(db.collection('users').doc(uid('pending')), { registrationStatus: 'pending', speakerId: null });
  batch.set(db.collection('users').doc(uid('speaker')), { registrationStatus: 'pending', approvalSource: null, speakerId: 'spk-1' });
  batch.set(db.collection('social_posts').doc('root'),
    { state: 'active', authorUid: uid('author'), text: 'Synthetic root.', parentPostId: null, createdAt: AT });
  batch.set(db.collection('users').doc(uid('author')).collection('notifications').doc('notice'),
    { kind: 'post_reply', rootPostId: 'root', replyPostId: 'r1', createdAt: AT, readAt: null });
  await batch.commit();
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('feed and notification reads mirror decideResourceGrant', () => {
  for (const entry of CASES.filter((item) => item.resource === 'interactions')) {
    it(entry.name, async () => {
      await db.collection('users').doc(uid('author')).set(entry.account);
      if (entry.control) await setControl(entry.control);
      if (entry.grant) await setGrant('author', entry.grant);
      const allowed = entry.expected === 'allow';
      await (allowed ? assertSucceeds(rootFeed(client('author'))) : assertFails(rootFeed(client('author'))));
      await (allowed ? assertSucceeds(ownNotice('author')) : assertFails(ownNotice('author')));
    });
  }

  it('bootstrap staff keep feed reads after publication without a grant', async () => {
    await setControl(PUBLISHED);
    await assertSucceeds(rootFeed(client('staff')));
  });

  it('a grant does not open a closed feed or a pending account', async () => {
    await setControl(PUBLISHED);
    await setGrant('reader', grantWith(true));
    await setGrant('pending', grantWith(true));
    await assertFails(rootFeed(client('pending')));
    await db.collection('config').doc('features').set({ socialFeed: false, attendeeDirectory: true });
    await assertFails(rootFeed(client('reader')));
  });
});

describe('server feed writes need the interactions grant after publication', () => {
  it('legacy mode: every write works with no grant, as before', async () => {
    expect((await post()).statusCode).toBe(201);
    expect((await reply()).statusCode).toBe(201);
    expect((await report()).statusCode).toBe(201);
    expect((await mark()).statusCode).toBe(200);
  });

  it('a current interactions grant allows every write', async () => {
    await setControl(PUBLISHED);
    await setGrant('reader', grantWith(true));
    await setGrant('author', grantWith(true));
    expect((await post()).statusCode).toBe(201);
    expect((await reply()).statusCode).toBe(201);
    expect((await report()).statusCode).toBe(201);
    expect((await mark()).statusCode).toBe(200);
  });

  it('a grant without interactions is refused as ticket-resource and writes nothing', async () => {
    await setControl(PUBLISHED);
    await setGrant('reader', grantWith(false));
    await setGrant('author', grantWith(false));
    for (const res of [await post(), await reply(), await report(), await mark()]) {
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('ticket-resource');
    }
    expect((await db.collection('social_posts').get()).size).toBe(1);
    expect((await db.collection('social_reports').get()).size).toBe(0);
    expect((await db.collection('social_posts').doc(replyId('reader')).get()).exists).toBe(false);
    expect((await db.collection('users').doc(uid('author')).collection('notifications').doc('notice').get()).data().readAt).toBe(null);
  });

  it('a stale grant or a sweep in progress is refused as access-updating', async () => {
    await setGrant('reader', grantWith(true, 1));
    await setControl({ effectiveRevision: 2, candidateRevision: null });
    expect((await post()).body.error.code).toBe('access-updating');
    await setControl({ effectiveRevision: 1, candidateRevision: 2 });
    const res = await report();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('access-updating');
  });

  it('a speaker posts and staff report without a grant; the binary gates still apply first', async () => {
    await setControl(PUBLISHED);
    expect((await post('speaker')).statusCode).toBe(201);
    expect((await report('staff')).statusCode).toBe(201);
    await setGrant('pending', grantWith(true));
    expect((await post('pending', 'grant_intent_2')).body.error.code).toBe('forbidden');
    await db.collection('config').doc('features').set({ socialFeed: false, attendeeDirectory: true });
    await setGrant('reader', grantWith(true));
    expect((await post('reader', 'grant_intent_3')).statusCode).toBe(404);
  });
});
