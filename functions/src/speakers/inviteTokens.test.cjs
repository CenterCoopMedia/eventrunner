'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SPEAKER_INVITES,
  INVITE_TTL_MS,
  mintInviteToken,
  hashInviteToken,
  isWellFormedToken,
  buildInviteUrl,
  maskEmail,
  invalidateInviteInTx,
} = require('./inviteTokens.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

test('a minted token is 32 random bytes and never repeats', () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) {
    const token = mintInviteToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(isWellFormedToken(token), true);
    tokens.add(token);
  }
  assert.equal(tokens.size, 200);
});

test('the stored digest is not the token', () => {
  const token = mintInviteToken();
  const hash = hashInviteToken(token);
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  // Stable: the same token always addresses the same document.
  assert.equal(hashInviteToken(token), hash);
});

test('malformed tokens are rejected on shape alone', () => {
  for (const bad of [undefined, null, 42, '', 'nope', 'A'.repeat(64), `${mintInviteToken()}x`]) {
    assert.equal(isWellFormedToken(bad), false);
  }
});

test('the invite URL lands on the reserved /speaker/accept segment', () => {
  const url = buildInviteUrl({ tierA: { publicUrl: 'https://event.example.org/' } }, 'abc123');
  assert.equal(url, 'https://event.example.org/speaker/accept?token=abc123');
  const { isReservedPathSegment } = require('shared/routing');
  assert.equal(isReservedPathSegment('speaker'), true);
});

test('masking keeps the domain and one initial, never the local part', () => {
  assert.equal(maskEmail('rae@example.org'), 'r**@example.org');
  assert.equal(maskEmail('alexandra.okonkwo@example.org').startsWith('a*'), true);
  assert.equal(maskEmail('alexandra.okonkwo@example.org').includes('lexandra'), false);
  assert.equal(maskEmail('@example.org'), '');
  assert.equal(maskEmail(null), '');
});

test('invalidateInviteInTx closes the invite row and clears the speaker half in one commit', async () => {
  const hash = hashInviteToken('t');
  const db = makeSpeakersDb({
    'speakers/s1': { status: 'invited', inviteToken: hash },
    [`${SPEAKER_INVITES}/${hash}`]: { speakerId: 's1', status: 'pending' },
  });
  const at = new Date('2026-08-21T12:00:00Z');

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection('speakers').doc('s1'));
    const patch = invalidateInviteInTx({
      tx, db, speaker: snap.data(), at, status: 'cancelled', actorEmail: 'admin@example.org',
    });
    assert.deepEqual(patch, { inviteToken: null });
    tx.set(db.collection('speakers').doc('s1'), patch, { merge: true });
  });

  assert.equal(db.read(SPEAKER_INVITES, hash).status, 'cancelled');
  assert.equal(db.read(SPEAKER_INVITES, hash).closedBy, 'admin@example.org');
  assert.equal(db.read('speakers', 's1').inviteToken, null);
});

test('invalidateInviteInTx on a speaker with no token writes no invite row', async () => {
  const db = makeSpeakersDb({ 'speakers/s1': { status: 'draft', inviteToken: null } });
  await db.runTransaction(async (tx) => {
    invalidateInviteInTx({ tx, db, speaker: { inviteToken: null }, at: new Date(), status: 'superseded' });
  });
  assert.deepEqual(db.ids(SPEAKER_INVITES), []);
});

test('the invite lifetime is two weeks', () => {
  assert.equal(INVITE_TTL_MS, 14 * 24 * 60 * 60 * 1000);
});
