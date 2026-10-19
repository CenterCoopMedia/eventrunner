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

test('a title whose id is taken gets the next free suffix; a taken mapped ID is an error', async () => {
  const db = makeDb({ 'cmsSchedule/verification-at-speed': { title: 'Older', visible: true, revision: 1 } });
  const { commit } = await previewAndCommit(db, body([ROW, { ...ROW, Ref: 'SES-2' }]));
  assert.deepEqual(commit.body.rows.map((r) => r.docId), ['verification-at-speed-2', 'verification-at-speed-3']);

  const mapped = makeDb({ 'cmsSchedule_drafts/keynote': { title: 'Keynote' } });
  const result = await previewAndCommit(mapped, body([{ ...ROW, Slug: 'keynote' }], { ...MAPPING, slug: 'Slug' }));
  assert.equal(result.commit.body.rows[0].verdict, 'error');
  assert.match(result.commit.body.rows[0].reasons[0], /^slug: another session already uses "keynote"/);
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
  assert.match(commit.body.rows[0].notes[0], /^title: kept the edit/);
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
