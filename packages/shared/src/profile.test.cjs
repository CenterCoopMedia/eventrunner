'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROFILE_VISIBILITY,
  PUBLIC_PROFILE_FIELDS,
  SELF_EDITABLE_PROFILE_FIELDS,
  buildPublicProfile,
  isProfileComplete,
  isValidProfileVisibility,
} = require('./profile.cjs');

const BADGES_CONFIG = {
  categories: [
    { id: 'craft', maxPicks: 2, badges: [{ id: 'writer' }, { id: 'editor' }] },
  ],
};

function user(overrides = {}) {
  return {
    displayName: 'Rae Okonkwo',
    email: 'rae@example.org',
    registrationStatus: 'approved',
    approvalSource: 'admin',
    role: 'attendee',
    speakerId: null,
    profileVisibility: 'attendees_only',
    badges: ['writer'],
    ...overrides,
  };
}

test('default visibility for a new account is attendees_only', () => {
  assert.equal(DEFAULT_PROFILE_VISIBILITY, 'attendees_only');
});

test('server-owned fields are never self-editable', () => {
  for (const field of ['speakerId', 'registrationStatus', 'approvalSource', 'role', 'email', 'createdAt', 'uid', 'profileComplete']) {
    assert.equal(SELF_EDITABLE_PROFILE_FIELDS.includes(field), false, `${field} must stay server-owned`);
  }
});

test('the projection never carries account-private fields', () => {
  for (const field of ['email', 'registrationStatus', 'approvalSource', 'role']) {
    assert.equal(PUBLIC_PROFILE_FIELDS.includes(field), false, `${field} must not be public`);
  }
});

test('projection copies only public-safe fields', () => {
  const pub = buildPublicProfile(user(), BADGES_CONFIG);
  assert.equal(pub.displayName, 'Rae Okonkwo');
  assert.equal(pub.email, undefined);
  assert.equal(pub.registrationStatus, undefined);
  assert.equal(pub.approvalSource, undefined);
  assert.equal(pub.role, undefined);
});

test('projection drops fields that are not on the public list', () => {
  const pub = buildPublicProfile(user({ secretNote: 'internal', dietaryNeeds: 'none' }), BADGES_CONFIG);
  assert.equal(pub.secretNote, undefined);
  assert.equal(pub.dietaryNeeds, undefined);
});

test('badges are rewritten to the intersection with config/badges', () => {
  const pub = buildPublicProfile(user({ badges: ['writer', 'not-configured', 'editor'] }), BADGES_CONFIG);
  assert.deepEqual(pub.badges, ['writer', 'editor']);
});

test('badges honor the per-category maxPicks cap', () => {
  const pub = buildPublicProfile(
    user({ badges: ['writer', 'editor'] }),
    { categories: [{ id: 'craft', maxPicks: 1, badges: [{ id: 'writer' }, { id: 'editor' }] }] },
  );
  assert.deepEqual(pub.badges, ['writer']);
});

test('badges become empty when no badge config exists', () => {
  const pub = buildPublicProfile(user({ badges: ['writer'] }), null);
  assert.deepEqual(pub.badges, []);
});

test('a missing or invalid visibility fails closed to the default, never to public', () => {
  assert.equal(buildPublicProfile(user({ profileVisibility: undefined }), BADGES_CONFIG).profileVisibility, 'attendees_only');
  assert.equal(buildPublicProfile(user({ profileVisibility: 'everyone' }), BADGES_CONFIG).profileVisibility, 'attendees_only');
  assert.equal(buildPublicProfile(user({ profileVisibility: 'public' }), BADGES_CONFIG).profileVisibility, 'public');
});

test('projection is total for a garbage or missing document', () => {
  for (const input of [null, undefined, 'nope', 42, []]) {
    const pub = buildPublicProfile(input, BADGES_CONFIG);
    assert.equal(pub.displayName, '');
    assert.deepEqual(pub.badges, []);
    assert.deepEqual(pub.socialHandles, {});
    assert.equal(pub.speakerId, null);
    assert.equal(pub.profileVisibility, 'attendees_only');
  }
});

test('socialHandles is copied only when it is a plain object', () => {
  assert.deepEqual(
    buildPublicProfile(user({ socialHandles: { mastodon: '@rae@example.social' } }), BADGES_CONFIG).socialHandles,
    { mastodon: '@rae@example.social' },
  );
  assert.deepEqual(buildPublicProfile(user({ socialHandles: 'twitter' }), BADGES_CONFIG).socialHandles, {});
  assert.deepEqual(buildPublicProfile(user({ socialHandles: ['x'] }), BADGES_CONFIG).socialHandles, {});
});

test('speakerId is normalized to a string id or null', () => {
  assert.equal(buildPublicProfile(user({ speakerId: 'spk-1' }), BADGES_CONFIG).speakerId, 'spk-1');
  assert.equal(buildPublicProfile(user({ speakerId: '' }), BADGES_CONFIG).speakerId, null);
  assert.equal(buildPublicProfile(user({ speakerId: 7 }), BADGES_CONFIG).speakerId, null);
});

test('isValidProfileVisibility accepts the three values and nothing else', () => {
  assert.equal(isValidProfileVisibility('public'), true);
  assert.equal(isValidProfileVisibility('attendees_only'), true);
  assert.equal(isValidProfileVisibility('private'), true);
  assert.equal(isValidProfileVisibility('Private'), false);
  assert.equal(isValidProfileVisibility(null), false);
});

test('isProfileComplete needs a display name and a valid visibility', () => {
  assert.equal(isProfileComplete(user()), true);
  assert.equal(isProfileComplete(user({ displayName: '   ' })), false);
  assert.equal(isProfileComplete(user({ profileVisibility: null })), false);
  assert.equal(isProfileComplete(null), false);
});
