'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePageDoc,
  createSavePageHandler,
  createDeletePageHandler,
  PAGE_LAYOUT_VALUES,
  SECTION_SLOTS,
  PAGE_TEMPLATE_IDS,
} = require('./pages.cjs');
const { PAGE_TEMPLATE_LAYOUTS } = require('./pageTemplates.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

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

/** In-memory Firestore fake (get/set/where/batch) seeded as 'collection/id'. */
function fakeDb(seed = {}) {
  return makeFakeDb(seed);
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

// -------------------------------------------------- path routing (issue #52)

test('validatePageDoc rejects a reserved first segment on a generic page, naming it', () => {
  for (const segment of ['schedule', 'speakers', 'sponsors', 'signin', 'p', 'admin']) {
    const { ok, errors } = validatePageDoc(validPage({ path: `/${segment}` }));
    assert.equal(ok, false, segment);
    assert.ok(errors.some((e) => e.includes(`'${segment}' is a reserved route`)), `${segment}: ${errors.join('; ')}`);
  }
});

test('validatePageDoc allows a reserved segment on the systemPage that owns it', () => {
  const { ok } = validatePageDoc(validPage({ path: '/schedule', systemPage: true }));
  assert.equal(ok, true);
});

test('validatePageDoc rejects a reserved segment nested deeper in the path too', () => {
  const { ok, errors } = validatePageDoc(validPage({ path: '/p/old-faq' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("'p' is a reserved route")));
});

test('validatePageDoc rejects path "/" for a generic page but allows it for a system page', () => {
  const generic = validatePageDoc(validPage({ path: '/' }));
  assert.equal(generic.ok, false);
  assert.ok(generic.errors.some((e) => e.includes("'/' is reserved for the home page")));

  const system = validatePageDoc(validPage({ path: '/', systemPage: true, id: 'home' }));
  assert.equal(system.ok, true);
});

test('validatePageDoc rejects a trailing slash', () => {
  const { ok, errors } = validatePageDoc(validPage({ path: '/scholarships/' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('trailing slash')));
});

test('validatePageDoc rejects empty segments from a double slash', () => {
  const { ok, errors } = validatePageDoc(validPage({ path: '/scholarships//apply' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('empty segments')));
});

test('validatePageDoc rejects uppercase and non-slug characters in a segment', () => {
  for (const path of ['/Scholarships', '/scholarships_2026', '/scholar ships']) {
    const { ok, errors } = validatePageDoc(validPage({ path }));
    assert.equal(ok, false, path);
    assert.ok(errors.some((e) => e.startsWith('path: segment')), `${path}: ${errors.join('; ')}`);
  }
});

test('validatePageDoc rejects leading/trailing hyphens in a segment', () => {
  for (const path of ['/-scholarships', '/scholarships-']) {
    const { ok } = validatePageDoc(validPage({ path }));
    assert.equal(ok, false, path);
  }
});

test('validatePageDoc accepts a normalized multi-segment root-level path', () => {
  const { ok } = validatePageDoc(validPage({ path: '/get-involved/scholarships-2026' }));
  assert.equal(ok, true);
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

// -------------------------------------------------- layout variants (§6.2)

test('validatePageDoc accepts a page with no layout at all', () => {
  const page = validPage();
  assert.equal('layout' in page, false);
  assert.equal(validatePageDoc(page).ok, true);
});

test('validatePageDoc accepts every value of every layout variant', () => {
  for (const [key, values] of Object.entries(PAGE_LAYOUT_VALUES)) {
    for (const value of values) {
      const { ok, errors } = validatePageDoc(validPage({ layout: { [key]: value } }));
      assert.equal(ok, true, `layout.${key} = ${value}: ${errors.join('; ')}`);
    }
  }
});

test('validatePageDoc rejects an unknown layout value, naming the field and the value', () => {
  const { ok, errors } = validatePageDoc(validPage({ layout: { arrangement: 'masonry' } }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('layout.arrangement:') && e.includes('"masonry"')));
});

test('validatePageDoc rejects header "none" — every public page keeps a nameplate', () => {
  const { ok, errors } = validatePageDoc(validPage({ layout: { header: 'none' } }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('layout.header:') && e.includes('"none"')));
  assert.equal(PAGE_LAYOUT_VALUES.header.includes('none'), false);
});

test('validatePageDoc names an unknown key inside layout', () => {
  const { ok, errors } = validatePageDoc(validPage({ layout: { columns: 3 } }));
  assert.equal(ok, false);
  assert.ok(errors.includes('layout.columns: unknown field'));
});

test('validatePageDoc rejects a layout that is not an object', () => {
  assert.equal(validatePageDoc(validPage({ layout: 'grid' })).ok, false);
  assert.equal(validatePageDoc(validPage({ layout: ['grid'] })).ok, false);
  assert.equal(validatePageDoc(validPage({ layout: null })).ok, false);
});

// ---------------------------------------------------------- page templates

test('validatePageDoc accepts a page with no template, and null for none', () => {
  const page = validPage();
  assert.equal('template' in page, false);
  assert.equal(validatePageDoc(page).ok, true);
  assert.equal(validatePageDoc(validPage({ template: null })).ok, true);
});

test('validatePageDoc accepts every template the catalogue names', () => {
  for (const id of PAGE_TEMPLATE_IDS) {
    const { ok, errors } = validatePageDoc(validPage({ template: id }));
    assert.equal(ok, true, `template ${id}: ${errors.join('; ')}`);
  }
});

test('validatePageDoc rejects an unknown template BY NAME', () => {
  const { ok, errors } = validatePageDoc(validPage({ template: 'poster' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('template:') && e.includes('"poster"')));
});

test('every template bundle states every layout variant, in accepted values', () => {
  // A template's whole job is to answer the questions the operator would
  // otherwise have to. One left unstated leaves the page half-following the
  // preset, which is the state templates exist to prevent.
  for (const id of PAGE_TEMPLATE_IDS) {
    const bundle = PAGE_TEMPLATE_LAYOUTS[id];
    assert.deepEqual(Object.keys(bundle).sort(), ['arrangement', 'density', 'header']);
    const { ok, errors } = validatePageDoc(validPage({ template: id, layout: { ...bundle } }));
    assert.equal(ok, true, `${id}: ${errors.join('; ')}`);
  }
});

test('navPlacement stays accepted on a page, so pages written before it moved still save', () => {
  // The page editor stopped offering it — where the navigation sits is a
  // site setting now. A validator that started rejecting a value it once
  // wrote would make untouched pages unsaveable.
  assert.equal(validatePageDoc(validPage({ layout: { navPlacement: 'side' } })).ok, true);
});

// ------------------------------------------------------ section slots (§6.2)

test('validatePageDoc accepts a section with no slot, and every named slot', () => {
  assert.equal(validatePageDoc(validPage()).ok, true);
  for (const slot of SECTION_SLOTS) {
    const page = validPage();
    page.sections[0].slot = slot;
    assert.equal(validatePageDoc(page).ok, true, `slot ${slot}`);
  }
});

test('validatePageDoc rejects an unknown slot by name, naming the section', () => {
  const page = validPage();
  page.sections[0].slot = 'beside';
  const { ok, errors } = validatePageDoc(page);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('sections[0].slot:') && e.includes('"beside"')));
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

// --------------------------------------------- cmsSavePage path uniqueness

test('cmsSavePage rejects a path already used by another LIVE page', async () => {
  const db = fakeDb({ 'cmsPages/faq': { id: 'faq', path: '/scholarships', systemPage: false } });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.message.includes("already used by page 'faq'"));
  assert.equal(d.store.writes.length, 0);
});

test('cmsSavePage rejects a path already used by another DRAFT page', async () => {
  const db = fakeDb({ 'cmsPages_drafts/faq': { id: 'faq', path: '/scholarships', systemPage: false } });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.message.includes("already used by page 'faq'"));
  assert.equal(d.store.writes.length, 0);
});

test('cmsSavePage allows re-saving a page under its own unchanged path', async () => {
  const db = fakeDb({
    'cmsPages/scholarships': { id: 'scholarships', path: '/scholarships', systemPage: false },
    'cmsPages_drafts/scholarships': { id: 'scholarships', path: '/scholarships', systemPage: false, status: 'clean' },
  });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 200);
});

test('cmsSavePage allows two different pages with different paths', async () => {
  const db = fakeDb({ 'cmsPages/faq': { id: 'faq', path: '/faq', systemPage: false } });
  const d = deps({ db });
  const res = fakeRes();
  await createSavePageHandler(d)(adminReq({ page: validPage() }), res);
  assert.equal(res.statusCode, 200);
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
