'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../../functions/src/cms/firestoreFake.cjs');
const store = require('../../functions/src/cms/store.cjs');
const {
  writeConfigDocs, seedCollection, findPagePathCollisions, findPageSectionCollisions, countSeeded, readConfig,
  removeObsoleteSeeds, withholdUpgradeSeeds,
} = require('./write.cjs');
const {
  defaultPages, buildSeedContent, OBSOLETE_CONTENT_IDS, REPLACED_CONTENT_IDS,
} = require('./seed.cjs');
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

test('findPagePathCollisions finds nothing on a fresh project', async () => {
  const db = makeFakeDb();
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));
  const collisions = await findPagePathCollisions({ db, pages });
  assert.equal(collisions.size, 0);
});

test('findPagePathCollisions flags a seeded page whose path a DIFFERENT live doc id already owns', async () => {
  const db = makeFakeDb();
  await db.collection('cmsPages').doc('about-us').set({
    label: 'About us', path: '/recap', icon: null, order: 99,
    visible: true, systemPage: false, sections: [], seeded: false,
  });
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));

  const collisions = await findPagePathCollisions({ db, pages });

  assert.equal(collisions.size, 1);
  assert.deepEqual(collisions.get('recap'), { path: '/recap', ownerId: 'about-us' });
});

test('findPagePathCollisions also reads the draft revision — an unpublished path claim still collides', async () => {
  const db = makeFakeDb();
  await db.collection('cmsPages_drafts').doc('speaker-notes').set({
    label: 'Speaker notes', path: '/guidelines', icon: null, order: 50,
    visible: true, systemPage: false, sections: [], status: 'dirty',
  });
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));

  const collisions = await findPagePathCollisions({ db, pages });

  assert.equal(collisions.size, 1);
  assert.deepEqual(collisions.get('guidelines'), { path: '/guidelines', ownerId: 'speaker-notes' });
});

test('findPagePathCollisions does not flag a page reclaiming its own path', async () => {
  const db = makeFakeDb();
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));
  // A normal re-run: the seeded page's own prior live doc already sits at
  // its own path under its own id — that is a refresh, not a collision.
  await seedCollection({ db, store, collection: 'cmsPages', docs: pages, now });

  const collisions = await findPagePathCollisions({ db, pages });
  assert.equal(collisions.size, 0);
});

test('findPageSectionCollisions finds nothing on a fresh project', async () => {
  const db = makeFakeDb();
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));
  const collisions = await findPageSectionCollisions({ db, pages });
  assert.equal(collisions.size, 0);
});

test('findPageSectionCollisions does not flag a page reclaiming its own sections', async () => {
  const db = makeFakeDb();
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));
  // A normal re-run: the seeded page's own prior live doc already lists
  // its own section ids as its own — that is a refresh, not a collision.
  await seedCollection({ db, store, collection: 'cmsPages', docs: pages, now });

  const collisions = await findPageSectionCollisions({ db, pages });
  assert.equal(collisions.size, 0);
});

test('findPageSectionCollisions flags a page whose section id a DIFFERENT live page already lists as its own', async () => {
  // A client-created page (or one reassigned by an operator) that happens
  // to reuse the exact section id a newly-added seeded page wants —
  // 'city_guide_eat' here, chosen at random from a client's own page.
  const db = makeFakeDb();
  await db.collection('cmsPages').doc('neighborhood-picks').set({
    label: 'Neighborhood picks', path: '/neighborhood-picks', icon: null, order: 99,
    visible: true, systemPage: false,
    sections: [{ id: 'city_guide_eat', label: 'Where we eat', description: '', allowedBlocks: ['richtext'], maxBlocks: 5, reorderable: true, defaultBlocks: [] }],
    seeded: false,
  });
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));

  const collisions = await findPageSectionCollisions({ db, pages });

  assert.equal(collisions.size, 1);
  assert.deepEqual(collisions.get('city_guide'), { sectionId: 'city_guide_eat', ownerId: 'neighborhood-picks' });
});

test('findPageSectionCollisions also reads the draft revision — an unpublished section claim still collides', async () => {
  const db = makeFakeDb();
  await db.collection('cmsPages_drafts').doc('food-list').set({
    label: 'Food list', path: '/food-list', icon: null, order: 50,
    visible: true, systemPage: false,
    sections: [{ id: 'city_guide_see', label: 'Sights', description: '', allowedBlocks: ['richtext'], maxBlocks: 5, reorderable: true, defaultBlocks: [] }],
    status: 'dirty',
  });
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));

  const collisions = await findPageSectionCollisions({ db, pages });

  assert.equal(collisions.size, 1);
  assert.deepEqual(collisions.get('city_guide'), { sectionId: 'city_guide_see', ownerId: 'food-list' });
});

test('findPageSectionCollisions flags a section id orphaned by a deleted page — content with no current owner', async () => {
  // cmsDeletePage removes the page document, not the cmsContent filed
  // under its sections — a doc can be sitting there, ownerless, under a
  // section id a newly-added seeded page also wants.
  const db = makeFakeDb();
  await db.collection('cmsContent').doc('city_guide_around__note').set({
    section: 'city_guide_around', field: 'note', blockType: 'richtext',
    value: '<p>Left over from a page that no longer exists.</p>', visible: true, order: 0, seeded: false,
  });
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));

  const collisions = await findPageSectionCollisions({ db, pages });

  assert.equal(collisions.size, 1);
  assert.deepEqual(collisions.get('city_guide'), { sectionId: 'city_guide_around' });
});

test('findPageSectionCollisions treats orphaned draft-only content the same way', async () => {
  const db = makeFakeDb();
  await db.collection('cmsContent_drafts').doc('city_guide_intro__welcome').set({
    section: 'city_guide_intro', field: 'welcome', blockType: 'richtext',
    value: '<p>An unpublished edit to a page that was since deleted.</p>', status: 'dirty',
  });
  const pages = defaultPages().map((p) => ({ ...p, seeded: true }));

  const collisions = await findPageSectionCollisions({ db, pages });

  assert.equal(collisions.size, 1);
  assert.deepEqual(collisions.get('city_guide'), { sectionId: 'city_guide_intro' });
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

test('an unpublished editor draft is protected, even while the live doc still looks seeded', async () => {
  // The two-revision model (§8.4) means unpublished work exists ONLY in
  // the draft: the live doc still carries seeded: true. Deciding on the
  // live flag alone would overwrite the draft and then publish the
  // placeholder over it.
  const db = makeFakeDb();
  const content = [{
    id: 'hero__subtitle', section: 'hero', field: 'subtitle', blockType: 'text',
    value: '[Replace] One warm supporting sentence.', visible: true, order: 1, seeded: true,
  }];
  await seedCollection({ db, store, collection: 'cmsContent', docs: content, now });

  // An editor rewrites it and has not published yet.
  await store.writeDraft({
    db,
    collection: 'cmsContent',
    docId: 'hero__subtitle',
    fields: { section: 'hero', field: 'subtitle', blockType: 'text', value: 'Our unpublished copy', seeded: false },
    visible: true,
    actor: { uid: 'editor', email: 'editor@example.org' },
    now,
  });

  const rerun = await seedCollection({ db, store, collection: 'cmsContent', docs: content, now, force: true });
  assert.deepEqual(rerun.skipped.map((s) => s.id), ['hero__subtitle']);
  assert.match(rerun.skipped[0].reason, /draft/);
  const draft = await db.collection('cmsContent_drafts').doc('hero__subtitle').get();
  assert.equal(draft.data().value, 'Our unpublished copy');
  assert.equal(draft.data().status, 'dirty', 'the editor work is still theirs to publish');
});

test('a draft that is still the seeded one does not block a refresh', async () => {
  const db = makeFakeDb();
  const content = [{
    id: 'hero__subtitle', section: 'hero', field: 'subtitle', blockType: 'text',
    value: '[Replace] first wording', visible: true, order: 1, seeded: true,
  }];
  await seedCollection({ db, store, collection: 'cmsContent', docs: content, now });
  const updated = [{ ...content[0], value: '[Replace] corrected wording' }];
  const rerun = await seedCollection({ db, store, collection: 'cmsContent', docs: updated, now });
  assert.deepEqual(rerun.refreshed, ['hero__subtitle']);
  assert.equal(
    (await db.collection('cmsContent').doc('hero__subtitle').get()).data().value,
    '[Replace] corrected wording',
  );
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
  const { results: first } = await writeConfigDocs({ db, docs: config, now });
  assert.deepEqual(first.map((r) => r.action), ['create', 'create', 'create', 'create', 'create', 'create']);

  const { results: second } = await writeConfigDocs({ db, docs: config, now });
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

// REMOVING A SEED THE PLATFORM NO LONGER SHIPS (Codex review of the
// configured registration action: P1).
//
// `seedCollection` only ever writes. Dropping a block from `defaultPages()`
// therefore changes nothing on a deployment that was already initialized:
// the document the old seed wrote is still live, still published, and still
// drawing the control the release removed. Removing it is the same
// ownership question every other seed write asks, so it asks it with the
// same function — `decideSeedWrite` — and a document a human has touched is
// not the platform's to delete.

/** The legacy hero cta doc, as the removed seed wrote it. */
function legacyCta(overrides = {}) {
  return {
    section: 'hero',
    field: 'register_cta',
    blockType: 'cta',
    label: 'Register',
    url: 'https://example.org',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: 'T0',
    ...overrides,
  };
}

test('removeObsoleteSeeds deletes a still-seeded legacy doc from BOTH revisions', async () => {
  const db = makeFakeDb();
  await seedCollection({
    db, store, collection: 'cmsContent', docs: [{ id: 'hero__register_cta', ...legacyCta() }], now,
  });
  assert.equal((await db.collection('cmsContent').doc('hero__register_cta').get()).exists, true);
  assert.equal((await db.collection('cmsContent_drafts').doc('hero__register_cta').get()).exists, true);

  const result = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', docIds: OBSOLETE_CONTENT_IDS,
  });

  assert.deepEqual(result.removed, ['hero__register_cta']);
  assert.deepEqual(result.kept, []);
  assert.equal((await db.collection('cmsContent').doc('hero__register_cta').get()).exists, false);
  assert.equal(
    (await db.collection('cmsContent_drafts').doc('hero__register_cta').get()).exists,
    false,
    'the draft revision goes too, or the next publish restores the block',
  );
});

test('removeObsoleteSeeds leaves an editor-authored doc at the same id alone', async () => {
  // Nothing stops an editor from adding their own cta block to the hero
  // section — the release removed the seeded block, not the slot — and an
  // editor-authored one lands at exactly this id.
  const db = makeFakeDb();
  await db.collection('cmsContent').doc('hero__register_cta').set(
    legacyCta({ label: 'Get a ticket', url: 'https://tickets.example.org', seeded: false }),
  );

  const result = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', docIds: OBSOLETE_CONTENT_IDS,
  });

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.id), ['hero__register_cta']);
  const kept = await db.collection('cmsContent').doc('hero__register_cta').get();
  assert.equal(kept.exists, true);
  assert.equal(kept.data().label, 'Get a ticket');
});

test('removeObsoleteSeeds leaves a seeded doc an editor has rewritten but not published alone', async () => {
  const db = makeFakeDb();
  await seedCollection({
    db, store, collection: 'cmsContent', docs: [{ id: 'hero__register_cta', ...legacyCta() }], now,
  });
  // The live doc still looks seeded; the editor's work exists only in the
  // draft (§8.4), which is exactly the case a live-flag-only check misses.
  await store.writeDraft({
    db,
    collection: 'cmsContent',
    docId: 'hero__register_cta',
    fields: legacyCta({ label: 'Get a ticket', url: 'https://tickets.example.org', seeded: false }),
    visible: true,
    actor: { uid: 'editor', email: 'editor@example.org' },
    now,
  });

  const result = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', docIds: OBSOLETE_CONTENT_IDS,
  });

  assert.deepEqual(result.removed, []);
  assert.equal(result.kept[0].reason, 'unpublished editor draft');
  assert.equal((await db.collection('cmsContent').doc('hero__register_cta').get()).exists, true);
  assert.equal(
    (await db.collection('cmsContent_drafts').doc('hero__register_cta').get()).data().label,
    'Get a ticket',
  );
});

test('removeObsoleteSeeds is a no-op on a site that never had the document', async () => {
  const db = makeFakeDb();
  const result = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', docIds: OBSOLETE_CONTENT_IDS,
  });
  assert.deepEqual(result, { removed: [], kept: [] });
});

test('removeObsoleteSeeds under --dry-run reports without deleting', async () => {
  const db = makeFakeDb();
  await seedCollection({
    db, store, collection: 'cmsContent', docs: [{ id: 'hero__register_cta', ...legacyCta() }], now,
  });

  const result = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', docIds: OBSOLETE_CONTENT_IDS, dryRun: true,
  });

  assert.deepEqual(result.removed, ['hero__register_cta']);
  assert.equal((await db.collection('cmsContent').doc('hero__register_cta').get()).exists, true);
});

// ------------------------------------------------------- the two tiers (#187 review)

test('a re-run does not re-apply the answers file\u2019s lists: an address removed in the admin stays removed', async () => {
  const db = makeFakeDb();
  const config = docs();
  await writeConfigDocs({ db, docs: config, now });
  // An operator removed the seeded address on the Access page and granted another.
  await db.collection('config').doc('bootstrap').set({ adminEmails: ['kept@example.org'], staffEmails: ['desk@example.org'] });

  const { results } = await writeConfigDocs({
    db, docs: config, now, bootstrapAdditions: { adminEmails: [], staffEmails: [] },
  });
  const row = results.find((r) => r.docId === 'bootstrap');
  assert.equal(row.action, 'skip');
  assert.deepEqual(row.added, { adminEmails: [], staffEmails: [] });
  const loaded = await readConfig({ db });
  assert.deepEqual(loaded.bootstrap.adminEmails, ['kept@example.org']);
  assert.deepEqual(loaded.bootstrap.staffEmails, ['desk@example.org']);
});

test('on a re-run only the explicit flags add, and the result names what was added', async () => {
  const db = makeFakeDb();
  const config = docs();
  await writeConfigDocs({ db, docs: config, now });
  const { results } = await writeConfigDocs({
    db, docs: config, now,
    bootstrapAdditions: { adminEmails: ['Second@Example.org'], staffEmails: ['desk@example.org', 'ops@example.org'] },
  });
  const row = results.find((r) => r.docId === 'bootstrap');
  assert.equal(row.action, 'overwrite');
  // ops@ is already an operator, so it is not "added" as staff either.
  assert.deepEqual(row.added, { adminEmails: ['second@example.org'], staffEmails: ['desk@example.org'] });
  const loaded = await readConfig({ db });
  assert.deepEqual(loaded.bootstrap.adminEmails, ['ops@example.org', 'second@example.org']);
  assert.deepEqual(loaded.bootstrap.staffEmails, ['desk@example.org']);
});

test('a fresh deployment still seeds bootstrap from the answers file, additions or not', async () => {
  const db = makeFakeDb();
  await writeConfigDocs({ db, docs: docs(), now, bootstrapAdditions: { adminEmails: [], staffEmails: [] } });
  const loaded = await readConfig({ db });
  assert.deepEqual(loaded.bootstrap.adminEmails, ['ops@example.org']);
});

// THE #234 UPGRADE PATH (adversarial review of the 2026-09-10 wave). The
// base release seeded the venue as two labelled lines under the dates card,
// `info__where_venue` and `info__where_address`, as placeholders nothing
// filled; this release seeds one `info__where` fact in their place and a new
// `info__who` placeholder. A launched site has typed its venue into the two
// lines, so they are the client's, and a re-run must neither state the venue
// twice nor publish a fresh "[Replace]" line onto its home page.

/** The base release's key facts section, as init wrote it: every block the seed's. */
function baseReleaseKeyFacts() {
  const seed = { visible: true, seeded: true, seededAt: 'T0' };
  const line = (field, text, order) => ({
    id: `info__${field}`, section: 'info', field, blockType: 'list_item', text, order, ...seed,
  });
  return [
    {
      id: 'info__when', section: 'info', field: 'when', blockType: 'stat', order: 0, ...seed,
      value: '[Replace] When the event runs.', label: 'When',
    },
    line('where_venue', '[Replace] The venue’s name, labelled.', 1),
    line('where_address', '[Replace] The venue’s street address, labelled.', 2),
    line('where_transit', '[Replace] The nearest transit to the venue, labelled.', 3),
  ];
}

/** This release's seed for the key facts section alone. */
function keyFactsSeed(config) {
  return buildSeedContent({ pages: defaultPages(), docs: config, tierA: TIER_A, seededAt: 'T1' })
    .filter((doc) => doc.section === 'info');
}

/** One init re-run over the key facts: withhold, seed, then remove the obsolete. */
async function upgradeKeyFacts(db, config) {
  const upgrade = await withholdUpgradeSeeds({
    db, collection: 'cmsContent', docs: keyFactsSeed(config), replacedBy: REPLACED_CONTENT_IDS,
  });
  const seeded = await seedCollection({ db, store, collection: 'cmsContent', docs: upgrade.docs, now });
  const protectedIds = new Set(upgrade.protected);
  const obsolete = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', docIds: OBSOLETE_CONTENT_IDS.filter((id) => !protectedIds.has(id)),
  });
  return { upgrade, seeded, obsolete };
}

const liveIds = async (db) => (await db.collection('cmsContent').where('section', '==', 'info').get())
  .docs.map((doc) => doc.id).sort();

test('upgrading a site whose venue lines are still the seed’s replaces them with the fact, cleanly', async () => {
  const db = makeFakeDb();
  const config = docs();
  await seedCollection({ db, store, collection: 'cmsContent', docs: baseReleaseKeyFacts(), now });

  const { upgrade, seeded, obsolete } = await upgradeKeyFacts(db, config);

  assert.deepEqual(upgrade.withheld, [], 'nothing is the client’s, so nothing is withheld');
  assert.deepEqual(upgrade.protected, []);
  assert.deepEqual(seeded.created.sort(), ['info__where', 'info__who']);
  assert.deepEqual(seeded.refreshed.sort(), ['info__when', 'info__where_transit']);
  assert.deepEqual(obsolete.removed.sort(), ['info__where_address', 'info__where_venue']);
  assert.deepEqual(await liveIds(db), ['info__when', 'info__where', 'info__where_transit', 'info__who']);
  // The stat became the fact, because it was still the seed's.
  assert.equal((await db.collection('cmsContent').doc('info__when').get()).data().blockType, 'fact');
  // The fact is seeded from configuration: the venue's name, or the
  // instruction to state it where the test config names none.
  assert.equal(
    (await db.collection('cmsContent').doc('info__where').get()).data().value,
    config.event.venue?.name || '[Replace] The venue’s name.',
  );
});

test('upgrading a launched site keeps the client’s venue lines and creates neither the duplicate fact nor a new placeholder', async () => {
  const db = makeFakeDb();
  const config = docs();
  await seedCollection({ db, store, collection: 'cmsContent', docs: baseReleaseKeyFacts(), now });
  // The client filled the venue line and published it, so the CMS cleared
  // its seeded flag (§5.4); the address line beside it is still the seed's.
  await db.collection('cmsContent').doc('info__where_venue').set({
    section: 'info', field: 'where_venue', blockType: 'list_item', text: 'Venue: Test Hall',
    visible: true, order: 1, seeded: false, revision: 2,
  });

  const { upgrade, seeded, obsolete } = await upgradeKeyFacts(db, config);

  // The replacement waits, and it says which predecessor it is waiting on.
  assert.deepEqual(upgrade.withheld.map((w) => w.id).sort(), ['info__where', 'info__who']);
  assert.match(upgrade.withheld.find((w) => w.id === 'info__where').reason, /info__where_venue/);
  assert.match(upgrade.withheld.find((w) => w.id === 'info__who').reason, /placeholder/);
  assert.equal(seeded.created.length, 0, 'nothing new lands on a launched home page');
  // The still-seeded address line is protected too: it is the address the
  // withheld fact would have carried, and it stays beside the client's line.
  assert.deepEqual(upgrade.protected.sort(), ['info__where_address', 'info__where_venue']);
  assert.deepEqual(obsolete.removed, []);
  assert.deepEqual(await liveIds(db), ['info__when', 'info__where_address', 'info__where_transit', 'info__where_venue']);
  assert.equal(
    (await db.collection('cmsContent').doc('info__where_venue').get()).data().text,
    'Venue: Test Hall',
  );
  assert.equal((await db.collection('cmsContent').doc('info__where').get()).exists, false, 'the venue is stated once');
  assert.equal((await db.collection('cmsContent_drafts').doc('info__who').get()).exists, false, 'no draft either');
});

test('withholdUpgradeSeeds reads the draft revision: an unpublished edit to a predecessor protects it', async () => {
  const db = makeFakeDb();
  const config = docs();
  await seedCollection({ db, store, collection: 'cmsContent', docs: baseReleaseKeyFacts(), now });
  await store.writeDraft({
    db, collection: 'cmsContent', docId: 'info__where_address', visible: true, now,
    fields: { section: 'info', field: 'where_address', blockType: 'list_item', text: 'Address: 1 Test Way', seeded: false },
    actor: { uid: 'editor', email: 'editor@example.org' },
  });

  const { upgrade } = await withholdUpgradeSeeds({
    db, collection: 'cmsContent', docs: keyFactsSeed(config), replacedBy: REPLACED_CONTENT_IDS,
  }).then((upgrade) => ({ upgrade }));

  assert.match(upgrade.withheld.find((w) => w.id === 'info__where').reason, /info__where_address/);
  assert.ok(upgrade.withheld.some((w) => w.id === 'info__who'), 'the section has an editor’s draft, so no placeholder');
});

test('withholdUpgradeSeeds passes a document the site already holds straight through', async () => {
  // Existing documents are seedCollection's to refresh or skip under the
  // ownership rule it has always applied; this rule is for what is new.
  const db = makeFakeDb();
  const config = docs();
  await seedCollection({ db, store, collection: 'cmsContent', docs: keyFactsSeed(config), now });
  await db.collection('cmsContent').doc('info__who').set({
    section: 'info', field: 'who', blockType: 'fact', label: 'Who', value: 'Local newsroom staff',
    visible: true, order: 3, seeded: false, revision: 2,
  });
  const upgrade = await withholdUpgradeSeeds({
    db, collection: 'cmsContent', docs: keyFactsSeed(config), replacedBy: REPLACED_CONTENT_IDS,
  });
  assert.deepEqual(upgrade.withheld, []);
  assert.equal(upgrade.docs.length, keyFactsSeed(config).length);
});

test('a fresh site gets every key fact, placeholder included', async () => {
  const db = makeFakeDb();
  const config = docs();
  const { upgrade, seeded } = await upgradeKeyFacts(db, config);
  assert.deepEqual(upgrade.withheld, []);
  assert.deepEqual(seeded.created.sort(), ['info__when', 'info__where', 'info__where_transit', 'info__who']);
});
