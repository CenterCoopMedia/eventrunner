'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');

// requireAdmin reads config/bootstrap LIVE from the db it is handed (issue
// #186 review: it fails closed on an absent document), so every fake this
// file builds carries the document the file's getConfig describes.
const BOOTSTRAP_DOC = { adminEmails: ['admin@example.org'], staffEmails: ['staff@example.org'] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });
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
    deps(seeded(), { auth: { verifyIdToken: async () => ({ uid: 'x-1', email: 'nobody@example.org', email_verified: true }) } }),
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

// ------------------------------------------------ branding is the operator's (#186 review)

const STAFF_EMAIL = 'staff@example.org';
const BRANDING_ID = 'brand-asset-1';
const tiered = async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL], staffEmails: [STAFF_EMAIL] } });
const staffAuth = { verifyIdToken: async () => ({ uid: 'staff-1', email: STAFF_EMAIL, email_verified: true }) };
const brandingLibrary = () => makeFakeDb({
  [`media_assets/${BRANDING_ID}`]: {
    path: `branding/${BRANDING_ID}/logo.png`, folder: 'branding', contentType: 'image/png', size: 5,
    alt: '', title: 'Logo', uploadedBy: ADMIN_EMAIL, createdAt: new Date(NOW),
  },
  [`media_assets/${ASSET_ID}`]: {
    path: `cms-images/${ASSET_ID}/hero.png`, folder: 'cms-images', contentType: 'image/png', size: 5,
    alt: '', title: 'Hero', uploadedBy: ADMIN_EMAIL, createdAt: new Date(NOW),
  },
});

test('mediaUpdateMetadata on a branding asset is refused for staff and allowed for an operator', async () => {
  const db = brandingLibrary();
  const refused = fakeRes();
  await createMediaUpdateMetadataHandler(deps(db, { auth: staffAuth, getConfig: tiered }))(
    post({ assetId: BRANDING_ID, alt: 'The logo' }), refused,
  );
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.error.message, 'branding: operator access required');
  assert.equal(db.read('media_assets', BRANDING_ID).alt, '');

  const allowed = fakeRes();
  await createMediaUpdateMetadataHandler(deps(db, { getConfig: tiered }))(
    post({ assetId: BRANDING_ID, alt: 'The logo' }), allowed,
  );
  assert.equal(allowed.statusCode, 200);
  assert.equal(db.read('media_assets', BRANDING_ID).alt, 'The logo');
});

test('mediaUpdateMetadata on a cms-images asset stays staff work', async () => {
  const db = brandingLibrary();
  const res = fakeRes();
  await createMediaUpdateMetadataHandler(deps(db, { auth: staffAuth, getConfig: tiered }))(
    post({ assetId: ASSET_ID, alt: 'A hero' }), res,
  );
  assert.equal(res.statusCode, 200);
});
