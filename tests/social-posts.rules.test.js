// #510's HTTP and persistence contract against real Firestore transactions.
// Only Auth/Storage are fakes. Expected outcomes come from issue #510;
// #506's audit rollback and moderation/cleanup tests remain in social-feed.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { createCreateSocialPostHandler, createRemoveSocialPostHandler, createReportSocialPostHandler } = require('../functions/src/social/feed.cjs');
const { createDeleteAttendeeHandler } = require('../functions/src/users/records.cjs');
const { MAX_SOCIAL_THREAD_PAGE_SIZE } = require('../packages/shared/src/socialPost.cjs');
const PROJECT_ID = 'demo-run-of-show';
const OPERATOR = 'post-operator@example.test';
const STAFF = 'post-staff@example.test';
const FEED_ON = { socialFeed: true, attendeeDirectory: true };
const AT = new Date('2026-11-10T18:00:00Z');
const QUIET = { error() {}, warn() {}, info() {} };
const ROOT = { state: 'active', authorUid: 'post-bo', text: 'Root.', parentPostId: null, createdAt: AT };
const TOKENS = Object.fromEntries(['approved', 'speaker', 'pending', 'ticketed', 'revoked', 'former', 'public', 'staff', 'operator'].map((name) => [name, {
  uid: `post-${name}`, email: `post-${name}@example.test`, email_verified: true,
}]));
const auth = {
  async verifyIdToken(token, checkRevoked) {
    expect(checkRevoked).toBe(true);
    if (!TOKENS[token]) throw new Error('invalid or revoked sign-in');
    return TOKENS[token];
  },
  async getUser(uid) { return { uid, email: `${uid}@example.test` }; },
  async deleteUser() {}, // Tokens keep verifying, to prove the database fence.
};
let testEnv;
let adminApp;
let db;

function response() {
  return {
    statusCode: null, body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(factory, token, body, deps = {}, request = {}) {
  const res = response();
  await factory({ db, auth, getConfig: async () => ({ bootstrap: { adminEmails: [OPERATOR, TOKENS.former.email] } }),
    getBucket: () => ({ async getFiles() { return [[]]; } }), log: QUIET, ...deps })(
    { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body, ...request }, res,
  );
  return res;
}

const payload = (overrides = {}) => ({ text: 'Lunch at noon.', submissionKey: 'intent_1', ...overrides });
const create = (token = 'approved', body = payload(), deps, request) => call(createCreateSocialPostHandler, token, body, deps, request);
const remove = (postId = 'root', deps) => call(createRemoveSocialPostHandler, 'staff', { postId }, deps);
const report = (postId, token = 'speaker', deps) => call(createReportSocialPostHandler, token, { postId }, deps);
const deleteAccount = (deps) => call(createDeleteAttendeeHandler, 'operator', { uid: TOKENS.approved.uid }, deps);
const data = async (postId) => (await db.collection('social_posts').doc(postId).get()).data();
const idFor = (token, key = 'intent_1') => createHash('sha256').update(`${TOKENS[token].uid}\0${key}`).digest('hex');
const client = (name) => testEnv.authenticatedContext(TOKENS[name].uid, {
  email: TOKENS[name].email, email_verified: true,
}).firestore();

// Hold a real database operation before it starts its transaction, while a
// competing real operation commits. No reads, locks, writes or retries are
// faked. This gives deterministic overlapping handlers in both commit orders.
function pausedTransaction() {
  let arrived;
  let release;
  const entered = new Promise((resolve) => { arrived = resolve; });
  const resume = new Promise((resolve) => { release = resolve; });
  let first = true;
  const heldDb = new Proxy(db, {
    get(target, prop) {
      if (prop === 'runTransaction') return async (...args) => {
        if (first) { first = false; arrived(); await resume; }
        return target.runTransaction(...args);
      };
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: heldDb, entered, release };
}

async function changeFlags(flags) {
  await db.runTransaction(async (tx) => {
    const ref = db.collection('config').doc('features');
    await tx.get(ref);
    tx.set(ref, flags);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `social-posts-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  const batch = db.batch();
  batch.set(db.collection('config').doc('bootstrap'), { adminEmails: [OPERATOR], staffEmails: [STAFF] });
  batch.set(db.collection('config').doc('features'), FEED_ON);
  for (const name of ['approved', 'speaker', 'pending', 'ticketed', 'revoked', 'former']) {
    batch.set(db.collection('users').doc(TOKENS[name].uid), {
      uid: TOKENS[name].uid, email: TOKENS[name].email,
      registrationStatus: name === 'former' || name === 'speaker' ? 'pending' : name,
      speakerId: name === 'speaker' ? 'speaker-1' : null,
      role: name === 'former' ? 'admin' : 'attendee',
    });
  }
  batch.set(db.collection('users_public').doc(TOKENS.public.uid), { profileVisibility: 'public', displayName: 'A visitor' });
  // A live root author is required before a reply can create its private notice.
  batch.set(db.collection('users').doc(ROOT.authorUid), { registrationStatus: 'approved' });
  batch.set(db.collection('social_posts').doc('root'), ROOT);
  batch.set(db.collection('social_posts').doc('other-root'), ROOT);
  batch.set(db.collection('social_posts').doc('reply'), { ...ROOT, parentPostId: 'root' });
  await batch.commit();
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('creation authorization and validation', () => {
  it('admits only current approved/speaker accounts, deriving their author and server time', async () => {
    for (const token of ['approved', 'speaker']) {
      const res = await create(token, payload({ text: '  <b>Lunch</b>\n', parentPostId: token === 'speaker' ? 'root' : null }), { now: () => AT });
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ postId: idFor(token), state: 'active' });
      const stored = await data(res.body.postId);
      expect(Object.keys(stored).sort()).toEqual(['authorUid', 'createdAt', 'parentPostId', 'state', 'text']);
      expect(stored).toMatchObject({ authorUid: TOKENS[token].uid, state: 'active', text: '<b>Lunch</b>', parentPostId: token === 'speaker' ? 'root' : null });
      expect(stored.createdAt.toMillis()).toBe(AT.getTime());
    }
    for (const token of [null, 'revoked-signin']) expect((await create(token)).statusCode).toBe(401);
    for (const token of ['pending', 'ticketed', 'revoked', 'former', 'public', 'staff', 'operator']) {
      expect((await create(token)).statusCode, token).toBe(403);
      expect(await data(idFor(token))).toBeUndefined();
    }
    // An independent approved account can compose even if also staff.
    await db.collection('users').doc(TOKENS.staff.uid).set({ registrationStatus: 'approved' });
    expect((await create('staff')).statusCode).toBe(201);
  });

  it('fails closed for missing, false or malformed flags and unavailable configuration', async () => {
    for (const flags of [null, {}, { socialFeed: true }, { attendeeDirectory: true },
      { socialFeed: false, attendeeDirectory: true }, { socialFeed: true, attendeeDirectory: false },
      { socialFeed: 'true', attendeeDirectory: true }, { socialFeed: true, attendeeDirectory: 'true' }]) {
      const ref = db.collection('config').doc('features');
      if (flags === null) await ref.delete(); else await ref.set(flags);
      expect((await create()).statusCode, JSON.stringify(flags)).toBe(404);
    }
    const unavailable = { runTransaction() { throw new Error('database unavailable'); }, collection: (name) => db.collection(name) };
    expect((await create('approved', payload(), { db: unavailable })).statusCode).toBe(500);
    expect(await data(idFor('approved'))).toBeUndefined();
  });

  it('rejects forged fields, invalid IDs, keys and text before a transaction starts', async () => {
    const noDatabase = { runTransaction() { throw new Error('must not enter a transaction'); } };
    const bodies = [null, [], payload({ text: ' \n' }), payload({ text: 'x'.repeat(2001) }),
      payload({ text: '😀'.repeat(1000) + 'a' }), payload({ submissionKey: 'short' }), payload({ submissionKey: 'x'.repeat(129) }),
      ...['authorUid', 'createdAt', 'state', 'extra'].map((key) => payload({ [key]: 'forged' })),
      ...['', '.', '..', 'nested/root', 'x'.repeat(129), {}].map((parentPostId) => payload({ parentPostId }))];
    for (const body of bodies) expect((await create('approved', body, { db: noDatabase })).statusCode).toBe(400);
    expect((await create('approved', payload(), { db: noDatabase }, { method: 'GET' })).statusCode).toBe(405);
    expect((await create('approved', payload({ text: '\u0000'.repeat(1400) }), { db: noDatabase })).statusCode).toBe(413);
    expect((await create('approved', payload(), { db: noDatabase }, { rawBody: Buffer.from(JSON.stringify(payload()).padEnd(8193)) })).statusCode).toBe(413);
    expect((await create('approved', payload(), {}, { rawBody: Buffer.from(JSON.stringify(payload()).padEnd(8192)) })).statusCode).toBe(201);
    expect((await create('speaker', payload({ text: '😀'.repeat(1000) }))).statusCode).toBe(201);
  });

  it('refuses nested replies and removed/missing roots without creating a target', async () => {
    await remove();
    for (const parentPostId of ['reply', 'root', 'missing']) {
      expect((await create('approved', payload({ parentPostId }))).statusCode).toBe(404);
    }
    expect(await data(idFor('approved'))).toBeUndefined();
  });
});

describe('submission identity and terminal removal', () => {
  it('stores once across concurrent normalized replays and namespaces keys by UID', async () => {
    const results = await Promise.all([create(), create('approved', payload({ text: ' Lunch at noon. ' })), create()]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((res) => res.body.postId))).toEqual(new Set([idFor('approved')]));
    const snapshot = await db.collection('social_posts').doc(idFor('approved')).get();
    const before = snapshot.data();
    expect((await create()).statusCode).toBe(200);
    expect(await data(idFor('approved'))).toEqual(before);
    expect((await db.collection('social_posts').doc(idFor('approved')).get()).updateTime.isEqual(snapshot.updateTime)).toBe(true);
    expect((await create('speaker')).statusCode).toBe(201);
    expect(idFor('speaker')).not.toBe(idFor('approved'));
    expect((await create('approved', payload({ text: 'Different.' }))).statusCode).toBe(409);
    expect((await create('approved', payload({ parentPostId: 'root' }))).statusCode).toBe(409);
    expect(await data(idFor('approved'))).toEqual(before);
  });

  it('checks current authorization before replay and makes removed IDs terminal with one audit', async () => {
    const created = await create();
    await remove(created.body.postId);
    await remove(created.body.postId);
    for (const text of ['Lunch at noon.', 'Changed after removal.']) {
      const replay = await create('approved', payload({ text }));
      expect(replay.statusCode).toBe(410);
      expect(replay.body.error.code).toBe('post-removed');
    }
    const tombstone = await data(created.body.postId);
    expect(Object.keys(tombstone).sort()).toEqual(['createdAt', 'parentPostId', 'removedAt', 'state']);
    const logs = (await db.collection('admin_logs').get()).docs.map((row) => row.data());
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain('Lunch at noon.');
    expect(JSON.stringify(logs)).not.toContain(TOKENS.approved.uid);
    await changeFlags({ ...FEED_ON, socialFeed: false });
    expect((await create()).statusCode).toBe(404);
    await changeFlags(FEED_ON);
    await db.collection('users').doc(TOKENS.approved.uid).update({ registrationStatus: 'revoked' });
    expect((await create()).statusCode).toBe(403);
    expect(await data(created.body.postId)).toEqual(tombstone);
  });

  it('refuses an active replay after either flag is disabled or the account grant is revoked/deleted', async () => {
    expect((await create()).statusCode).toBe(201);
    const before = await data(idFor('approved'));
    for (const flag of ['socialFeed', 'attendeeDirectory']) {
      await changeFlags({ ...FEED_ON, [flag]: false });
      expect((await create()).statusCode).toBe(404);
    }
    await changeFlags(FEED_ON);
    await db.collection('users').doc(TOKENS.approved.uid).update({ registrationStatus: 'revoked' });
    expect((await create()).statusCode).toBe(403);
    await db.collection('users').doc(TOKENS.approved.uid).delete();
    expect((await create()).statusCode).toBe(403);
    expect(await data(idFor('approved'))).toEqual(before);
  });
});

describe('transaction commit orders', () => {
  for (const first of ['reply', 'removal']) {
    it(`${first} commits first: root removal closes new replies and retains existing ones`, async () => {
      const pause = pausedTransaction();
      const pending = first === 'reply' ? remove('root', { db: pause.db }) : create('approved', payload({ parentPostId: 'root' }), { db: pause.db });
      await pause.entered;
      let reply;
      try { reply = first === 'reply' ? await create('approved', payload({ parentPostId: 'root' })) : await remove(); }
      finally { pause.release(); }
      expect(reply.statusCode).toBe(first === 'reply' ? 201 : 200);
      expect((await pending).statusCode).toBe(first === 'reply' ? 200 : 404);
      expect((await data('root')).state).toBe('removed');
      if (first === 'reply') {
        expect((await report(idFor('approved'))).statusCode).toBe(201);
        expect((await assertSucceeds(getDoc(doc(client('approved'), `social_posts/${idFor('approved')}`)))).data().text).toBe('Lunch at noon.');
        expect((await create('approved', payload({ parentPostId: 'root' }))).statusCode).toBe(200);
        await remove(idFor('approved'));
        expect((await data(idFor('approved'))).state).toBe('removed');
      }
      expect((await create('speaker', payload({ parentPostId: 'root', submissionKey: 'new_reply' }))).statusCode).toBe(404);
      expect((await data('reply')).state).toBe('active');
    });
  }

  for (const flag of ['socialFeed', 'attendeeDirectory']) {
    for (const first of ['creation', 'disable']) {
      it(`${first} commits first against ${flag}`, async () => {
        const pause = pausedTransaction();
        const pending = first === 'creation'
          ? pause.db.runTransaction(async (tx) => { tx.set(db.collection('config').doc('features'), { ...FEED_ON, [flag]: false }); })
          : create('approved', payload(), { db: pause.db });
        await pause.entered;
        try {
          if (first === 'creation') expect((await create()).statusCode).toBe(201);
          else await changeFlags({ ...FEED_ON, [flag]: false });
        } finally { pause.release(); }
        const result = await pending;
        if (first === 'disable') expect(result.statusCode).toBe(404);
        expect(Boolean(await data(idFor('approved')))).toBe(first === 'creation');
        expect((await create()).statusCode).toBe(404);
      });
    }
  }

  for (const first of ['creation', 'deletion']) {
    it(`${first} commits first against account deletion; only the author's active rows are swept`, async () => {
      const pause = pausedTransaction();
      const pending = first === 'creation' ? deleteAccount({ db: pause.db }) : create('approved', payload(), { db: pause.db });
      await pause.entered;
      try {
        if (first === 'creation') {
          expect((await create()).statusCode).toBe(201);
          expect((await create('approved', payload({ submissionKey: 'own_reply', parentPostId: 'root' }))).statusCode).toBe(201);
          expect((await create('speaker', payload({ parentPostId: idFor('approved') }))).statusCode).toBe(201);
        } else expect((await deleteAccount()).statusCode).toBe(200);
      } finally { pause.release(); }
      expect((await pending).statusCode).toBe(first === 'creation' ? 200 : 403);
      expect(await data(idFor('approved'))).toBeUndefined();
      expect(await data(idFor('approved', 'own_reply'))).toBeUndefined();
      expect((await create()).statusCode).toBe(403); // old token still verifies
      if (first === 'creation') {
        expect((await data(idFor('speaker'))).state).toBe('active');
        expect((await report(idFor('speaker'))).statusCode).toBe(201);
        expect((await create('speaker', payload({ submissionKey: 'after_del', parentPostId: idFor('approved') }))).statusCode).toBe(404);
      }
    });
  }

  for (const first of ['report', 'removal']) {
    it(`${first} commits first: a removed target accepts no new report`, async () => {
      const pause = pausedTransaction();
      const pending = first === 'report' ? remove('root', { db: pause.db }) : report('root', 'speaker', { db: pause.db });
      await pause.entered;
      try { expect((await (first === 'report' ? report('root') : remove())).statusCode).toBe(first === 'report' ? 201 : 200); }
      finally { pause.release(); }
      expect((await pending).statusCode).toBe(first === 'report' ? 200 : 404);
      expect((await db.collection('social_reports').get()).size).toBe(first === 'report' ? 1 : 0);
      expect((await report('root', 'approved')).statusCode).toBe(404);
    });
  }
});

it('a 50-row thread page and document-ID cursor preserve equal-time replies across root removal', async () => {
  const batch = db.batch();
  const ids = Array.from({ length: 51 }, (_, i) => `thread-${String(i).padStart(3, '0')}`);
  for (const id of ids) batch.set(db.collection('social_posts').doc(id), { ...ROOT, parentPostId: 'other-root', text: id });
  await batch.commit();
  await remove('other-root');
  const clauses = [where('parentPostId', '==', 'other-root'), orderBy('createdAt', 'asc'), orderBy(documentId(), 'asc')];
  const posts = collection(client('approved'), 'social_posts');
  const first = await assertSucceeds(getDocs(query(posts, ...clauses, limit(MAX_SOCIAL_THREAD_PAGE_SIZE))));
  const next = await assertSucceeds(getDocs(query(posts, ...clauses, startAfter(first.docs.at(-1)), limit(MAX_SOCIAL_THREAD_PAGE_SIZE))));
  expect(first.size).toBe(50);
  expect(next.size).toBe(1);
  expect([...first.docs, ...next.docs].map((row) => row.id)).toEqual(ids);
});
