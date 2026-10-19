'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateImportRequest,
  requestDigest,
  reconcileFields,
  defaultImporters,
  internals,
} = require('./recordImport.cjs');
const {
  OPERATOR_EMAIL,
  STAFF_EMAIL,
  FORBIDDEN_COLLECTIONS,
  makeDb,
  callImport,
  previewAndCommit,
  writtenCollections,
} = require('./importTestKit.cjs');

const IMPORTERS = defaultImporters();
const SPEAKER_BODY = {
  type: 'speakers',
  mapping: { externalId: 'ID', name: 'Name', email: 'Email' },
  rows: [
    { ID: 'S-1', Name: 'Ada Lovelace', Email: 'ada@example.com' },
    { ID: 'S-2', Name: 'Grace Hopper', Email: 'grace@example.com' },
  ],
};

/* ---------------------------------------------------------------- */
/* Cells, ids and the request envelope                              */
/* ---------------------------------------------------------------- */

test('cell: trims text, keeps numbers as text, and caps the length', () => {
  assert.equal(internals.cell('  Ada  '), 'Ada');
  assert.equal(internals.cell(42), '42');
  assert.equal(internals.cell({ x: 1 }), '');
  assert.equal(internals.cell('x'.repeat(internals.MAX_CELL_LENGTH + 10)).length, internals.MAX_CELL_LENGTH);
  assert.equal(internals.cellOrNull('   '), null);
});

test('externalIdError: names a blank, an over-long, and a control-character id', () => {
  assert.equal(internals.externalIdError('S-1'), null);
  assert.equal(internals.externalIdError('row 12 / sheet 3'), null);
  assert.match(internals.externalIdError(''), /^externalId: /);
  assert.match(internals.externalIdError('x'.repeat(internals.MAX_EXTERNAL_ID_LENGTH + 1)), /characters or fewer/);
  assert.match(internals.externalIdError(`a${String.fromCharCode(9)}b`), /printable/);
});

test('importKeyId: one usable document id per type and external id', () => {
  const a = internals.importKeyId('speakers', 'S/1');
  assert.match(a, /^speakers__[0-9a-f]{40}$/);
  assert.notEqual(a, internals.importKeyId('sessions', 'S/1'));
  assert.equal(a, internals.importKeyId('speakers', 'S/1'));
});

test('validateImportRequest: refuses an unknown type, a missing mapping, and empty or oversized rows', () => {
  assert.match(validateImportRequest(null, IMPORTERS).message, /^body:/);
  assert.match(validateImportRequest({ ...SPEAKER_BODY, type: 'tickets' }, IMPORTERS).message, /^type: must be one of speakers, sessions, organizations/);
  assert.match(validateImportRequest({ ...SPEAKER_BODY, mapping: { name: 'Name' } }, IMPORTERS).message, /^mapping\.externalId/);
  assert.match(validateImportRequest({ ...SPEAKER_BODY, rows: [] }, IMPORTERS).message, /no data rows/);
  const many = Array.from({ length: internals.MAX_IMPORT_ROWS + 1 }, (_, i) => ({ ID: `S-${i}`, Name: 'A B' }));
  assert.match(validateImportRequest({ ...SPEAKER_BODY, rows: many }, IMPORTERS).message, /at most 500 rows/);
  const wide = Object.fromEntries(Array.from({ length: internals.MAX_COLUMNS + 1 }, (_, i) => [`c${i}`, 'x']));
  assert.match(validateImportRequest({ ...SPEAKER_BODY, rows: [wide] }, IMPORTERS).message, /at most 60 columns/);
});

test('validateImportRequest: drops mapping keys the type does not have, and a commit needs the digest', () => {
  const ok = validateImportRequest({ ...SPEAKER_BODY, mapping: { ...SPEAKER_BODY.mapping, status: 'Status' } }, IMPORTERS);
  assert.equal(ok.ok, true);
  assert.equal(ok.dryRun, true);
  assert.deepEqual(Object.keys(ok.mapping).sort(), ['email', 'externalId', 'name']);
  const commit = validateImportRequest({ ...SPEAKER_BODY, dryRun: false }, IMPORTERS);
  assert.equal(commit.ok, false);
  assert.match(commit.message, /^confirmDigest: preview the import first/);
});

test('requestDigest: the same file and mapping give one digest; a changed cell or mapping gives another', () => {
  const a = requestDigest(SPEAKER_BODY);
  assert.equal(a, requestDigest({ ...SPEAKER_BODY, mapping: { email: 'Email', name: 'Name', externalId: 'ID' } }));
  assert.notEqual(a, requestDigest({ ...SPEAKER_BODY, rows: [{ ...SPEAKER_BODY.rows[0], Name: 'Ada King' }, SPEAKER_BODY.rows[1]] }));
  assert.notEqual(a, requestDigest({ ...SPEAKER_BODY, mapping: { ...SPEAKER_BODY.mapping, email: 'Mail' } }));
});

/* ---------------------------------------------------------------- */
/* Three-way reconciliation                                         */
/* ---------------------------------------------------------------- */

test('reconcileFields: the file unchanged since the last import leaves even a staff-edited field alone', () => {
  const out = reconcileFields({
    incoming: { bio: 'From the file' },
    last: { bio: 'From the file' },
    current: { bio: 'Edited by staff' },
  });
  assert.deepEqual(out, { patch: {}, conflicts: [] });
});

test('reconcileFields: a new file value replaces a field staff did not touch', () => {
  const out = reconcileFields({
    incoming: { bio: 'New bio', jobTitle: 'Editor' },
    last: { bio: 'Old bio', jobTitle: 'Editor' },
    current: { bio: 'Old bio', jobTitle: 'Editor' },
  });
  assert.deepEqual(out, { patch: { bio: 'New bio' }, conflicts: [] });
});

test('reconcileFields: a new file value never replaces a field staff changed; it is a conflict', () => {
  const out = reconcileFields({
    incoming: { bio: 'New bio' },
    last: { bio: 'Old bio' },
    current: { bio: 'Edited by staff' },
  });
  assert.deepEqual(out, { patch: {}, conflicts: ['bio'] });
});

test('reconcileFields: a newly mapped field fills a blank, and is a conflict over a stored value', () => {
  assert.deepEqual(
    reconcileFields({ incoming: { jobTitle: 'Editor' }, last: {}, current: { jobTitle: '' } }),
    { patch: { jobTitle: 'Editor' }, conflicts: [] },
  );
  assert.deepEqual(
    reconcileFields({ incoming: { jobTitle: 'Editor' }, last: {}, current: { jobTitle: 'Producer' } }),
    { patch: {}, conflicts: ['jobTitle'] },
  );
});

test('reconcileFields: blank, null and absent are one value; arrays compare by content', () => {
  assert.deepEqual(reconcileFields({ incoming: { tier: null }, last: { tier: '' }, current: {} }), { patch: {}, conflicts: [] });
  assert.deepEqual(
    reconcileFields({ incoming: { speakerIds: ['a', 'b'] }, last: { speakerIds: ['a'] }, current: { speakerIds: ['a'] } }),
    { patch: { speakerIds: ['a', 'b'] }, conflicts: [] },
  );
});

/* ---------------------------------------------------------------- */
/* importRecordsCsv: the gate                                       */
/* ---------------------------------------------------------------- */

test('importRecordsCsv: no token is a 401 and nothing is read or written', async () => {
  const db = makeDb();
  const res = await callImport(db, SPEAKER_BODY, { email: null });
  assert.equal(res.statusCode, 401);
  assert.equal(db.writes.length, 0);
});

test('importRecordsCsv: an account on neither admin list is a 403', async () => {
  const db = makeDb();
  const res = await callImport(db, SPEAKER_BODY, { email: 'stranger@example.com' });
  assert.equal(res.statusCode, 403);
  assert.equal(db.writes.length, 0);
});

test('importRecordsCsv: GET is a 405', async () => {
  const db = makeDb();
  const res = await callImport(db, SPEAKER_BODY, { method: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('importRecordsCsv: staff and operators both reach it (the editors’ tier)', async () => {
  for (const email of [STAFF_EMAIL, OPERATOR_EMAIL]) {
    const res = await callImport(makeDb(), SPEAKER_BODY, { email });
    assert.equal(res.statusCode, 200, email);
  }
});

test('importRecordsCsv: a bad envelope is a 400 that names the field', async () => {
  const res = await callImport(makeDb(), { ...SPEAKER_BODY, mapping: {} });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^mapping\.externalId/);
});

/* ---------------------------------------------------------------- */
/* importRecordsCsv: preview, confirm, audit                        */
/* ---------------------------------------------------------------- */

test('importRecordsCsv: a preview lists each row and writes nothing', async () => {
  const db = makeDb();
  const res = await callImport(db, SPEAKER_BODY);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dryRun, true);
  assert.deepEqual(res.body.summary, { create: 2, update: 0, unchanged: 0, error: 0 });
  assert.deepEqual(res.body.rows.map((r) => [r.index, r.verdict, r.externalId, r.label]), [
    [0, 'create', 'S-1', 'Ada Lovelace'],
    [1, 'create', 'S-2', 'Grace Hopper'],
  ]);
  assert.match(res.body.digest, /^[0-9a-f]{64}$/);
  assert.equal(db.writes.length, 0);
});

test('importRecordsCsv: a commit without the preview digest, or with another file’s, writes nothing', async () => {
  const db = makeDb();
  const missing = await callImport(db, { ...SPEAKER_BODY, dryRun: false });
  assert.equal(missing.statusCode, 400);
  const other = await callImport(db, { ...SPEAKER_BODY, dryRun: false, confirmDigest: 'f'.repeat(64) });
  assert.equal(other.statusCode, 409);
  assert.equal(other.body.error.code, 'preview-mismatch');
  assert.equal(db.writes.length, 0);
});

test('importRecordsCsv: a commit writes one admin_logs row with the counts, and no mail or invitation', async () => {
  const db = makeDb();
  const { commit } = await previewAndCommit(db, SPEAKER_BODY);
  assert.equal(commit.statusCode, 200);
  assert.deepEqual(commit.body.summary, { create: 2, update: 0, unchanged: 0, error: 0 });

  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'records-import');
  assert.equal(logs[0].docPath, 'speakers');
  assert.equal(logs[0].email, STAFF_EMAIL);
  assert.deepEqual(logs[0].details, { type: 'speakers', rows: 2, create: 2, update: 0, unchanged: 0, error: 0 });

  const written = writtenCollections(db);
  assert.deepEqual(written, ['admin_logs', 'record_imports', 'speaker_slugs', 'speakers']);
  for (const forbidden of FORBIDDEN_COLLECTIONS) assert.ok(!written.includes(forbidden), forbidden);
});

test('importRecordsCsv: the same id twice in one file is an error on the second row', async () => {
  const db = makeDb();
  const body = { ...SPEAKER_BODY, rows: [SPEAKER_BODY.rows[0], { ...SPEAKER_BODY.rows[1], ID: 'S-1' }] };
  const { commit } = await previewAndCommit(db, body);
  assert.equal(commit.body.rows[1].verdict, 'error');
  assert.deepEqual(commit.body.rows[1].reasons, ['externalId: the same ID is on row 1']);
  assert.equal(db.ids('speakers').length, 1);
});

test('importRecordsCsv: a row that fails does not stop the rows after it', async () => {
  const db = makeDb();
  const body = { ...SPEAKER_BODY, rows: [{ ID: '', Name: 'No Id' }, ...SPEAKER_BODY.rows] };
  const { commit } = await previewAndCommit(db, body);
  assert.deepEqual(commit.body.summary, { create: 2, update: 0, unchanged: 0, error: 1 });
  assert.match(commit.body.rows[0].reasons[0], /^externalId:/);
});
