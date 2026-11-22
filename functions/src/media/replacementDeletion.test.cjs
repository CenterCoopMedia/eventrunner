'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCmsPublishHandler } = require('../cms/publish.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createReplacementPublicationHandler } = require('./replacementDeletion.cjs');
const { scanReplacementUsage } = require('./usage.cjs');

const source = 'cms-images/old/venue.png';
const target = 'cms-images/new/venue.png';
const bucketName = 'fixture.appspot.com';
const requestId = '12d4b840-52b0-4af5-8f88-d40836151a48';
const operator = { uid: 'owner', email: 'owner@example.test', email_verified: true };

function fixture({ live = true, env = {}, fetchImpl } = {}) {
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
        deletions.push({ path, live: db.read('cmsContent', 'hero__image')?.url, draft: db.read('cmsContent_drafts', 'hero__image')?.url });
        files.delete(path);
      },
    }),
  };
  const handler = createCmsPublishHandler({
    db, auth: { verifyIdToken: async () => operator }, getConfig: async () => ({}),
    getBucket: () => bucket, env, fetchImpl, log: { warn() {}, error() {} },
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

test('an opted-in draft-only replacement deletes the original after the draft moves', async () => {
  const { db, replace, call, files, deletions } = fixture({ live: false });
  assert.equal((await replace({ deleteOriginal: true })).deletion.status, 'deleted');
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
  const { db, replace, call, files, deletions } = fixture({ live: false });
  t.mock.method(db, 'runTransaction', async () => { throw new Error('Commit unavailable'); }, { times: 1 });
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.deletion.status, 'kept');
  assert.match(outcome.deletion.message, /could not be changed/);
  assert.ok(files.has(source));
  assert.deepEqual(deletions, []);

  const resumed = await call({ queueId: requestId });
  assert.equal(resumed.deletion.status, 'deleted');
  assert.deepEqual(deletions, [{ path: source, live: undefined, draft: target }]);
});

test('published content keeps the original when a public site refresh cannot be verified', async () => {
  const { replace, files, deletions } = fixture();
  const outcome = await replace({ deleteOriginal: true });
  assert.equal(outcome.changed.length, 2);
  assert.equal(outcome.deletion.status, 'kept');
  assert.match(outcome.deletion.message, /public site may still use/);
  assert.ok(files.has(source));
  assert.deepEqual(deletions, []);
});

test('the publisher completing deletes the original even after the organizer leaves', async () => {
  const { db, replace, call, files, deletions, finishPublication } = fixture({
    env: { EVENT_SITE_PUBLISHER_JOB: 'site-publisher', EVENT_FIREBASE_PROJECT_ID: 'fixture' },
    fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('metadata.google.internal')
      ? { access_token: 'fixture-token' }
      : { metadata: { name: 'fixture-execution' } } }),
  });
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
