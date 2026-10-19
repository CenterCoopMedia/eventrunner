'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const speakerImport = require('./speakerImport.cjs');
const { internals: { importKeyId } } = require('./recordImport.cjs');
const {
  FORBIDDEN_COLLECTIONS,
  makeDb,
  previewAndCommit,
  writtenCollections,
} = require('./importTestKit.cjs');

const MAPPING = {
  externalId: 'Speaker ID',
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  organization: 'Org',
  jobTitle: 'Title',
  bio: 'Bio',
};
const ROW = {
  'Speaker ID': 'SPK-1',
  First: 'Ada',
  Last: 'Lovelace',
  Email: 'Ada@Example.com',
  Org: 'Analytical Engines',
  Title: 'Editor',
  Bio: 'Writes about engines.',
  Unmapped: 'ignored',
};
const body = (rows, mapping = MAPPING) => ({ type: 'speakers', mapping, rows });

function speakerByExternalId(db, externalId) {
  const key = db.read('record_imports', importKeyId('speakers', externalId));
  return key ? { id: key.docId, ...db.read('speakers', key.docId) } : null;
}

/* ---------------------------------------------------------------- */
/* Mapping                                                          */
/* ---------------------------------------------------------------- */

test('mappingError: needs the external id and either both name columns or a full name', () => {
  assert.match(speakerImport.mappingError({ firstName: 'F', lastName: 'L' }), /^mapping\.externalId/);
  assert.match(speakerImport.mappingError({ externalId: 'ID', firstName: 'F' }), /^mapping\.firstName/);
  assert.equal(speakerImport.mappingError({ externalId: 'ID', name: 'Name' }), null);
  assert.equal(speakerImport.mappingError({ externalId: 'ID', firstName: 'F', lastName: 'L' }), null);
});

test('mapRow: a full name splits on the first space; unmapped columns are not read', () => {
  const mapped = speakerImport.mapRow({
    row: { ID: 'x1', Name: 'Grace Brewster Hopper', Secret: 'no' },
    mapping: { externalId: 'ID', name: 'Name' },
  });
  assert.deepEqual(mapped, { ok: true, externalId: 'x1', input: { firstName: 'Grace', lastName: 'Brewster Hopper' } });
});

/* ---------------------------------------------------------------- */
/* Create                                                           */
/* ---------------------------------------------------------------- */

test('a new speaker is a draft record with no public projection, made by the shared validator', async () => {
  const db = makeDb();
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  assert.equal(preview.body.rows[0].verdict, 'create');
  assert.equal(commit.body.rows[0].verdict, 'create');

  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.status, 'draft');
  assert.equal(speaker.slug, 'ada-lovelace');
  assert.equal(speaker.email, 'ada@example.com', 'the validator lowercases the address');
  assert.equal(speaker.uid, null);
  assert.equal(speaker.inviteToken, null);
  assert.equal(speaker.approvedAt, null);
  assert.equal(speaker.updatedBy, 'staff@example.com');
  assert.equal(Object.hasOwn(speaker, 'Unmapped'), false);
  assert.deepEqual(db.read('speaker_slugs', 'ada-lovelace'), { speakerId: speaker.id, updatedAt: speaker.createdAt });
  assert.deepEqual(db.ids('speakers_public'), []);
});

test('no import writes mail, an invitation, or an account link', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const written = writtenCollections(db);
  for (const forbidden of FORBIDDEN_COLLECTIONS) assert.ok(!written.includes(forbidden), forbidden);
});

test('a field the shared validator refuses is a row error that names it', async () => {
  const db = makeDb();
  const { commit } = await previewAndCommit(db, body([{ ...ROW, Email: 'not-an-address' }]));
  assert.equal(commit.body.rows[0].verdict, 'error');
  assert.deepEqual(commit.body.rows[0].reasons, ['email: must be an email address']);
  assert.deepEqual(db.ids('speakers'), []);
});

test('a speaker typed in the editor before the import is matched by slug, not made twice', async () => {
  const db = makeDb({
    'speakers/existing': { firstName: 'Ada', lastName: 'Lovelace', slug: 'ada-lovelace', status: 'draft', bio: 'Typed by staff.' },
    'speaker_slugs/ada-lovelace': { speakerId: 'existing' },
  });
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  for (const res of [preview, commit]) {
    assert.equal(res.body.rows[0].verdict, 'update');
    assert.equal(res.body.rows[0].matched, true);
    assert.equal(res.body.rows[0].docId, 'existing');
  }
  const notes = commit.body.rows[0].notes;
  assert.match(notes[0], /^Matches the existing speaker "ada-lovelace" by its slug/);
  assert.match(notes[1], /^bio: kept the value in the admin panel/);
  assert.deepEqual(db.ids('speakers'), ['existing'], 'no second speaker');
  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.id, 'existing', 'the external ID now points at the record');
  assert.equal(speaker.bio, 'Typed by staff.', 'a value the record has is kept');
  assert.equal(speaker.jobTitle, 'Editor', 'an empty field is filled');

  const again = await previewAndCommit(db, body([ROW]));
  assert.equal(again.commit.body.rows[0].verdict, 'unchanged', 'the link holds');
});

test('a slug held by another person, by another external ID, or by an earlier row is a row error', async () => {
  const other = makeDb({
    'speakers/existing': { firstName: 'Ada', lastName: 'Lovelace', slug: 'ada-lovelace', email: 'other@example.com', status: 'draft' },
    'speaker_slugs/ada-lovelace': { speakerId: 'existing' },
  });
  const { commit } = await previewAndCommit(other, body([ROW]));
  assert.equal(commit.body.rows[0].verdict, 'error');
  assert.match(commit.body.rows[0].reasons[0], /^slug: "ada-lovelace" belongs to an existing speaker with a different email address/);

  const linked = makeDb();
  await previewAndCommit(linked, body([ROW]));
  const { commit: second } = await previewAndCommit(linked, body([{ ...ROW, 'Speaker ID': 'SPK-9' }]));
  assert.equal(second.body.rows[0].verdict, 'error');
  assert.match(second.body.rows[0].reasons[0], /an earlier import made from another external ID/);
  assert.equal(linked.ids('speakers').length, 1);

  const twin = makeDb();
  const rows = [ROW, { ...ROW, 'Speaker ID': 'SPK-2' }];
  const { preview, commit: third } = await previewAndCommit(twin, body(rows));
  assert.deepEqual(preview.body.rows.map((r) => r.verdict), ['create', 'error'], 'the preview says what the commit does');
  assert.deepEqual(third.body.rows.map((r) => r.verdict), ['create', 'error']);
  assert.match(third.body.rows[1].reasons[0], /^slug: an earlier row of this file uses "ada-lovelace"/);
});

/* ---------------------------------------------------------------- */
/* Idempotency and reconciliation                                   */
/* ---------------------------------------------------------------- */

test('importing the same file again changes nothing and writes nothing', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const before = db.writes.length;
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  assert.deepEqual(preview.body.summary, { create: 0, update: 0, unchanged: 1, error: 0 });
  assert.deepEqual(commit.body.summary, { create: 0, update: 0, unchanged: 1, error: 0 });
  assert.deepEqual(writtenCollections(db, before), ['admin_logs'], 'only the audit row');
  assert.equal(db.ids('speakers').length, 1);
});

test('a changed row updates only the mapped field it changed, and keeps the status', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = speakerByExternalId(db, 'SPK-1').id;
  // The speaker accepts an invitation (not yet public) and staff add a
  // headshot, which the file does not map.
  await db.collection('speakers').doc(id).set({ status: 'accepted', headshotPath: 'default-avatars/a.svg' }, { merge: true });

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Title: 'Managing editor' }]));
  assert.equal(commit.body.rows[0].verdict, 'update');
  assert.deepEqual(commit.body.rows[0].changedFields, ['jobTitle']);
  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.jobTitle, 'Managing editor');
  assert.equal(speaker.status, 'accepted', 'an import never moves the status');
  assert.equal(speaker.headshotPath, 'default-avatars/a.svg', 'an unmapped staff edit survives');
});

test('a staff edit to a mapped field survives a re-import, and a changed file value reports a conflict', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = speakerByExternalId(db, 'SPK-1').id;
  await db.collection('speakers').doc(id).set({ bio: 'Edited by staff.' }, { merge: true });

  const same = await previewAndCommit(db, body([ROW]));
  assert.equal(same.commit.body.rows[0].verdict, 'unchanged');
  assert.equal(speakerByExternalId(db, 'SPK-1').bio, 'Edited by staff.');

  const changed = await previewAndCommit(db, body([{ ...ROW, Bio: 'A new bio from the source.' }]));
  assert.equal(changed.commit.body.rows[0].verdict, 'unchanged');
  assert.match(changed.commit.body.rows[0].notes[0], /^bio: kept the value in the admin panel/);
  assert.equal(speakerByExternalId(db, 'SPK-1').bio, 'Edited by staff.');

  // The conflict is reported once: the next run of that file is quiet.
  const again = await previewAndCommit(db, body([{ ...ROW, Bio: 'A new bio from the source.' }]));
  assert.deepEqual(again.commit.body.rows[0].notes, []);
});

test('a name change does not move the slug; a changed slug cell does', async () => {
  const db = makeDb();
  const withSlug = { ...MAPPING, slug: 'Slug' };
  // A blank slug cell derives the slug on create, and leaves it alone after.
  await previewAndCommit(db, body([{ ...ROW, Slug: '' }], withSlug));
  await previewAndCommit(db, body([{ ...ROW, Last: 'King', Slug: '' }], withSlug));
  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.lastName, 'King');
  assert.equal(speaker.slug, 'ada-lovelace');

  await previewAndCommit(db, body([{ ...ROW, Last: 'King', Slug: 'ada-king' }], withSlug));
  assert.equal(speakerByExternalId(db, 'SPK-1').slug, 'ada-king');
  assert.deepEqual(db.read('speaker_slugs', 'ada-king'), { speakerId: speaker.id, updatedAt: db.read('speaker_slugs', 'ada-king').updatedAt });
  assert.equal(db.read('speaker_slugs', 'ada-lovelace'), undefined);
});

test('the address of a speaker with an open invitation is kept, with a note', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = speakerByExternalId(db, 'SPK-1').id;
  await db.collection('speakers').doc(id).set({ status: 'invited', inviteToken: 'hash' }, { merge: true });

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Email: 'new@example.com' }]));
  assert.equal(commit.body.rows[0].verdict, 'unchanged');
  assert.match(commit.body.rows[0].notes.join(' '), /open invitation/);
  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.email, 'ada@example.com');
  assert.equal(speaker.status, 'invited');
});

test('a speaker staff deleted after the import is not created again', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = speakerByExternalId(db, 'SPK-1').id;
  await db.collection('speakers').doc(id).delete();

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Title: 'Changed' }]));
  assert.equal(commit.body.rows[0].verdict, 'unchanged');
  assert.match(commit.body.rows[0].notes[0], /deleted in the admin panel/);
  assert.deepEqual(db.ids('speakers'), []);
});

/* ---------------------------------------------------------------- */
/* A published speaker                                              */
/* ---------------------------------------------------------------- */

/**
 * The onSpeakerWritten trigger, run the way Firestore runs it: after every
 * write to a speaker. The fake runs no triggers, so the test calls the
 * projection core itself for each speaker.
 */
async function runProjection(db) {
  const { createSyncSpeakerPublic } = require('../speakers/projection.cjs');
  const sync = createSyncSpeakerPublic({ db, now: () => new Date(0), log: { error() {} } });
  for (const speakerId of db.ids('speakers')) await sync({ speakerId });
}

test('a re-import never changes what a published speaker shows: the change waits for review', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = speakerByExternalId(db, 'SPK-1').id;
  await db.collection('speakers').doc(id).set({ status: 'approved' }, { merge: true });
  await runProjection(db);
  const published = db.read('speakers_public', id);
  assert.equal(published.jobTitle, 'Editor');

  const changed = { ...ROW, Title: 'Managing editor', Bio: 'A placeholder bio.' };
  const { preview, commit } = await previewAndCommit(db, body([changed]));
  assert.equal(preview.body.rows[0].verdict, 'update');
  assert.match(preview.body.rows[0].notes.join(' '), /pending review/);
  assert.deepEqual(commit.body.rows[0].changedFields, ['jobTitle', 'bio']);
  await runProjection(db);

  assert.deepEqual(db.read('speakers_public', id), published, 'the public speaker is unchanged');
  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.jobTitle, 'Editor', 'the live field is unchanged');
  assert.deepEqual(speaker.pendingEdits, { jobTitle: 'Managing editor', bio: 'A placeholder bio.' });
  assert.equal(speaker.status, 'approved');

  // The same file again stages nothing new and reports no change.
  const again = await previewAndCommit(db, body([changed]));
  assert.equal(again.commit.body.rows[0].verdict, 'unchanged');

  // Staff accept the change on the Speakers page; only then is it public.
  const { applyApplySpeakerPendingEdits } = require('../speakers/profile.cjs');
  const applied = await applyApplySpeakerPendingEdits({ db, speakerId: id, actor: { uid: 'u', email: 'staff@example.com' } });
  assert.equal(applied.ok, true);
  await runProjection(db);
  assert.equal(db.read('speakers_public', id).jobTitle, 'Managing editor');
});

test('a re-import keeps the slug of a published speaker, and a pending edit by the speaker', async () => {
  const db = makeDb();
  const withSlug = { ...MAPPING, slug: 'Slug' };
  await previewAndCommit(db, body([{ ...ROW, Slug: 'ada-lovelace' }], withSlug));
  const id = speakerByExternalId(db, 'SPK-1').id;
  await db.collection('speakers').doc(id).set({
    status: 'approved',
    pendingEdits: { bio: 'The speaker wrote this.' },
  }, { merge: true });
  await runProjection(db);
  const published = db.read('speakers_public', id);

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Slug: 'ada-king', Bio: 'From the file.' }], withSlug));
  await runProjection(db);
  assert.deepEqual(db.read('speakers_public', id), published);
  const speaker = speakerByExternalId(db, 'SPK-1');
  assert.equal(speaker.slug, 'ada-lovelace');
  assert.deepEqual(db.ids('speaker_slugs'), ['ada-lovelace']);
  assert.deepEqual(speaker.pendingEdits, { bio: 'The speaker wrote this.' }, "the speaker's own pending edit is kept");
  const notes = commit.body.rows[0].notes.join(' ');
  assert.match(notes, /^bio: kept the value in the admin panel/);
  assert.match(notes, /slug: kept the page address/);
});
