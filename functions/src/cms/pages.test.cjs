'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePageDoc,
  createSavePageHandler,
  createDeletePageHandler,
} = require('./pages.cjs');

// ---------------------------------------------------------------- fixtures

function validPage(overrides = {}) {
  return {
    id: 'scholarships',
    label: 'Scholarships',
    path: '/scholarships',
    icon: null,
    order: 5,
    visible: true,
    systemPage: false,
    sections: [
      {
        id: 'intro',
        label: 'Introduction',
        description: null,
        allowedBlocks: ['text', 'richtext'],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [
          { field: 'intro_heading', blockType: 'text', description: 'Heading' },
        ],
      },
    ],
    ...overrides,
  };
}

/** In-memory Firestore fake: get/set/add on `collection/id` keys. */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const added = [];
  return {
    docs,
    added,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              const data = docs.get(key);
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
        async add(data) {
          added.push({ collection: name, data });
          return { id: `auto${added.length}` };
        },
      };
    },
  };
}

function fakeStore() {
  const writes = [];
  const deletes = [];
  const logs = [];
  return {
    writes,
    deletes,
    logs,
    async writeDraft(args) { writes.push(args); },
    async deleteBoth(args) { deletes.push(args); },
    async logAdminAction(args) { logs.push(args); },
  };
}

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

const ADMIN_TOKEN = 'admin-token';
const NON_ADMIN_TOKEN = 'user-token';

const fakeAuth = {
  async verifyIdToken(token) {
    if (token === ADMIN_TOKEN) {
      return { uid: 'admin1', email: 'Admin@example.org', email_verified: true };
    }
    if (token === NON_ADMIN_TOKEN) {
      return { uid: 'user1', email: 'user@example.org', email_verified: true };
    }
    throw new Error('bad token');
  },
};

const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.org'] } });

function adminReq(body) {
  return { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, body };
}

function deps(overrides = {}) {
  return {
    db: fakeDb(),
    auth: fakeAuth,
    getConfig,
    store: fakeStore(),
    now: () => 1700000000000,
    log: { warn() {}, error() {} },
    ...overrides,
  };
}

// ---------------------------------------------------------- validatePageDoc

test('validatePageDoc accepts a spec-shaped page', () => {
  assert.deepEqual(validatePageDoc(validPage()), { ok: true, errors: [] });
});

test('validatePageDoc rejects unknown block ids BY NAME in allowedBlocks', () => {
  const page = validPage();
  page.sections[0].allowedBlocks = ['text', 'carousel'];
  const { ok, errors } = validatePageDoc(page);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("unknown block type 'carousel'")), errors.join('; '));
  assert.ok(errors.some((e) => e.includes('sections[0].allowedBlocks[1]')));
});

test('validatePageDoc rejects unknown defaultBlocks[].blockType by name', () => {
  const page = validPage();
  page.sections[0].defaultBlocks[0].blockType = 'hero_banner';
  const { ok, errors } = validatePageDoc(page);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("unknown block type 'hero_banner'")));
});

test('validatePageDoc refuses prototype names as block types', () => {
  const page = validPage();
  page.sections[0].allowedBlocks = ['toString'];
  assert.equal(validatePageDoc(page).ok, false);
});

test('validatePageDoc rejects duplicate section ids, naming the id', () => {
  const page = validPage();
  page.sections.push({ ...page.sections[0] });
  const { ok, errors } = validatePageDoc(page);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("duplicate section id 'intro'")));
});

test('validatePageDoc requires path to start with a slash', () => {
  const { ok, errors } = validatePageDoc(validPage({ path: 'scholarships' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('path:')));
});

test('validatePageDoc names unknown top-level and section fields', () => {
  const page = validPage({ published: true });
  page.sections[0].extra = 1;
  const { errors } = validatePageDoc(page);
  assert.ok(errors.some((e) => e === 'published: unknown field'));
  assert.ok(errors.some((e) => e === 'sections[0].extra: unknown field'));
});

test('validatePageDoc collects every field error, naming each field', () => {
  const { ok, errors } = validatePageDoc({
    id: '', label: 3, path: '/x', icon: null, order: 'first',
    visible: 'yes', systemPage: false, sections: [],
  });
  assert.equal(ok, false);
  for (const field of ['id:', 'label:', 'order:', 'visible:']) {
    assert.ok(errors.some((e) => e.startsWith(field)), `missing ${field} error`);
  }
});

test('validatePageDoc rejects non-objects without throwing', () => {
  assert.equal(validatePageDoc(null).ok, false);
  assert.equal(validatePageDoc([]).ok, false);
  assert.equal(validatePageDoc('page').ok, false);
});

// ------------------------------------------------------------- cmsSavePage

test('cmsSavePage writes the DRAFT collection only, never live', async () => {
  const d = deps();
  const res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(d.store.writes.length, 1);
  const write = d.store.writes[0];
  assert.equal(write.collection, 'cmsPages');
  assert.equal(write.docId, 'scholarships');
  assert.equal(write.visible, true);
  assert.deepEqual(write.actor, { uid: 'admin1', email: 'admin@example.org' });
  assert.equal(write.fields.id, 'scholarships');
  // No publish-model bookkeeping smuggled in by the handler.
  assert.ok(!('revision' in write.fields));
  assert.ok(!('status' in write.fields));
  assert.equal(d.store.deletes.length, 0);
});

test('cmsSavePage rejects an invalid page with 400 naming the block', async () => {
  const d = deps();
  const res = fakeRes();
  const page = validPage();
  page.sections[0].allowedBlocks = ['nope'];
  await createSavePageHandler(d)(adminReq({ page }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.message.includes("unknown block type 'nope'"));
  assert.equal(d.store.writes.length, 0);
});

test('cmsSavePage requires a token (401) and admin membership (403)', async () => {
  const d = deps();
  let res = fakeRes();
  await createSavePageHandler(d)({ method: 'POST', headers: {}, body: { page: validPage() } }, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await createSavePageHandler(d)(
    { method: 'POST', headers: { authorization: `Bearer ${NON_ADMIN_TOKEN}` }, body: { page: validPage() } },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(d.store.writes.length, 0);
});

test('cmsSavePage rejects non-POST', async () => {
  const res = fakeRes();
  await createSavePageHandler(deps())({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('cmsSavePage refuses to flip systemPage true -> false (live doc)', async () => {
  const db = fakeDb({ 'cmsPages/home': { id: 'home', systemPage: true } });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(
    adminReq({ page: validPage({ id: 'home', path: '/home', systemPage: false }) }),
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.ok(res.body.error.message.includes('systemPage'));
  assert.equal(d.store.writes.length, 0);
});

test('cmsSavePage refuses the flip when only the DRAFT says systemPage', async () => {
  const db = fakeDb({ 'cmsPages_drafts/home': { id: 'home', systemPage: true } });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(
    adminReq({ page: validPage({ id: 'home', path: '/home', systemPage: false }) }),
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(d.store.writes.length, 0);
});

test('cmsSavePage still allows editing a system page that stays systemPage', async () => {
  const db = fakeDb({ 'cmsPages/home': { id: 'home', systemPage: true } });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(
    adminReq({ page: validPage({ id: 'home', path: '/home', systemPage: true }) }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(d.store.writes.length, 1);
});

test('cmsSavePage allows systemPage:false on brand-new and non-system pages', async () => {
  const db = fakeDb({ 'cmsPages/extra': { id: 'extra', systemPage: false } });
  const d = deps({ db });
  let res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage({ id: 'extra', path: '/extra' }) }), res);
  assert.equal(res.statusCode, 200);
  res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(d.store.writes.length, 2);
});

test('cmsSavePage records an admin_logs entry via the store', async () => {
  const d = deps();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), fakeRes());
  assert.equal(d.store.logs.length, 1);
  const entry = d.store.logs[0];
  assert.equal(entry.action, 'cmsSavePage');
  assert.equal(entry.docPath, 'cmsPages_drafts/scholarships');
  assert.deepEqual(entry.actor, { uid: 'admin1', email: 'admin@example.org' });
});

test('cmsSavePage succeeds even when the admin log throws', async () => {
  const store = fakeStore();
  store.logAdminAction = async () => { throw new Error('down'); };
  const res = fakeRes();
  await createSavePageHandler(deps({ store }))(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 200);
});

test('cmsSavePage maps a store failure to 500 without a stack leak', async () => {
  const store = { async writeDraft() { throw new Error('firestore exploded at /internal/path'); } };
  const res = fakeRes();
  await createSavePageHandler(deps({ store }))(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.error.message.includes('exploded'));
});

// ----------------------------------------------------------- cmsDeletePage

test('cmsDeletePage refuses to delete a systemPage (live doc)', async () => {
  const db = fakeDb({ 'cmsPages/home': { id: 'home', systemPage: true } });
  const d = deps({ db });
  const res = fakeRes();
  await createDeletePageHandler(d)(adminReq({ id: 'home' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(d.store.deletes.length, 0);
});

test('cmsDeletePage refuses when only the DRAFT is a systemPage', async () => {
  const db = fakeDb({ 'cmsPages_drafts/home': { id: 'home', systemPage: true } });
  const d = deps({ db });
  const res = fakeRes();
  await createDeletePageHandler(d)(adminReq({ id: 'home' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(d.store.deletes.length, 0);
});

test('cmsDeletePage deletes both revisions of a non-system page and logs', async () => {
  const db = fakeDb({
    'cmsPages/extra': { id: 'extra', systemPage: false },
    'cmsPages_drafts/extra': { id: 'extra', systemPage: false, status: 'clean' },
  });
  const d = deps({ db });
  const res = fakeRes();
  await createDeletePageHandler(d)(adminReq({ id: 'extra' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(d.store.deletes[0], { db, collection: 'cmsPages', docId: 'extra' });
  assert.equal(d.store.logs[0].action, 'cmsDeletePage');
  assert.equal(d.store.logs[0].docPath, 'cmsPages/extra');
});

test('cmsDeletePage 404s when neither revision exists', async () => {
  const res = fakeRes();
  await createDeletePageHandler(deps())(adminReq({ id: 'ghost' }), res);
  assert.equal(res.statusCode, 404);
});

test('cmsDeletePage gates on admin', async () => {
  const d = deps({ db: fakeDb({ 'cmsPages/extra': { systemPage: false } }) });
  const res = fakeRes();
  await createDeletePageHandler(d)({ method: 'POST', headers: {}, body: { id: 'extra' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(d.store.deletes.length, 0);
});

test('cmsDeletePage rejects a malformed id before touching the db', async () => {
  const res = fakeRes();
  await createDeletePageHandler(deps())(adminReq({ id: '../config' }), res);
  assert.equal(res.statusCode, 400);
});
