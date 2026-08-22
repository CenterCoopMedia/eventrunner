'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSpeakerPublic } = require('./projection.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const NOW = new Date('2026-08-21T12:00:00Z');

function speakerDoc(overrides = {}) {
  return {
    firstName: 'Rae',
    lastName: 'Okonkwo',
    slug: 'rae-okonkwo',
    email: 'rae@example.org',
    bio: 'Community reporter.',
    headshotPath: 'speakers/rae.jpg',
    organization: '[Demo] Cooperative',
    jobTitle: 'Editor',
    socialHandles: { web: 'https://example.org' },
    status: 'approved',
    uid: 'u1',
    inviteToken: 'tok_secret',
    approvedAt: NOW,
    ...overrides,
  };
}

function build(seed = {}) {
  const db = makeSpeakersDb(seed);
  const errors = [];
  const sync = createSyncSpeakerPublic({
    db,
    now: () => NOW,
    log: { error: (...args) => errors.push(args) },
  });
  return { db, sync, errors };
}

test('projects an approved speaker down to public-safe fields', async () => {
  const { db, sync } = build({ 'speakers/s1': speakerDoc() });
  assert.deepEqual(await sync({ speakerId: 's1' }), { action: 'written' });

  const projected = db.read('speakers_public', 's1');
  assert.equal(projected.displayName, 'Rae Okonkwo');
  assert.equal(projected.speakerId, 's1');
  assert.deepEqual(projected.updatedAt, NOW);
  for (const secret of ['email', 'uid', 'inviteToken', 'status', 'approvedAt']) {
    assert.equal(secret in projected, false, `${secret} leaked into speakers_public`);
  }
});

test('the projection is one-way: nothing ever writes speakers', async () => {
  const { db, sync } = build({ 'speakers/s1': speakerDoc() });
  await sync({ speakerId: 's1' });
  assert.deepEqual(
    db.writes.filter((w) => w.path.startsWith('speakers/')),
    [],
    'a write to speakers would be the reverse-sync trigger §4.3 removes',
  );
});

test('a deleted speaker takes its projection with it', async () => {
  const { db, sync } = build({
    'speakers_public/s1': { speakerId: 's1', displayName: 'Rae Okonkwo' },
  });
  assert.deepEqual(await sync({ speakerId: 's1' }), { action: 'deleted' });
  assert.equal(db.read('speakers_public', 's1'), undefined);
});

test('a soft-deleted speaker is removed from the public surface', async () => {
  const { db, sync } = build({
    'speakers/s1': speakerDoc({ status: 'removed' }),
    'speakers_public/s1': { speakerId: 's1', displayName: 'Rae Okonkwo' },
  });
  assert.deepEqual(await sync({ speakerId: 's1' }), { action: 'deleted' });
  assert.equal(db.read('speakers_public', 's1'), undefined);
  assert.notEqual(db.read('speakers', 's1'), undefined, 'the canonical record survives a soft delete');
});

test('only approved speakers get a projection', async () => {
  for (const status of ['draft', 'invited', 'accepted']) {
    const { db, sync } = build({ 'speakers/s1': speakerDoc({ status }) });
    assert.deepEqual(await sync({ speakerId: 's1' }), { action: 'unchanged' });
    assert.equal(db.read('speakers_public', 's1'), undefined, `${status} must not publish`);
  }
});

test('a re-delivery that changes nothing writes nothing', async () => {
  const { db, sync } = build({ 'speakers/s1': speakerDoc() });
  await sync({ speakerId: 's1' });
  const writesAfterFirst = db.writes.length;
  assert.deepEqual(await sync({ speakerId: 's1' }), { action: 'unchanged' });
  assert.equal(db.writes.length, writesAfterFirst);
});

test('the handler re-reads the source rather than trusting a stale event', async () => {
  // The delivery that arrives is for the OLD (approved) state; the stored
  // document has since been soft-deleted. Projecting the event payload
  // would put the speaker back on the open web.
  const { db, sync } = build({
    'speakers/s1': speakerDoc({ status: 'removed' }),
    'speakers_public/s1': { speakerId: 's1', displayName: 'Rae Okonkwo' },
  });
  await sync({ speakerId: 's1', after: speakerDoc() });
  assert.equal(db.read('speakers_public', 's1'), undefined);
  assert.ok(db.reads.includes('speakers/s1'), 'the source document must be re-read');
});

test('a missing speakerId is logged, not thrown', async () => {
  const { sync, errors } = build();
  assert.deepEqual(await sync({}), { action: 'unchanged' });
  assert.equal(errors.length, 1);
});

// The issue's done-when, asserted rather than asserted-about: the tri-sync
// trigger set is verifiably absent from the deployable barrel, and the only
// speaker trigger is the one-way projection. A future PR that reintroduces
// a reverse sync or a periodic drift detector fails here.
test('the tri-sync trigger set and the drift detector do not exist', () => {
  const deployable = require('../../index.js');
  const exports_ = Object.keys(deployable);
  for (const name of [
    'syncSessionInfoToSpeakers',
    'reverseJoinSpeakerToSessions',
    'onCmsSpeakerWritten',
    'syncSessionSpeakerIds',
    'cleanupRevokedInviteSessionIds',
    'detectSpeakerSoTDrift',
  ]) {
    assert.equal(exports_.includes(name), false, `${name} must not exist (§4.3, §9)`);
  }
  assert.deepEqual(
    exports_.filter((name) => /speaker/i.test(name)).sort(),
    [
      // The invite pipeline (issue #21). Listed here on purpose: this
      // assertion is the guard against a speaker export nobody reviewed,
      // so adding one is meant to fail it until the name is written down.
      'acceptSpeakerInvite',
      'cancelSpeakerInvite',
      'createSpeaker',
      'deleteSpeaker',
      'listSpeakerInvites',
      'onSpeakerWritten',
      'resendSpeakerInvite',
      'sendSpeakerInvite',
      'updateSpeaker',
      'validateSpeakerInvite',
    ],
  );
});

test('onSpeakerWritten is deployed with retries enabled', () => {
  // This projection is the only thing that removes a speaker from the
  // public site, and §4.3 leaves no reconciliation to heal it — so a
  // dropped delivery on a soft delete would leave a removed speaker
  // publicly readable indefinitely. Retries are safe: the handler re-reads
  // the source and writes nothing when the projection is already correct.
  const { handlers } = require('./projection.cjs');
  const endpoint = Object.getOwnPropertyDescriptor(handlers.onSpeakerWritten, '__endpoint')?.value;
  assert.equal(endpoint.eventTrigger.retry, true);
});

test('a malformed stored document still projects renderable strings', async () => {
  const { db, sync } = build({
    'speakers/s1': { status: 'approved', firstName: 'Sam', lastName: 'Example', bio: { oops: true } },
  });
  await sync({ speakerId: 's1' });
  assert.equal(db.read('speakers_public', 's1').bio, '');
  assert.equal(db.read('speakers_public', 's1').slug, 'sam-example');
});
