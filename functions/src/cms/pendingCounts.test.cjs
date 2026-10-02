'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensurePendingCounts,
  parsePendingCounts,
  createEnsurePendingCountsHandler,
} = require('./pendingCounts.cjs');
const { writeDraft } = require('./store.cjs');
const { PUBLISHABLE_COLLECTIONS } = require('./blockTypes.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

const NOW = 1_750_000_000_000;
const ACTOR = { uid: 'admin1', email: 'admin@example.org' };

function zeros(overrides = {}) {
  return { ...Object.fromEntries(PUBLISHABLE_COLLECTIONS.map((name) => [name, 0])), ...overrides };
}

test('ensurePendingCounts bootstraps all six counts from existing dirty drafts', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/a': { status: 'dirty' },
    'cmsContent_drafts/b': { status: 'clean' },
    'cmsSchedule_drafts/s1': { status: 'dirty' },
    'cmsPages_drafts/home': { status: 'dirty' },
  });

  const counts = await ensurePendingCounts({ db, now: () => NOW });

  assert.deepEqual(counts, zeros({ cmsContent: 1, cmsSchedule: 1, cmsPages: 1 }));
  assert.deepEqual(db.read('cmsMeta', 'pending'), {
    schemaVersion: 1,
    counts,
    updatedAt: new Date(NOW),
  });
});

test('ensurePendingCounts leaves a valid document unchanged and repairs an invalid one', async () => {
  const valid = {
    schemaVersion: 1,
    counts: zeros({ cmsTimeline: 2 }),
    updatedAt: new Date(100),
  };
  const db = makeFakeDb({ 'cmsMeta/pending': valid });
  assert.deepEqual(await ensurePendingCounts({ db, now: () => NOW }), valid.counts);
  assert.deepEqual(db.read('cmsMeta', 'pending'), valid);

  await db.collection('cmsMeta').doc('pending').set({ schemaVersion: 1, counts: { cmsContent: -1 } });
  db.writes.length = 0;
  await ensurePendingCounts({ db, now: () => NOW });
  assert.deepEqual(db.read('cmsMeta', 'pending').counts, zeros());
  assert.deepEqual(db.writes.map((write) => write.path), ['cmsMeta/pending']);
});

test('bootstrap retries around a concurrent first draft and counts it once', async () => {
  const db = makeFakeDb();
  db.beforeCommit = async () => {
    await writeDraft({
      db,
      collection: 'cmsContent',
      docId: 'hero__title',
      fields: { value: 'First draft' },
      actor: ACTOR,
      now: () => NOW,
    });
  };

  await ensurePendingCounts({ db, now: () => NOW });

  assert.equal(db.read('cmsContent_drafts', 'hero__title').status, 'dirty');
  assert.deepEqual(db.read('cmsMeta', 'pending').counts, zeros({ cmsContent: 1 }));
});

test('parsePendingCounts refuses missing, incomplete, negative, unsafe, and old-schema values', () => {
  for (const value of [
    null,
    {},
    { schemaVersion: 0, counts: zeros() },
    { schemaVersion: 1, counts: { cmsContent: 0 } },
    { schemaVersion: 1, counts: zeros({ cmsPages: -1 }) },
    { schemaVersion: 1, counts: zeros({ cmsPages: Number.MAX_SAFE_INTEGER + 1 }) },
  ]) {
    assert.equal(parsePendingCounts(value), null);
  }
  assert.deepEqual(parsePendingCounts({ schemaVersion: 1, counts: zeros() }), zeros());
});

function fakeAuth() {
  return {
    async verifyIdToken(token) {
      if (token === 'staff-token') {
        return { uid: 'staff1', email: 'staff@example.org', email_verified: true };
      }
      if (token === 'user-token') {
        return { uid: 'user1', email: 'user@example.org', email_verified: true };
      }
      throw new Error('bad token');
    },
  };
}

function req({ method = 'POST', token = 'staff-token' } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} };
}

function res() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('cmsEnsurePendingCounts is staff-admin-only and returns only the stable wire result', async () => {
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: [], staffEmails: ['staff@example.org'] },
    'cmsUpdates_drafts/news': { status: 'dirty' },
  });
  const handler = createEnsurePendingCountsHandler({
    db,
    auth: fakeAuth(),
    getConfig: async () => ({}),
    now: () => NOW,
    log: { error() {} },
  });

  let response = res();
  await handler(req(), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(db.read('cmsMeta', 'pending').counts.cmsUpdates, 1);

  response = res();
  await handler(req({ token: 'user-token' }), response);
  assert.equal(response.statusCode, 403);

  response = res();
  await handler(req({ method: 'GET' }), response);
  assert.equal(response.statusCode, 405);
});
