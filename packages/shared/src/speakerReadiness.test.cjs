'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  READINESS_ITEMS,
  REMINDABLE_SPEAKER_STATUSES,
  sessionsForSpeaker,
  speakerReadiness,
  normalizeReadinessTopics,
} = require('./speakerReadiness.cjs');

const complete = { bio: 'A biography.', headshotPath: 'speaker-photos/a/photo.png' };

test('a complete speaker with no session owes nothing', () => {
  const result = speakerReadiness({ speaker: complete, sessions: [], materialsBySession: {} });
  assert.deepEqual(result, {
    bio: false,
    headshot: false,
    descriptionSessions: [],
    materialsSessions: [],
    missing: [],
  });
});

test('blank profile fields are missing, and edits waiting for review count as done', () => {
  const blank = speakerReadiness({ speaker: { bio: '  ', headshotPath: null }, sessions: [], materialsBySession: {} });
  assert.deepEqual(blank.missing, ['bio', 'headshot']);

  const pending = speakerReadiness({
    speaker: { bio: '', headshotPath: '', pendingEdits: { bio: 'Waiting.', headshotPath: 'p.png' } },
    sessions: [],
    materialsBySession: {},
  });
  assert.deepEqual(pending.missing, []);
});

test('a session needs readable description text and a pending or approved material', () => {
  const sessions = [
    { id: 's1', title: 'One', description: '<p> </p>' },
    { id: 's2', title: 'Two', description: '<p>Real text</p>' },
    { id: 's3', title: '', description: 'Plain text' },
  ];
  const result = speakerReadiness({
    speaker: complete,
    sessions,
    materialsBySession: {
      s1: [{ reviewStatus: 'rejected' }],
      s2: [{ reviewStatus: 'pending' }],
      s3: [{ reviewStatus: 'approved' }],
    },
  });
  assert.deepEqual(result.descriptionSessions, [{ id: 's1', title: 'One' }]);
  assert.deepEqual(result.materialsSessions, [{ id: 's1', title: 'One' }]);
  assert.deepEqual(result.missing, ['description', 'materials']);
});

test('a session listed twice is counted once, and an untitled session is named by its id', () => {
  const result = speakerReadiness({
    speaker: complete,
    sessions: [{ id: 'x', description: '' }, { id: 'x', description: '' }],
    materialsBySession: {},
  });
  assert.deepEqual(result.materialsSessions, [{ id: 'x', title: 'x' }]);
  assert.deepEqual(result.descriptionSessions, [{ id: 'x', title: 'x' }]);
});

test('sessionsForSpeaker keeps visible sessions that name the speaker, once each', () => {
  const sessions = [
    { id: 'a', visible: true, speakerIds: ['sp1', 'sp2'] },
    { id: 'b', visible: false, speakerIds: ['sp1'] },
    { id: 'c', speakerIds: ['sp1'] },
    { id: 'd', visible: true, speakerIds: ['sp2'] },
    { id: 'a', visible: true, speakerIds: ['sp1'] },
  ];
  assert.deepEqual(sessionsForSpeaker(sessions, 'sp1').map((s) => s.id), ['a']);
  assert.deepEqual(sessionsForSpeaker(sessions, ''), []);
  assert.deepEqual(sessionsForSpeaker(null, 'sp1'), []);
});

test('topics keep the known items in a fixed order; none means all', () => {
  assert.deepEqual(normalizeReadinessTopics(undefined), [...READINESS_ITEMS]);
  assert.deepEqual(normalizeReadinessTopics([]), [...READINESS_ITEMS]);
  assert.deepEqual(normalizeReadinessTopics(['materials', 'bio', 'nope']), ['bio', 'materials']);
});

test('only speakers who accepted an invitation can be reminded', () => {
  assert.deepEqual([...REMINDABLE_SPEAKER_STATUSES], ['accepted', 'approved']);
});
