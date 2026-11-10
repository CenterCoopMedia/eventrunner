// The attendee feed backend (issue #506) against the real Firestore
// emulator: the report and removal handlers, their transactions, the
// account delete sweep, and what a client can read afterwards. Firebase
// Auth and Cloud Storage are the only fakes. Expected values come from the
// #506 contract: who may report, one report per (post, reporter), an exact
// content-free tombstone, one metadata-only audit row, and cleanup that
// never erases a tombstone. tests/firestore.rules.test.js holds the client
// read matrix for every flag state.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const {
  createReportSocialPostHandler,
  createRemoveSocialPostHandler,
  internals: { reportIdFor },
} = require('../functions/src/social/feed.cjs');
const { createDeleteAttendeeHandler } = require('../functions/src/users/records.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR = 'sf-operator@example.test';
const STAFF = 'sf-staff@example.test';
const EXPIRED = 'sf-expired@example.test';
const FORMER = 'sf-former@example.test';
const QUIET = { error() {}, warn() {}, info() {} };

/** Every identity the #506 matrix names, by token. */
const TOKENS = {
  pending: { uid: 'sf-pending', email: 'sf-pending@example.test', email_verified: true },
  ticketed: { uid: 'sf-ticketed', email: 'sf-ticketed@example.test', email_verified: true },
  approved: { uid: 'sf-approved', email: 'sf-approved@example.test', email_verified: true },
  revoked: { uid: 'sf-revoked', email: 'sf-revoked@example.test', email_verified: true },
  speaker: { uid: 'sf-speaker', email: 'sf-speaker@example.test', email_verified: true },
  ada: { uid: 'sf-ada', email: 'sf-ada@example.test', email_verified: true },
  bo: { uid: 'sf-bo', email: 'sf-bo@example.test', email_verified: true },
  // Bootstrap admins with no account document.
  staff: { uid: 'sf-staff', email: STAFF, email_verified: true },
  operator: { uid: 'sf-operator', email: OPERATOR, email_verified: true },
  // Still on staffEmails, but the grant has ended.
  expired: { uid: 'sf-expired', email: EXPIRED, email_verified: true },
  // A pending account a stale cached bootstrap still names as an operator.
  former: { uid: 'sf-former', email: FORMER, email_verified: true },
};

const ACCOUNTS = {
  'sf-pending': { registrationStatus: 'pending', speakerId: null },
  'sf-ticketed': { registrationStatus: 'ticketed', speakerId: null },
  'sf-approved': { registrationStatus: 'approved', speakerId: null },
  'sf-revoked': { registrationStatus: 'revoked', speakerId: null },
  'sf-speaker': { registrationStatus: 'pending', speakerId: 'spk-1' },
  'sf-ada': { registrationStatus: 'approved', speakerId: null },
  'sf-bo': { registrationStatus: 'approved', speakerId: null },
  'sf-former': { registrationStatus: 'pending', speakerId: null, role: 'admin' },
};

let testEnv;
let adminApp;
let db;

/** Sign-ins the delete reads and removes. A token keeps verifying after deleteUser: it is the stale-token case. */
const signIns = new Map();
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
  async getUser(uid) {
    if (!signIns.has(uid)) {
      const err = new Error('no user');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return { uid, email: signIns.get(uid) };
  },
  async deleteUser(uid) {
    if (!signIns.has(uid)) {
      const err = new Error('no user');
      err.code = 'auth/user-not-found';
      throw err;
    }
    signIns.delete(uid);
  },
};
const getBucket = () => ({ async getFiles() { return [[]]; } });
// A stale cache that still lists the former operator. Nothing below may rely on it.
const staleConfig = async () => ({ bootstrap: { adminEmails: [OPERATOR, FORMER], staffEmails: [STAFF, EXPIRED] }, features: {} });

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

async function call(create, token, body, deps = {}) {
  const res = makeRes();
  await create({ db, auth, getConfig: staleConfig, getBucket, log: QUIET, ...deps })(
    { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body },
    res,
  );
  return res;
}

const report = (token, postId = 'root-bo', deps) => call(createReportSocialPostHandler, token, { postId }, deps);
const remove = (token, postId = 'root-bo', deps) => call(createRemoveSocialPostHandler, token, { postId }, deps);
const deleteAccount = (uid, deps) => call(createDeleteAttendeeHandler, 'operator', { uid }, deps);

const features = (data) => (data === null
  ? db.collection('config').doc('features').delete()
  : db.collection('config').doc('features').set(data));
const FEED_ON = { socialFeed: true, attendeeDirectory: true };
const post = async (id) => (await db.collection('social_posts').doc(id).get()).data();
const reports = async () => (await db.collection('social_reports').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const auditRows = async () => (await db.collection('admin_logs').get()).docs.map((d) => d.data());
const client = (token) => testEnv.authenticatedContext(TOKENS[token].uid, {
  email: TOKENS[token].email, email_verified: true,
}).firestore();

const CREATED = new Date('2026-11-01T12:00:00.000Z');
const ROOT_BO = { state: 'active', authorUid: 'sf-bo', text: 'Lunch is at noon by the river.', createdAt: CREATED, parentPostId: null };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `social-feed-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  signIns.clear();
  for (const token of ['ada', 'bo', 'approved', 'staff']) signIns.set(TOKENS[token].uid, TOKENS[token].email);
  await db.collection('config').doc('bootstrap').set({
    adminEmails: [OPERATOR],
    staffEmails: [STAFF, EXPIRED],
    staffExpiry: { [EXPIRED]: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000) },
  });
  await features(FEED_ON);
  for (const [uid, account] of Object.entries(ACCOUNTS)) {
    await db.collection('users').doc(uid).set({ uid, email: `${uid}@example.test`, ...account });
  }
  const posts = db.collection('social_posts');
  await posts.doc('root-bo').set(ROOT_BO);
  await posts.doc('reply-ada').set({ state: 'active', authorUid: 'sf-ada', text: 'See you there.', createdAt: CREATED, parentPostId: 'root-bo' });
  await posts.doc('root-ada').set({ state: 'active', authorUid: 'sf-ada', text: 'Who is at the data desk?', createdAt: CREATED, parentPostId: null });
  await posts.doc('reply-bo').set({ state: 'active', authorUid: 'sf-bo', text: 'I am.', createdAt: CREATED, parentPostId: 'root-ada' });
  await posts.doc('gone').set({ state: 'removed', parentPostId: null, createdAt: CREATED, removedAt: CREATED });
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('who may report a post', () => {
  it('admits a current approved attendee, speaker, staff member or operator, with both flags on', async () => {
    for (const token of ['approved', 'speaker', 'staff', 'operator']) {
      expect((await report(token)).statusCode, token).toBe(201);
    }
    expect((await reports()).map((r) => r.reporterUid).sort()).toEqual(['sf-approved', 'sf-operator', 'sf-speaker', 'sf-staff']);
  });

  it('refuses anonymous, pending, ticketed and revoked callers, an expired staff grant, and a former operator the cache still lists', async () => {
    expect((await report(null)).statusCode).toBe(401);
    for (const token of ['pending', 'ticketed', 'revoked', 'expired', 'former']) {
      expect((await report(token)).statusCode, token).toBe(403);
    }
    expect(await reports()).toEqual([]);
  });

  it('refuses every report, a staff member’s included, unless both flags are true', async () => {
    for (const state of [null, {}, { socialFeed: true }, { attendeeDirectory: true },
      { socialFeed: false, attendeeDirectory: true }, { socialFeed: true, attendeeDirectory: false },
      { socialFeed: 'true', attendeeDirectory: true }]) {
      await features(state);
      for (const token of ['approved', 'staff']) {
        expect((await report(token)).statusCode, `${token} ${JSON.stringify(state)}`).toBe(404);
      }
    }
    expect(await reports()).toEqual([]);
  });
});

describe('the report record', () => {
  it('is stored once across concurrent submissions and a retry, with only the post, reporter and time', async () => {
    const results = await Promise.all([report('approved'), report('approved'), report('approved')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    expect((await report('approved')).statusCode).toBe(200);
    const stored = await reports();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(reportIdFor('root-bo', 'sf-approved'));
    expect(Object.keys(stored[0]).sort()).toEqual(['createdAt', 'id', 'postId', 'reporterUid']);
    expect(stored[0]).toMatchObject({ postId: 'root-bo', reporterUid: 'sf-approved' });
  });

  it('takes the reporter from the token, never from the body', async () => {
    const res = await call(createReportSocialPostHandler, 'approved', { postId: 'root-bo', reporterUid: 'sf-bo', uid: 'sf-bo' });
    expect(res.statusCode).toBe(201);
    expect((await reports()).map((r) => r.reporterUid)).toEqual(['sf-approved']);
  });

  it('cannot target a missing or removed post, and an active reply is reportable', async () => {
    expect((await report('approved', 'no-such-post')).statusCode).toBe(404);
    expect((await report('approved', 'gone')).statusCode).toBe(404);
    expect((await report('approved', 'reply-ada')).statusCode).toBe(201);
    expect((await reports()).map((r) => r.postId)).toEqual(['reply-ada']);
  });

  it('stays unreadable to the reporter and the author, and readable to staff and operators', async () => {
    await report('approved');
    const path = `social_reports/${reportIdFor('root-bo', 'sf-approved')}`;
    for (const token of ['approved', 'bo']) {
      await assertFails(getDoc(doc(client(token), path)));
      await assertFails(getDocs(collection(client(token), 'social_reports')));
    }
    for (const token of ['staff', 'operator']) await assertSucceeds(getDoc(doc(client(token), path)));
  });
});

describe('staff removal', () => {
  it('replaces the post with the exact tombstone and writes one metadata-only audit row, with both flags off', async () => {
    await report('approved');
    await features({ socialFeed: false, attendeeDirectory: false });
    const res = await remove('staff');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ postId: 'root-bo', removed: true, alreadyRemoved: false });

    const tombstone = await post('root-bo');
    expect(Object.keys(tombstone).sort()).toEqual(['createdAt', 'parentPostId', 'removedAt', 'state']);
    expect(tombstone.state).toBe('removed');
    expect(tombstone.parentPostId).toBeNull();
    expect(tombstone.createdAt.toMillis()).toBe(CREATED.getTime());

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['action', 'at', 'docPath', 'email', 'uid']);
    expect(rows[0]).toMatchObject({ action: 'removeSocialPost', docPath: 'social_posts/root-bo', uid: 'sf-staff', email: STAFF });
    const recorded = JSON.stringify([rows, await reports()]);
    expect(recorded).not.toContain(ROOT_BO.text);
    expect(recorded).not.toContain('sf-bo');
    // The earlier report stays for staff inspection.
    expect(await reports()).toHaveLength(1);
  });

  it('a repeated removal answers success and adds no audit row', async () => {
    expect((await remove('staff')).statusCode).toBe(200);
    const again = await remove('operator');
    expect(again.statusCode).toBe(200);
    expect(again.body.alreadyRemoved).toBe(true);
    expect(await auditRows()).toHaveLength(1);
    expect((await remove('staff', 'gone')).body.alreadyRemoved).toBe(true);
    expect(await auditRows()).toHaveLength(1);
  });

  it('leaves replies to a removed root active and reportable', async () => {
    await remove('staff');
    expect((await post('reply-ada')).state).toBe('active');
    expect((await report('approved', 'reply-ada')).statusCode).toBe(201);
  });

  it('refuses an attendee, an expired staff grant, and a former operator the cache still lists, and admits a current operator with no account', async () => {
    for (const token of ['approved', 'speaker', 'expired', 'former']) {
      expect((await remove(token)).statusCode, token).toBe(403);
    }
    expect(await post('root-bo')).toMatchObject({ state: 'active', text: ROOT_BO.text });
    expect(await auditRows()).toEqual([]);
    expect((await remove('operator')).statusCode).toBe(200);
  });

  it('an audit write the database refuses at commit leaves the active post and writes nothing', async () => {
    // The audit row is sent as an update of a document that does not
    // exist, which Firestore refuses when the transaction commits, after
    // the tombstone write was queued in the same transaction.
    const refusing = {
      collection: (name) => db.collection(name),
      runTransaction: (fn, options) => db.runTransaction((tx) => fn(new Proxy(tx, {
        get(target, prop) {
          if (prop === 'set') {
            return (ref, data, opts) => (ref.parent.id === 'admin_logs'
              ? target.update(ref, data)
              : target.set(ref, data, opts));
          }
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      })), options),
    };
    const res = await remove('staff', 'root-bo', { db: refusing });
    expect(res.statusCode).toBe(500);
    expect(await post('root-bo')).toMatchObject({ state: 'active', authorUid: 'sf-bo', text: ROOT_BO.text });
    expect(await auditRows()).toEqual([]);
  });
});

describe('report ordering against removal, flag changes, revocation and account delete', () => {
  it('a removal or a flag change that commits first stores nothing; a report that commits first remains', async () => {
    await remove('staff', 'root-ada');
    expect((await report('approved', 'root-ada')).statusCode).toBe(404);

    expect((await report('approved', 'root-bo')).statusCode).toBe(201);
    await remove('staff', 'root-bo');
    await features({ socialFeed: false, attendeeDirectory: true });
    expect((await report('speaker', 'reply-ada')).statusCode).toBe(404);
    expect((await reports()).map((r) => r.postId)).toEqual(['root-bo']);
  });

  it('an account delete that commits first refuses the old token; a report that commits first is swept with the account', async () => {
    expect((await report('ada', 'root-bo')).statusCode).toBe(201);
    expect((await deleteAccount('sf-ada')).statusCode).toBe(200);
    expect(await reports()).toEqual([]);
    // The ID token still verifies; the missing account refuses it.
    expect((await report('ada', 'reply-bo')).statusCode).toBe(403);
    expect(await reports()).toEqual([]);
  });

  it('accountless staff: a revocation that commits first refuses; an independent account grant still admits', async () => {
    await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR], staffEmails: [] });
    expect((await report('staff')).statusCode).toBe(403);
    await db.collection('users').doc('sf-staff').set({ uid: 'sf-staff', registrationStatus: 'approved', speakerId: null });
    expect((await report('staff')).statusCode).toBe(201);
  });

  it('accountless staff reports stay while the address is listed, expired included, and the resumed delete clears them after an operator removes it', async () => {
    signIns.set('sf-expired', EXPIRED);
    // Report while the grant was current, then the grant ends.
    await db.collection('social_reports').doc(reportIdFor('root-bo', 'sf-expired'))
      .set({ postId: 'root-bo', reporterUid: 'sf-expired', createdAt: CREATED });
    expect((await report('expired')).statusCode).toBe(403);
    // Expired but listed: still an admin address, so the delete refuses.
    const refused = await deleteAccount('sf-expired');
    expect(refused.statusCode).toBe(409);
    expect(refused.body.error.code).toBe('admin-account');
    expect(await reports()).toHaveLength(1);

    expect((await report('staff')).statusCode).toBe(201);
    await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR], staffEmails: [] });
    for (const uid of ['sf-expired', 'sf-staff']) {
      const res = await deleteAccount(uid);
      expect(res.statusCode, uid).toBe(200);
      expect(res.body.removed.socialReports, uid).toBe(1);
    }
    expect(await reports()).toEqual([]);
    // Nothing remains, so a third delete is a 404.
    expect((await deleteAccount('sf-staff')).statusCode).toBe(404);
  });
});

describe('author account cleanup against moderation', () => {
  it('removes the author’s active posts and replies, keeps other authors’ rows, tombstones and reports of the removed post', async () => {
    await report('bo', 'root-ada');
    const res = await deleteAccount('sf-ada');
    expect(res.statusCode).toBe(200);
    expect(res.body.removed.socialPosts).toBe(2);
    const ids = (await db.collection('social_posts').get()).docs.map((d) => d.id).sort();
    expect(ids).toEqual(['gone', 'reply-bo', 'root-bo']);
    expect((await reports()).map((r) => r.postId)).toEqual(['root-ada']);
    // Cleanup committed first: nothing remains to moderate.
    expect((await remove('staff', 'root-ada')).statusCode).toBe(404);
    expect(await auditRows()).toHaveLength(1); // the delete's own row
  });

  it('a removal that commits after the sweep read its page keeps its tombstone', async () => {
    // Run the removal once, right after the sweep's first social_posts page read.
    let interleave = async () => {
      expect((await remove('staff', 'root-ada')).statusCode).toBe(200);
    };
    const afterPageRead = (query) => new Proxy(query, {
      get(target, prop) {
        if (prop === 'where' || prop === 'limit') return (...args) => afterPageRead(target[prop](...args));
        if (prop === 'get') {
          return async () => {
            const snap = await target.get();
            if (interleave && snap.size > 0) {
              const run = interleave;
              interleave = null;
              await run();
            }
            return snap;
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const sweepDb = {
      collection: (name) => (name === 'social_posts' ? afterPageRead(db.collection(name)) : db.collection(name)),
      runTransaction: (...args) => db.runTransaction(...args),
      batch: () => db.batch(),
    };

    const res = await deleteAccount('sf-ada', { db: sweepDb });
    expect(res.statusCode).toBe(200);
    expect(interleave).toBeNull();
    expect(res.body.removed.socialPosts).toBe(1);
    const tombstone = await post('root-ada');
    expect(Object.keys(tombstone).sort()).toEqual(['createdAt', 'parentPostId', 'removedAt', 'state']);
    expect(await post('reply-ada')).toBeUndefined();
    expect((await auditRows()).filter((row) => row.action === 'removeSocialPost')).toHaveLength(1);
    // A repeated cleanup resumes safely and leaves the tombstone.
    expect((await deleteAccount('sf-ada')).statusCode).toBe(404);
    expect((await post('root-ada')).state).toBe('removed');
  });
});
