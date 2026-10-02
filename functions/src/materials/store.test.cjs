'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Storage } = require('@google-cloud/storage');

const {
  addSessionMaterialLink,
  uploadSessionMaterial,
  uploadSessionMaterialBytes,
  uploadSessionMaterialRequest,
  updateSessionMaterial,
  deleteSessionMaterial,
  deleteMaterialsForSession,
  internals: {
    SessionNotFoundError,
    MaterialNotFoundError,
    NotAuthorizedError,
    InvalidUrlError,
    InvalidStoragePathError,
    InvalidMaterialUploadError,
    MaterialFileNotFoundError,
    MaterialFileTooLargeError,
    MaterialFileSizeUnavailableError,
    MaterialCapExceededError,
    MAX_MATERIALS_PER_SESSION,
    decodeMaterialUpload,
    sendStoreError,
  },
} = require('./store.cjs');
const { MAX_MATERIAL_FILE_BYTES } = require('./policy.cjs');

/** Minimal in-memory Firestore fake, same shape as bookmarks.test.cjs's. */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, v]));
  let counter = 0;
  function docRef(col, id) {
    const key = `${col}/${id}`;
    return {
      id,
      _key: key,
      async get() {
        const data = docs.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data) {
        docs.set(key, data);
      },
      async update(patch) {
        docs.set(key, { ...docs.get(key), ...patch });
      },
      async delete() {
        docs.delete(key);
      },
    };
  }
  return {
    docs,
    collection(name) {
      return {
        doc: (id) => docRef(name, id ?? `auto-${++counter}`),
        where(field, _op, value) {
          return {
            async get() {
              const rows = [...docs.entries()]
                .filter(([k]) => k.startsWith(`${name}/`))
                .filter(([, v]) => v?.[field] === value)
                .map(([k, v]) => ({ id: k.split('/')[1], ref: docRef(name, k.split('/')[1]), data: () => v }));
              return { empty: rows.length === 0, docs: rows };
            },
          };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        delete(ref) {
          ops.push(() => docs.delete(ref._key));
        },
        async commit() {
          for (const op of ops) op();
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          docs.set(ref._key, data);
        },
        update(ref, patch) {
          docs.set(ref._key, { ...docs.get(ref._key), ...patch });
        },
        delete(ref) {
          docs.delete(ref._key);
        },
      };
      return fn(tx);
    },
  };
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const now = () => NOW;

function seedSession(id, overrides = {}) {
  return { [`cmsSchedule/${id}`]: { title: 'Fixture session', speakerIds: [], ...overrides } };
}

const ADMIN = { uid: 'admin-1', isAdmin: true, speakerId: null };
const speaker = (speakerId, uid = 'speaker-uid') => ({ uid, isAdmin: false, speakerId });

function fakeBucket({ exists = true, size = MAX_MATERIAL_FILE_BYTES } = {}) {
  const state = { fileCalls: 0, existsCalls: 0, metadataCalls: 0 };
  return {
    state,
    file() {
      state.fileCalls += 1;
      return {
        async exists() {
          state.existsCalls += 1;
          return [exists];
        },
        async getMetadata() {
          state.metadataCalls += 1;
          return [{ size }];
        },
      };
    },
  };
}

function fakeWritableBucket() {
  const state = {
    paths: [],
    savedBytes: null,
    saveOptions: null,
    deletedPaths: [],
    deleteOptions: [],
  };
  return {
    state,
    file(path) {
      state.paths.push(path);
      return {
        async save(bytes, options) {
          state.savedBytes = bytes;
          state.saveOptions = options;
        },
        async exists() {
          return [state.savedBytes != null && !state.deletedPaths.includes(path)];
        },
        async getMetadata() {
          return [{
            size: state.savedBytes?.length,
            generation: '1',
            metadata: state.saveOptions?.metadata?.metadata,
          }];
        },
        async delete(options) {
          state.deletedPaths.push(path);
          state.deleteOptions.push(options);
        },
      };
    },
  };
}

function fakeRejectedSaveBucket({ error, createsObject, existingObject = null }) {
  const state = {
    object: existingObject,
    deletedPaths: [],
    deleteOptions: [],
    metadataCalls: 0,
  };
  return {
    state,
    file(path) {
      return {
        async save(bytes, options) {
          if (createsObject) {
            state.object = {
              bytes,
              generation: '7',
              metadata: options.metadata?.metadata,
            };
          }
          throw error;
        },
        async getMetadata() {
          state.metadataCalls += 1;
          if (!state.object) {
            const notFound = new Error('not found');
            notFound.code = 404;
            throw notFound;
          }
          return [{
            size: state.object.bytes.length,
            generation: state.object.generation,
            metadata: state.object.metadata,
          }];
        },
        async delete(options) {
          state.deletedPaths.push(path);
          state.deleteOptions.push(options);
          state.object = null;
        },
      };
    },
  };
}

function fakeErrorRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

// --------------------------------------------------------- addSessionMaterialLink

test('addSessionMaterialLink: admin can add a link and materialCount increments in the same write', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id, material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/deck',
    label: 'Slide deck',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'Slide deck');
  assert.equal(material.reviewStatus, 'pending');
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 1);
  assert.equal(db.docs.get(`session_materials/${id}`).sessionId, 's1');
});

test('addSessionMaterialLink: a speaker of the session may add a link', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/deck',
    label: 'Deck',
    actor: speaker('spk-1'),
    now,
  });
  assert.equal(material.submittedBySpeakerId, 'spk-1');
});

test('addSessionMaterialLink: a speaker NOT on the session is rejected', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  await assert.rejects(
    addSessionMaterialLink({
      db,
      sessionId: 's1',
      url: 'https://example.org/deck',
      label: 'Deck',
      actor: speaker('spk-2'),
      now,
    }),
    NotAuthorizedError,
  );
});

test('addSessionMaterialLink: an unknown session rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    addSessionMaterialLink({ db, sessionId: 'missing', url: 'https://x.org', label: '', actor: ADMIN, now }),
    SessionNotFoundError,
  );
});

test('addSessionMaterialLink: materialCount increments across multiple materials on the same session', async () => {
  const db = fakeDb(seedSession('s1'));
  await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://a.org', label: 'A', actor: ADMIN, now });
  await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://b.org', label: 'B', actor: ADMIN, now });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 2);
});

// ------------------------------------------------- the four named §4.4 scrub tests

test('pinning: a URL-shaped label renders "External link"', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/embargoed-actual-url',
    label: 'https://example.org/embargoed-actual-url',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'External link');
});

test('pinning: an empty label renders "External link"', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/embargoed',
    label: '   ',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'External link');
});

test('pinning: a real label is preserved', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/embargoed',
    label: 'Opening keynote slides',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'Opening keynote slides');
});

// ------------------------------------------------------------ uploadSessionMaterial

test('uploadSessionMaterial: file materials are never scrubbed even when URL-shaped', async () => {
  const db = fakeDb(seedSession('s1'));
  const bucket = fakeBucket();
  const { material } = await uploadSessionMaterial({
    db,
    bucket,
    sessionId: 's1',
    storagePath: 'session-materials/s1/slides.pdf',
    filename: 'slides.pdf',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'slides.pdf');
  assert.equal(material.type, 'file');
  assert.equal(Object.hasOwn(material, 'managedStorageObject'), false);
});

test('uploadSessionMaterial: refuses a path outside the material session before any write', async () => {
  for (const storagePath of [
    'branding/logo.png',
    'session-materials/s2/slides.pdf',
    'session-materials/s1',
    'session-materials/s1/',
  ]) {
    const db = fakeDb(seedSession('s1'));
    const bucket = fakeBucket();
    await assert.rejects(
      uploadSessionMaterial({ db, bucket, sessionId: 's1', storagePath, filename: 'slides.pdf', actor: ADMIN, now }),
      (err) => err instanceof InvalidStoragePathError && err.message.startsWith('storagePath:'),
      storagePath,
    );
    assert.equal(db.docs.get('cmsSchedule/s1').materialCount, undefined, storagePath);
    assert.equal([...db.docs.keys()].some((key) => key.startsWith('session_materials/')), false, storagePath);
    assert.equal(bucket.state.fileCalls, 0, storagePath);
  }
});

test('uploadSessionMaterial: accepts the exact file-size cap from Storage', async () => {
  const db = fakeDb(seedSession('s1'));
  const bucket = fakeBucket({ size: String(MAX_MATERIAL_FILE_BYTES) });
  const { material } = await uploadSessionMaterial({
    db,
    bucket,
    sessionId: 's1',
    storagePath: 'session-materials/s1/slides.pdf',
    filename: 'slides.pdf',
    actor: ADMIN,
    now,
  });
  assert.equal(material.storagePath, 'session-materials/s1/slides.pdf');
  assert.deepEqual(bucket.state, { fileCalls: 1, existsCalls: 1, metadataCalls: 1 });
});

test('uploadSessionMaterial: refuses a file one byte over the cap with both sizes and no write', async () => {
  const db = fakeDb(seedSession('s1'));
  const size = MAX_MATERIAL_FILE_BYTES + 1;
  const bucket = fakeBucket({ size: String(size) });
  const error = await uploadSessionMaterial({
      db,
      bucket,
      sessionId: 's1',
      storagePath: 'session-materials/s1/slides.pdf',
      filename: 'slides.pdf',
      actor: ADMIN,
      now,
    }).catch((err) => err);
  assert.ok(error instanceof MaterialFileTooLargeError);
  assert.match(error.message, new RegExp(`${size}.*${MAX_MATERIAL_FILE_BYTES}`));
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, undefined);
  assert.equal([...db.docs.keys()].some((key) => key.startsWith('session_materials/')), false);

  const res = fakeErrorRes();
  sendStoreError(res, error, { error() {} });
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error.code, 'too-large');
  assert.match(res.body.error.message, new RegExp(`^storagePath:.*${size}.*${MAX_MATERIAL_FILE_BYTES}`));
});

test('uploadSessionMaterial: refuses a missing file or an unreadable size without a write', async () => {
  for (const [bucket, ErrorType] of [
    [fakeBucket({ exists: false }), MaterialFileNotFoundError],
    [fakeBucket({ size: 'unknown' }), MaterialFileSizeUnavailableError],
  ]) {
    const db = fakeDb(seedSession('s1'));
    await assert.rejects(
      uploadSessionMaterial({
        db,
        bucket,
        sessionId: 's1',
        storagePath: 'session-materials/s1/slides.pdf',
        filename: 'slides.pdf',
        actor: ADMIN,
        now,
      }),
      ErrorType,
    );
    assert.equal(db.docs.get('cmsSchedule/s1').materialCount, undefined);
    assert.equal([...db.docs.keys()].some((key) => key.startsWith('session_materials/')), false);
  }
});

test('uploadSessionMaterial: checks session authorization before reading Storage', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const bucket = fakeBucket();
  await assert.rejects(
    uploadSessionMaterial({
      db,
      bucket,
      sessionId: 's1',
      storagePath: 'session-materials/s1/slides.pdf',
      filename: 'slides.pdf',
      actor: speaker('spk-2'),
      now,
    }),
    NotAuthorizedError,
  );
  assert.equal(bucket.state.fileCalls, 0);
});

test('uploadSessionMaterial: validates registered filenames but keeps the missing-name fallback', async () => {
  for (const filename of [`${'a'.repeat(241)}.pdf`, 'slides\u0000.pdf']) {
    const db = fakeDb(seedSession('s1'));
    const bucket = fakeBucket();
    await assert.rejects(
      uploadSessionMaterial({
        db,
        bucket,
        sessionId: 's1',
        storagePath: 'session-materials/s1/slides.pdf',
        filename,
        actor: ADMIN,
        now,
      }),
      InvalidMaterialUploadError,
    );
    assert.equal(bucket.state.fileCalls, 0);
    assert.equal([...db.docs.keys()].some((key) => key.startsWith('session_materials/')), false);
  }

  const db = fakeDb(seedSession('s1'));
  const { material } = await uploadSessionMaterial({
    db,
    bucket: fakeBucket(),
    sessionId: 's1',
    storagePath: 'session-materials/s1/slides.pdf',
    filename: '   ',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'Untitled file');
});

// ------------------------------------------------------- browser byte uploads

test('uploadSessionMaterialBytes: own-session bytes use a fresh server path and register pending', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const bucket = fakeWritableBucket();
  const { id, material } = await uploadSessionMaterialBytes({
    db,
    bucket,
    sessionId: 's1',
    data: Buffer.from('synthetic slides').toString('base64'),
    contentType: 'application/pdf',
    filename: 'slides.pdf',
    actor: speaker('spk-1'),
    now,
  });

  assert.match(material.storagePath, /^session-materials\/s1\/auto-\d+$/);
  assert.equal(material.type, 'file');
  assert.equal(material.reviewStatus, 'pending');
  assert.equal(material.submittedBySpeakerId, 'spk-1');
  assert.equal(material.managedStorageObject, true);
  assert.equal(bucket.state.savedBytes.toString(), 'synthetic slides');
  const uploadAttempt = bucket.state.saveOptions.metadata.metadata.eventrunnerUploadAttempt;
  assert.deepEqual(bucket.state.saveOptions, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0, no-store',
      metadata: {
        uploadedBy: 'speaker-uid',
        eventrunnerUploadAttempt: uploadAttempt,
      },
    },
  });
  assert.match(uploadAttempt, /^[\da-f-]{36}$/u);
  assert.notEqual(uploadAttempt, material.storagePath.split('/').at(-1));
  assert.equal(db.docs.get(`session_materials/${id}`).storagePath, material.storagePath);
  assert.equal(db.docs.get(`session_materials/${id}`).managedStorageObject, true);
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 1);
});

test('uploadSessionMaterialBytes: a foreign speaker is refused before bytes are decoded or Storage is read', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const bucket = fakeWritableBucket();
  await assert.rejects(
    uploadSessionMaterialBytes({
      db,
      bucket,
      sessionId: 's1',
      data: 'not base64',
      contentType: 'application/pdf',
      filename: 'slides.pdf',
      actor: speaker('spk-2'),
      now,
    }),
    NotAuthorizedError,
  );
  assert.deepEqual(bucket.state.paths, []);
});

test('uploadSessionMaterialBytes: a transaction-time authorization loss removes only the new object', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const runTransaction = db.runTransaction;
  db.runTransaction = (fn) => {
    db.docs.set('cmsSchedule/s1', { title: 'Fixture session', speakerIds: ['spk-2'] });
    return runTransaction(fn);
  };
  const bucket = fakeWritableBucket();
  await assert.rejects(
    uploadSessionMaterialBytes({
      db,
      bucket,
      sessionId: 's1',
      data: Buffer.from('synthetic slides').toString('base64'),
      contentType: 'application/pdf',
      filename: 'slides.pdf',
      actor: speaker('spk-1'),
      now,
    }),
    NotAuthorizedError,
  );
  assert.equal(bucket.state.deletedPaths.length, 1);
  assert.match(bucket.state.deletedPaths[0], /^session-materials\/s1\/auto-\d+$/);
  assert.equal([...db.docs.keys()].some((key) => key.startsWith('session_materials/')), false);
});

test('uploadSessionMaterialBytes: an ambiguous save failure removes only this attempt\'s object', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const saveError = new Error('Storage lost the response after writing');
  const bucket = fakeRejectedSaveBucket({ error: saveError, createsObject: true });

  const error = await uploadSessionMaterialBytes({
    db,
    bucket,
    sessionId: 's1',
    data: Buffer.from('synthetic slides').toString('base64'),
    contentType: 'application/pdf',
    filename: 'slides.pdf',
    actor: speaker('spk-1'),
    now,
    log: { error() {} },
  }).catch((caught) => caught);

  assert.equal(error, saveError);
  assert.equal(bucket.state.object, null);
  assert.equal(bucket.state.deletedPaths.length, 1);
  assert.match(bucket.state.deletedPaths[0], /^session-materials\/s1\/auto-\d+$/);
  assert.deepEqual(bucket.state.deleteOptions, [{
    ignoreNotFound: true,
    ifGenerationMatch: '7',
  }]);
});

test('uploadSessionMaterialBytes: the installed SDK sends the cleanup generation precondition', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const saveError = new Error('Storage lost the response after writing');
  const file = new Storage({ projectId: 'demo-eventrunner' })
    .bucket('eventrunner-fixture')
    .file('session-materials/s1/sdk-fixture');
  let savedMetadata;
  file.save = async (_bytes, options) => {
    savedMetadata = options.metadata.metadata;
    throw saveError;
  };
  file.getMetadata = async () => [{
    size: 1,
    generation: '11',
    metadata: savedMetadata,
  }];

  const serviceObjectPrototype = Object.getPrototypeOf(Object.getPrototypeOf(file));
  const originalRequest = serviceObjectPrototype.request;
  let deleteRequest;
  serviceObjectPrototype.request = function request(options, callback) {
    deleteRequest = options;
    callback(null, {}, {});
  };
  try {
    const error = await uploadSessionMaterialBytes({
      db,
      bucket: { file() { return file; } },
      sessionId: 's1',
      data: Buffer.from('x').toString('base64'),
      contentType: 'application/pdf',
      filename: 'slides.pdf',
      actor: speaker('spk-1'),
      now,
      log: { error() {} },
    }).catch((caught) => caught);
    assert.equal(error, saveError);
  } finally {
    serviceObjectPrototype.request = originalRequest;
  }

  assert.equal(deleteRequest.method, 'DELETE');
  assert.equal(deleteRequest.qs.ifGenerationMatch, '11');
  assert.equal(Object.hasOwn(deleteRequest.qs, 'preconditionOpts'), false);
});

test('uploadSessionMaterialBytes: a create precondition failure never deletes the existing object', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const saveError = new Error('At least one of the preconditions failed');
  saveError.code = 412;
  const existingObject = {
    bytes: Buffer.from('existing bytes'),
    generation: '3',
    metadata: { eventrunnerUploadAttempt: 'another-attempt' },
  };
  const bucket = fakeRejectedSaveBucket({
    error: saveError,
    createsObject: false,
    existingObject,
  });

  const error = await uploadSessionMaterialBytes({
    db,
    bucket,
    sessionId: 's1',
    data: Buffer.from('synthetic slides').toString('base64'),
    contentType: 'application/pdf',
    filename: 'slides.pdf',
    actor: speaker('spk-1'),
    now,
    log: { error() {} },
  }).catch((caught) => caught);

  assert.equal(error, saveError);
  assert.equal(bucket.state.object, existingObject);
  assert.equal(bucket.state.metadataCalls, 0);
  assert.deepEqual(bucket.state.deletedPaths, []);
});

test('uploadSessionMaterialRequest: rejects mixed byte and storage-path variants without touching Storage', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const bucket = fakeWritableBucket();
  await assert.rejects(
    uploadSessionMaterialRequest({
      db,
      bucket,
      body: {
        sessionId: 's1',
        storagePath: '',
        data: Buffer.from('synthetic slides').toString('base64'),
        filename: 'slides.pdf',
      },
      actor: speaker('spk-1'),
      now,
    }),
    /Send data or storagePath, not both/,
  );
  assert.deepEqual(bucket.state.paths, []);
});

test('decodeMaterialUpload: accepts the exact decoded cap and rejects one byte more', () => {
  const exact = Buffer.alloc(MAX_MATERIAL_FILE_BYTES).toString('base64');
  assert.equal(decodeMaterialUpload(exact).length, MAX_MATERIAL_FILE_BYTES);
  const tooLarge = Buffer.alloc(MAX_MATERIAL_FILE_BYTES + 1).toString('base64');
  assert.throws(() => decodeMaterialUpload(tooLarge), MaterialFileTooLargeError);
});

test('uploadSessionMaterialBytes: rejects invalid filenames and media types before writing', async () => {
  const bodies = [
    { filename: 'slides\n.pdf', contentType: 'application/pdf' },
    { filename: 'a'.repeat(241), contentType: 'application/pdf' },
    { filename: 'slides.pdf', contentType: 'not a media type' },
  ];
  for (const body of bodies) {
    const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
    const bucket = fakeWritableBucket();
    await assert.rejects(
      uploadSessionMaterialBytes({
        db,
        bucket,
        sessionId: 's1',
        data: Buffer.from('synthetic slides').toString('base64'),
        ...body,
        actor: speaker('spk-1'),
        now,
      }),
      /must be/,
    );
    assert.deepEqual(bucket.state.paths, []);
  }
});

// ------------------------------------------------------------ updateSessionMaterial

test('updateSessionMaterial: admin can update filename with re-scrub applied', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  const { material } = await updateSessionMaterial({
    db,
    materialId: id,
    patch: { filename: 'https://leaked.example.org' },
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'External link');
});

test('updateSessionMaterial: the submitting speaker may edit their own pending material', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  const { material } = await updateSessionMaterial({
    db, materialId: id, patch: { filename: 'Updated deck' }, actor: speaker('spk-1'), now,
  });
  assert.equal(material.filename, 'Updated deck');
});

test('updateSessionMaterial: invalid file renames leave the stored row unchanged', async () => {
  for (const filename of ['   ', 'a'.repeat(241), 'slides\u0000.pdf']) {
    const db = fakeDb({
      'session_materials/file-1': {
        sessionId: 's1',
        type: 'file',
        filename: 'slides.pdf',
        storagePath: 'session-materials/s1/file-1',
        reviewStatus: 'pending',
        submittedBySpeakerId: 'spk-1',
      },
    });
    const before = structuredClone(db.docs.get('session_materials/file-1'));

    await assert.rejects(
      updateSessionMaterial({
        db,
        materialId: 'file-1',
        patch: { filename },
        actor: speaker('spk-1'),
        now,
      }),
      InvalidMaterialUploadError,
    );
    assert.deepEqual(db.docs.get('session_materials/file-1'), before);
  }
});

test('updateSessionMaterial: a speaker may not edit a material once it is no longer pending', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  db.docs.set(`session_materials/${id}`, { ...db.docs.get(`session_materials/${id}`), reviewStatus: 'approved' });
  await assert.rejects(
    updateSessionMaterial({ db, materialId: id, patch: { filename: 'Sneaky' }, actor: speaker('spk-1'), now }),
    NotAuthorizedError,
  );
});

test('updateSessionMaterial: a different speaker cannot edit someone else\'s material', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1', 'spk-2'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  await assert.rejects(
    updateSessionMaterial({ db, materialId: id, patch: { filename: 'Hijack' }, actor: speaker('spk-2'), now }),
    NotAuthorizedError,
  );
});

test('updateSessionMaterial: an unknown material rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    updateSessionMaterial({ db, materialId: 'nope', patch: {}, actor: ADMIN, now }),
    MaterialNotFoundError,
  );
});

// ------------------------------------------------------------ deleteSessionMaterial

test('deleteSessionMaterial: admin delete decrements materialCount in the same transaction', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 1);
  await deleteSessionMaterial({ db, materialId: id, actor: ADMIN });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 0);
  assert.equal(db.docs.has(`session_materials/${id}`), false);
});

test('deleteSessionMaterial: materialCount never goes negative', async () => {
  const db = fakeDb(seedSession('s1', { materialCount: 0 }));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  db.docs.set('cmsSchedule/s1', { ...db.docs.get('cmsSchedule/s1'), materialCount: 0 });
  await deleteSessionMaterial({ db, materialId: id, actor: ADMIN });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 0);
});

test('deleteSessionMaterial: the submitting speaker may withdraw their own material at any review status', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  db.docs.set(`session_materials/${id}`, { ...db.docs.get(`session_materials/${id}`), reviewStatus: 'approved' });
  await deleteSessionMaterial({ db, materialId: id, actor: speaker('spk-1') });
  assert.equal(db.docs.has(`session_materials/${id}`), false);
});

test('deleteSessionMaterial: a non-owning speaker cannot delete', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1', 'spk-2'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  await assert.rejects(
    deleteSessionMaterial({ db, materialId: id, actor: speaker('spk-2') }),
    NotAuthorizedError,
  );
});

test('deleteSessionMaterial: an unknown material rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    deleteSessionMaterial({ db, materialId: 'nope', actor: ADMIN }),
    MaterialNotFoundError,
  );
});

// --------------------------------------------------- unsafe URL rejection (P1)

for (const unsafe of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not-a-url', '']) {
  test(`addSessionMaterialLink: rejects an unsafe/invalid url (${JSON.stringify(unsafe)})`, async () => {
    const db = fakeDb(seedSession('s1'));
    await assert.rejects(
      addSessionMaterialLink({ db, sessionId: 's1', url: unsafe, label: 'Deck', actor: ADMIN, now }),
      InvalidUrlError,
    );
    // Nothing was written and materialCount was never touched.
    assert.equal(db.docs.get('cmsSchedule/s1').materialCount, undefined);
  });
}

test('addSessionMaterialLink: an http/https url is accepted', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'http://example.org/deck', label: 'Deck', actor: ADMIN, now,
  });
  assert.equal(material.url, 'http://example.org/deck');
});

test('updateSessionMaterial: rejects an unsafe url patch, leaving the stored url untouched', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  await assert.rejects(
    updateSessionMaterial({ db, materialId: id, patch: { url: 'javascript:alert(1)' }, actor: ADMIN, now }),
    InvalidUrlError,
  );
  assert.equal(db.docs.get(`session_materials/${id}`).url, 'https://x.org');
});

// ------------------------------------------------------- per-session cap (P2)

test(`addSessionMaterialLink: rejects the ${MAX_MATERIALS_PER_SESSION + 1}th material for a session`, async () => {
  const db = fakeDb(seedSession('s1', { materialCount: MAX_MATERIALS_PER_SESSION }));
  await assert.rejects(
    addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'One too many', actor: ADMIN, now }),
    MaterialCapExceededError,
  );
});

test('addSessionMaterialLink: the exact cap boundary is still accepted', async () => {
  const db = fakeDb(seedSession('s1', { materialCount: MAX_MATERIALS_PER_SESSION - 1 }));
  const { material } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Last one', actor: ADMIN, now,
  });
  assert.equal(material.filename, 'Last one');
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, MAX_MATERIALS_PER_SESSION);
});

test('uploadSessionMaterial: the cap applies to file materials too', async () => {
  const db = fakeDb(seedSession('s1', { materialCount: MAX_MATERIALS_PER_SESSION }));
  const bucket = fakeBucket();
  await assert.rejects(
    uploadSessionMaterial({
      db, bucket, sessionId: 's1', storagePath: 'session-materials/s1/x.pdf', filename: 'x.pdf', actor: ADMIN, now,
    }),
    MaterialCapExceededError,
  );
  assert.equal(bucket.state.fileCalls, 0);
});

// ------------------------------------------------- deleteMaterialsForSession (cascade)

test('deleteMaterialsForSession: removes every material AND its public projection for the session', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id: id1 } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://a.org', label: 'A', actor: ADMIN, now });
  const { id: id2 } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://b.org', label: 'B', actor: ADMIN, now });
  db.docs.set(`session_materials_public/${id1}`, { sessionId: 's1', type: 'link', filename: 'A', reviewStatus: 'approved' });
  db.docs.set(`session_materials_public/${id2}`, { sessionId: 's1', type: 'link', filename: 'B', reviewStatus: 'approved' });

  const result = await deleteMaterialsForSession({ db, sessionId: 's1' });

  assert.equal(result.deleted, 2);
  assert.equal(db.docs.has(`session_materials/${id1}`), false);
  assert.equal(db.docs.has(`session_materials/${id2}`), false);
  assert.equal(db.docs.has(`session_materials_public/${id1}`), false);
  assert.equal(db.docs.has(`session_materials_public/${id2}`), false);
});

test('deleteMaterialsForSession: never touches another session\'s materials', async () => {
  const db = fakeDb({ ...seedSession('s1'), ...seedSession('s2') });
  const { id: keep } = await addSessionMaterialLink({ db, sessionId: 's2', url: 'https://c.org', label: 'C', actor: ADMIN, now });
  await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://a.org', label: 'A', actor: ADMIN, now });

  await deleteMaterialsForSession({ db, sessionId: 's1' });

  assert.equal(db.docs.has(`session_materials/${keep}`), true);
});

test('deleteMaterialsForSession: a session with no materials is a no-op', async () => {
  const db = fakeDb();
  const result = await deleteMaterialsForSession({ db, sessionId: 'empty' });
  assert.equal(result.deleted, 0);
});
