'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seedDemoSpeakers } = require('./demo-speakers.cjs');
const { makeFakeDb } = require('../../functions/src/cms/firestoreFake.cjs');

const fixture = (id = 'demo-one') => ({
  id, slug: id, firstName: '[Demo] Example', lastName: 'Speaker',
  status: 'approved', seeded: true, uid: null, email: null, inviteToken: null,
});
const stored = (speaker = fixture()) => {
  const { id, ...fields } = speaker;
  return fields;
};
const seed = (db, options = {}) => seedDemoSpeakers({
  db, speakers: [fixture()], now: () => 1000, ...options,
});
const isConflict = (error) => error.code === 'demo-speaker-conflict';

function strictTransactions(db) {
  const run = db.runTransaction.bind(db);
  db.runTransaction = (callback) => run(async (tx) => {
    let writing = false;
    const strict = {};
    for (const name of ['get', 'getAll']) {
      strict[name] = (...args) => {
        assert.equal(writing, false, 'all reads must precede all writes');
        return tx[name](...args);
      };
    }
    for (const name of ['set', 'create', 'delete', 'update']) {
      strict[name] = (...args) => {
        writing = true;
        return tx[name](...args);
      };
    }
    return callback(strict);
  });
  return db;
}

test('creates speakers and their reservations in one read-before-write transaction', async () => {
  const db = strictTransactions(makeFakeDb());
  const speakers = [fixture(), fixture('demo-two'), fixture('demo-three')];
  const result = await seed(db, { speakers });
  assert.deepEqual(result, { created: speakers.map((s) => s.id), refreshed: [], skipped: [] });
  for (const speaker of speakers) {
    assert.equal(db.read('speaker_slugs', speaker.slug).speakerId, speaker.id);
    assert.equal(db.read('speakers', speaker.id).updatedAt.getTime(), 1000);
    assert.equal(db.read('speakers', speaker.id).id, undefined);
  }
});

test('refreshes an untouched seed and repairs its missing reservation', async () => {
  const db = makeFakeDb({ 'speakers/demo-one': { ...stored(), createdAt: new Date(1) } });
  assert.deepEqual(await seed(db), { created: [], refreshed: ['demo-one'], skipped: [] });
  assert.equal(db.read('speaker_slugs', 'demo-one').speakerId, 'demo-one');
  assert.equal(db.read('speakers', 'demo-one').createdAt.getTime(), 1);
});

test('rerunning the seed retains the same owned reservation', async () => {
  const db = makeFakeDb();
  await seed(db);
  const before = db.read('speaker_slugs', 'demo-one');
  await seed(db, { now: () => 2000 });
  assert.deepEqual(db.read('speaker_slugs', 'demo-one'), before);
  assert.equal(db.ids('speaker_slugs').length, 1);
});

test('a conflicting reservation stops the entire speaker set before any writes', async () => {
  const db = makeFakeDb({ 'speaker_slugs/demo-two': { speakerId: 'existing-speaker' } });
  await assert.rejects(seed(db, { speakers: [fixture(), fixture('demo-two')] }), isConflict);
  assert.deepEqual(db.writes, []);
  assert.deepEqual(db.ids('speakers'), []);
});

test('a canonical speaker without a reservation still owns its slug', async () => {
  const db = makeFakeDb({ 'speakers/existing-speaker': { slug: 'demo-one' } });
  await assert.rejects(seed(db), isConflict);
  assert.deepEqual(db.writes, []);
});

test('an owned reservation does not hide a second canonical owner', async () => {
  const db = makeFakeDb({
    'speaker_slugs/demo-one': { speakerId: 'demo-one' },
    'speakers/demo-one': stored(),
    'speakers/legacy-speaker': { slug: 'demo-one' },
  });
  await assert.rejects(seed(db), isConflict);
  assert.deepEqual(db.writes, []);
});

test('malformed reservations fail closed without exposing their values', async () => {
  for (const value of [{}, { speakerId: null }, { speakerId: 2 }, { speakerId: 'private@example.test' }]) {
    const db = makeFakeDb({ 'speaker_slugs/demo-one': value });
    await assert.rejects(seed(db), (error) => {
      assert.equal(error.message.includes('private@example.test'), false);
      return isConflict(error);
    });
    assert.deepEqual(db.writes, []);
  }
});

test('operator edits, account links, invitations, and pending changes are preserved', async () => {
  const patches = [
    { seeded: false }, { seeded: undefined }, { updatedBy: 'operator@example.test' },
    { uid: 'linked-account' }, { email: 'speaker@example.test' }, { inviteToken: 'pending-invitation' },
    { pendingEdits: { bio: 'Pending biography.' } }, { pendingEditsAt: new Date(1) },
    { pendingEditsBy: 'speaker-account' }, { status: 'removed' }, { status: 'draft' },
  ];
  for (const patch of patches) {
    const before = { ...stored(), ...patch };
    const db = makeFakeDb({ 'speakers/demo-one': before });
    assert.deepEqual(await seed(db), { created: [], refreshed: [], skipped: ['demo-one'] });
    assert.deepEqual(db.read('speakers', 'demo-one'), before);
    assert.deepEqual(db.writes, []);
  }
});

test('dry run reports plans without changing speakers or reservations', async () => {
  const db = makeFakeDb({ 'speakers/demo-one': stored() });
  assert.deepEqual(await seed(db, { dryRun: true, speakers: [fixture(), fixture('demo-two')] }), {
    created: ['demo-two'], refreshed: ['demo-one'], skipped: [],
  });
  assert.deepEqual(db.writes, []);
});

test('dry run detects ownership conflicts rather than reporting success', async () => {
  const db = makeFakeDb({ 'speaker_slugs/demo-one': { speakerId: 'other' } });
  await assert.rejects(seed(db, { dryRun: true }), isConflict);
  assert.deepEqual(db.writes, []);
});

test('a fixture slug change releases only its own previous reservation', async () => {
  for (const previousOwner of ['demo-one', 'another-speaker']) {
    const db = strictTransactions(makeFakeDb({
      'speakers/demo-one': { ...stored(), slug: 'old-demo-slug' },
      'speaker_slugs/old-demo-slug': { speakerId: previousOwner },
    }));
    await seed(db);
    assert.equal(db.read('speaker_slugs', 'demo-one').speakerId, 'demo-one');
    assert.deepEqual(db.read('speaker_slugs', 'old-demo-slug'),
      previousOwner === 'demo-one' ? undefined : { speakerId: previousOwner });
  }
});

test('a concurrent slug claim makes the retry reject without stealing ownership', async () => {
  const db = makeFakeDb();
  db.beforeCommit = () => db.collection('speaker_slugs').doc('demo-one').set({ speakerId: 'other' });
  await assert.rejects(seed(db), isConflict);
  assert.equal(db.read('speakers', 'demo-one'), undefined);
  assert.equal(db.read('speaker_slugs', 'demo-one').speakerId, 'other');
});

test('a concurrent admin edit makes the retry skip instead of overwriting it', async () => {
  const db = makeFakeDb({ 'speakers/demo-one': stored() });
  db.beforeCommit = () => db.collection('speakers').doc('demo-one').update({
    updatedBy: 'operator@example.test', bio: 'Keep this biography.',
  });
  assert.deepEqual(await seed(db), { created: [], refreshed: [], skipped: ['demo-one'] });
  assert.equal(db.read('speakers', 'demo-one').bio, 'Keep this biography.');
  assert.equal(db.read('speaker_slugs', 'demo-one'), undefined);
});

test('a concurrent non-seed creation is not overwritten after retry', async () => {
  const db = makeFakeDb();
  const other = { slug: 'different-slug', firstName: 'Existing speaker' };
  db.beforeCommit = () => db.collection('speakers').doc('demo-one').set(other);
  assert.deepEqual(await seed(db), { created: [], refreshed: [], skipped: ['demo-one'] });
  assert.deepEqual(db.read('speakers', 'demo-one'), other);
});

test('a write-stage error commits neither the speaker nor the reservation', async () => {
  const db = makeFakeDb();
  const run = db.runTransaction.bind(db);
  db.runTransaction = (callback) => run((tx) => callback({
    ...tx, set: () => { throw new Error('Injected speaker write failure'); },
  }));
  await assert.rejects(seed(db), /Injected speaker write failure/);
  assert.deepEqual(db.writes, []);
});

test('invalid and duplicate fixtures are rejected before database access', async () => {
  for (const speakers of [null, [null], [fixture(), fixture()],
    [fixture(), { ...fixture('demo-two'), slug: 'demo-one' }],
    [{ ...fixture(), id: '../private' }], [{ ...fixture(), slug: '../private' }],
    [{ ...fixture(), seeded: false }], Array.from({ length: 101 }, (_, i) => fixture(`demo-${i}`))]) {
    await assert.rejects(seed({}, { speakers }), /Demo speaker fixtures/);
  }
  await assert.rejects(seed({}, { now: () => NaN }), /seed time/);
});
