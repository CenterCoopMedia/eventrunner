'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  writeDraft,
  deleteBoth,
  unpublishDoc,
  listDirty,
  publishDocs,
  logAdminAction,
  contentFieldsOf,
  internals,
} = require('./store.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

const ACTOR = { uid: 'admin1', email: 'admin@example.org' };
const NOW = 1_750_000_000_000;
const now = () => NOW;

test('chunk size never exceeds 400 writes per batch', () => {
  assert.equal(internals.DOCS_PER_CHUNK * internals.WRITES_PER_DOC <= internals.MAX_WRITES_PER_BATCH, true);
  assert.equal(internals.DOCS_PER_CHUNK, 133);
});

test('contentFieldsOf strips every bookkeeping key', () => {
  const stripped = contentFieldsOf({
    value: 'hello',
    section: 'hero',
    visible: true,
    status: 'dirty',
    revision: 9,
    basedOnRevision: 8,
    updatedAt: new Date(),
    updatedBy: 'x',
    publishedAt: new Date(),
    publishedBy: 'y',
  });
  assert.deepEqual(stripped, { value: 'hello', section: 'hero' });
});

// --- writeDraft -------------------------------------------------------------

test('writeDraft writes the draft only — the live collection is never touched', async () => {
  const db = makeFakeDb({ 'cmsContent/hero__title': { value: 'live', visible: true, revision: 3 } });
  await writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'edited' }, actor: ACTOR, now });
  assert.deepEqual(db.writes.map((w) => w.path), ['cmsContent_drafts/hero__title']);
  assert.equal(db.read('cmsContent', 'hero__title').value, 'live');
});

test('writeDraft: fresh draft of a never-published doc has basedOnRevision null, status dirty', async () => {
  const db = makeFakeDb();
  const { docPath, existed } = await writeDraft({
    db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'v1' }, actor: ACTOR, now,
  });
  assert.equal(docPath, 'cmsContent_drafts/hero__title');
  assert.equal(existed, false);
  assert.deepEqual(db.read('cmsContent_drafts', 'hero__title'), {
    value: 'v1',
    visible: true,
    status: 'dirty',
    basedOnRevision: null,
    updatedAt: new Date(NOW),
    updatedBy: ACTOR.email,
  });
});

test('writeDraft forks basedOnRevision and visible from the live doc when no draft exists', async () => {
  const db = makeFakeDb({ 'cmsContent/hero__title': { value: 'live', visible: false, revision: 7 } });
  await writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'edited' }, actor: ACTOR, now });
  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.basedOnRevision, 7);
  assert.equal(draft.visible, false);
  assert.equal(draft.status, 'dirty');
});

test('writeDraft preserves an existing draft basedOnRevision and re-dirties a clean draft', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/hero__title': {
      value: 'old', visible: true, status: 'clean', basedOnRevision: 4,
      updatedAt: new Date(0), updatedBy: 'someone@example.org',
    },
  });
  await writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'new' }, actor: ACTOR, now });
  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.basedOnRevision, 4);
  assert.equal(draft.value, 'new');
  assert.equal(draft.updatedBy, ACTOR.email);
});

test('writeDraft strips reserved bookkeeping keys from caller fields', async () => {
  const db = makeFakeDb();
  await writeDraft({
    db, collection: 'cmsPages', docId: 'home',
    fields: { label: 'Home', revision: 999, publishedBy: 'attacker@example.org', status: 'clean' },
    actor: ACTOR, now,
  });
  const draft = db.read('cmsPages_drafts', 'home');
  assert.equal(draft.label, 'Home');
  assert.equal(draft.revision, undefined);
  assert.equal(draft.publishedBy, undefined);
  assert.equal(draft.status, 'dirty');
});

test('writeDraft throws on a non-publishable collection before writing anything', async () => {
  const db = makeFakeDb();
  await assert.rejects(
    () => writeDraft({ db, collection: 'users', docId: 'u1', fields: {}, actor: ACTOR, now }),
    /Not a publishable collection/,
  );
  assert.equal(db.writes.length, 0);
});

// --- deleteBoth -------------------------------------------------------------

test('deleteBoth removes live and draft in a single batch', async () => {
  const db = makeFakeDb({
    'cmsUpdates/post1': { title: 'x', visible: true, revision: 1 },
    'cmsUpdates_drafts/post1': { title: 'x', visible: true, status: 'clean', basedOnRevision: 1 },
  });
  const { livePath, draftPath } = await deleteBoth({ db, collection: 'cmsUpdates', docId: 'post1' });
  assert.equal(livePath, 'cmsUpdates/post1');
  assert.equal(draftPath, 'cmsUpdates_drafts/post1');
  assert.equal(db.read('cmsUpdates', 'post1'), undefined);
  assert.equal(db.read('cmsUpdates_drafts', 'post1'), undefined);
  assert.equal(db.commitCount, 1);
});

// --- unpublishDoc -----------------------------------------------------------

test('unpublishDoc sets visible:false on the live doc only, keeping revision stamps', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': {
      value: 'live', visible: true, revision: 5,
      publishedAt: new Date(1000), publishedBy: 'a@example.org',
    },
    'cmsContent_drafts/hero__title': { value: 'live', visible: true, status: 'clean', basedOnRevision: 5 },
  });
  const result = await unpublishDoc({ db, collection: 'cmsContent', docId: 'hero__title' });
  assert.deepEqual(result, { ok: true, docPath: 'cmsContent/hero__title' });
  const live = db.read('cmsContent', 'hero__title');
  assert.equal(live.visible, false);
  assert.equal(live.revision, 5);
  assert.equal(live.value, 'live');
  // The draft is untouched: unpublish is never an edit.
  assert.equal(db.read('cmsContent_drafts', 'hero__title').visible, true);
  assert.deepEqual(db.writes.map((w) => w.path), ['cmsContent/hero__title']);
});

test('unpublishDoc on a never-published doc reports not-published and writes nothing', async () => {
  const db = makeFakeDb({ 'cmsContent_drafts/hero__title': { value: 'v', visible: true, status: 'dirty' } });
  const result = await unpublishDoc({ db, collection: 'cmsContent', docId: 'hero__title' });
  assert.deepEqual(result, { ok: false, reason: 'not-published' });
  assert.equal(db.writes.length, 0);
});

// --- listDirty --------------------------------------------------------------

test('listDirty returns only dirty draft ids', async () => {
  const db = makeFakeDb({
    'cmsPages_drafts/a': { status: 'dirty' },
    'cmsPages_drafts/b': { status: 'clean' },
    'cmsPages_drafts/c': { status: 'dirty' },
  });
  assert.deepEqual((await listDirty({ db, collection: 'cmsPages' })).sort(), ['a', 'c']);
});

// --- publishDocs ------------------------------------------------------------

test('publishDocs: first publish is revision 1; live gets content fields, visible, stamps', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/hero__title': {
      value: 'v1', section: 'hero', field: 'title', visible: true,
      status: 'dirty', basedOnRevision: null, updatedAt: new Date(0), updatedBy: 'e@example.org',
    },
  });
  const result = await publishDocs({ db, collection: 'cmsContent', docIds: ['hero__title'], actor: ACTOR, now });
  assert.deepEqual(result.published, ['hero__title']);
  assert.deepEqual(result.skipped, []);

  const live = db.read('cmsContent', 'hero__title');
  assert.deepEqual(live, {
    value: 'v1',
    section: 'hero',
    field: 'title',
    visible: true,
    revision: 1,
    publishedAt: new Date(NOW),
    publishedBy: ACTOR.email,
  });
  // Draft bookkeeping (status/updatedAt/updatedBy) never leaks onto live.
  assert.equal('status' in live, false);

  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.status, 'clean');
  assert.equal(draft.basedOnRevision, 1);

  const historyIds = db.ids('cmsVersionHistory');
  assert.equal(historyIds.length, 1);
  const entry = db.read('cmsVersionHistory', historyIds[0]);
  assert.equal(entry.docPath, 'cmsContent/hero__title');
  assert.equal(entry.revision, 1);
  assert.deepEqual(entry.fields, { value: 'v1', section: 'hero', field: 'title' });
});

test('publishDocs: republish bumps revision by exactly one from the live doc', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': { value: 'v1', visible: true, revision: 4, publishedAt: new Date(0), publishedBy: 'x' },
    'cmsContent_drafts/hero__title': { value: 'v2', visible: true, status: 'dirty', basedOnRevision: 4 },
  });
  await publishDocs({ db, collection: 'cmsContent', docIds: ['hero__title'], actor: ACTOR, now });
  assert.equal(db.read('cmsContent', 'hero__title').revision, 5);
  assert.equal(db.read('cmsContent', 'hero__title').value, 'v2');
  assert.equal(db.read('cmsContent_drafts', 'hero__title').basedOnRevision, 5);
});

test('publishDocs skips docIds without a draft and reports them', async () => {
  const db = makeFakeDb({ 'cmsUpdates_drafts/real': { title: 't', visible: true, status: 'dirty' } });
  const result = await publishDocs({ db, collection: 'cmsUpdates', docIds: ['real', 'ghost'], actor: ACTOR, now });
  assert.deepEqual(result.published, ['real']);
  assert.deepEqual(result.skipped, [{ docId: 'ghost', reason: 'no-draft' }]);
  assert.equal(db.read('cmsUpdates', 'ghost'), undefined);
});

test('publishDocs publishes a draft with visible:false as a hidden live doc', async () => {
  const db = makeFakeDb({ 'cmsPages_drafts/secret': { label: 's', visible: false, status: 'dirty' } });
  await publishDocs({ db, collection: 'cmsPages', docIds: ['secret'], actor: ACTOR, now });
  assert.equal(db.read('cmsPages', 'secret').visible, false);
});

/** Seed n dirty drafts sched-0..sched-(n-1); returns the db and ids. */
function seedManyDrafts(n) {
  const seed = {};
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const id = `sched-${String(i).padStart(3, '0')}`;
    ids.push(id);
    seed[`cmsSchedule_drafts/${id}`] = { title: `Session ${i}`, visible: true, status: 'dirty' };
  }
  return { db: makeFakeDb(seed), ids };
}

test('publishDocs chunks a multi-doc publish and records per-chunk progress on the queue row', async () => {
  const { db, ids } = seedManyDrafts(134); // one over DOCS_PER_CHUNK → two chunks
  const queueRef = db.collection('cmsPublishQueue').doc('q1');
  await queueRef.set({ status: 'running', request: { cmsSchedule: ids } });

  const result = await publishDocs({ db, collection: 'cmsSchedule', docIds: ids, actor: ACTOR, now, queueRef });
  assert.equal(result.published.length, 134);
  assert.equal(result.chunksCommitted, 2);
  assert.equal(db.ids('cmsSchedule').length, 134);
  assert.equal(db.ids('cmsVersionHistory').length, 134);

  const row = db.read('cmsPublishQueue', 'q1');
  assert.equal(row.progress.cmsSchedule.published.length, 134);
  assert.equal(row.progress.cmsSchedule.chunksCommitted, 2);
});

test('publishDocs: a mid-way batch failure leaves committed chunks recorded, and a re-run completes without double-bumping', async () => {
  const { db, ids } = seedManyDrafts(134);
  const queueRef = db.collection('cmsPublishQueue').doc('q1');
  await queueRef.set({ status: 'running', request: { cmsSchedule: ids } });

  db.failAtCommit = 2; // chunk 1 commits, chunk 2 throws
  await assert.rejects(
    () => publishDocs({ db, collection: 'cmsSchedule', docIds: ids, actor: ACTOR, now, queueRef }),
    /injected batch commit failure/,
  );

  // Exactly the first chunk landed, and the row records exactly that.
  assert.equal(db.ids('cmsSchedule').length, 133);
  assert.equal(db.ids('cmsVersionHistory').length, 133);
  const rowAfterFailure = db.read('cmsPublishQueue', 'q1');
  assert.equal(rowAfterFailure.progress.cmsSchedule.published.length, 133);
  assert.equal(rowAfterFailure.progress.cmsSchedule.chunksCommitted, 1);

  // Re-run with the same queue row: only the remaining doc publishes.
  const result = await publishDocs({ db, collection: 'cmsSchedule', docIds: ids, actor: ACTOR, now, queueRef });
  assert.equal(result.published.length, 134);
  assert.equal(db.ids('cmsSchedule').length, 134);
  assert.equal(db.ids('cmsVersionHistory').length, 134); // no duplicate history rows
  for (const id of ids) {
    assert.equal(db.read('cmsSchedule', id).revision, 1); // never double-bumped
    assert.equal(db.read('cmsSchedule_drafts', id).status, 'clean');
  }
});

test('publishDocs without a queueRef works (single-doc convenience path)', async () => {
  const db = makeFakeDb({ 'cmsTimeline_drafts/t1': { year: 2020, visible: true, status: 'dirty' } });
  const result = await publishDocs({ db, collection: 'cmsTimeline', docIds: ['t1'], actor: ACTOR, now });
  assert.deepEqual(result.published, ['t1']);
  assert.equal(db.read('cmsTimeline', 't1').revision, 1);
});

// --- logAdminAction ---------------------------------------------------------

test('logAdminAction writes the fixed-shape entry', async () => {
  const db = makeFakeDb();
  await logAdminAction({ db, action: 'cms-create-content', docPath: 'cmsContent_drafts/x', actor: ACTOR, now });
  const ids = db.ids('admin_logs');
  assert.equal(ids.length, 1);
  assert.deepEqual(db.read('admin_logs', ids[0]), {
    action: 'cms-create-content',
    docPath: 'cmsContent_drafts/x',
    uid: ACTOR.uid,
    email: ACTOR.email,
    at: new Date(NOW),
  });
});

test('logAdminAction never throws when the audit write fails', async () => {
  const broken = {
    collection() {
      return { doc: () => ({ set: async () => { throw new Error('firestore down'); } }) };
    },
  };
  const warnings = [];
  await logAdminAction({
    db: broken, action: 'x', docPath: 'y', actor: ACTOR, now,
    log: { warn: (...args) => warnings.push(args) },
  });
  assert.equal(warnings.length, 1);
});
