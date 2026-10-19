'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const organizationImport = require('./organizationImport.cjs');
const { internals: { importKeyId } } = require('./recordImport.cjs');
const {
  FORBIDDEN_COLLECTIONS,
  makeDb,
  previewAndCommit,
  writtenCollections,
} = require('./importTestKit.cjs');

const MAPPING = {
  externalId: 'Sponsor ID',
  name: 'Company',
  tier: 'Level',
  url: 'Website',
  description: 'Blurb',
  order: 'Sort',
};
const ROW = {
  'Sponsor ID': 'ORG-1',
  Company: 'Northwind Press',
  Level: 'Gold',
  Website: 'HTTPS://northwind.example.org/',
  Blurb: 'A press that funds fellowships.',
  Sort: '2',
};
const body = (rows, mapping = MAPPING) => ({ type: 'organizations', mapping, rows });

/* ---------------------------------------------------------------- */
/* Mapping                                                          */
/* ---------------------------------------------------------------- */

test('mappingError: needs the external id and the name', () => {
  assert.match(organizationImport.mappingError({ name: 'N' }), /^mapping\.externalId/);
  assert.match(organizationImport.mappingError({ externalId: 'ID' }), /^mapping\.name/);
  assert.equal(organizationImport.mappingError({ externalId: 'ID', name: 'N' }), null);
});

test('mapRow: a numeric order becomes a number, blank is none, anything else goes as typed', () => {
  const map = (Sort) => organizationImport.mapRow({ row: { ...ROW, Sort }, mapping: MAPPING }).input.values.order;
  assert.equal(map('3'), 3);
  assert.equal(map(''), null);
  assert.equal(map('first'), 'first');
});

/* ---------------------------------------------------------------- */
/* Create                                                           */
/* ---------------------------------------------------------------- */

test('a new organization is a hidden draft, with the editor’s canonical link and suggested address', async () => {
  const db = makeDb();
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  assert.equal(preview.body.rows[0].verdict, 'create');
  assert.equal(commit.body.rows[0].docId, 'northwind-press');

  const draft = db.read('cmsOrganizations_drafts', 'northwind-press');
  assert.equal(draft.visible, false);
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.name, 'Northwind Press');
  assert.equal(draft.tier, 'Gold');
  assert.equal(draft.url, 'https://northwind.example.org/');
  assert.equal(draft.order, 2);
  assert.equal(db.read('cmsOrganizations', 'northwind-press'), undefined);

  const written = writtenCollections(db);
  for (const forbidden of FORBIDDEN_COLLECTIONS) assert.ok(!written.includes(forbidden), forbidden);
});

test('the organization validator refuses a bad row; its message reaches the preview', async () => {
  const db = makeDb();
  const { preview } = await previewAndCommit(db, body([{ ...ROW, Website: 'javascript:alert(1)', Sort: 'first' }]));
  assert.equal(preview.body.rows[0].verdict, 'error');
  assert.deepEqual(preview.body.rows[0].reasons, [
    'order: must be a number',
    'url: must start with http:// or https://',
  ]);
});

test('an organization typed in the editor is matched by its address, not made twice', async () => {
  const db = makeDb({
    'cmsOrganizations/northwind-press': { name: 'Northwind Press', tier: 'Silver', visible: true, revision: 1 },
  });
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  for (const res of [preview, commit]) {
    assert.equal(res.body.rows[0].verdict, 'update');
    assert.equal(res.body.rows[0].matched, true);
  }
  assert.match(commit.body.rows[0].notes[0], /^Matches the existing organization "northwind-press" by its address/);
  assert.match(commit.body.rows[0].notes[1], /^tier: kept the value in the admin panel/);
  assert.equal(db.read('record_imports', importKeyId('organizations', 'ORG-1')).docId, 'northwind-press');
  const draft = db.read('cmsOrganizations_drafts', 'northwind-press');
  assert.equal(draft.tier, 'Silver', 'a value the record has is kept');
  assert.equal(draft.description, 'A press that funds fellowships.', 'an empty field is filled');
  assert.equal(draft.visible, true, 'the match keeps the visibility');
  assert.deepEqual(db.ids('cmsOrganizations_drafts'), ['northwind-press']);
});

test('an address another external ID imported, an earlier row, or a bad mapped one is a row error', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const { commit } = await previewAndCommit(db, body([{ ...ROW, 'Sponsor ID': 'ORG-9' }]));
  assert.equal(commit.body.rows[0].verdict, 'error');
  assert.match(commit.body.rows[0].reasons[0], /^slug: another organization already uses "northwind-press"\. An earlier import made it/);

  const twin = await previewAndCommit(makeDb(), body([ROW, { ...ROW, 'Sponsor ID': 'ORG-2' }]));
  assert.deepEqual(twin.commit.body.rows.map((r) => r.verdict), ['create', 'error']);
  assert.match(twin.commit.body.rows[1].reasons[0], /^slug: an earlier row of this file uses "northwind-press"/);

  const bad = await previewAndCommit(makeDb(), body([{ ...ROW, Slug: 'Not A Slug' }], { ...MAPPING, slug: 'Slug' }));
  assert.match(bad.commit.body.rows[0].reasons[0], /^slug: use lowercase letters/);
});

/* ---------------------------------------------------------------- */
/* Idempotency and reconciliation                                   */
/* ---------------------------------------------------------------- */

test('importing the same file again changes nothing and writes no draft', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const before = db.writes.length;
  const { commit } = await previewAndCommit(db, body([ROW]));
  assert.deepEqual(commit.body.summary, { create: 0, update: 0, unchanged: 1, error: 0 });
  assert.deepEqual(writtenCollections(db, before), ['admin_logs']);
});

test('a changed tier updates the draft only; a logo staff chose survives', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  await db.collection('cmsOrganizations_drafts').doc('northwind-press').set({ logoPath: 'media/logo.png', visible: true }, { merge: true });

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Level: 'Silver' }]));
  assert.equal(commit.body.rows[0].verdict, 'update');
  assert.deepEqual(commit.body.rows[0].changedFields, ['tier']);
  const draft = db.read('cmsOrganizations_drafts', 'northwind-press');
  assert.equal(draft.tier, 'Silver');
  assert.equal(draft.logoPath, 'media/logo.png');
  assert.equal(draft.visible, true);
  const { internals: { valueDigest } } = require('./recordImport.cjs');
  assert.equal(db.read('record_imports', importKeyId('organizations', 'ORG-1')).values.tier, valueDigest('Silver'));
});

test('a staff edit to a mapped field is kept when the file changes it too', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  await db.collection('cmsOrganizations_drafts').doc('northwind-press').set({ description: 'Edited by staff.' }, { merge: true });

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Blurb: 'New blurb from the source.' }]));
  assert.equal(commit.body.rows[0].verdict, 'unchanged');
  assert.match(commit.body.rows[0].notes[0], /^description: kept the value in the admin panel/);
  assert.equal(db.read('cmsOrganizations_drafts', 'northwind-press').description, 'Edited by staff.');
});
