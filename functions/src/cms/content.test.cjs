'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCmsCreateContentHandler,
  createCmsUpdateContentHandler,
  createCmsDeleteContentHandler,
  createGetSiteContentHandler,
  DELETE_FIELD_SENTINEL,
  internals,
} = require('./content.cjs');
const { makeFakeDb: makeBareFakeDb } = require('./firestoreFake.cjs');
const { publishDocs } = require('./store.cjs');

// requireAdmin reads config/bootstrap LIVE from the db it is handed (issue
// #186 review: it fails closed on an absent document), so every fake this
// file builds carries the document the file's getConfig describes.
const BOOTSTRAP_DOC = { adminEmails: ['admin@example.org'], staffEmails: ['staff@example.org'] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });

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

test('cmsUpdateContent drops a field explicitly marked with DELETE_FIELD_SENTINEL', async () => {
  // A cmsContent block switching type (apps/web/src/admin) needs to clear
  // the OLD type's now-irrelevant fields, which the merge-onto-the-prior-
  // draft semantics above would otherwise strand on the doc forever.
  const db = makeFakeDb({
    'cmsContent_drafts/faq__q1': {
      question: 'keep', answer: 'stale-answer', section: 'faq', field: 'q1',
      visible: true, status: 'clean', basedOnRevision: 2,
    },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({
      body: {
        section: 'faq',
        field: 'q1',
        fields: { blockType: 'text', value: 'now text', answer: DELETE_FIELD_SENTINEL },
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const draft = db.read('cmsContent_drafts', 'faq__q1');
  assert.equal(draft.value, 'now text');
  assert.equal(draft.question, 'keep'); // unspecified fields still survive
  assert.equal('answer' in draft, false); // explicitly cleared, not merely nulled
});

test('cmsCreateContent also honors DELETE_FIELD_SENTINEL (defensive; no base to strand)', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({
      body: {
        section: 'hero',
        field: 'title',
        fields: { value: 'Welcome', extra: DELETE_FIELD_SENTINEL },
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.value, 'Welcome');
  assert.equal('extra' in draft, false);
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

test('cmsDeleteContent refuses to orphan a session’s children, naming them', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { title: 'Workshop', dayId: 'day-2', visible: true, revision: 1 },
    'cmsSchedule/session-clinic': { title: 'Clinic', dayId: 'day-2', parentId: 'session-parent', visible: true, revision: 1 },
    // An unpublished child is a child too.
    'cmsSchedule_drafts/session-lab': { title: 'Lab', dayId: 'day-2', parentId: 'session-parent', status: 'dirty' },
  });
  const res = fakeRes();
  await createCmsDeleteContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-parent' } }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error.message, /Cannot delete session "session-parent": 2 sessions still run inside it/);
  assert.match(res.body.error.message, /session-clinic/);
  assert.match(res.body.error.message, /session-lab/);
  assert.match(res.body.error.message, /Move those sessions to another parent or delete them first\./);
  // Nothing was deleted, and no materials cascade ran on a refused delete.
  assert.notEqual(db.read('cmsSchedule', 'session-parent'), undefined);
  assert.notEqual(db.read('cmsSchedule', 'session-clinic'), undefined);
  assert.equal(db.ids('admin_logs').length, 0);
});

test('cmsDeleteContent deletes a session once its children are gone', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { title: 'Workshop', dayId: 'day-2', visible: true, revision: 1 },
    'cmsSchedule_drafts/session-parent': { title: 'Workshop', status: 'clean', basedOnRevision: 1 },
    // A child of a DIFFERENT session must not hold this one hostage.
    'cmsSchedule/session-clinic': { title: 'Clinic', dayId: 'day-2', parentId: 'session-other', visible: true, revision: 1 },
  });
  const res = fakeRes();
  await createCmsDeleteContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-parent' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.deleted, ['cmsSchedule/session-parent', 'cmsSchedule_drafts/session-parent']);
  assert.equal(db.read('cmsSchedule', 'session-parent'), undefined);
  assert.equal(db.read('cmsSchedule_drafts', 'session-parent'), undefined);
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

// --- speakerIds referential integrity (spec §4.3 seam #1) -------------------

const SPEAKERS = {
  'speakers/s1': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', status: 'approved' },
  'speakers/s2': { firstName: 'Sam', lastName: 'Example', slug: 'sam-example', status: 'draft' },
};

test('creating a session with a dangling speakerId is REJECTED, naming the id', async () => {
  const db = makeFakeDb({ ...SPEAKERS });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { title: 'Panel', speakerIds: ['s1', 'ghost'] } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'speakerIds: no speaker exists with id "ghost"');
  // Rejected, not silently dropped: nothing was written at all.
  assert.equal(db.read('cmsSchedule_drafts', 'sess-1'), undefined);
});

test('creating a session whose speakerIds all resolve is accepted verbatim', async () => {
  const db = makeFakeDb({ ...SPEAKERS });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { title: 'Panel', speakerIds: ['s1', 's2'] } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-1').speakerIds, ['s1', 's2']);
});

test('a speaker in any pipeline status satisfies the reference — existence is the test', async () => {
  // The seam asks "does speakers/{id} exist", not "is it published": an
  // unapproved speaker is a legitimate session assignment, and it is the
  // projection that decides what the public sees.
  const db = makeFakeDb({ ...SPEAKERS });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-2', fields: { speakerIds: ['s2'] } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
});

test('updating a session validates the MERGED speakerIds, not just the payload', async () => {
  const db = makeFakeDb({
    ...SPEAKERS,
    'cmsSchedule_drafts/sess-1': { title: 'Panel', speakerIds: ['ghost'], status: 'dirty' },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { title: 'Renamed' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /no speaker exists with id "ghost"/);
  assert.equal(db.read('cmsSchedule_drafts', 'sess-1').title, 'Panel', 'nothing was written');
});

test('an update that FIXES the dangling reference is accepted', async () => {
  const db = makeFakeDb({
    ...SPEAKERS,
    'cmsSchedule_drafts/sess-1': { title: 'Panel', speakerIds: ['ghost'], status: 'dirty' },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { speakerIds: ['s1'] } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-1').speakerIds, ['s1']);
});

test('a malformed speakerIds value is rejected before any speaker read', async () => {
  const db = makeFakeDb({ ...SPEAKERS });
  for (const speakerIds of ['s1', [42], ['s1', 's1']]) {
    const res = fakeRes();
    await createCmsCreateContentHandler(deps(db))(
      req({ body: { collection: 'cmsSchedule', docId: 'sess-x', fields: { speakerIds } } }),
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /^speakerIds: /);
  }
});

test('a concurrent deleteSpeaker aborts the save instead of leaving a dangling id', async () => {
  // The seam is only real if the reference read and the draft write are the
  // SAME transaction. As a pre-check it was advisory: deleteSpeaker queries
  // the sessions and drafts that exist at its moment, so a draft written a
  // heartbeat later still named the deleted speaker — with no reconciler
  // left in the system to notice.
  const db = makeFakeDb({ ...SPEAKERS });
  // The speaker vanishes between the transaction body and its commit.
  db.beforeCommit = () => {
    db.collection('speakers').doc('s1').delete();
  };

  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { speakerIds: ['s1'] } } }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /no speaker exists with id "s1"/);
  assert.equal(db.read('cmsSchedule_drafts', 'sess-1'), undefined, 'no dangling draft was written');
});

test('the same interleaving on an update leaves the stored draft untouched', async () => {
  const db = makeFakeDb({
    ...SPEAKERS,
    'cmsSchedule_drafts/sess-1': { title: 'Panel', speakerIds: [], status: 'dirty' },
  });
  db.beforeCommit = () => {
    db.collection('speakers').doc('s2').delete();
  };

  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { speakerIds: ['s2'] } } }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-1').speakerIds, []);
});

test('a save that races nothing still commits on the retry path', async () => {
  // The conflict machinery must not turn an unrelated concurrent write
  // into a failed save: the body re-runs and succeeds.
  const db = makeFakeDb({ ...SPEAKERS });
  db.beforeCommit = () => {
    db.collection('speakers').doc('s1').set({ ...SPEAKERS['speakers/s1'], bio: 'edited' });
  };

  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { speakerIds: ['s1'] } } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-1').speakerIds, ['s1']);
});

test('speakerIds is stored as an array even when the payload sends null', async () => {
  // `null` validates as "no references" — it must not be PERSISTED as
  // null, or the stored shape stops being string[] and every reader has to
  // defend against it.
  const db = makeFakeDb({ ...SPEAKERS });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { title: 'Panel', speakerIds: null } } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-1').speakerIds, []);
});

test('an update that clears speakerIds with null stores an empty array', async () => {
  const db = makeFakeDb({
    ...SPEAKERS,
    'cmsSchedule_drafts/sess-1': { title: 'Panel', speakerIds: ['s1'], status: 'dirty' },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'sess-1', fields: { speakerIds: null } } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-1').speakerIds, []);
});

test('collections without speaker references are untouched by the seam', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  // cmsContent has no speakers; a stray speakerIds field is ordinary content.
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'blurb', fields: { speakerIds: ['ghost'] } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
});

// --- the stat contract (design brief §2.1.1) --------------------------------

const FULL_STAT = Object.freeze({
  blockType: 'stat',
  value: '420',
  label: 'attendees expected',
  takeaway: 'Registration is close to filling the hall',
  description: 'Confirmed registrations across all three days.',
  source: 'Registration list, read 1 September 2026.',
  alt: 'Confirmed registrations stand at 420 of 450 seats.',
});

test('a stat block with evidence but no figure is rejected, naming the figure and its caption', async () => {
  // The registry has always marked value and label required; the write
  // contract now enforces them, so "all the evidence, no number" — a
  // caption with a hole where the figure goes — cannot be written.
  const db = makeFakeDb();
  const { value, label, ...evidenceOnly } = FULL_STAT;
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: evidenceOnly } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  for (const part of ['value:', 'label:']) {
    assert.ok(res.body.error.message.includes(part), `names ${part}`);
  }
  assert.equal(db.read('cmsContent_drafts', 'stats__attendees'), undefined);
});

test('creating a stat block without its four parts is rejected, naming each one', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: { blockType: 'stat', value: '420', label: 'attendees' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  for (const part of ['takeaway:', 'description:', 'source:', 'alt:']) {
    assert.ok(res.body.error.message.includes(part), `names ${part}`);
  }
  // Nothing was written: the refusal aborts the transaction.
  assert.equal(db.read('cmsContent_drafts', 'stats__attendees'), undefined);
});

test('a stat block carrying all four parts is written', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: { ...FULL_STAT } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('cmsContent_drafts', 'stats__attendees').takeaway, FULL_STAT.takeaway);
});

test('a blank part is as missing as an absent one', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: { ...FULL_STAT, source: '   ' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^source: /);
});

test('a legacy stat block keeps publishing and rendering; only WRITING it that way stops', async () => {
  // The stored shape is untouched — nothing sweeps the corpus, and the
  // live doc a reader sees is exactly what it was.
  const db = makeFakeDb({
    'cmsContent/stats__attendees': {
      blockType: 'stat', value: '420', label: 'Attendees expected', visible: true, revision: 2,
    },
  });
  const res = fakeRes();
  await createGetSiteContentHandler({ db })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.content[0].value, '420');

  // An edit of that legacy block has to bring it up to contract.
  const update = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: { value: '450' } } }),
    update,
  );
  assert.equal(update.statusCode, 400);
  assert.match(update.body.error.message, /takeaway: /);
  assert.equal(db.read('cmsContent', 'stats__attendees').value, '420');
});

test('the contract is checked on the MERGED result, not just the payload', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/stats__attendees': { ...FULL_STAT, section: 'stats', field: 'attendees' },
  });
  const res = fakeRes();
  // The payload names only the figure; the stored draft supplies the parts.
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: { value: '450' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('cmsContent_drafts', 'stats__attendees').value, '450');

  // And clearing a part is a rejection, not a silent drop.
  const cleared = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'stats', field: 'attendees', fields: { alt: DELETE_FIELD_SENTINEL } } }),
    cleared,
  );
  assert.equal(cleared.statusCode, 400);
  assert.match(cleared.body.error.message, /^alt: /);
});

test('the contract binds stat blocks only, and cmsContent only', async () => {
  const db = makeFakeDb();
  const text = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'title', fields: { blockType: 'text', value: 'Welcome' } } }),
    text,
  );
  assert.equal(text.statusCode, 200);

  // A session is not a block: `stat` means nothing in cmsSchedule.
  const session = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-1', fields: { blockType: 'stat', title: 'Welcome' } } }),
    session,
  );
  assert.equal(session.statusCode, 200);
});

// --- the session structure seam (design brief §4.6) -------------------------

test('a session save validates its track letter, naming the field', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-1', fields: { dayId: 'day-1', track: 'Line A' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^track: /);
  assert.equal(db.read('cmsSchedule_drafts', 'session-1'), undefined);
});

test('a session save rejects a parent that does not exist, naming the id', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-1', fields: { dayId: 'day-1', parentId: 'session-ghost' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /no session exists with id "session-ghost"/);
});

test('a session save rejects a track the event does not define, naming the ones it does', async () => {
  const db = makeFakeDb({
    'config/event': { tracks: [{ letter: 'A', name: 'Practice' }] },
  });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-1', fields: { dayId: 'day-1', track: 'B' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^track: "B" is not one of this event's tracks \(A\)/);
  assert.equal(db.read('cmsSchedule_drafts', 'session-1'), undefined);
});

test('a session save accepts a track and a parent on the same day', async () => {
  const db = makeFakeDb({
    'config/event': { tracks: [{ letter: 'A', name: 'Practice' }, { letter: 'B', name: 'Sustainability' }] },
    'cmsSchedule/session-parent': { dayId: 'day-2', title: 'Workshop', track: 'B' },
  });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({
      body: {
        collection: 'cmsSchedule',
        docId: 'session-child',
        fields: { dayId: 'day-2', title: 'Clinic', track: 'B', parentId: 'session-parent' },
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const draft = db.read('cmsSchedule_drafts', 'session-child');
  assert.equal(draft.track, 'B');
  assert.equal(draft.parentId, 'session-parent');
});

test('a session save rejects a child on a different line from its parent', async () => {
  const db = makeFakeDb({
    'config/event': { tracks: [{ letter: 'A', name: 'Practice' }, { letter: 'B', name: 'Sustainability' }] },
    'cmsSchedule/session-parent': { dayId: 'day-2', title: 'Workshop', track: 'B' },
  });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({
      body: {
        collection: 'cmsSchedule',
        docId: 'session-child',
        fields: { dayId: 'day-2', title: 'Clinic', track: 'A', parentId: 'session-parent' },
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^track: "A" is not the track of its parent "session-parent"/);
  assert.equal(db.read('cmsSchedule_drafts', 'session-child'), undefined);
});

test('a child with no track of its own is written as it was sent — it inherits', async () => {
  const db = makeFakeDb({
    'config/event': { tracks: [{ letter: 'B', name: 'Sustainability' }] },
    'cmsSchedule/session-parent': { dayId: 'day-2', title: 'Workshop', track: 'B' },
  });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({
      body: {
        collection: 'cmsSchedule',
        docId: 'session-child',
        fields: { dayId: 'day-2', title: 'Clinic', parentId: 'session-parent' },
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  // Absence stays absence: nothing writes the parent's letter onto the child.
  assert.equal('track' in db.read('cmsSchedule_drafts', 'session-child'), false);
});

test('an update is judged on the MERGED session, not the payload alone', async () => {
  // The stored draft already names the parent; this edit only moves the day.
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2' },
    'cmsSchedule_drafts/session-child': { dayId: 'day-2', parentId: 'session-parent' },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-child', fields: { dayId: 'day-3' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /a child session\s+runs on its parent's day|child session/);
  assert.equal(db.read('cmsSchedule_drafts', 'session-child').dayId, 'day-2');
});

test('moving a parent session strands nothing: the edit is rejected, naming the children', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2', title: 'Workshop', visible: true, revision: 1 },
    'cmsSchedule/session-clinic': { dayId: 'day-2', title: 'Clinic', parentId: 'session-parent', visible: true, revision: 1 },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-parent', fields: { dayId: 'day-3' } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /carries 1 child session \(session-clinic\)/);
  assert.equal(db.read('cmsSchedule_drafts', 'session-parent'), undefined);
});

test('a parent may still be edited in every way that does not strand a child', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2', title: 'Workshop', visible: true, revision: 1 },
    'cmsSchedule/session-clinic': { dayId: 'day-2', title: 'Clinic', parentId: 'session-parent', visible: true, revision: 1 },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'session-parent', fields: { title: 'Workshop, renamed' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('cmsSchedule_drafts', 'session-parent').title, 'Workshop, renamed');
});

test('the session seam leaves every other collection alone', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  // `track` and `parentId` are ordinary content anywhere but a session.
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'blurb', fields: { blockType: 'text', value: 'x', track: 'Line A', parentId: 'nope' } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
});

// ------------------------------------------------------- the two tiers (#186)

test('mutation handlers admit a staff admin — content is staff work', async () => {
  const STAFF = { uid: 'staff-1', email: 'staff@example.org', email_verified: true };
  const staffDeps = (db) => deps(db, {
    auth: { async verifyIdToken(t) { if (t === 'staff-token') return STAFF; throw new Error('bad'); } },
    getConfig: async () => ({ bootstrap: { adminEmails: ['admin@example.org'], staffEmails: ['staff@example.org'] } }),
  });
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(staffDeps(db))(
    req({ token: 'staff-token', body: { collection: 'cmsContent', section: 'hero', field: 'title', fields: { value: 'Set by staff' } } }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.read('cmsContent_drafts', 'hero__title').updatedBy, 'staff@example.org');
});

// --- the seed flag (ADR 0001 §5.4; adversarial review 2026-09-24) -----------

test('an admin edit clears the seed flag, and the publish carries the cleared flag live', async () => {
  // The merge base is the stored document, flag included; an edit that kept
  // the flag left every edited block reading as the seed's, so init
  // overwrote it and the home page replaced the operator's When fact.
  const db = makeFakeDb({
    'cmsContent/info__when': {
      section: 'info', field: 'when', blockType: 'fact', label: 'When', value: 'October 14–16, 2026',
      visible: true, order: 0, seeded: true, seededAt: '1970-01-01T00:00:00.000Z',
      revision: 1, publishedBy: 'init-event-script',
    },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'info', field: 'when', fields: { value: 'October 13–16, 2026' } } }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const draft = db.read('cmsContent_drafts', 'info__when');
  assert.equal(draft.value, 'October 13–16, 2026');
  assert.equal('seeded' in draft, false, 'the edit clears the flag');
  assert.equal('seededAt' in draft, false, 'and the seed stamp with it');
  assert.equal(draft.label, 'When', 'the other fields still merge');

  await publishDocs({ db, collection: 'cmsContent', docIds: ['info__when'], actor: ADMIN, now });
  const live = db.read('cmsContent', 'info__when');
  assert.equal('seeded' in live, false, 'the publish carries the cleared flag');
  assert.equal(live.publishedBy, ADMIN.uid);
});

test('an admin create never seeds, whatever the payload claims', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'note', fields: { blockType: 'text', value: 'x', seeded: true, seededAt: 'T' } } }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const draft = db.read('cmsContent_drafts', 'hero__note');
  assert.equal('seeded' in draft, false);
  assert.equal('seededAt' in draft, false);
});

test('getSiteContent states seeded only for a block the seed published, and never the publisher', async () => {
  // A deployment from before the edit cleared the flag holds edited blocks
  // that still carry it; the public read judges by who published.
  const db = makeFakeDb({
    'cmsContent/hero__title': {
      section: 'hero', field: 'title', blockType: 'text', value: '[Replace] Event name headline.',
      visible: true, order: 0, seeded: true, revision: 1, publishedBy: 'init-event-script',
    },
    'cmsContent/hero__subtitle': {
      section: 'hero', field: 'subtitle', blockType: 'text', value: 'Our real subtitle',
      visible: true, order: 1, seeded: true, revision: 2, publishedBy: ADMIN.uid,
    },
  });
  const res = fakeRes();
  await createGetSiteContentHandler({ db, log: { error() {} } })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  const byId = Object.fromEntries(res.body.content.map((doc) => [doc.id, doc]));
  assert.equal(byId.hero__title.seeded, true);
  assert.equal('seeded' in byId.hero__subtitle, false, 'an operator’s publish wins over the stale flag');
  for (const doc of res.body.content) assert.equal('publishedBy' in doc, false);
});

// --- organization fields at the seam (issue #192) ---------------------------

const ORG = Object.freeze({
  name: 'Example Fund',
  tier: 'presenting',
  order: 0,
  logoPath: 'cms-images/example-fund.webp',
  url: 'https://example.org/',
  description: 'Funds the travel grants.',
});

function createOrganization(db, docId, fields, extra = {}) {
  const res = fakeRes();
  return createCmsCreateContentHandler(deps(db, extra))(
    req({ ...extra.request, body: { collection: 'cmsOrganizations', docId, fields, visible: true } }),
    res,
  ).then(() => res);
}

function updateOrganization(db, docId, fields) {
  const res = fakeRes();
  return createCmsUpdateContentHandler(deps(db))(
    req({ body: { collection: 'cmsOrganizations', docId, fields } }),
    res,
  ).then(() => res);
}

test('an organization whose name is not text is refused at save, naming the field, and nothing is written', async () => {
  const db = makeFakeDb();
  const res = await createOrganization(db, 'example-fund', { ...ORG, name: 42 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'name: must be text');
  assert.equal(db.read('cmsOrganizations_drafts', 'example-fund'), undefined);
  assert.equal(db.ids('admin_logs').length, 0, 'a refused save writes no admin log row');
});

test('an organization update is judged on the merged record', async () => {
  const db = makeFakeDb({ 'cmsOrganizations_drafts/example-fund': { ...ORG, status: 'dirty' } });
  let res = await updateOrganization(db, 'example-fund', { tier: { level: 1 } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'tier: must be text');

  // A stored value the request did not send still decides the verdict.
  const broken = makeFakeDb({ 'cmsOrganizations_drafts/example-fund': { ...ORG, name: { x: 1 }, status: 'dirty' } });
  res = await updateOrganization(broken, 'example-fund', { description: 'New words.' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'name: must be text');
  assert.equal(broken.read('cmsOrganizations_drafts', 'example-fund').description, ORG.description);
});

test('an organization order sent as a string, or a website that is not http(s), is refused', async () => {
  const db = makeFakeDb();
  let res = await createOrganization(db, 'example-fund', { ...ORG, order: '3' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'order: must be a number');

  res = await createOrganization(db, 'example-fund', { ...ORG, url: 'javascript:alert(1)' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'url: must start with http:// or https://');

  res = await createOrganization(db, 'example-fund', { ...ORG, name: 7, order: 'first' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'name: must be text; order: must be a number');
  assert.equal(db.read('cmsOrganizations_drafts', 'example-fund'), undefined);
});

test('a valid organization is stored trimmed, with its website in canonical form', async () => {
  const db = makeFakeDb();
  const res = await createOrganization(db, 'example-fund', {
    ...ORG,
    name: '  Example Fund ',
    tier: ' presenting ',
    url: ' HTTPS://Example.ORG ',
    description: '',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const draft = db.read('cmsOrganizations_drafts', 'example-fund');
  assert.equal(draft.name, 'Example Fund');
  assert.equal(draft.tier, 'presenting');
  assert.equal(draft.url, 'https://example.org/');
  assert.equal(draft.description, null);
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.visible, true);
  assert.equal(db.ids('admin_logs').length, 1);
});

test('an editor save over a record whose profile fields a script stored badly is accepted', async () => {
  const db = makeFakeDb({
    'cmsOrganizations/example-fund': { ...ORG, bio: {}, supportDescription: 3, visible: true, revision: 1 },
  });
  const res = await updateOrganization(db, 'example-fund', { name: 'Example Fund Two' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const draft = db.read('cmsOrganizations_drafts', 'example-fund');
  assert.equal(draft.name, 'Example Fund Two');
  assert.deepEqual(draft.bio, {}, 'the stored value is kept, not rewritten');
  // Sending the malformed field is what gets it judged.
  const again = await updateOrganization(db, 'example-fund', { bio: {} });
  assert.equal(again.statusCode, 400);
  assert.equal(again.body.error.message, 'bio: must be text');
});

test('a staff admin creates an organization', async () => {
  const STAFF = { uid: 'staff-1', email: 'staff@example.org', email_verified: true };
  const db = makeFakeDb();
  const res = await createOrganization(db, 'example-fund', { ...ORG }, {
    auth: { async verifyIdToken(t) { if (t === 'staff-token') return STAFF; throw new Error('bad'); } },
    request: { token: 'staff-token' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.read('cmsOrganizations_drafts', 'example-fund').updatedBy, 'staff@example.org');
});

test('the organization seam leaves content blocks and sessions alone', async () => {
  const db = makeFakeDb();
  const res = fakeRes();
  // A cmsContent block may carry a `name` of any shape; the seam is not its rule.
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { section: 'hero', field: 'blurb', fields: { blockType: 'text', value: 'x', name: 42, order: '1' } } }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(
    internals.checkOrganizationFields({ collection: 'cmsSchedule', fields: { name: 42 }, sent: {} }),
    { ok: true, fields: { name: 42 } },
  );
});

// --- the page address is the document key (issue #193) ----------------------

test('an organization address that is not slug-shaped is refused at save, for organizations only', async () => {
  const db = makeFakeDb();
  let res = await createOrganization(db, 'Bad Slug', { ...ORG });
  assert.equal(res.statusCode, 400);
  assert.equal(
    res.body.error.message,
    'slug: use lowercase letters, digits, and single hyphens, up to 80 characters',
  );
  res = await createOrganization(db, 'a'.repeat(81), { ...ORG });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^slug: /);
  assert.deepEqual(db.ids('cmsOrganizations_drafts'), []);
  assert.equal(db.ids('admin_logs').length, 0);

  // Other collections keep their own id rules.
  res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 'Bad Slug', fields: {} } }),
    res,
  );
  assert.notEqual(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(db.read('cmsSchedule_drafts', 'Bad Slug') !== undefined, true);
});

test('a second organization claiming a published address is refused at save, naming the slug', async () => {
  const db = makeFakeDb({
    'cmsOrganizations/example-fund': { ...ORG, visible: true, revision: 1 },
  });
  const res = await createOrganization(db, 'example-fund', { ...ORG, name: 'Another Fund' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.message, 'slug: another organization already uses "example-fund"');
  assert.equal(db.read('cmsOrganizations_drafts', 'example-fund'), undefined);
  assert.equal(db.read('cmsOrganizations', 'example-fund').name, ORG.name);
});

test('a second organization claiming an address held only by a draft is refused, and the first draft is unchanged', async () => {
  const db = makeFakeDb();
  const first = await createOrganization(db, 'example-fund', { ...ORG });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const before = db.read('cmsOrganizations_drafts', 'example-fund');

  const second = await createOrganization(db, 'example-fund', { ...ORG, name: 'Another Fund', tier: 'partner' });
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.error.message, 'slug: another organization already uses "example-fund"');
  assert.deepEqual(db.read('cmsOrganizations_drafts', 'example-fund'), before);
  assert.equal(db.ids('admin_logs').length, 1, 'only the first create is logged');
});

test('an organization stored under an id that is not a slug stays editable', async () => {
  const db = makeFakeDb({ 'cmsOrganizations/Legacy_Org': { ...ORG, visible: true, revision: 1 } });
  const res = await updateOrganization(db, 'Legacy_Org', { description: 'Edited.' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.read('cmsOrganizations_drafts', 'Legacy_Org').description, 'Edited.');
});

test('every other collection keeps its own already-exists words', async () => {
  const db = makeFakeDb({ 'cmsSchedule/s1': { title: 'x', revision: 1 } });
  const res = fakeRes();
  await createCmsCreateContentHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docId: 's1', fields: {} } }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.message, 'That document already exists; use cmsUpdateContent.');
});

// --- review round (c2, finding 1) ---------------------------------------------

test('a sponsor package limit sent as the deletion sentinel leaves the stored draft without one', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/sponsor_packages__supporting': {
      section: 'sponsor_packages', field: 'supporting', blockType: 'sponsor_package',
      name: 'Supporting', limit: 3, benefits: '<p>Materials.</p>', status: 'dirty',
    },
  });
  const res = fakeRes();
  await createCmsUpdateContentHandler(deps(db))(
    req({ body: { section: 'sponsor_packages', field: 'supporting', fields: { name: 'Supporting', limit: DELETE_FIELD_SENTINEL } } }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const draft = db.read('cmsContent_drafts', 'sponsor_packages__supporting');
  assert.equal('limit' in draft, false);
  assert.equal(draft.benefits, '<p>Materials.</p>');
});
