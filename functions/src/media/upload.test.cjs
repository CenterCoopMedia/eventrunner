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
  createMediaUploadHandler,
  createMediaDeleteHandler,
  createSpeakerPhotoUploadHandler,
  createSpeakerPhotoDeleteHandler,
  internals: {
    validateUpload, decodeUpload, safeObjectName, MAX_UPLOAD_BYTES, SPEAKER_PHOTO_MAX_BYTES,
    isBrandingAsset, referencedByTheme,
  },
} = require('./upload.cjs');

const ADMIN_EMAIL = 'admin@example.org';
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const ASSET_ID = 'aaaabbbbcccc';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString('base64');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

/**
 * Bucket fake: records saved objects with the metadata they were written
 * with, so the tests can pin the `seeded: 'false'` stamp scripts/lib/
 * branding.cjs reads, and can inject a save/delete failure.
 */
function fakeBucket({ failSave = false } = {}) {
  const objects = new Map();
  const deleted = [];
  return {
    objects,
    deleted,
    file(path) {
      return {
        path,
        async save(buffer, options) {
          if (failSave) throw new Error('bucket unavailable');
          objects.set(path, { buffer, options });
        },
        async delete(options = {}) {
          if (!objects.has(path) && options.ignoreNotFound !== true) {
            throw new Error(`NOT_FOUND: ${path}`);
          }
          objects.delete(path);
          deleted.push(path);
        },
      };
    },
  };
}

const deps = (db, bucket, overrides = {}) => ({
  db,
  bucket,
  auth: { verifyIdToken: async () => ({ uid: 'admin-1', email: ADMIN_EMAIL, email_verified: true }) },
  getConfig: async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL] } }),
  now: () => NOW,
  newId: () => ASSET_ID,
  log: { warn() {}, error() {} },
  ...overrides,
});

const post = (body) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body });

// ---------------------------------------------------------------- pure bits

test('safeObjectName strips directories and forces the declared extension', () => {
  assert.equal(safeObjectName('../../etc/Passwd.png', 'image/png'), 'passwd.png');
  assert.equal(safeObjectName('My Logo (final).JPG', 'image/jpeg'), 'my-logo-final.jpg');
  assert.equal(safeObjectName('', 'image/webp'), 'asset.webp');
  assert.equal(safeObjectName('...', 'image/png'), 'asset.png');
});

test('decodeUpload accepts a data: URL and rejects non-base64 and oversize payloads', () => {
  assert.equal(decodeUpload(`data:image/png;base64,${PNG}`).ok, true);
  assert.equal(decodeUpload('not base64!!').ok, false);
  assert.equal(decodeUpload('').ok, false);
  const oversize = 'A'.repeat(Math.ceil((MAX_UPLOAD_BYTES + 1024) / 3) * 4);
  const verdict = decodeUpload(oversize);
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /limit/);
});

test('validateUpload builds the object path from the SERVER-generated asset id', () => {
  const verdict = validateUpload(
    { folder: 'cms-images', contentType: 'image/png', filename: 'Hero.png', data: PNG },
    () => ASSET_ID,
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.asset.path, `cms-images/${ASSET_ID}/hero.png`);
});

test('validateUpload rejects an unknown folder — no path traversal into another namespace', () => {
  for (const folder of ['profile-photos', '../branding', 'session-materials', '']) {
    const verdict = validateUpload(
      { folder, contentType: 'image/png', data: PNG },
      () => ASSET_ID,
    );
    assert.equal(verdict.ok, false, folder);
    assert.match(verdict.message, /folder/);
  }
});

test('validateUpload takes SVG for branding only', () => {
  const branding = validateUpload(
    { folder: 'branding', contentType: 'image/svg+xml', data: PNG },
    () => ASSET_ID,
  );
  assert.equal(branding.ok, true);
  const cms = validateUpload(
    { folder: 'cms-images', contentType: 'image/svg+xml', data: PNG },
    () => ASSET_ID,
  );
  assert.equal(cms.ok, false);
  assert.match(cms.message, /contentType/);
});

test('validateUpload rejects a non-image content type', () => {
  const verdict = validateUpload(
    { folder: 'cms-images', contentType: 'application/pdf', data: PNG },
    () => ASSET_ID,
  );
  assert.equal(verdict.ok, false);
});

// ------------------------------------------------------------- mediaUpload

test('mediaUpload requires an admin token', async () => {
  const res = fakeRes();
  const handler = createMediaUploadHandler(
    deps(makeFakeDb({}), fakeBucket(), {
      auth: { verifyIdToken: async () => ({ uid: 'x-1', email: 'nobody@example.org', email_verified: true }) },
    }),
  );
  await handler(post({ folder: 'cms-images', contentType: 'image/png', data: PNG }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'forbidden');
});

test('mediaUpload rejects an unverified email', async () => {
  const res = fakeRes();
  const handler = createMediaUploadHandler(
    deps(makeFakeDb({}), fakeBucket(), {
      auth: {
        verifyIdToken: async () => ({ uid: 'a', email: ADMIN_EMAIL, email_verified: false }),
      },
    }),
  );
  await handler(post({ folder: 'cms-images', contentType: 'image/png', data: PNG }), res);
  assert.equal(res.statusCode, 403);
});

test('mediaUpload writes the object and indexes it in media_assets', async () => {
  const db = makeFakeDb({});
  const bucket = fakeBucket();
  const res = fakeRes();
  await createMediaUploadHandler(deps(db, bucket))(
    post({
      folder: 'cms-images',
      contentType: 'image/png',
      filename: 'hero.png',
      data: PNG,
      alt: '  A wide shot of the venue  ',
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  const path = `cms-images/${ASSET_ID}/hero.png`;
  assert.equal(res.body.asset.path, path);
  assert.ok(bucket.objects.has(path));

  const row = db.read('media_assets', ASSET_ID);
  assert.equal(row.path, path);
  assert.equal(row.contentType, 'image/png');
  assert.equal(row.size, Buffer.from(PNG, 'base64').length);
  assert.equal(row.alt, 'A wide shot of the venue');
  assert.equal(row.uploadedBy, ADMIN_EMAIL);
  assert.equal(row.uploadedByUid, 'admin-1');
  assert.deepEqual(row.createdAt, new Date(NOW));
});

test('mediaUpload stamps seeded=false so an init --force re-run cannot clobber it', async () => {
  const db = makeFakeDb({});
  const bucket = fakeBucket();
  await createMediaUploadHandler(deps(db, bucket))(
    post({ folder: 'branding', contentType: 'image/png', filename: 'logo.png', data: PNG }),
    fakeRes(),
  );
  const stored = bucket.objects.get(`branding/${ASSET_ID}/logo.png`);
  assert.equal(stored.options.metadata.metadata.seeded, 'false');
  assert.equal(stored.options.metadata.metadata.uploadedBy, ADMIN_EMAIL);
  assert.equal(stored.options.contentType, 'image/png');
});

test('mediaUpload writes an admin_logs row', async () => {
  const db = makeFakeDb({});
  await createMediaUploadHandler(deps(db, fakeBucket()))(
    post({ folder: 'cms-images', contentType: 'image/png', data: PNG }),
    fakeRes(),
  );
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'mediaUpload');
  assert.equal(logs[0].docPath, `media_assets/${ASSET_ID}`);
});

test('mediaUpload removes the object again when the index write fails', async () => {
  const bucket = fakeBucket();
  const db = makeFakeDb({});
  const broken = {
    ...db,
    collection(name) {
      if (name === 'media_assets') {
        return { doc: () => ({ async set() { throw new Error('firestore down'); } }) };
      }
      return db.collection(name);
    },
  };
  const res = fakeRes();
  await createMediaUploadHandler(deps(broken, bucket))(
    post({ folder: 'cms-images', contentType: 'image/png', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 500);
  // A row-less object is invisible in the library; an object-less row would
  // render as a broken image on a live page. Neither is left behind.
  assert.equal(bucket.objects.size, 0);
});

test('mediaUpload reports a bucket failure as a 500 and indexes nothing', async () => {
  const db = makeFakeDb({});
  const res = fakeRes();
  await createMediaUploadHandler(deps(db, fakeBucket({ failSave: true })))(
    post({ folder: 'cms-images', contentType: 'image/png', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 500);
  assert.deepEqual(db.ids('media_assets'), []);
});

test('mediaUpload refuses non-POST', async () => {
  const res = fakeRes();
  await createMediaUploadHandler(deps(makeFakeDb({}), fakeBucket()))(
    { method: 'GET', headers: {} },
    res,
  );
  assert.equal(res.statusCode, 405);
});

// ------------------------------------------------------------- mediaDelete

function seededLibrary(extra = {}) {
  return makeFakeDb({
    [`media_assets/${ASSET_ID}`]: {
      path: `cms-images/${ASSET_ID}/hero.png`,
      contentType: 'image/png',
      size: 5,
      uploadedBy: ADMIN_EMAIL,
      createdAt: new Date(NOW),
    },
    ...extra,
  });
}

test('mediaDelete requires admin', async () => {
  const res = fakeRes();
  await createMediaDeleteHandler(
    deps(seededLibrary(), fakeBucket(), {
      auth: { verifyIdToken: async () => null },
    }),
  )(post({ assetId: ASSET_ID }), res);
  assert.equal(res.statusCode, 401);
});

test('mediaDelete removes the object and the row when nothing references it', async () => {
  const db = seededLibrary();
  const bucket = fakeBucket();
  const path = `cms-images/${ASSET_ID}/hero.png`;
  await bucket.file(path).save(Buffer.from('x'), {});
  const res = fakeRes();
  await createMediaDeleteHandler(deps(db, bucket))(post({ assetId: ASSET_ID }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.ids('media_assets'), []);
  assert.deepEqual(bucket.deleted, [path]);
});

test('mediaDelete refuses with 409 and the reference list when the asset is in use', async () => {
  const path = `cms-images/${ASSET_ID}/hero.png`;
  const db = seededLibrary({ 'cmsPages/home': { sections: [{ image: path }] } });
  const bucket = fakeBucket();
  const res = fakeRes();
  await createMediaDeleteHandler(deps(db, bucket))(post({ assetId: ASSET_ID }), res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'asset-in-use');
  assert.deepEqual(res.body.usage, [{ docPath: 'cmsPages/home', field: 'sections.0.image' }]);
  assert.deepEqual(db.ids('media_assets'), [ASSET_ID]);
  assert.deepEqual(bucket.deleted, []);
});

test('mediaDelete with force deletes a referenced asset and reports what it broke', async () => {
  const path = `cms-images/${ASSET_ID}/hero.png`;
  const db = seededLibrary({ 'cmsPages/home': { sections: [{ image: path }] } });
  const bucket = fakeBucket();
  await bucket.file(path).save(Buffer.from('x'), {});
  const res = fakeRes();
  await createMediaDeleteHandler(deps(db, bucket))(post({ assetId: ASSET_ID, force: true }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.usage, [{ docPath: 'cmsPages/home', field: 'sections.0.image' }]);
  assert.deepEqual(db.ids('media_assets'), []);
});

test('mediaDelete clears a row whose object is already gone', async () => {
  const db = seededLibrary();
  const res = fakeRes();
  await createMediaDeleteHandler(deps(db, fakeBucket()))(post({ assetId: ASSET_ID }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.ids('media_assets'), []);
});

test('mediaDelete answers 404 for an unknown asset', async () => {
  const res = fakeRes();
  await createMediaDeleteHandler(deps(seededLibrary(), fakeBucket()))(
    post({ assetId: 'nope' }),
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('mediaDelete rejects an assetId that is a path', async () => {
  const res = fakeRes();
  await createMediaDeleteHandler(deps(seededLibrary(), fakeBucket()))(
    post({ assetId: 'a/b' }),
    res,
  );
  assert.equal(res.statusCode, 400);
});

// ------------------------------------------------------------ speakerPhotoUpload

const SPEAKER_UID = 'speaker-uid-1';

/** { db, bucket } seeded with one speaker owned by SPEAKER_UID. */
function speakerWorld(extra = {}) {
  return makeFakeDb({
    'speakers/rae': { firstName: 'Rae', lastName: 'Okonkwo', uid: SPEAKER_UID, status: 'accepted', ...extra },
  });
}

function speakerAuthDeps(db, bucket, { uid = SPEAKER_UID, email = 'rae@example.org', newId } = {}) {
  return {
    db,
    bucket,
    auth: { verifyIdToken: async () => ({ uid, email, email_verified: true }) },
    getConfig: async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL] } }),
    log: { warn() {}, error() {} },
    ...(newId ? { newId } : {}),
  };
}

test('speakerPhotoUpload requires a token', async () => {
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    { method: 'POST', headers: {}, body: { speakerId: 'rae', contentType: 'image/png', data: PNG } },
    res,
  );
  assert.equal(res.statusCode, 401);
});

test('speakerPhotoUpload writes to a FRESH versioned path, not the fixed live path (issue #22 review P1-2)', async () => {
  const bucket = fakeBucket();
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), bucket, { newId: () => ASSET_ID }))(
    post({ speakerId: 'rae', contentType: 'image/png', filename: 'me.png', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.path, `speaker-photos/rae/${ASSET_ID}/me.png`);
  assert.equal(bucket.objects.has(`speaker-photos/rae/${ASSET_ID}/me.png`), true);
});

test('speakerPhotoUpload: two uploads for the same speaker land at two different paths', async () => {
  const bucket = fakeBucket();
  const first = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), bucket))(
    post({ speakerId: 'rae', contentType: 'image/png', data: PNG }),
    first,
  );
  const second = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), bucket))(
    post({ speakerId: 'rae', contentType: 'image/png', data: PNG }),
    second,
  );
  assert.notEqual(first.body.path, second.body.path);
  // Neither upload overwrote or removed the other — both objects exist,
  // which is exactly what protects the currently-live object from an
  // abandoned or still-under-review edit.
  assert.equal(bucket.objects.has(first.body.path), true);
  assert.equal(bucket.objects.has(second.body.path), true);
});

test('speakerPhotoUpload refuses a caller who does not own the speaker record', async () => {
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), fakeBucket(), { uid: 'someone-else' }))(
    post({ speakerId: 'rae', contentType: 'image/png', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 403);
});

test('speakerPhotoUpload 404s for an unknown speaker', async () => {
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(makeFakeDb({}), fakeBucket()))(
    post({ speakerId: 'ghost', contentType: 'image/png', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('speakerPhotoUpload lets an admin upload on a speaker’s behalf even without ownership', async () => {
  const bucket = fakeBucket();
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(
    speakerAuthDeps(speakerWorld(), bucket, { uid: 'admin-1', email: ADMIN_EMAIL }),
  )(post({ speakerId: 'rae', contentType: 'image/png', data: PNG }), res);
  assert.equal(res.statusCode, 200);
});

test('speakerPhotoUpload rejects a disallowed content type (no SVG here)', async () => {
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    post({ speakerId: 'rae', contentType: 'image/svg+xml', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /contentType/);
});

test('speakerPhotoUpload rejects a payload at or over the 2 MiB cap', async () => {
  const oversize = 'A'.repeat(Math.ceil(SPEAKER_PHOTO_MAX_BYTES / 3) * 4);
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    post({ speakerId: 'rae', contentType: 'image/png', data: oversize }),
    res,
  );
  assert.equal(res.statusCode, 400);
});

test('speakerPhotoUpload requires a speakerId', async () => {
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    post({ contentType: 'image/png', data: PNG }),
    res,
  );
  assert.equal(res.statusCode, 400);
});

test('speakerPhotoUpload is POST-only', async () => {
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    { method: 'GET' },
    res,
  );
  assert.equal(res.statusCode, 405);
});

// ------------------------------------------------------------ speakerPhotoDelete

test('speakerPhotoDelete requires a token', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    { method: 'POST', headers: {}, body: { speakerId: 'rae', path: 'speaker-photos/rae/x/photo.png' } },
    res,
  );
  assert.equal(res.statusCode, 401);
});

test('speakerPhotoDelete lets the owning speaker delete an object under their own prefix', async () => {
  const bucket = fakeBucket();
  await bucket.file('speaker-photos/rae/old/photo.png').save(Buffer.from('x'), {});
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), bucket))(
    post({ speakerId: 'rae', path: 'speaker-photos/rae/old/photo.png' }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { path: 'speaker-photos/rae/old/photo.png', deleted: true });
  assert.equal(bucket.objects.has('speaker-photos/rae/old/photo.png'), false);
});

test('speakerPhotoDelete rejects a path outside the caller\'s own speaker prefix', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    post({ speakerId: 'rae', path: 'speaker-photos/someone-else/photo.png' }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^path: must be under speaker-photos\/rae\//);
});

test('speakerPhotoDelete rejects a path traversal attempt', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    post({ speakerId: 'rae', path: 'speaker-photos/rae/../../cms-images/hero.png' }),
    res,
  );
  assert.equal(res.statusCode, 400);
});

test('speakerPhotoDelete refuses a caller who does not own the speaker record', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), fakeBucket(), { uid: 'someone-else' }))(
    post({ speakerId: 'rae', path: 'speaker-photos/rae/old/photo.png' }),
    res,
  );
  assert.equal(res.statusCode, 403);
});

test('speakerPhotoDelete lets an admin delete on a speaker\'s behalf', async () => {
  const bucket = fakeBucket();
  await bucket.file('speaker-photos/rae/old/photo.png').save(Buffer.from('x'), {});
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(
    speakerAuthDeps(speakerWorld(), bucket, { uid: 'admin-1', email: ADMIN_EMAIL }),
  )(post({ speakerId: 'rae', path: 'speaker-photos/rae/old/photo.png' }), res);
  assert.equal(res.statusCode, 200);
});

test('speakerPhotoDelete succeeds (ignoreNotFound) for an object already gone', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    post({ speakerId: 'rae', path: 'speaker-photos/rae/gone/photo.png' }),
    res,
  );
  assert.equal(res.statusCode, 200);
});

test('speakerPhotoDelete 404s for an unknown speaker', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(makeFakeDb({}), fakeBucket()))(
    post({ speakerId: 'ghost', path: 'speaker-photos/ghost/x/photo.png' }),
    res,
  );
  assert.equal(res.statusCode, 404);
});

test('speakerPhotoDelete is POST-only', async () => {
  const res = fakeRes();
  await createSpeakerPhotoDeleteHandler(speakerAuthDeps(speakerWorld(), fakeBucket()))(
    { method: 'GET' },
    res,
  );
  assert.equal(res.statusCode, 405);
});

// ------------------------------------------------------- the two tiers (#186)

const STAFF_EMAIL = 'staff@example.org';
const tieredBootstrap = async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL], staffEmails: [STAFF_EMAIL] } });

test('mediaUpload admits a staff admin — the media library is staff work', async () => {
  const db = makeFakeDb({});
  const res = fakeRes();
  await createMediaUploadHandler(
    deps(db, fakeBucket(), {
      auth: { verifyIdToken: async () => ({ uid: 'staff-1', email: STAFF_EMAIL, email_verified: true }) },
      getConfig: tieredBootstrap,
    }),
  )(post({ folder: 'cms-images', contentType: 'image/png', data: PNG }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('media_assets', ASSET_ID).uploadedBy, STAFF_EMAIL);
});

test('speakerPhotoUpload treats a staff admin as an admin: no ownership check', async () => {
  const bucket = fakeBucket();
  const res = fakeRes();
  await createSpeakerPhotoUploadHandler({
    ...speakerAuthDeps(speakerWorld(), bucket, { uid: 'staff-1', email: STAFF_EMAIL }),
    getConfig: tieredBootstrap,
  })(post({ speakerId: 'rae', contentType: 'image/png', data: PNG }), res);
  assert.equal(res.statusCode, 200);
});

// ------------------------------------------------ branding is the operator's (#186 review)

const STAFF_AUTH = { verifyIdToken: async () => ({ uid: 'staff-1', email: STAFF_EMAIL, email_verified: true }) };
const staffDeps = (db, bucket, extra = {}) => deps(db, bucket, { auth: STAFF_AUTH, getConfig: tieredBootstrap, ...extra });
const operatorDeps = (db, bucket, extra = {}) => deps(db, bucket, { getConfig: tieredBootstrap, ...extra });
const BRANDING_ID = 'brand-asset-1';
const brandingRow = (extra = {}) => ({
  path: `branding/${BRANDING_ID}/logo.png`, folder: 'branding', contentType: 'image/png', size: 5,
  uploadedBy: ADMIN_EMAIL, createdAt: new Date(NOW), ...extra,
});

test('mediaUpload into branding is refused for staff and allowed for an operator', async () => {
  const refused = fakeRes();
  const db = makeFakeDb({});
  await createMediaUploadHandler(staffDeps(db, fakeBucket()))(
    post({ folder: 'branding', contentType: 'image/png', data: PNG }), refused,
  );
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.error.message, 'branding: operator access required');
  assert.deepEqual(db.ids('media_assets'), []);

  const allowed = fakeRes();
  await createMediaUploadHandler(operatorDeps(db, fakeBucket()))(
    post({ folder: 'branding', contentType: 'image/png', data: PNG }), allowed,
  );
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.asset.folder, 'branding');
});

test('mediaUpload into cms-images stays staff work', async () => {
  const res = fakeRes();
  await createMediaUploadHandler(staffDeps(makeFakeDb({}), fakeBucket()))(
    post({ folder: 'cms-images', contentType: 'image/png', data: PNG }), res,
  );
  assert.equal(res.statusCode, 200);
});

test('mediaDelete of a branding-folder asset is refused for staff, force or not, and allowed for an operator', async () => {
  for (const force of [false, true]) {
    const db = makeFakeDb({ [`media_assets/${BRANDING_ID}`]: brandingRow() });
    const res = fakeRes();
    await createMediaDeleteHandler(staffDeps(db, fakeBucket()))(post({ assetId: BRANDING_ID, force }), res);
    assert.equal(res.statusCode, 403, `force=${force}`);
    assert.equal(res.body.error.message, 'branding: operator access required');
    assert.deepEqual(db.ids('media_assets'), [BRANDING_ID]);
  }
  const db = makeFakeDb({ [`media_assets/${BRANDING_ID}`]: brandingRow() });
  const bucket = fakeBucket();
  await bucket.file(`branding/${BRANDING_ID}/logo.png`).save(Buffer.from('x'), {});
  const res = fakeRes();
  await createMediaDeleteHandler(operatorDeps(db, bucket))(post({ assetId: BRANDING_ID }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.ids('media_assets'), []);
});

test('mediaDelete reads branding off the path when the row has no folder field', async () => {
  const { folder, ...rowWithoutFolder } = brandingRow();
  const db = makeFakeDb({ [`media_assets/${BRANDING_ID}`]: rowWithoutFolder });
  const res = fakeRes();
  await createMediaDeleteHandler(staffDeps(db, fakeBucket()))(post({ assetId: BRANDING_ID, force: true }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(typeof folder, 'string');
});

test('mediaDelete of an asset a theme slot references is refused for staff even with force, and allowed for an operator', async () => {
  const path = `cms-images/${ASSET_ID}/hero.png`;
  const seed = () => seededLibrary({ 'config/theme': { logos: { primary: path } } });
  const refused = fakeRes();
  const db = seed();
  await createMediaDeleteHandler(staffDeps(db, fakeBucket()))(post({ assetId: ASSET_ID, force: true }), refused);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.error.message, 'branding: operator access required');
  assert.deepEqual(db.ids('media_assets'), [ASSET_ID]);

  const allowed = fakeRes();
  const db2 = seed();
  await createMediaDeleteHandler(operatorDeps(db2, fakeBucket()))(post({ assetId: ASSET_ID, force: true }), allowed);
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body.usage, [{ docPath: 'config/theme', field: 'logos.primary' }]);
});

test('mediaDelete of an unreferenced cms-images asset stays staff work', async () => {
  const db = seededLibrary();
  const res = fakeRes();
  await createMediaDeleteHandler(staffDeps(db, fakeBucket()))(post({ assetId: ASSET_ID }), res);
  assert.equal(res.statusCode, 200);
});

test('isBrandingAsset and referencedByTheme read the row and the scan the way the handlers do', () => {
  assert.equal(isBrandingAsset({ folder: 'branding', path: 'x' }), true);
  assert.equal(isBrandingAsset({ path: 'branding/a/b.png' }), true);
  assert.equal(isBrandingAsset({ folder: 'cms-images', path: 'cms-images/a/b.png' }), false);
  assert.equal(isBrandingAsset(undefined), false);
  assert.equal(referencedByTheme([{ docPath: 'config/theme', field: 'logos.mark' }]), true);
  assert.equal(referencedByTheme([{ docPath: 'cmsPages/home', field: 'sections.0.image' }]), false);
  assert.equal(referencedByTheme([]), false);
});
