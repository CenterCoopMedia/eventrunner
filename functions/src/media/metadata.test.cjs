'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createMediaUpdateMetadataHandler,
  internals: { validateMetadata },
} = require('./metadata.cjs');

const ADMIN_EMAIL = 'admin@example.org';
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const ASSET_ID = 'aaaabbbbcccc';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function seeded() {
  return makeFakeDb({
    [`media_assets/${ASSET_ID}`]: {
      path: `cms-images/${ASSET_ID}/hero.png`,
      contentType: 'image/png',
      size: 5,
      alt: '',
      title: 'Hero',
      uploadedBy: ADMIN_EMAIL,
      createdAt: new Date(NOW),
    },
  });
}

const deps = (db, overrides = {}) => ({
  db,
  auth: { verifyIdToken: async () => ({ uid: 'admin-1', email: ADMIN_EMAIL, email_verified: true }) },
  getConfig: async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL] } }),
  now: () => NOW,
  log: { warn() {}, error() {} },
  ...overrides,
});

const post = (body) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body });

test('validateMetadata accepts a partial patch and leaves absent fields alone', () => {
  const verdict = validateMetadata({ assetId: ASSET_ID, alt: ' A photo ' });
  assert.deepEqual(verdict, { ok: true, patch: { alt: 'A photo' } });
});

test('validateMetadata refuses fields that describe the object itself', () => {
  for (const field of ['path', 'contentType', 'size', 'uploadedBy', 'createdAt']) {
    const verdict = validateMetadata({ assetId: ASSET_ID, [field]: 'x' });
    assert.equal(verdict.ok, false, field);
    assert.match(verdict.message, new RegExp(field));
  }
});

test('validateMetadata rejects a non-string value and an empty patch', () => {
  assert.equal(validateMetadata({ assetId: ASSET_ID, alt: 12 }).ok, false);
  assert.equal(validateMetadata({ assetId: ASSET_ID }).ok, false);
});

test('mediaUpdateMetadata requires admin', async () => {
  const res = fakeRes();
  await createMediaUpdateMetadataHandler(
    deps(seeded(), { getConfig: async () => ({ bootstrap: { adminEmails: [] } }) }),
  )(post({ assetId: ASSET_ID, alt: 'x' }), res);
  assert.equal(res.statusCode, 403);
});

test('mediaUpdateMetadata round-trips alt text and stamps the editor', async () => {
  const db = seeded();
  const res = fakeRes();
  await createMediaUpdateMetadataHandler(deps(db))(
    post({ assetId: ASSET_ID, alt: 'The venue at dusk' }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const row = db.read('media_assets', ASSET_ID);
  assert.equal(row.alt, 'The venue at dusk');
  assert.equal(row.title, 'Hero'); // untouched
  assert.equal(row.updatedBy, ADMIN_EMAIL);
  assert.deepEqual(row.updatedAt, new Date(NOW));
});

test('mediaUpdateMetadata answers 404 for an unknown asset', async () => {
  const res = fakeRes();
  await createMediaUpdateMetadataHandler(deps(seeded()))(
    post({ assetId: 'missing', alt: 'x' }),
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('mediaUpdateMetadata writes an admin_logs row', async () => {
  const db = seeded();
  await createMediaUpdateMetadataHandler(deps(db))(post({ assetId: ASSET_ID, alt: 'x' }), fakeRes());
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs[0].action, 'mediaUpdateMetadata');
});

test('mediaUpdateMetadata refuses non-POST', async () => {
  const res = fakeRes();
  await createMediaUpdateMetadataHandler(deps(seeded()))({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});
