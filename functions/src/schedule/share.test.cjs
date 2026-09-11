'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  internals: { buildScheduleShare, sameProjection, storedVisibility, VISIBILITIES },
} = require('./share.cjs');

test('buildScheduleShare: sorts and de-duplicates the session ids', () => {
  const share = buildScheduleShare({
    sessionIds: ['s3', 's1', 's1', 's2'],
    displayName: 'Alex',
    existing: null,
  });
  assert.deepEqual(share.sessionIds, ['s1', 's2', 's3']);
  assert.equal(share.displayName, 'Alex');
});

test('buildScheduleShare: a missing, unknown, or malformed stored visibility reads as private', () => {
  for (const stored of [undefined, null, 'friends', 7, {}]) {
    assert.equal(
      buildScheduleShare({ sessionIds: [], displayName: null, existing: { scheduleVisibility: stored } })
        .scheduleVisibility,
      'private',
      String(stored),
    );
  }
  assert.equal(storedVisibility('public'), 'public');
});

test('buildScheduleShare: an explicit visibility (the consent act) is the one stored', () => {
  const share = buildScheduleShare({
    sessionIds: [],
    displayName: null,
    existing: { scheduleVisibility: 'private' },
    visibility: 'attendees_only',
  });
  assert.equal(share.scheduleVisibility, 'attendees_only');
});

test('buildScheduleShare: a blank or non-string display name stores null', () => {
  assert.equal(buildScheduleShare({ sessionIds: [], displayName: '   ', existing: null }).displayName, null);
  assert.equal(buildScheduleShare({ sessionIds: [], displayName: 42, existing: null }).displayName, null);
});

test('sameProjection: only the projected fields matter, never updatedAt', () => {
  const next = { sessionIds: ['s1'], displayName: 'Alex', scheduleVisibility: 'private' };
  assert.equal(sameProjection({ ...next, updatedAt: new Date('2026-01-01') }, next), true);
  assert.equal(
    sameProjection({ ...next, sessionIds: ['s2'], updatedAt: new Date('2026-01-01') }, next),
    false,
  );
  assert.equal(sameProjection(null, next), false);
  // An unsorted stored list against the sorted next still differs.
  assert.equal(sameProjection({ ...next, sessionIds: [] }, next), false);
});

test('the visibility list is the closed list the rules read', () => {
  assert.deepEqual([...VISIBILITIES], ['private', 'attendees_only', 'public']);
});
