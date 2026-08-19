'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGetVersionHistoryHandler, internals } = require('./versions.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

const ADMIN = { uid: 'admin1', email: 'admin@example.org', email_verified: true };
const USER = { uid: 'user1', email: 'user@example.org', email_verified: true };

function fakeAuth() {
  return {
    async verifyIdToken(t) {
      if (t === 'admin-token') return ADMIN;
      if (t === 'user-token') return USER;
      throw new Error('auth/argument-error');
    },
  };
}

const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.org'] } });

function req({ method = 'POST', token = 'admin-token', body = {} } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

/** Seed history rows for two docPaths, revisions 1..n. */
function seedHistory() {
  const seed = {};
  for (let r = 1; r <= 5; r += 1) {
    seed[`cmsVersionHistory/h-title-${r}`] = {
      docPath: 'cmsContent/hero__title',
      revision: r,
      fields: { value: `v${r}` },
      visible: true,
      publishedAt: new Date(r * 1000),
      publishedBy: 'admin@example.org',
    };
  }
  seed['cmsVersionHistory/h-other-1'] = {
    docPath: 'cmsContent/hero__subtitle',
    revision: 1,
    fields: { value: 'other' },
    visible: true,
    publishedAt: new Date(1),
    publishedBy: 'admin@example.org',
  };
  return makeFakeDb(seed);
}

function handler(db) {
  return createGetVersionHistoryHandler({ db, auth: fakeAuth(), getConfig });
}

test('isValidDocPath accepts publishable-collection paths only', () => {
  assert.equal(internals.isValidDocPath('cmsContent/hero__title'), true);
  assert.equal(internals.isValidDocPath('cmsPages/home'), true);
  assert.equal(internals.isValidDocPath('users/u1'), false);
  assert.equal(internals.isValidDocPath('cmsContent'), false);
  assert.equal(internals.isValidDocPath('cmsContent/a/b'), false);
  assert.equal(internals.isValidDocPath(42), false);
});

test('cmsGetVersionHistory: 401 without token, 403 for non-admin, 405 for GET', async () => {
  const db = seedHistory();
  let res = fakeRes();
  await handler(db)(req({ token: null }), res);
  assert.equal(res.statusCode, 401);

  res = fakeRes();
  await handler(db)(req({ token: 'user-token' }), res);
  assert.equal(res.statusCode, 403);

  res = fakeRes();
  await handler(db)(req({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('cmsGetVersionHistory: 400 on a bad docPath or cursor', async () => {
  const db = seedHistory();
  for (const body of [
    {},
    { docPath: 'users/u1' },
    { docPath: 'cmsContent/hero__title', cursor: 'three' },
  ]) {
    const res = fakeRes();
    await handler(db)(req({ body }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('cmsGetVersionHistory paginates newest-first with revision cursors', async () => {
  const db = seedHistory();
  const docPath = 'cmsContent/hero__title';

  let res = fakeRes();
  await handler(db)(req({ body: { docPath, limit: 2 } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.entries.map((e) => e.revision), [5, 4]);
  assert.equal(res.body.nextCursor, 4);

  res = fakeRes();
  await handler(db)(req({ body: { docPath, limit: 2, cursor: 4 } }), res);
  assert.deepEqual(res.body.entries.map((e) => e.revision), [3, 2]);
  assert.equal(res.body.nextCursor, 2);

  res = fakeRes();
  await handler(db)(req({ body: { docPath, limit: 2, cursor: 2 } }), res);
  assert.deepEqual(res.body.entries.map((e) => e.revision), [1]);
  assert.equal(res.body.nextCursor, null);
});

test('cmsGetVersionHistory scopes strictly to the requested docPath', async () => {
  const db = seedHistory();
  const res = fakeRes();
  await handler(db)(req({ body: { docPath: 'cmsContent/hero__subtitle' } }), res);
  assert.equal(res.body.entries.length, 1);
  assert.equal(res.body.entries[0].fields.value, 'other');
  assert.equal(res.body.nextCursor, null);
});

test('cmsGetVersionHistory: an exact-limit page has no phantom next page', async () => {
  const db = seedHistory();
  const res = fakeRes();
  await handler(db)(req({ body: { docPath: 'cmsContent/hero__title', limit: 5 } }), res);
  assert.equal(res.body.entries.length, 5);
  assert.equal(res.body.nextCursor, null);
});

test('cmsGetVersionHistory clamps a silly limit to the default', async () => {
  const db = seedHistory();
  const res = fakeRes();
  await handler(db)(req({ body: { docPath: 'cmsContent/hero__title', limit: 10000 } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.entries.length, 5); // default (20) covers all rows
});

test('the (docPath ASC, revision DESC) composite index is declared for deploy', () => {
  // The where('docPath','==')+orderBy('revision','desc') query needs this
  // composite index in real Firestore; the in-memory fake cannot catch a
  // missing declaration, so assert the deployed file directly.
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const declared = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8'),
  );
  const match = (declared.indexes || []).find(
    (ix) =>
      ix.collectionGroup === 'cmsVersionHistory' &&
      Array.isArray(ix.fields) &&
      ix.fields.length === 2 &&
      ix.fields[0].fieldPath === 'docPath' &&
      ix.fields[0].order === 'ASCENDING' &&
      ix.fields[1].fieldPath === 'revision' &&
      ix.fields[1].order === 'DESCENDING',
  );
  assert.ok(match, 'firestore.indexes.json must declare (docPath ASC, revision DESC) on cmsVersionHistory');
});

test('cmsGetVersionHistory shapes an infra query failure as a core/errors 500', async () => {
  const throwingDb = {
    collection() {
      return {
        where() { return this; },
        orderBy() { return this; },
        startAfter() { return this; },
        limit() { return this; },
        async get() {
          throw new Error('FAILED_PRECONDITION: The query requires an index.');
        },
      };
    },
  };
  const res = fakeRes();
  await createGetVersionHistoryHandler({
    db: throwingDb,
    auth: fakeAuth(),
    getConfig,
    log: { error() {} },
  })(req({ body: { docPath: 'cmsContent/hero__title' } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'internal');
});
