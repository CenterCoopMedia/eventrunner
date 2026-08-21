'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../../functions/src/cms/firestoreFake.cjs');
const store = require('../../functions/src/cms/store.cjs');
const { writeConfigDocs, seedCollection, countSeeded, readConfig } = require('./write.cjs');
const { defaultPages, buildSeedContent } = require('./seed.cjs');
const { buildConfigDocs } = require('./answers.cjs');

const TIER_A = { publicUrl: 'https://example.org', emailProvider: 'console', ticketingProvider: 'none' };

function docs() {
  const built = buildConfigDocs({
    answers: {
      adminEmails: ['ops@example.org'],
      event: {
        name: 'Test Gathering',
        shortName: 'TEST',
        timezone: 'UTC',
        sender: { email: 'hello@example.org' },
        legal: { operatorName: 'Test Operator', supportEmail: 'support@example.org' },
      },
    },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.equal(built.ok, true, built.errors.join('; '));
  return built.docs;
}

const now = () => 1_700_000_000_000;

test('seeding writes a published live doc AND a clean draft, like an admin save + publish', async () => {
  const db = makeFakeDb();
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));
  const result = await seedCollection({ db, store, collection: 'cmsPages', docs: pages, now });

  assert.equal(result.created.length, pages.length);
  const live = await db.collection('cmsPages').doc('home').get();
  const draft = await db.collection('cmsPages_drafts').doc('home').get();
  assert.equal(live.exists, true);
  assert.equal(live.data().revision, 1);
  assert.equal(live.data().seeded, true);
  assert.equal(draft.data().status, 'clean', 'a seeded page must not show up as unpublished work');
});

test('re-running is a no-op for untouched seeds and never clobbers an edited doc', async () => {
  const db = makeFakeDb();
  const config = docs();
  const content = buildSeedContent({ pages: defaultPages(), docs: config, tierA: TIER_A, seededAt: 'T0' });
  await seedCollection({ db, store, collection: 'cmsContent', docs: content, now });

  // A client edits one block: the CMS clears the seeded flag on edit (§5.4).
  await db.collection('cmsContent').doc('hero__subtitle').set({
    section: 'hero',
    field: 'subtitle',
    blockType: 'text',
    value: 'Our real subtitle',
    visible: true,
    order: 1,
    seeded: false,
    revision: 2,
  });

  const rerun = await seedCollection({ db, store, collection: 'cmsContent', docs: content, now });
  assert.equal(rerun.created.length, 0);
  assert.equal(rerun.refreshed.length, content.length - 1);
  assert.deepEqual(rerun.skipped.map((s) => s.id), ['hero__subtitle']);

  const edited = await db.collection('cmsContent').doc('hero__subtitle').get();
  assert.equal(edited.data().value, 'Our real subtitle');
});

test('--force still refuses to overwrite a client-edited doc', async () => {
  const db = makeFakeDb();
  await db.collection('cmsContent').doc('hero__title').set({ value: 'Client copy', seeded: false });
  const result = await seedCollection({
    db,
    store,
    collection: 'cmsContent',
    docs: [{ id: 'hero__title', section: 'hero', field: 'title', blockType: 'text', value: '[Replace] x', seeded: true }],
    now,
    force: true,
  });
  assert.deepEqual(result.skipped.map((s) => s.id), ['hero__title']);
  assert.equal((await db.collection('cmsContent').doc('hero__title').get()).data().value, 'Client copy');
});

test('a dry run reports every write and performs none', async () => {
  const db = makeFakeDb();
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));
  const result = await seedCollection({ db, store, collection: 'cmsPages', docs: pages, dryRun: true, now });
  assert.equal(result.created.length, pages.length);
  assert.equal((await db.collection('cmsPages').doc('home').get()).exists, false);
  assert.equal(db.writes.length, 0);
});

test('config docs are written once, then left alone until --force', async () => {
  const db = makeFakeDb();
  const config = docs();
  const first = await writeConfigDocs({ db, docs: config, now });
  assert.deepEqual(first.map((r) => r.action), ['create', 'create', 'create', 'create', 'create', 'create']);

  const second = await writeConfigDocs({ db, docs: config, now });
  assert.deepEqual(
    second.filter((r) => r.docId !== 'bootstrap').map((r) => r.action),
    ['skip', 'skip', 'skip', 'skip', 'skip'],
  );

  const loaded = await readConfig({ db });
  assert.equal(loaded.event.name, 'Test Gathering');
  assert.deepEqual(loaded.bootstrap.adminEmails, ['ops@example.org']);
});

test('re-running with a new --admin extends the list instead of replacing it', async () => {
  const db = makeFakeDb();
  const config = docs();
  await writeConfigDocs({ db, docs: config, now });
  await writeConfigDocs({
    db,
    docs: { ...config, bootstrap: { adminEmails: ['second@example.org'] } },
    now,
  });
  const loaded = await readConfig({ db });
  assert.deepEqual(loaded.bootstrap.adminEmails, ['ops@example.org', 'second@example.org']);
});

test('countSeeded counts the live seeded blocks the readiness table reports', async () => {
  const db = makeFakeDb();
  const config = docs();
  const content = buildSeedContent({ pages: defaultPages(), docs: config, tierA: TIER_A, seededAt: 'T0' });
  await seedCollection({ db, store, collection: 'cmsContent', docs: content, now });
  assert.equal(await countSeeded({ db }), content.length);
});
