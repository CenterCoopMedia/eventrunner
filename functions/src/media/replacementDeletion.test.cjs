'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCmsPublishHandler } = require('../cms/publish.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { writeDraft } = require('../cms/store.cjs');
const { createReplacementPublicationHandler } = require('./replacementDeletion.cjs');
const { scanReplacementUsage } = require('./usage.cjs');

const source = 'cms-images/old/venue.png';
const target = 'cms-images/new/venue.png';
const bucketName = 'fixture.appspot.com';
const requestId = '12d4b840-52b0-4af5-8f88-d40836151a48';
const operator = { uid: 'owner', email: 'owner@example.test', email_verified: true };

function fixture({ live = true, publisher = true, beforeDelete = async () => {} } = {}) {
  const image = { blockType: 'image', url: source, alt: 'Original', section: 'hero', field: 'image' };
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: [operator.email] },
    'media_assets/old': { path: source },
    'media_assets/new': { path: target, alt: 'Replacement' },
    'media_captions/old': { caption: 'Original' },
    ...(live ? { 'cmsContent/hero__image': { ...image, revision: 1, visible: true } } : {}),
    'cmsContent_drafts/hero__image': { ...image, status: 'dirty', basedOnRevision: 1 },
  });
  const deletions = [];
  const files = new Set([source, target]);
  const bucket = {
    name: bucketName,
    file: (path) => ({
      exists: async () => [files.has(path)],
      delete: async () => {
        await beforeDelete(db);
        deletions.push({ path, live: db.read('cmsContent', 'hero__image')?.url, draft: db.read('cmsContent_drafts', 'hero__image')?.url });
        files.delete(path);
      },
    }),
  };
  const handler = createCmsPublishHandler({
    db, auth: { verifyIdToken: async () => operator }, getConfig: async () => ({}),
    getBucket: () => bucket, log: { warn() {}, error() {} },
    env: publisher ? { EVENT_SITE_PUBLISHER_JOB: 'site-publisher', EVENT_FIREBASE_PROJECT_ID: 'fixture' } : {},
    fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('metadata.google.internal')
      ? { access_token: 'fixture-token' }
      : { metadata: { name: 'fixture-execution' } } }),
  });
  const onPublication = createReplacementPublicationHandler({ db, getBucket: () => bucket, log: { warn() {}, error() {} } });
  async function call(body) {
    const res = { status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer operator' }, body }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body));
    return res.body;
  }
  async function replace(options) {
    const references = (await scanReplacementUsage({ db, paths: [source], bucket: bucketName }))[source];
    return call({ requestId, mediaReplacement: { assetId: 'old', replacementId: 'new', references, ...options } });
  }
  async function finishPublication(status) {
    const ref = db.collection('cmsPublishQueue').doc(requestId);
    const before = await ref.get();
    await ref.set({ publisher: { status } }, { merge: true });
    const event = { data: { before, after: await ref.get() } };
    await onPublication(event);
    await onPublication(event); // Event delivery can be repeated.
  }
  return { db, replace, call, files, deletions, finishPublication };
}

test('replacement keeps the original file by default', async () => {
  const { db, replace, files, deletions } = fixture();
  const outcome = await replace();
  assert.equal(outcome.changed.length, 2);
  assert.equal(outcome.deletion, undefined);
  assert.equal(db.read('media_assets', 'old').path, source);
  assert.ok(files.has(source));
  assert.deepEqual(deletions, []);
});

test('an opted-in draft-only move refreshes the public site before deleting the original', async () => {
  const { db, replace, call, files, deletions, finishPublication } = fixture({ live: false });
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.publisher.status, 'invoked');
  assert.equal(outcome.deletion.status, 'waiting-for-site');
  assert.ok(files.has(source));
  await finishPublication('done');
  assert.equal((await call({ queueId: requestId })).deletion.status, 'deleted');
  assert.deepEqual(deletions, [{ path: source, live: undefined, draft: target }]);
  assert.equal(db.read('media_assets', 'old'), undefined);
  assert.equal(db.read('media_captions', 'old'), undefined);
  assert.ok(!files.has(source) && files.has(target));
});

test('a new link outside the replacement placements blocks deletion', async (t) => {
  const { db, replace, files, deletions } = fixture();
  const transaction = db.runTransaction.bind(db);
  t.mock.method(db, 'runTransaction', (callback) => {
    if (db.read('cmsPublishQueue', requestId)?.status === 'done') {
      db.beforeCommit = () => db.collection('cmsContent').doc('hero__cta').create({
        blockType: 'cta', url: `https://fixture.example.test/${encodeURIComponent(source)}`,
      });
    }
    return transaction(callback);
  });
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.changed.length, 2);
  assert.deepEqual(outcome.failed, []);
  assert.equal(outcome.deletion.status, 'kept');
  assert.match(outcome.deletion.message, /still used/);
  assert.equal(db.read('media_assets', 'old').path, source);
  assert.ok(files.has(source));
  assert.deepEqual(deletions, []);
});

test('a failed move keeps the file and a successful resume can finish deleting it', async (t) => {
  const { replace, call, files, deletions, db, finishPublication } = fixture({ live: false });
  t.mock.method(db, 'runTransaction', async () => { throw new Error('Commit unavailable'); }, { times: 1 });
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.deletion.status, 'kept');
  assert.match(outcome.deletion.message, /could not be changed/);
  assert.ok(files.has(source));
  assert.deepEqual(deletions, []);

  const resumed = await call({ queueId: requestId });
  assert.equal(resumed.deletion.status, 'waiting-for-site');
  await finishPublication('done');
  assert.deepEqual(deletions, [{ path: source, live: undefined, draft: target }]);
});

for (const live of [false, true]) {
  test(`${live ? 'Published' : 'Draft-only'} replacement keeps the original without a verified refresh`, async () => {
    const { replace, files, deletions } = fixture({ live, publisher: false });
    const outcome = await replace({ deleteOriginal: true });
    assert.equal(outcome.changed.length, live ? 2 : 1);
    assert.equal(outcome.deletion.status, 'kept');
    assert.match(outcome.deletion.message, /public site may still use/);
    assert.ok(files.has(source));
    assert.deepEqual(deletions, []);
  });
}

test('the publisher completing deletes the original even after the organizer leaves', async () => {
  const { db, replace, call, files, deletions, finishPublication } = fixture();
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.deletion.status, 'waiting-for-site');
  assert.ok(files.has(source));
  assert.deepEqual(deletions, []);

  await finishPublication('done');
  assert.equal(db.read('cmsPublishQueue', requestId).mediaReplacement.deletion.status, 'deleted');
  assert.equal(db.read('media_assets', 'old'), undefined);
  assert.equal((await call({ queueId: requestId })).deletion.status, 'deleted');
  assert.deepEqual(deletions, [{ path: source, live: target, draft: target }]);
});

test('a draft cannot add the original during or after Storage deletion', async () => {
  const saveNewReference = (db) => writeDraft({
    db, collection: 'cmsContent', docId: 'travel__image', actor: operator,
    fields: { blockType: 'image', url: `https://fixture.example.test/${encodeURIComponent(source)}` },
  });
  const conflict = (err) => err.httpError?.code === 'media-unavailable';
  const { db, replace, files, finishPublication } = fixture({ beforeDelete: async (db) => {
    assert.ok(files.has(source));
    assert.equal(db.read('media_assets', 'old').deleting, true);
    await assert.rejects(saveNewReference(db), conflict);
  } });
  await replace({ deleteOriginal: true });
  await finishPublication('done');
  assert.ok(!files.has(source));
  await assert.rejects(saveNewReference(db), conflict);
  assert.equal(db.read('cmsContent_drafts', 'travel__image'), undefined);
});

test('an initial usage scan failure leaves a deletion retry on the receipt', async (t) => {
  const { db, replace, call, files } = fixture();
  const collection = db.collection.bind(db);
  let failed = false;
  t.mock.method(db, 'collection', (name) => {
    const ref = collection(name);
    if (!failed && name === 'cmsPages' && db.read('cmsPublishQueue', requestId)?.status === 'done') {
      failed = true;
      ref.get = async () => { throw new Error('Read unavailable'); };
    }
    return ref;
  });
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.deletion.status, 'retry');
  assert.deepEqual(db.read('cmsPublishQueue', requestId).mediaReplacement.deletion, outcome.deletion);
  assert.ok(files.has(source));

  await db.collection('cmsPublishQueue').doc(requestId).set({ publisher: { status: 'done' } }, { merge: true });
  assert.equal((await call({ queueId: requestId })).deletion.status, 'deleted');
  assert.ok(!files.has(source));
});
