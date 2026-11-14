'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('./firestoreFake.cjs');
const store = require('./store.cjs');
const { createSavePageHandler, validatePageDoc } = require('./pages.cjs');
const { createCmsCreateContentHandler, createCmsUpdateContentHandler, createGetSiteContentHandler,
  DELETE_FIELD_SENTINEL } = require('./content.cjs');
const { publicContentDoc } = require('shared/seed');
const { resolveContentVariant } = require('shared/contentLanguages');
const { emitSiteContent, emitPagesData, emitScheduleData } = require('../../../scripts/lib/emit.cjs');

const actor = { uid: 'editor', email: 'editor@example.org' };
const now = () => 1_750_000_000_000;
const page = { id: 'visit', label: 'Visit', title: 'Plan your visit', path: '/visit', icon: null,
  order: 1, visible: true, systemPage: false, sections: [] };
const cases = [
  { collection: 'cmsPages', id: 'visit', kind: 'page', source: page, spanish: { label: 'Visita', title: 'Planifica tu visita' } },
  { collection: 'cmsContent', id: 'hero__body', kind: 'block', source: { section: 'hero', field: 'body', blockType: 'richtext', value: '<p>Welcome</p>' },
    spanish: { value: '<p>Bienvenidos</p>' } },
  { collection: 'cmsSchedule', id: 'talk', kind: 'session', source: { title: 'A talk', description: 'About the talk',
    dayId: 'day-1', startTime: '09:00', endTime: '10:00', location: 'Hall 2' },
    spanish: { title: 'Una charla', description: 'Sobre la charla' } },
];

function setup(seed = {}) {
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: [actor.email] },
    'config/event': { days: [{ id: 'day-1' }] },
    'cmsPages/owner': { sections: [{ id: 'hero', allowedBlocks: ['richtext'], maxBlocks: 10 }] },
    ...seed,
  });
  return { db, auth: { verifyIdToken: async () => ({ ...actor, email_verified: true }) },
    getConfig: async () => ({}), now, log: { warn() {}, error() {} }, store };
}

function response() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, set() { return this; } };
}

async function save(deps, entry, fields, create = false) {
  const res = response();
  const req = { method: 'POST', headers: { authorization: 'Bearer synthetic' } };
  if (entry.collection === 'cmsPages') {
    req.body = { page: fields };
    await createSavePageHandler(deps)(req, res);
  } else {
    req.body = { collection: entry.collection, docId: entry.id, section: 'hero', field: 'body',
      pageId: 'owner', fields, visible: true };
    await (create ? createCmsCreateContentHandler : createCmsUpdateContentHandler)(deps)(req, res);
  }
  return res;
}

function snapshot(entry, live) {
  const doc = { ...live, id: entry.id };
  if (entry.collection === 'cmsPages') return emitPagesData([doc]);
  if (entry.collection === 'cmsSchedule') return emitScheduleData({ sessions: [doc], speakers: [] });
  return emitSiteContent([doc]);
}

test('authorized paired draft/publish cycles keep draft translations private across every public surface', async () => {
  for (const entry of cases) {
    const deps = setup();
    const fields = { ...entry.source, translations: { es: entry.spanish } };
    assert.equal((await save(deps, entry, fields, true)).statusCode, 200);
    assert.equal(deps.db.read(entry.collection, entry.id), undefined);
    await store.publishDocs({ db: deps.db, collection: entry.collection, docIds: [entry.id], actor, now });
    const published = deps.db.read(entry.collection, entry.id);
    assert.deepEqual(published.translations, { es: entry.spanish });
    assert.deepEqual(publicContentDoc(published).translations, { es: entry.spanish });
    assert.ok(snapshot(entry, published).includes(Object.values(entry.spanish)[0]));

    const privateVariant = Object.fromEntries(Object.keys(entry.spanish).map((key) => [key, 'PRIVATE_UNPUBLISHED_TRANSLATION']));
    assert.equal((await save(deps, entry, { ...fields, translations: { es: privateVariant } })).statusCode, 200);
    assert.deepEqual(deps.db.read(entry.collection, entry.id).translations, { es: entry.spanish });
    assert.ok(!snapshot(entry, deps.db.read(entry.collection, entry.id)).includes('PRIVATE_UNPUBLISHED_TRANSLATION'));
    const res = response();
    await createGetSiteContentHandler(deps)({ method: 'GET' }, res);
    assert.ok(!JSON.stringify(res.body).includes('PRIVATE_UNPUBLISHED_TRANSLATION'));

    // A source-only API edit merges over the paired draft, rather than erasing it.
    if (entry.collection !== 'cmsPages') {
      assert.equal((await save(deps, entry, { [entry.kind === 'block' ? 'value' : 'description']: 'New English copy' })).statusCode, 200);
      assert.deepEqual(deps.db.read(`${entry.collection}_drafts`, entry.id).translations, { es: privateVariant });
    }
    const cleared = { ...entry.source };
    if (entry.collection !== 'cmsPages') cleared.translations = DELETE_FIELD_SENTINEL;
    assert.equal((await save(deps, entry, cleared)).statusCode, 200);
    await store.publishDocs({ db: deps.db, collection: entry.collection, docIds: [entry.id], actor, now });
    const newer = deps.db.read(entry.collection, entry.id);
    assert.equal(Object.hasOwn(newer, 'translations'), false);
    assert.equal(resolveContentVariant(newer, entry.kind, 'es', { contentLanguages: { default: 'en', available: ['en', 'es'] } }).language, 'en');
    assert.ok(!snapshot(entry, newer).includes(Object.values(entry.spanish)[0]));
    assert.equal(newer.revision, published.revision + 1);
  }
});

test('save and publish reject private translation metadata and malformed stored variants without changing live content', async () => {
  for (const entry of cases) {
    for (const translations of [{ es: { status: 'draft', title: 'PRIVATE' } }, { en: {} }, { es: null },
      { es: { [Object.keys(entry.spanish)[0]]: 42 } }]) {
      const deps = setup();
      assert.equal((await save(deps, entry, { ...entry.source, translations }, true)).statusCode, 400);
      assert.equal(deps.db.read(`${entry.collection}_drafts`, entry.id), undefined);
      await store.writeDraft({ db: deps.db, collection: entry.collection, docId: entry.id,
        fields: { ...entry.source, translations }, visible: true, actor, now });
      await assert.rejects(store.publishDocs({ db: deps.db, collection: entry.collection, docIds: [entry.id], actor, now }), /Invalid translated content/);
      assert.equal(deps.db.read(entry.collection, entry.id), undefined);
      assert.equal(deps.db.read(`${entry.collection}_drafts`, entry.id).status, 'dirty');
    }
  }
  assert.equal(validatePageDoc({ ...page, sections: [{ id: 'intro', label: 'Intro', allowedBlocks: ['text'], maxBlocks: 1,
    reorderable: true, translations: { es: { id: 'different' } } }] }).ok, false);
});

test('translated rich text crosses the same sanitizer on merged saves and on publication', async () => {
  const entry = cases[1];
  const unsafe = '<p>Hola<script>PRIVATE_SCRIPT</script><a href="javascript:alert(1)">enlace</a></p>';
  const deps = setup();
  assert.equal((await save(deps, entry, { ...entry.source, translations: { es: { value: unsafe } } }, true)).statusCode, 200);
  const draft = deps.db.read('cmsContent_drafts', entry.id);
  assert.equal(draft.translations.es.value, '<p>Hola<a>enlace</a></p>');
  await store.publishDocs({ db: deps.db, collection: entry.collection, docIds: [entry.id], actor, now });
  assert.equal(deps.db.read('cmsContent', entry.id).translations.es.value, draft.translations.es.value);
  // The publish boundary also protects drafts restored outside the HTTP seam.
  await store.writeDraft({ db: deps.db, collection: entry.collection, docId: entry.id,
    fields: { ...entry.source, translations: { es: { value: unsafe } } }, visible: true, actor, now });
  await store.publishDocs({ db: deps.db, collection: entry.collection, docIds: [entry.id], actor, now });
  assert.equal(deps.db.read('cmsContent', entry.id).translations.es.value, draft.translations.es.value);
});
