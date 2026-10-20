'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sessionImport = require('./sessionImport.cjs');
const { internals: { importKeyId } } = require('./recordImport.cjs');
const {
  EVENT_CONFIG,
  FORBIDDEN_COLLECTIONS,
  makeDb,
  previewAndCommit,
  writtenCollections,
} = require('./importTestKit.cjs');

const { normalizeClock, sessionIdFromTitle } = sessionImport.internals;

const MAPPING = {
  externalId: 'Ref',
  title: 'Title',
  description: 'Abstract',
  day: 'Day',
  startTime: 'Start',
  endTime: 'End',
  track: 'Track',
  place: 'Room',
  speakers: 'Speakers',
};
const ROW = {
  Ref: 'SES-1',
  Title: 'Verification at speed',
  Abstract: 'How a desk checks claims on deadline.',
  Day: '2026-11-12',
  Start: '9:30 AM',
  End: '10:15',
  Track: 'Main hall',
  Room: 'Hall 1',
  Speakers: '',
};
const body = (rows, mapping = MAPPING) => ({ type: 'sessions', mapping, rows });

/** A speaker an earlier speaker import created, plus one made in the editor. */
function speakerSeed() {
  return {
    'speakers/spk-a': { firstName: 'Ada', lastName: 'Lovelace', slug: 'ada-lovelace', status: 'draft' },
    'speakers/spk-b': { firstName: 'Grace', lastName: 'Hopper', slug: 'grace-hopper', status: 'approved' },
    [`record_imports/${importKeyId('speakers', 'SPK-1')}`]: { type: 'speakers', externalId: 'SPK-1', docId: 'spk-a', values: {} },
  };
}

function sessionKey(db, externalId) {
  return db.read('record_imports', importKeyId('sessions', externalId));
}

/* ---------------------------------------------------------------- */
/* Parsing and mapping                                              */
/* ---------------------------------------------------------------- */

test('normalizeClock: 24-hour and 12-hour times become HH:MM; anything else is left for the validator', () => {
  assert.equal(normalizeClock('9:30'), '09:30');
  assert.equal(normalizeClock('09:30'), '09:30');
  assert.equal(normalizeClock('9:30 AM'), '09:30');
  assert.equal(normalizeClock('12:00 pm'), '12:00');
  assert.equal(normalizeClock('12 AM'), '00:00');
  assert.equal(normalizeClock('3pm'), '15:00');
  assert.equal(normalizeClock('25:00'), '25:00');
  assert.equal(normalizeClock('soon'), 'soon');
});

test('sessionIdFromTitle: the editor rule, accents dropped', () => {
  assert.equal(sessionIdFromTitle('Café: Data & Désks!'), 'cafe-data-desks');
});

test('mapRow: day by date or label, track by name or letter, place by name or id', () => {
  const context = { days: EVENT_CONFIG.days, tracks: EVENT_CONFIG.tracks, places: EVENT_CONFIG.venue.places };
  const one = sessionImport.mapRow({ row: ROW, mapping: MAPPING, context });
  assert.equal(one.ok, true);
  assert.deepEqual(one.input.values, {
    title: 'Verification at speed',
    description: 'How a desk checks claims on deadline.',
    startTime: '09:30',
    endTime: '10:15',
    dayId: 'day-1',
    track: 'A',
    placeId: 'hall-1',
  });
  const two = sessionImport.mapRow({
    row: { ...ROW, Day: 'opening day', Track: 'b', Room: 'room-2' },
    mapping: MAPPING,
    context,
  });
  assert.deepEqual([two.input.values.dayId, two.input.values.track, two.input.values.placeId], ['day-1', 'B', 'room-2']);
});

test('mapRow: a day, track or place the event does not define is a row error that names it', () => {
  const context = { days: EVENT_CONFIG.days, tracks: EVENT_CONFIG.tracks, places: EVENT_CONFIG.venue.places };
  const mapped = sessionImport.mapRow({
    row: { ...ROW, Day: '2027-01-01', Track: 'Z', Room: 'Annex' },
    mapping: MAPPING,
    context,
  });
  assert.equal(mapped.ok, false);
  assert.deepEqual(mapped.reasons.map((r) => r.split(':')[0]), ['day', 'track', 'place']);
});

test('mapRow: the no-materials column reads yes as the mark; no or a blank cell clears it; anything else is a row error', () => {
  const context = { days: EVENT_CONFIG.days, tracks: EVENT_CONFIG.tracks, places: EVENT_CONFIG.venue.places };
  const mapping = { ...MAPPING, materialsNotNeeded: 'No materials' };
  const read = (cell) => sessionImport.mapRow({ row: { ...ROW, 'No materials': cell }, mapping, context });
  for (const yes of ['yes', 'Yes', 'Y', 'true', 'TRUE', '1']) assert.equal(read(yes).input.values.materialsNotNeeded, true, yes);
  for (const no of ['no', 'No', 'n', 'false', '0']) assert.equal(read(no).input.values.materialsNotNeeded, null, no);
  assert.equal(read('').input.values.materialsNotNeeded, null);
  assert.equal(read('   ').input.values.materialsNotNeeded, null);
  const bad = read('maybe');
  assert.equal(bad.ok, false);
  assert.match(bad.reasons[0], /^materialsNotNeeded: "maybe"/);
  // Not mapped: the stored value is left alone.
  assert.equal('materialsNotNeeded' in sessionImport.mapRow({ row: ROW, mapping: MAPPING, context }).input.values, false);
});

test('an imported session that needs no materials is stored with the mark, and "no" on a re-import changes nothing on a session without it', async () => {
  const db = makeDb();
  const mapping = { ...MAPPING, materialsNotNeeded: 'No materials' };
  const { commit } = await previewAndCommit(db, body([{ ...ROW, 'No materials': 'yes' }], mapping));
  assert.equal(commit.body.rows[0].verdict, 'create');
  assert.equal(db.read('cmsSchedule_drafts', 'verification-at-speed').materialsNotNeeded, true);

  // A session the editor saved with the box clear (null) and a file that
  // says "no" agree: the row is unchanged, with no conflict note.
  const other = makeDb();
  await previewAndCommit(other, body([{ ...ROW, 'No materials': '' }], mapping));
  const again = await previewAndCommit(other, body([{ ...ROW, 'No materials': 'no' }], mapping));
  assert.equal(again.preview.body.rows[0].verdict, 'unchanged');
  assert.deepEqual(again.preview.body.rows[0].notes ?? [], []);
});

/* ---------------------------------------------------------------- */
/* Create                                                           */
/* ---------------------------------------------------------------- */

test('a new session is a hidden draft; no live document is written', async () => {
  const db = makeDb();
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  assert.equal(preview.body.rows[0].verdict, 'create');
  assert.equal(commit.body.rows[0].verdict, 'create');
  assert.equal(commit.body.rows[0].docId, 'verification-at-speed');

  const draft = db.read('cmsSchedule_drafts', 'verification-at-speed');
  assert.equal(draft.visible, false);
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.title, 'Verification at speed');
  assert.equal(draft.dayId, 'day-1');
  assert.equal(draft.startTime, '09:30');
  assert.deepEqual(draft.speakerIds, []);
  assert.equal(db.read('cmsSchedule', 'verification-at-speed'), undefined);

  const written = writtenCollections(db);
  for (const forbidden of FORBIDDEN_COLLECTIONS) assert.ok(!written.includes(forbidden), forbidden);
});

test('speakers link by speaker external ID or by slug; an unknown one is a row error', async () => {
  const db = makeDb(speakerSeed());
  const { commit } = await previewAndCommit(db, body([
    { ...ROW, Speakers: 'SPK-1; grace-hopper' },
    { ...ROW, Ref: 'SES-2', Title: 'Second', Speakers: 'SPK-404' },
  ]));
  assert.equal(commit.body.rows[0].verdict, 'create');
  assert.deepEqual(db.read('cmsSchedule_drafts', 'verification-at-speed').speakerIds, ['spk-a', 'spk-b']);
  assert.equal(commit.body.rows[1].verdict, 'error');
  assert.deepEqual(commit.body.rows[1].reasons, [
    'speakers: "SPK-404" matches no speaker external ID or slug. Import the speakers first.',
  ]);
});

test('the shared session validator refuses a bad row, and its message reaches the preview', async () => {
  const db = makeDb();
  const { preview } = await previewAndCommit(db, body([{ ...ROW, Start: '11:00', End: '10:00', Abstract: '' }]));
  assert.equal(preview.body.rows[0].verdict, 'error');
  assert.deepEqual(preview.body.rows[0].reasons, [
    'description: must be a non-empty public description',
    'endTime: must be after startTime',
  ]);
  assert.deepEqual(db.ids('cmsSchedule_drafts'), []);
});

test('a title whose id is taken by another session gets the next free suffix, with a note', async () => {
  const db = makeDb({ 'cmsSchedule/verification-at-speed': { title: 'Older', visible: true, revision: 1 } });
  const { preview, commit } = await previewAndCommit(db, body([ROW, { ...ROW, Ref: 'SES-2' }]));
  assert.deepEqual(commit.body.rows.map((r) => r.docId), ['verification-at-speed-2', 'verification-at-speed-3']);
  assert.match(preview.body.rows[0].notes[0], /^A session with the ID "verification-at-speed" already exists/);
});

test('a session typed in the editor is matched, not made twice: by its title and day, or by a mapped ID', async () => {
  const typed = {
    title: 'Verification at speed', description: 'Typed by staff.', dayId: 'day-1', visible: true, revision: 1,
  };
  const db = makeDb({ 'cmsSchedule/verification-at-speed': typed });
  const { preview, commit } = await previewAndCommit(db, body([ROW]));
  for (const res of [preview, commit]) {
    assert.equal(res.body.rows[0].verdict, 'update');
    assert.equal(res.body.rows[0].matched, true);
    assert.equal(res.body.rows[0].docId, 'verification-at-speed');
  }
  assert.match(commit.body.rows[0].notes[0], /^Matches the existing session "verification-at-speed" by its session ID/);
  assert.equal(sessionKey(db, 'SES-1').docId, 'verification-at-speed');
  const draft = db.read('cmsSchedule_drafts', 'verification-at-speed');
  assert.equal(draft.description, 'Typed by staff.', 'a value the record has is kept');
  assert.equal(draft.startTime, '09:30', 'an empty field is filled');
  assert.deepEqual(db.ids('cmsSchedule_drafts'), ['verification-at-speed'], 'no second session');

  // The same title on another day is another session.
  const otherDay = makeDb({ 'cmsSchedule/verification-at-speed': { ...typed, dayId: 'day-2' } });
  const second = await previewAndCommit(otherDay, body([ROW]));
  assert.equal(second.commit.body.rows[0].verdict, 'create');
  assert.equal(second.commit.body.rows[0].docId, 'verification-at-speed-2');

  // A mapped session ID matches whatever the title.
  const mapped = makeDb({ 'cmsSchedule_drafts/keynote': { title: 'Keynote' } });
  const byId = await previewAndCommit(mapped, body([{ ...ROW, Slug: 'keynote' }], { ...MAPPING, slug: 'Slug' }));
  assert.equal(byId.commit.body.rows[0].verdict, 'update');
  assert.equal(byId.commit.body.rows[0].docId, 'keynote');
  assert.equal(mapped.read('cmsSchedule_drafts', 'keynote').title, 'Keynote');
});

test('a mapped ID that another external ID imported, or an earlier row uses, is a row error', async () => {
  const db = makeDb();
  const withId = { ...MAPPING, slug: 'Slug' };
  await previewAndCommit(db, body([{ ...ROW, Slug: 'keynote' }], withId));
  const { commit } = await previewAndCommit(db, body([{ ...ROW, Ref: 'SES-9', Slug: 'keynote' }], withId));
  assert.equal(commit.body.rows[0].verdict, 'error');
  assert.match(commit.body.rows[0].reasons[0], /^slug: the session "keynote" belongs to another external ID/);

  const twin = makeDb();
  const rows = [{ ...ROW, Slug: 'keynote' }, { ...ROW, Ref: 'SES-2', Slug: 'keynote' }];
  const second = await previewAndCommit(twin, body(rows, withId));
  assert.deepEqual(second.commit.body.rows.map((r) => r.verdict), ['create', 'error']);
  assert.match(second.commit.body.rows[1].reasons[0], /^slug: an earlier row of this file uses "keynote"/);
});

test('a removed speaker is a row error, by external ID or by slug', async () => {
  const db = makeDb({
    ...speakerSeed(),
    'speakers/spk-a': { firstName: 'Ada', lastName: 'Lovelace', slug: 'ada-lovelace', status: 'removed' },
  });
  for (const token of ['SPK-1', 'ada-lovelace']) {
    const { commit } = await previewAndCommit(db, body([{ ...ROW, Speakers: token }]));
    assert.equal(commit.body.rows[0].verdict, 'error');
    assert.match(commit.body.rows[0].reasons[0], new RegExp(`^speakers: "${token}" is a removed speaker`));
  }
  assert.deepEqual(db.ids('cmsSchedule_drafts'), []);
});

/* ---------------------------------------------------------------- */
/* Idempotency and reconciliation                                   */
/* ---------------------------------------------------------------- */

test('importing the same file again changes nothing and writes no draft', async () => {
  const db = makeDb(speakerSeed());
  const rows = [{ ...ROW, Speakers: 'SPK-1' }];
  await previewAndCommit(db, body(rows));
  const before = db.writes.length;
  const { commit } = await previewAndCommit(db, body(rows));
  assert.deepEqual(commit.body.summary, { create: 0, update: 0, unchanged: 1, error: 0 });
  assert.deepEqual(writtenCollections(db, before), ['admin_logs']);
});

test('an update after publish writes the draft only, keeps the visibility, and keeps unmapped edits', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = sessionKey(db, 'SES-1').docId;
  // Staff publish the session visibly and give it a recording link, which
  // the file does not map.
  const draft = db.read('cmsSchedule_drafts', id);
  await db.collection('cmsSchedule').doc(id).set({ ...draft, visible: true, recordingUrl: 'https://video.example.org/1', revision: 1 });
  await db.collection('cmsSchedule_drafts').doc(id).delete();

  const { commit } = await previewAndCommit(db, body([{ ...ROW, End: '10:30' }]));
  assert.equal(commit.body.rows[0].verdict, 'update');
  assert.deepEqual(commit.body.rows[0].changedFields, ['endTime']);
  const next = db.read('cmsSchedule_drafts', id);
  assert.equal(next.endTime, '10:30');
  assert.equal(next.visible, true, 'the record keeps its visibility');
  assert.equal(next.recordingUrl, 'https://video.example.org/1');
  assert.equal(db.read('cmsSchedule', id).endTime, '10:15', 'the live session waits for a publish');
});

test('a staff edit to a mapped field is kept when the file changes it too', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = sessionKey(db, 'SES-1').docId;
  await db.collection('cmsSchedule_drafts').doc(id).set({ title: 'Verification on deadline' }, { merge: true });

  const { commit } = await previewAndCommit(db, body([{ ...ROW, Title: 'Verification, fast' }]));
  assert.equal(commit.body.rows[0].verdict, 'unchanged');
  assert.match(commit.body.rows[0].notes[0], /^title: kept the value in the admin panel/);
  assert.equal(db.read('cmsSchedule_drafts', id).title, 'Verification on deadline');
});

test('a session staff deleted is not created again', async () => {
  const db = makeDb();
  await previewAndCommit(db, body([ROW]));
  const id = sessionKey(db, 'SES-1').docId;
  await db.collection('cmsSchedule_drafts').doc(id).delete();
  const { commit } = await previewAndCommit(db, body([ROW]));
  assert.equal(commit.body.rows[0].verdict, 'unchanged');
  assert.match(commit.body.rows[0].notes[0], /deleted in the admin panel/);
  assert.deepEqual(db.ids('cmsSchedule_drafts'), []);
});
