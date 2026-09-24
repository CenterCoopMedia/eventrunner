'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGetVersionHistoryHandler, internals } = require('./versions.cjs');
const { makeFakeDb: makeBareFakeDb } = require('./firestoreFake.cjs');

// requireAdmin reads config/bootstrap LIVE from the db it is handed (issue
// #186 review: it fails closed on an absent document), so every fake this
// file builds carries the document the file's getConfig describes.
const BOOTSTRAP_DOC = { adminEmails: ['admin@example.org'], staffEmails: ['staff@example.org'] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });

const ADMIN = { uid: 'admin1', email: 'admin@example.org', email_verified: true };
const STAFF = { uid: 'staff1', email: 'staff@example.org', email_verified: true };
const USER = { uid: 'user1', email: 'user@example.org', email_verified: true };

function fakeAuth() {
  return {
    async verifyIdToken(t) {
      if (t === 'admin-token') return ADMIN;
      if (t === 'staff-token') return STAFF;
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
  assert.deepEqual(res.body.entries[0].changes, [{ path: 'value', kind: 'added', before: null, after: 'other' }]);
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

/**
 * A db that answers config/bootstrap with this file's bootstrap document and
 * the history query with `rows` exactly as given. makeFakeDb clones every
 * stored value, which turns a Firestore Timestamp into a plain
 * `{ _seconds, _nanoseconds }` object, so a test of the real instant type
 * needs rows the fake never touches. `get` replaces the query's read.
 */
function stubDb(rows, { get } = {}) {
  const docs = rows.map((data, index) => ({ id: `row-${index}`, data: () => data }));
  const query = {
    where() { return query; },
    orderBy() { return query; },
    startAfter() { return query; },
    limit(n) {
      return {
        get: get ?? (async () => ({ docs: docs.slice(0, n) })),
      };
    },
  };
  return {
    collection(name) {
      if (name === 'config') {
        return {
          doc: () => ({ get: async () => ({ exists: true, data: () => BOOTSTRAP_DOC }) }),
        };
      }
      return query;
    },
  };
}

test('cmsGetVersionHistory shapes an infra query failure as a core/errors 500', async () => {
  // The stub answers the tier gate's config/bootstrap read, so the failure
  // is the history query's own and not the gate's (which answers 500 with a
  // different message before any query runs).
  const throwingDb = stubDb([], {
    get: async () => {
      throw new Error('FAILED_PRECONDITION: The query requires an index.');
    },
  });
  const res = fakeRes();
  await createGetVersionHistoryHandler({
    db: throwingDb,
    auth: fakeAuth(),
    getConfig,
    log: { error() {} },
  })(req({ body: { docPath: 'cmsContent/hero__title' } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'internal');
  assert.equal(res.body.error.message, 'Version history is temporarily unavailable.');
});

test('cmsGetVersionHistory answers a staff caller: version history is staff work', async () => {
  const db = seedHistory();
  const res = fakeRes();
  await handler(db)(req({ token: 'staff-token', body: { docPath: 'cmsContent/hero__title' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.entries.map((e) => e.revision), [5, 4, 3, 2, 1]);
});

// --- what changed (issue #195) -------------------------------------------------

const { describeChanges } = internals;
const row = (fields, visible = true) => ({ fields, visible });

test('describeChanges: a changed value, an added field, and a removed one', () => {
  const { changes, moreChanges } = describeChanges(
    row({ value: 'old', label: 'Kept', note: 'gone' }),
    row({ value: 'new', label: 'Kept', url: 'https://example.org' }),
  );
  assert.deepEqual(changes, [
    { path: 'note', kind: 'removed', before: 'gone', after: null },
    { path: 'url', kind: 'added', before: null, after: 'https://example.org' },
    { path: 'value', kind: 'changed', before: 'old', after: 'new' },
  ]);
  assert.equal(moreChanges, 0);
});

test('describeChanges: no change gives an empty list', () => {
  assert.deepEqual(describeChanges(row({ value: 'same', tags: ['a'] }), row({ value: 'same', tags: ['a'] })), {
    changes: [],
    moreChanges: 0,
  });
});

test('describeChanges: an array of scalars is one value, compared whole', () => {
  const { changes } = describeChanges(row({ tags: ['a', 'b'] }), row({ tags: ['a', 'c'] }));
  assert.deepEqual(changes, [{ path: 'tags', kind: 'changed', before: ['a', 'b'], after: ['a', 'c'] }]);
});

test('describeChanges: a nested map flattens to dotted paths', () => {
  const { changes } = describeChanges(
    row({ layout: { header: 'banner', width: 'wide' } }),
    row({ layout: { header: 'plain', width: 'wide' } }),
  );
  assert.deepEqual(changes, [{ path: 'layout.header', kind: 'changed', before: 'banner', after: 'plain' }]);
});

test('describeChanges: an array of maps is compared by index', () => {
  const { changes } = describeChanges(
    row({ sections: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }] }),
    row({ sections: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Second' }] }),
  );
  assert.deepEqual(changes, [{ path: 'sections.1.label', kind: 'changed', before: 'Two', after: 'Second' }]);
});

test('describeChanges: an empty map or array is one value', () => {
  const { changes } = describeChanges(row({ layout: {}, tags: [] }), row({ layout: { header: 'plain' }, tags: ['a'] }));
  assert.deepEqual(changes, [
    { path: 'layout', kind: 'removed', before: {}, after: null },
    { path: 'layout.header', kind: 'added', before: null, after: 'plain' },
    { path: 'tags', kind: 'changed', before: [], after: ['a'] },
  ]);
});

test('describeChanges: the seed bookkeeping is never a change', () => {
  const { changes } = describeChanges(
    row({ value: 'old', seeded: true, seededAt: '2026-01-01T00:00:00.000Z' }),
    row({ value: 'new' }),
  );
  assert.deepEqual(changes, [{ path: 'value', kind: 'changed', before: 'old', after: 'new' }]);
  assert.deepEqual(describeChanges(null, row({ value: 'v', seeded: true, seededAt: 'x' })).changes, [
    { path: 'value', kind: 'added', before: null, after: 'v' },
  ]);
});

test('describeChanges: visibility shows when it moves, and on a first version that went out hidden', () => {
  assert.deepEqual(describeChanges(row({ value: 'v' }, true), row({ value: 'v' }, false)).changes, [
    { path: 'visible', kind: 'changed', before: true, after: false },
  ]);
  assert.deepEqual(describeChanges(null, row({ value: 'v' }, false)).changes, [
    { path: 'value', kind: 'added', before: null, after: 'v' },
    { path: 'visible', kind: 'added', before: null, after: false },
  ]);
  assert.deepEqual(describeChanges(null, row({ value: 'v' }, true)).changes, [
    { path: 'value', kind: 'added', before: null, after: 'v' },
  ]);
});

test('describeChanges: with no predecessor, every leaf reads as added', () => {
  const { changes } = describeChanges(null, row({ title: 'T', layout: { header: 'plain' }, tags: ['a'] }));
  assert.deepEqual(changes, [
    { path: 'layout.header', kind: 'added', before: null, after: 'plain' },
    { path: 'tags', kind: 'added', before: null, after: ['a'] },
    { path: 'title', kind: 'added', before: null, after: 'T' },
  ]);
});

test('describeChanges: 60 changes list 50 and count the other 10', () => {
  const before = {};
  const after = {};
  for (let i = 0; i < 60; i += 1) {
    before[`f${String(i).padStart(2, '0')}`] = 'a';
    after[`f${String(i).padStart(2, '0')}`] = 'b';
  }
  const { changes, moreChanges } = describeChanges(row(before), row(after));
  assert.equal(changes.length, 50);
  assert.equal(moreChanges, 10);
  assert.equal(changes[0].path, 'f00');
  assert.equal(changes[49].path, 'f49');
});

test('describeChanges: paths come sorted, index segments by number', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ label: `L${i}` }));
  const changed = items(12).map((item, i) => (i === 2 || i === 10 ? { label: `${item.label}!` } : item));
  const { changes } = describeChanges(row({ zeta: 1, items: items(12), alpha: 1 }), row({ zeta: 2, items: changed, alpha: 2 }));
  assert.deepEqual(changes.map((c) => c.path), ['alpha', 'items.2.label', 'items.10.label', 'zeta']);
});

test('describeChanges: an instant is one value in milliseconds, marked as a time', () => {
  const { Timestamp } = require('firebase-admin/firestore');
  const moved = describeChanges(
    row({ publishAt: Timestamp.fromMillis(1_000) }),
    row({ publishAt: Timestamp.fromMillis(2_000) }),
  );
  assert.deepEqual(moved.changes, [{ path: 'publishAt', kind: 'changed', before: 1_000, after: 2_000, time: true }]);
  // A Date and a Timestamp for the same instant are the same value.
  assert.deepEqual(
    describeChanges(row({ publishAt: new Date(5_000) }), row({ publishAt: Timestamp.fromMillis(5_000) })).changes,
    [],
  );
  // Set for the first time, and cleared.
  assert.deepEqual(describeChanges(row({ publishAt: null }), row({ publishAt: new Date(3_000) })).changes, [
    { path: 'publishAt', kind: 'changed', before: null, after: 3_000, time: true },
  ]);
});

test('cmsGetVersionHistory: every entry diffs against the row before it, across pages', async () => {
  const db = seedHistory();
  const docPath = 'cmsContent/hero__title';

  let res = fakeRes();
  await handler(db)(req({ body: { docPath, limit: 2 } }), res);
  const [five, four] = res.body.entries;
  assert.equal(five.previousRevision, 4);
  assert.deepEqual(five.changes, [{ path: 'value', kind: 'changed', before: 'v4', after: 'v5' }]);
  // The last entry on a full page diffs against the extra row the query
  // already reads to decide nextCursor.
  assert.equal(four.previousRevision, 3);
  assert.deepEqual(four.changes, [{ path: 'value', kind: 'changed', before: 'v3', after: 'v4' }]);
  assert.equal(four.moreChanges, 0);

  res = fakeRes();
  await handler(db)(req({ body: { docPath, limit: 2, cursor: 2 } }), res);
  const [one] = res.body.entries;
  assert.equal(one.revision, 1);
  assert.equal(one.previousRevision, null);
  assert.deepEqual(one.changes, [{ path: 'value', kind: 'added', before: null, after: 'v1' }]);
  // Named fields only, and the time in milliseconds.
  // The stored snapshot is not sent: the page reads the changes only.
  assert.deepEqual(Object.keys(one).sort(), [
    'changes', 'docPath', 'id', 'moreChanges', 'previousRevision', 'publishedAt',
    'publishedBy', 'publishedByUid', 'revision', 'visible',
  ]);
  assert.equal(one.publishedAt, 1000);
  assert.equal(one.publishedBy, 'admin@example.org');
  assert.equal(one.publishedByUid, null);
});

test('cmsGetVersionHistory sends a real Timestamp as milliseconds, never as its internal fields', async () => {
  const { Timestamp } = require('firebase-admin/firestore');
  const PUBLISHED = Date.UTC(2026, 8, 23, 18, 2);
  const db = stubDb([
    {
      docPath: 'cmsUpdates/u1',
      revision: 2,
      fields: { title: 'Doors open', publishAt: Timestamp.fromMillis(PUBLISHED + 60_000) },
      visible: true,
      publishedAt: Timestamp.fromMillis(PUBLISHED),
      publishedBy: 'admin@example.org',
      publishedByUid: 'admin1',
    },
    {
      docPath: 'cmsUpdates/u1',
      revision: 1,
      fields: { title: 'Doors open', publishAt: Timestamp.fromMillis(PUBLISHED) },
      visible: true,
      publishedAt: Timestamp.fromMillis(PUBLISHED - 60_000),
      publishedBy: 'admin@example.org',
      publishedByUid: 'admin1',
    },
  ]);
  const res = fakeRes();
  await handler(db)(req({ body: { docPath: 'cmsUpdates/u1', limit: 1 } }), res);
  assert.equal(res.statusCode, 200);
  const [entry] = res.body.entries;
  assert.equal(entry.publishedAt, PUBLISHED);
  assert.deepEqual(entry.changes, [
    { path: 'publishAt', kind: 'changed', before: PUBLISHED, after: PUBLISHED + 60_000, time: true },
  ]);
  const wire = JSON.stringify(res.body);
  assert.doesNotMatch(wire, /_seconds/);
  assert.equal(res.body.nextCursor, 2);
});

// --- clause (f), the server half: an edit and a publish of a content block ----

test('editing and publishing a content block yields a readable history entry', async () => {
  const store = require('./store.cjs');
  const { createCmsUpdateContentHandler } = require('./content.cjs');
  const { createCmsPublishHandler } = require('./publish.cjs');
  const db = makeFakeDb();
  const SEED_ACTOR = { uid: 'init-event-script', email: 'init-event-script' };
  const docId = 'hero__subtitle';

  // As the seed writes it: a draft, then a publish (scripts/lib/write.cjs).
  await store.writeDraft({
    db,
    collection: 'cmsContent',
    docId,
    fields: {
      section: 'hero',
      field: 'subtitle',
      blockType: 'text',
      value: 'Three days of workshops.',
      seeded: true,
      seededAt: '2026-01-01T00:00:00.000Z',
    },
    visible: true,
    actor: SEED_ACTOR,
  });
  await store.publishDocs({ db, collection: 'cmsContent', docIds: [docId], actor: SEED_ACTOR });

  // The admin's edit and publish, through the real endpoints.
  const deps = { db, auth: fakeAuth(), getConfig, log: { warn() {}, error() {} } };
  let res = fakeRes();
  await createCmsUpdateContentHandler(deps)(
    req({ body: { collection: 'cmsContent', section: 'hero', field: 'subtitle', fields: { value: 'Four days of workshops.' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  res = fakeRes();
  await createCmsPublishHandler(deps)(req({ body: { collection: 'cmsContent', docIds: [docId] } }), res);
  assert.equal(res.statusCode, 200);

  res = fakeRes();
  await handler(db)(req({ body: { docPath: `cmsContent/${docId}` } }), res);
  assert.equal(res.statusCode, 200);
  const [latest, first] = res.body.entries;
  assert.equal(latest.revision, 2);
  assert.equal(latest.publishedBy, 'admin@example.org');
  assert.ok(Number.isFinite(latest.publishedAt));
  // Only the edited field: the flag the edit cleared is not a change.
  assert.deepEqual(latest.changes, [
    { path: 'value', kind: 'changed', before: 'Three days of workshops.', after: 'Four days of workshops.' },
  ]);
  assert.equal(first.revision, 1);
  assert.equal(first.publishedBy, 'init-event-script');
  assert.equal(first.previousRevision, null);
});
