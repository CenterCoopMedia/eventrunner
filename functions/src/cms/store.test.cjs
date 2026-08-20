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
    // The actor's UID, never the email: live docs are anonymously readable
    // per the rules, so an address here would be harvestable regardless of
    // any response filtering.
    publishedBy: ACTOR.uid,
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
  // The email lives ONLY on the admin-only history row (rules: admin read).
  assert.equal(entry.publishedBy, ACTOR.email);
  assert.equal(entry.publishedByUid, ACTOR.uid);
});

test('publishDocs never writes the actor email onto an anonymously readable live doc', async () => {
  const db = makeFakeDb({ 'cmsPages_drafts/about': { label: 'About', visible: true, status: 'dirty' } });
  await publishDocs({ db, collection: 'cmsPages', docIds: ['about'], actor: ACTOR, now });
  const live = db.read('cmsPages', 'about');
  assert.equal(live.publishedBy, ACTOR.uid);
  assert.equal(JSON.stringify(live).includes(ACTOR.email), false, 'no live field may carry the admin email');
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

test('publishDocs queue progress rides IN the chunk batch, never a separate post-commit write', async () => {
  // If the progress record were a doc-level queueRef.set() after the batch
  // commit, a crash between the two would leave committed docs unrecorded
  // and a resume would double-bump their revisions. Prove the progress is
  // batched: sabotage the doc-level set and the publish must still succeed
  // with the progress recorded.
  const db = makeFakeDb({ 'cmsSchedule_drafts/s1': { title: 'S1', visible: true, status: 'dirty' } });
  const queueRef = db.collection('cmsPublishQueue').doc('q1');
  await queueRef.set({ status: 'running', request: { cmsSchedule: ['s1'] } });
  queueRef.set = async () => {
    throw new Error('doc-level queueRef.set must not be used for progress');
  };

  const result = await publishDocs({ db, collection: 'cmsSchedule', docIds: ['s1'], actor: ACTOR, now, queueRef });
  assert.deepEqual(result.published, ['s1']);
  const row = db.read('cmsPublishQueue', 'q1');
  assert.deepEqual(row.progress.cmsSchedule.published, ['s1']);
  assert.equal(row.progress.cmsSchedule.chunksCommitted, 1);
});

test('publishDocs: an editor save between the read and the commit is a conflict skip, never a stale publish', async () => {
  const db = makeFakeDb({
    'cmsContent/hero__title': { value: 'v1', visible: true, revision: 1, publishedAt: new Date(0), publishedBy: 'u' },
    'cmsContent_drafts/hero__title': { value: 'v2', visible: true, status: 'dirty', basedOnRevision: 1 },
  });
  // Interleave: after publishDocs reads the draft snapshots, an editor
  // saves v3 before the batch commits. Without the lastUpdateTime
  // precondition, live would get the stale v2 AND the v3 draft would be
  // marked clean — invisible to { all: true } forever.
  const realGetAll = db.getAll.bind(db);
  let fired = false;
  db.getAll = async (...refs) => {
    const snaps = await realGetAll(...refs);
    if (!fired && refs[0]._col === 'cmsContent_drafts') {
      fired = true;
      await db.collection('cmsContent_drafts').doc('hero__title').set({
        value: 'v3', visible: true, status: 'dirty', basedOnRevision: 1,
        updatedAt: new Date(NOW), updatedBy: 'editor@example.org',
      });
    }
    return snaps;
  };

  const result = await publishDocs({ db, collection: 'cmsContent', docIds: ['hero__title'], actor: ACTOR, now });
  assert.deepEqual(result.published, []);
  assert.deepEqual(result.skipped, [{ docId: 'hero__title', reason: 'conflict' }]);
  // Live keeps v1 — the stale v2 snapshot never went out.
  assert.equal(db.read('cmsContent', 'hero__title').value, 'v1');
  assert.equal(db.read('cmsContent', 'hero__title').revision, 1);
  // The newer draft is still dirty, so the next publish still finds it.
  const draft = db.read('cmsContent_drafts', 'hero__title');
  assert.equal(draft.value, 'v3');
  assert.equal(draft.status, 'dirty');
  assert.equal(db.ids('cmsVersionHistory').length, 0);
});

test('publishDocs conflict on one doc does not fail the chunk: the others still publish', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/a': { value: 'a1', visible: true, status: 'dirty' },
    'cmsContent_drafts/b': { value: 'b1', visible: true, status: 'dirty' },
  });
  const realGetAll = db.getAll.bind(db);
  let fired = false;
  db.getAll = async (...refs) => {
    const snaps = await realGetAll(...refs);
    if (!fired && refs[0]._col === 'cmsContent_drafts') {
      fired = true;
      await db.collection('cmsContent_drafts').doc('a').set({ value: 'a2', visible: true, status: 'dirty' });
    }
    return snaps;
  };

  const queueRef = db.collection('cmsPublishQueue').doc('q1');
  await queueRef.set({ status: 'running', request: { cmsContent: ['a', 'b'] } });
  const result = await publishDocs({ db, collection: 'cmsContent', docIds: ['a', 'b'], actor: ACTOR, now, queueRef });
  assert.deepEqual(result.published, ['b']);
  assert.deepEqual(result.skipped, [{ docId: 'a', reason: 'conflict' }]);
  assert.equal(db.read('cmsContent', 'b').value, 'b1');
  assert.equal(db.read('cmsContent', 'a'), undefined);
  assert.equal(db.read('cmsContent_drafts', 'a').status, 'dirty');
  // The queue row records the conflict so the operator can see it.
  const row = db.read('cmsPublishQueue', 'q1');
  assert.deepEqual(row.progress.cmsContent.published, ['b']);
  assert.deepEqual(row.progress.cmsContent.skipped, [{ docId: 'a', reason: 'conflict' }]);
});

test('publishDocs rethrows non-precondition commit failures instead of retrying them', async () => {
  const db = makeFakeDb({ 'cmsContent_drafts/x': { value: 'v', visible: true, status: 'dirty' } });
  db.failAtCommit = 1;
  await assert.rejects(
    () => publishDocs({ db, collection: 'cmsContent', docIds: ['x'], actor: ACTOR, now }),
    /injected batch commit failure/,
  );
  assert.equal(db.read('cmsContent', 'x'), undefined);
  assert.equal(db.read('cmsContent_drafts', 'x').status, 'dirty');
});

// --- writeDraft createOnly (concurrent create race) ---------------------------

test('writeDraft createOnly refuses an existing draft without writing', async () => {
  const db = makeFakeDb({ 'cmsContent_drafts/hero__title': { value: 'first', visible: true, status: 'dirty' } });
  await assert.rejects(
    () => writeDraft({
      db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'second' },
      actor: ACTOR, now, createOnly: true,
    }),
    (err) => require('./store.cjs').isAlreadyExistsError(err),
  );
  assert.equal(db.read('cmsContent_drafts', 'hero__title').value, 'first');
  assert.equal(db.writes.length, 0);
});

test('writeDraft createOnly loses the create() race atomically — the first writer wins', async () => {
  const db = makeFakeDb();
  const draftRef = db.collection('cmsContent_drafts').doc('hero__title');
  // Interleave: the second create's existence check runs before the first
  // create's write lands (both saw "no doc"), so only the create()
  // precondition separates them.
  const realGet = draftRef.get.bind(draftRef);
  let lied = false;
  const rigged = {
    ...draftRef,
    get: async () => {
      if (!lied) return realGet();
      return { exists: false, data: () => undefined };
    },
  };
  const col = db.collection.bind(db);
  db.collection = (name) => {
    if (name !== 'cmsContent_drafts') return col(name);
    return { ...col(name), doc: (id) => (id === 'hero__title' ? rigged : col(name).doc(id)) };
  };

  await writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'first' }, actor: ACTOR, now, createOnly: true });
  lied = true; // the loser's existence check now reports "no doc" despite the winner's write
  await assert.rejects(
    () => writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'second' }, actor: ACTOR, now, createOnly: true }),
    (err) => require('./store.cjs').isAlreadyExistsError(err),
  );
  assert.equal(db.read('cmsContent_drafts', 'hero__title').value, 'first');
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

// --- isValidDocId -------------------------------------------------------------

test('isValidDocId rejects empty, slashed, dot, and oversized ids', () => {
  const { isValidDocId } = require('./store.cjs');
  assert.equal(isValidDocId('q-abc123'), true);
  assert.equal(isValidDocId(''), false);
  assert.equal(isValidDocId('a/b'), false);
  assert.equal(isValidDocId('a/b/c'), false);
  assert.equal(isValidDocId('.'), false);
  assert.equal(isValidDocId('..'), false);
  assert.equal(isValidDocId(42), false);
  assert.equal(isValidDocId('x'.repeat(internals.MAX_DOC_ID_LENGTH + 1)), false);
});

// --- revision uniqueness across deleteBoth + recreate -------------------------

test('publishDocs after deleteBoth + recreate resumes above the historical max revision', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/hero__title': { value: 'v1', section: 'hero', field: 'title', visible: true, status: 'dirty' },
  });
  // Two publish generations: revisions 1 and 2.
  await publishDocs({ db, collection: 'cmsContent', docIds: ['hero__title'], actor: ACTOR, now });
  await writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'v2' }, actor: ACTOR, now });
  await publishDocs({ db, collection: 'cmsContent', docIds: ['hero__title'], actor: ACTOR, now });
  assert.equal(db.read('cmsContent', 'hero__title').revision, 2);

  // Delete both docs; history rows survive as the audit trail.
  await deleteBoth({ db, collection: 'cmsContent', docId: 'hero__title' });
  assert.equal(db.ids('cmsVersionHistory').length, 2);

  // Recreate and publish: the new revision continues past the old max —
  // never back to 1 — so revisions stay unique per docPath and the
  // versions.cjs revision cursor cannot skip or repeat entries.
  await writeDraft({ db, collection: 'cmsContent', docId: 'hero__title', fields: { value: 'v3' }, actor: ACTOR, now });
  await publishDocs({ db, collection: 'cmsContent', docIds: ['hero__title'], actor: ACTOR, now });
  assert.equal(db.read('cmsContent', 'hero__title').revision, 3);

  const revisions = db.ids('cmsVersionHistory').map((id) => db.read('cmsVersionHistory', id).revision).sort();
  assert.deepEqual(revisions, [1, 2, 3]);
});
