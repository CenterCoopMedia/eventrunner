'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCmsCreateContentHandler,
  createCmsUpdateContentHandler,
  createCmsDeleteContentHandler,
  createGetSiteContentHandler,
  internals,
} = require('./content.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

const NOW = 1_750_000_000_000;
const now = () => NOW;
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
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

/** Response fake capturing status + JSON body. */
function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function deps(db, overrides = {}) {
  return { db, auth: fakeAuth(), getConfig, now, log: { warn() {}, error() {} }, ...overrides };
}

// --- admin gate + method ----------------------------------------------------

test('mutation handlers: no token → 401, non-admin → 403, non-POST → 405', async () => {
  const db = makeFakeDb();
  for (const create of [
    createCmsCreateContentHandler,
    createCmsUpdateContentHandler,
    createCmsDeleteContentHandler,
  ]) {
    const handler = create(deps(db));

    let res = fakeRes();
    await handler(req({ token: null }), res);
    assert.equal(res.statusCode, 401);

    res = fakeRes();
    await handler(req({ token: 'user-token' }), res);
    assert.equal(res.statusCode, 403);

    res = fakeRes();
    await handler(req({ method: 'GET' }), res);
    assert.equal(res.statusCode, 405);
  }
  // Nothing was written by any rejected call.
  assert.equal(db.writes.length, 0);
});

// --- resolveTarget / validateFields -----------------------------------------

test('resolveTarget keys cmsContent by section+field and rejects bad keys', () => {
  const ok = internals.resolveTarget({ collection: 'cmsContent', section: 'hero', field: 'title' });
  assert.deepEqual(ok, { ok: true, collection: 'cmsContent', docId: 'hero__title', extraFields: { section: 'hero', field: 'title' } });
  assert.equal(internals.resolveTarget({ section: 'hero' }).ok, false); // field missing, default collection
  assert.equal(internals.resolveTarget({ collection: 'cmsContent', section: 'he ro', field: 'x' }).ok, false);
  assert.equal(internals.resolveTarget({ collection: 'users', docId: 'x' }).ok, false);
  assert.equal(internals.resolveTarget({ collection: 'cmsSchedule' }).ok, false); // docId missing
  assert.equal(internals.resolveTarget({ collection: 'cmsSchedule', docId: 'a/b' }).ok, false);
  assert.equal(internals.resolveTarget({ collection: 'cmsSchedule', docId: 'sess-1' }).ok, true);
});

test('validateFields rejects non-objects and reserved keys', () => {
  assert.equal(internals.validateFields(undefined).ok, true);
  assert.equal(internals.validateFields({ value: 'x' }).ok, true);
  assert.equal(internals.validateFields('nope').ok, false);
  assert.equal(internals.validateFields([1]).ok, false);
  assert.equal(internals.validateFields({ revision: 3 }).ok, false);
  assert.equal(internals.validateFields({ publishedBy: 'x' }).ok, false);
});

// --- cmsCreateContent ---------------------------------------------------------

test('cmsCreateContent writes a dirty draft only — never the live collection', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'Welcome' }, visible: true } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { docPath: 'cmsContent_drafts/hero__title', docId: 'hero__title', status: 'dirty' });

  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.value, 'Welcome');
  assert.equal(draft.section, 'hero');
  assert.equal(draft.field, 'title');
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.basedOnRevision, null);
  assert.equal(db.read('cmsContent', 'hero__title'), undefined);
  assert.equal(db.writes.some((w) => w.path.startsWith('cmsContent/')), false);

  // Admin audit entry with the fixed shape.
  const logIds = db.ids('admin_logs');
  assert.equal(logIds.length, 1);
  const entry = db.read('admin_logs', logIds[0]);
  assert.deepEqual(entry, {
    action: 'cms-create-content',
    docPath: 'cmsContent_drafts/hero__title',
    uid: ADMIN.uid,
    email: ADMIN.email,
    at: new Date(NOW),
  });
});

test('cmsCreateContent → 409 when a draft or live doc already exists', async () => {
  const db = makeFakeDb({ 'cmsContent_drafts/hero__title': { value: 'x', status: 'dirty', visible: true } });
  let res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'y' } } }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'already-exists');

  const db2 = makeFakeDb({ 'cmsContent/hero__title': { value: 'live', visible: true, revision: 1 } });
  res = fakeRes();
  await createCmsCreateContentHandler(deps(db2))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'y' } } }),
    res,
  );
  assert.equal(res.statusCode, 409);
});

test('cmsCreateContent: two racing creates → one 200, one 409, first draft intact', async () => {
  // Both requests pass the pre-write existence check (the second one's
  // reads happen before the first one's write lands); only the create()
  // precondition in writeDraft separates them.
  const db = makeFakeDb();
  const realCollection = db.collection.bind(db);
  let winnerLanded = false;
  db.collection = (name) => {
    const col = realCollection(name);
    if (name !== 'cmsContent_drafts' && name !== 'cmsContent') return col;
    return {
      ...col,
      doc: (id) => {
        const ref = col.doc(id);
        return {
          ...ref,
          get: async () => (winnerLanded
            ? { exists: false, data: () => undefined } // the loser's stale pre-check
            : ref.get()),
        };
      },
    };
  };
  const handler = createCmsCreateContentHandler(deps(db));
  const body = { section: 'hero', field: 'title', fields: { value: 'first' } };

  const res1 = fakeRes();
  await handler(req({ body }), res1);
  assert.equal(res1.statusCode, 200);

  winnerLanded = true; // second request read "no doc" before the first wrote
  const res2 = fakeRes();
  await handler(req({ body: { ...body, fields: { value: 'second' } } }), res2);
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.code, 'already-exists');
  assert.equal(db.read('cmsContent_drafts', 'hero__title').value, 'first');
});

test('cmsCreateContent → 400 on unknown collection, bad keys, reserved fields', async () => {
  const db = makeFakeDb();
  const handler = createCmsCreateContentHandler(deps(db));
  for (const body of [
    { collection: 'admin_logs', docId: 'x' },
    { collection: 'cmsContent', section: 'hero' },
    { collection: 'cmsContent', section: 'hero', field: 'bad key' },
    { collection: 'cmsContent', section: 'hero', field: 'title', fields: { status: 'clean' } },
    { collection: 'cmsSchedule', docIds: ['no-docId'] },
  ]) {
    const res = fakeRes();
    await handler(req({ body }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(db.writes.length, 0);
});

test('cmsCreateContent handles non-cmsContent collections by explicit docId', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsOrganizations', docId: 'org-1', fields: { name: 'Acme' }, visible: false } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const draft = db.read('cmsOrganizations_drafts', 'org-1');
  assert.equal(draft.name, 'Acme');
  assert.equal(draft.visible, false);
});

// --- cmsUpdateContent ---------------------------------------------------------

test('cmsUpdateContent merges fields onto the existing draft; live stays untouched', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': { value: 'live', section: 'hero', field: 'title', visible: true, revision: 2 },
    'cmsContent_drafts/hero__title': {
      value: 'draft', subtitle: 'keep-me', section: 'hero', field: 'title',
      visible: true, status: 'clean', basedOnRevision: 2,
    },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'edited' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.value, 'edited');
  assert.equal(draft.subtitle, 'keep-me'); // unspecified fields survive
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.basedOnRevision, 2);
  assert.equal(db.read('cmsContent', 'hero__title').value, 'live');
  assert.equal(db.writes.some((w) => w.path.startsWith('cmsContent/')), false);
});

test('cmsUpdateContent forks a draft from the live doc when only the live doc exists', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': { value: 'live', extra: 'field', section: 'hero', field: 'title', visible: true, revision: 6 },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'edited' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.value, 'edited');
  assert.equal(draft.extra, 'field');
  assert.equal(draft.basedOnRevision, 6);
  assert.equal(draft.status, 'dirty');
});

test('cmsUpdateContent → 404 when neither draft nor live doc exists', async () => {
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(makeFakeDb()))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'x' } } }),
    res,
  );
  assert.equal(res.statusCode, 404);
});

// --- cmsDeleteContent ---------------------------------------------------------

test('cmsDeleteContent removes live and draft in one batch and logs the action', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': { value: 'live', visible: true, revision: 1 },
    'cmsContent_drafts/hero__title': { value: 'draft', visible: true, status: 'clean', basedOnRevision: 1 },
  });
  const res = fakeRes();
  await createCmsDeleteContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, ['cmsContent/hero__title', 'cmsContent_drafts/hero__title']);
  assert.equal(db.read('cmsContent', 'hero__title'), undefined);
  assert.equal(db.read('cmsContent_drafts', 'hero__title'), undefined);
  assert.equal(db.commitCount, 1);
  assert.equal(db.ids('admin_logs').length, 1);
});

test('cmsDeleteContent on a cmsSchedule doc cascades: its materials and their public projections are deleted too (issue #23 follow-up)', async () => {
  const db = makeFakeDb({
    'cmsSchedule/s1': { title: 'Session', visible: true, revision: 1, materialCount: 2 },
    'cmsSchedule_drafts/s1': { title: 'Session', visible: true, status: 'clean', basedOnRevision: 1 },
    'session_materials/m1': { sessionId: 's1', type: 'link', url: 'https://a.org', filename: 'A', reviewStatus: 'approved' },
    'session_materials/m2': { sessionId: 's1', type: 'link', url: 'https://b.org', filename: 'B', reviewStatus: 'pending' },
    'session_materials_public/m1': { sessionId: 's1', type: 'link', filename: 'A', reviewStatus: 'approved' },
    // A different session's material must survive.
    'session_materials/other': { sessionId: 's2', type: 'link', url: 'https://c.org', filename: 'C', reviewStatus: 'approved' },
  });
  const res = fakeRes();
  await createCmsDeleteContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 's1' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('cmsSchedule', 's1'), undefined);
  assert.equal(db.read('session_materials', 'm1'), undefined);
  assert.equal(db.read('session_materials', 'm2'), undefined);
  assert.equal(db.read('session_materials_public', 'm1'), undefined);
  assert.notEqual(db.read('session_materials', 'other'), undefined);
});

test('cmsDeleteContent on a non-cmsSchedule collection never queries session_materials', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': { value: 'live', visible: true, revision: 1 },
    'cmsContent_drafts/hero__title': { value: 'draft', visible: true, status: 'clean', basedOnRevision: 1 },
  });
  const res = fakeRes();
  await createCmsDeleteContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  // No session_materials collection was ever created in the fake store —
  // asserting on the id list is a cheap proxy for "never touched".
  assert.deepEqual(db.ids('session_materials'), []);
});

// --- getSiteContent -----------------------------------------------------------

test('getSiteContent is public GET: returns visible published docs, no auth required', async () => {
  const db = makeFakeDb({
    'cmsContent/a': { value: 'shown', visible: true, revision: 1, publishedAt: new Date(1), publishedBy: 'admin@example.org' },
    'cmsContent/b': { value: 'hidden', visible: false, revision: 2, publishedAt: new Date(2), publishedBy: 'admin@example.org' },
    'cmsContent_drafts/c': { value: 'draft-only', visible: true, status: 'dirty' },
  });
  const res = fakeRes();
  await createGetSiteContentHandler({ db })({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.content.length, 1);
  const [doc] = res.body.content;
  assert.equal(doc.id, 'a');
  assert.equal(doc.value, 'shown');
  assert.equal(doc.revision, 1);
  // publishedBy (an admin address) is stripped from the public response.
  assert.equal('publishedBy' in doc, false);
});

test('getSiteContent → 405 on POST', async () => {
  const res = fakeRes();
  await createGetSiteContentHandler({ db: makeFakeDb() })({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('getSiteContent → 500 with a safe message when the read fails', async () => {
  const db = {
    collection() {
      return { where: () => ({ get: async () => { throw new Error('secret internal detail'); } }) };
    },
  };
  const res = fakeRes();
  await createGetSiteContentHandler({ db, log: { error() {} } })({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message.includes('secret'), false);
});

// --- audit is best-effort -----------------------------------------------------

test('a failed admin_logs write never fails the mutation', async () => {
  const db = makeFakeDb();
  const realCollection = db.collection.bind(db);
  db.collection = (name) => {
    if (name === 'admin_logs') {
      return { doc: () => ({ set: async () => { throw new Error('audit down'); } }) };
    }
    return realCollection(name);
  };
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title', fields: { value: 'v' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('cmsContent_drafts', 'hero__title').value, 'v');
});

test('resolveTarget routes cmsPages/cmsUpdates to their validated writers (never generic)', () => {
  // §5.2: page and update drafts must pass BLOCK_TYPES / shape validation,
  // which only cmsSavePage / cmsSaveUpdate run — the generic endpoints
  // would let an unvalidated draft reach publish verbatim.
  const pages = internals.resolveTarget({ collection: 'cmsPages', docId: 'home' });
  assert.equal(pages.ok, false);
  assert.match(pages.message, /cmsSavePage/);
  const updates = internals.resolveTarget({ collection: 'cmsUpdates', docId: 'u1' });
  assert.equal(updates.ok, false);
  assert.match(updates.message, /cmsSaveUpdate/);
  assert.deepEqual(internals.GENERIC_COLLECTIONS, ['cmsContent', 'cmsSchedule', 'cmsOrganizations', 'cmsTimeline']);
});
