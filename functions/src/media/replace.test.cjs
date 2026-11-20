'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCmsPublishHandler } = require('../cms/publish.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { scanReplacementUsage } = require('./usage.cjs');

const source = 'cms-images/old/old.png';
const target = 'cms-images/new/new.png';
const bucketName = 'fixture.appspot.com';
const hostedOld = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(source)}?alt=media`;
const requestId = '12d4b840-52b0-4af5-8f88-d40836151a48';
const operator = { uid: 'owner', email: 'owner@example.test', email_verified: true };
const staff = { uid: 'staff', email: 'staff@example.test', email_verified: true };

function fixture() {
  const image = { blockType: 'image', url: source, alt: 'Old description', caption: 'Old caption', focalX: 79 };
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: [operator.email], staffEmails: [staff.email] },
    'media_assets/old': { path: source, alt: 'Asset alt', credit: 'Original photographer' },
    'media_assets/new': { path: target, alt: 'Replacement alt', caption: 'Replacement caption', credit: 'Replacement photographer' },
    'cmsContent/hero__image': { ...image, section: 'hero', field: 'image', revision: 2, visible: true },
    'cmsContent_drafts/hero__image': { ...image, status: 'dirty', basedOnRevision: 2, focalX: 28 },
    'cmsContent/travel-arrival__photo': {
      ...image, section: 'travel-arrival', field: 'photo', revision: 4, visible: true,
      descriptionOverride: { assetId: 'old', caption: '', credit: '' },
    },
    'cmsContent_drafts/travel-arrival__photo': {
      ...image, url: 'cms-images/other/photo.png', status: 'dirty', basedOnRevision: 4,
      updatedBy: staff.email, updatedAt: '2026-11-19T19:00:00.000Z',
    },
    'cmsContent/travel-arrival__link': { blockType: 'cta', url: source, label: 'Keep this destination' },
    'cmsUpdates/arrival': { title: 'Arrival', featuredImage: { url: hostedOld, alt: 'Feature alt' },
      content: [{ type: 'image', image: { url: source, alt: 'Body alt' } }], revision: 1, visible: true },
    'cmsOrganizations/patron': { name: 'Patron', logoPath: source, tier: 'gold', revision: 1, visible: true },
    'config/theme': { logos: { primary: source, footer: 'branding/another.png' }, preset: 'zine' },
    'config/event': { venue: { map: { image: source, alt: 'The map', markers: [{ x: 44, y: 20 }] } } },
  });
  const handler = createCmsPublishHandler({
    db, auth: { verifyIdToken: async (token) => token === 'staff' ? staff : operator },
    getConfig: async () => ({}), getBucket: () => ({ name: bucketName, file: () => ({ exists: async () => [true] }) }),
    env: {}, log: { warn() {}, error() {} },
  });
  async function call(body, token = 'owner') {
    const response = { status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, response);
    return response;
  }
  return { db, call };
}

test('replacement usage finds actual image slots across revisions and leaves image links alone', async () => {
  const { db, call } = fixture();
  const refs = (await scanReplacementUsage({ db, paths: [source], bucket: bucketName }))[source];
  assert.deepEqual(refs.map(({ docPath, field }) => `${docPath}:${field}`).sort(), [
    'cmsContent/hero__image:url', 'cmsContent/travel-arrival__photo:url', 'cmsContent_drafts/hero__image:url',
    'cmsOrganizations/patron:logoPath', 'cmsUpdates/arrival:content.0.image.url', 'cmsUpdates/arrival:featuredImage.url',
    'config/event:venue.map.image', 'config/theme:logos.primary',
  ]);
  assert.equal(refs.find(({ docPath }) => docPath === 'cmsContent/travel-arrival__photo').label, 'travel-arrival · photo');
  const input = { assetId: 'old', replacementId: 'new', references: refs };
  assert.equal((await call({ requestId, mediaReplacement: input }, 'staff')).code, 403);
  const stale = await call({ requestId, mediaReplacement: { ...input, references: refs.slice(1) } });
  assert.equal(stale.code, 409);
  assert.equal(stale.body.error.code, 'usage-changed');
  assert.equal(db.writes.length, 0);
});

test('replacement resumes committed groups through the publish receipt without publishing unrelated edits', async (t) => {
  const { db, call } = fixture();
  const references = (await scanReplacementUsage({ db, paths: [source], bucket: bucketName }))[source];
  const input = { requestId, mediaReplacement: { assetId: 'old', replacementId: 'new', references } };
  const transaction = db.runTransaction.bind(db);
  let attempt = 0;
  t.mock.method(db, 'runTransaction', (callback) => {
    attempt += 1;
    if (attempt === 2) return Promise.reject(new Error('Commit unavailable'));
    return transaction(callback);
  });
  const partial = await call(input);
  assert.equal(partial.code, 200);
  assert.equal(partial.body.status, 'failed');
  assert.ok(partial.body.changed.length > 0);
  assert.ok(partial.body.failed.length > 0);
  const [partialLog] = db.ids('admin_logs');
  assert.equal(db.read('admin_logs', partialLog).action, 'mediaReplaceFailed');
  assert.equal(db.read('admin_logs', partialLog).docPath, `cmsPublishQueue/${requestId}`);
  const completedBefore = db.writes.filter(({ path }) => path === 'cmsContent/hero__image').length;
  assert.equal(completedBefore, 1);

  const resumed = await call({ queueId: requestId });
  assert.equal(resumed.code, 200);
  assert.equal(resumed.body.status, 'done');
  assert.equal(resumed.body.changed.length, references.length);
  assert.deepEqual(resumed.body.failed, []);
  assert.equal(resumed.body.publisher.status, 'skipped');
  assert.equal(db.writes.filter(({ path }) => path === 'cmsContent/hero__image').length, completedBefore);
  assert.equal(db.read('cmsContent', 'hero__image').revision, 3);
  assert.equal(db.read('cmsContent', 'hero__image').focalX, 79);
  assert.equal(db.read('cmsContent_drafts', 'hero__image').focalX, 28);
  assert.equal(db.read('cmsContent_drafts', 'hero__image').status, 'dirty');
  const photo = db.read('cmsContent', 'travel-arrival__photo');
  assert.deepEqual([photo.url, photo.alt, photo.caption, photo.descriptionOverride],
    [target, 'Replacement alt', undefined, undefined]);
  const untouchedDraft = db.read('cmsContent_drafts', 'travel-arrival__photo');
  assert.equal(untouchedDraft.basedOnRevision, 5);
  assert.equal(untouchedDraft.url, 'cms-images/other/photo.png');
  assert.equal(untouchedDraft.updatedBy, staff.email);
  assert.equal(untouchedDraft.updatedAt, '2026-11-19T19:00:00.000Z');
  assert.equal(db.read('cmsContent', 'travel-arrival__link').url, source);
  assert.equal(db.read('cmsUpdates', 'arrival').content[0].image.url, target);
  assert.equal(db.read('cmsUpdates', 'arrival').featuredImage.url, target);
  assert.equal(db.read('cmsOrganizations', 'patron').logoPath, target);
  assert.equal(db.read('config', 'theme').logos.primary, target);
  assert.equal(db.read('config', 'theme').logos.footer, 'branding/another.png');
  assert.ok(db.ids('cmsVersionHistory').some((id) => db.read('cmsVersionHistory', id).docPath === 'config/theme'));
  assert.deepEqual(db.read('config', 'event').venue.map.markers, [{ x: 44, y: 20 }]);
  assert.ok(db.read('media_assets', 'old'));
});

test('keeping descriptions retains authored text and pins the old inherited text, including blanks', async () => {
  const { db, call } = fixture();
  const references = (await scanReplacementUsage({ db, paths: [source], bucket: bucketName }))[source];
  const outcome = await call({ requestId, mediaReplacement: { assetId: 'old', replacementId: 'new', references, keepDescription: true } });
  assert.equal(outcome.body.status, 'done');
  const inherited = { assetId: 'new', caption: '', credit: 'Original photographer' };
  const { url, alt, caption, descriptionOverride } = db.read('cmsContent', 'hero__image');
  assert.deepEqual([url, alt, caption, descriptionOverride], [target, 'Old description', 'Old caption', inherited]);
  assert.deepEqual(db.read('cmsContent', 'travel-arrival__photo').descriptionOverride, { ...inherited, credit: '' });
  assert.deepEqual(db.read('cmsUpdates', 'arrival').featuredImage.descriptionOverride, { ...inherited, credit: '' });
  assert.deepEqual(db.read('cmsUpdates', 'arrival').content[0].image.descriptionOverride, inherited);
  assert.deepEqual(db.read('config', 'event').venue.map.descriptionOverride, inherited);
});

test('a placement that moved after confirmation is reported and cannot strand the run', async (t) => {
  const { db, call } = fixture();
  const references = (await scanReplacementUsage({ db, paths: [source], bucket: bucketName }))[source];
  const transaction = db.runTransaction.bind(db);
  t.mock.method(db, 'runTransaction', async (callback) => {
    if (db.read('cmsContent_drafts', 'hero__image').url === source) {
      await db.collection('cmsContent_drafts').doc('hero__image').update({ url: 'cms-images/third/third.png' });
    }
    return transaction(callback);
  });
  const result = await call({ requestId, mediaReplacement: { assetId: 'old', replacementId: 'new', references } });
  assert.equal(result.body.status, 'done');
  assert.equal(result.body.failed.length, 2);
  assert.match(result.body.failed[0].reason, /changed after the usage check/);
  assert.equal(db.read('cmsContent', 'hero__image').url, source);
  assert.equal(db.read('cmsContent_drafts', 'hero__image').url, 'cms-images/third/third.png');
  const writes = db.writes.length;
  const retry = await call({ queueId: requestId });
  assert.equal(retry.body.status, 'done');
  assert.deepEqual(retry.body.failed, result.body.failed);
  assert.equal(db.writes.length, writes);
});
