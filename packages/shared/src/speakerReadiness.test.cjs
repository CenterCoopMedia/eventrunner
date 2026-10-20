'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  READINESS_ITEMS,
  REMINDABLE_SPEAKER_STATUSES,
  sessionNeedsMaterials,
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
    pendingMaterialsSessions: [],
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

test('a session marked as needing no materials never asks for materials', () => {
  assert.equal(sessionNeedsMaterials({ id: 'a' }), true);
  assert.equal(sessionNeedsMaterials({ id: 'a', materialsNotNeeded: false }), true);
  assert.equal(sessionNeedsMaterials({ id: 'a', materialsNotNeeded: 'yes' }), true);
  assert.equal(sessionNeedsMaterials({ id: 'a', materialsNotNeeded: true }), false);

  const result = speakerReadiness({
    speaker: complete,
    sessions: [{ id: 'talk', title: 'Fireside chat', description: '', materialsNotNeeded: true }],
    materialsBySession: {},
  });
  assert.deepEqual(result.materialsSessions, []);
  assert.deepEqual(result.pendingMaterialsSessions, []);
  // The exception is for materials only: the description is still owed.
  assert.deepEqual(result.descriptionSessions, [{ id: 'talk', title: 'Fireside chat' }]);
  assert.deepEqual(result.missing, ['description']);
});

test('a speaker with one no-materials session and one other session owes materials for the other only', () => {
  const sessions = [
    { id: 'chat', title: 'Fireside chat', description: 'Text', materialsNotNeeded: true },
    { id: 'talk', title: 'Data talk', description: 'Text' },
  ];
  const owed = speakerReadiness({ speaker: complete, sessions, materialsBySession: {} });
  assert.deepEqual(owed.materialsSessions, [{ id: 'talk', title: 'Data talk' }]);
  assert.deepEqual(owed.missing, ['materials']);

  const sent = speakerReadiness({ speaker: complete, sessions, materialsBySession: { talk: [{ reviewStatus: 'approved' }] } });
  assert.deepEqual(sent.materialsSessions, []);
  assert.deepEqual(sent.missing, []);
});

test('co-speakers on a no-materials session both leave the materials group', () => {
  const sessions = [
    { id: 'panel', title: 'Panel', description: 'Text', visible: true, speakerIds: ['sp1', 'sp2'], materialsNotNeeded: true },
    { id: 'demo', title: 'Demo', description: 'Text', visible: true, speakerIds: ['sp2'] },
  ];
  const forSpeaker = (id) => speakerReadiness({
    speaker: complete,
    sessions: sessionsForSpeaker(sessions, id),
    materialsBySession: {},
  });
  assert.deepEqual(forSpeaker('sp1').missing, []);
  assert.deepEqual(forSpeaker('sp2').materialsSessions, [{ id: 'demo', title: 'Demo' }]);
});

test('materials waiting for review are told apart from approved ones', () => {
  const sessions = [
    { id: 'p', title: 'Pending only', description: 'Text' },
    { id: 'a', title: 'Approved', description: 'Text' },
    { id: 'm', title: 'Pending and approved', description: 'Text' },
    { id: 'r', title: 'Rejected only', description: 'Text' },
    { id: 'n', title: 'No materials needed', description: 'Text', materialsNotNeeded: true },
  ];
  const result = speakerReadiness({
    speaker: complete,
    sessions,
    materialsBySession: {
      p: [{ reviewStatus: 'pending' }, { reviewStatus: 'rejected' }],
      a: [{ reviewStatus: 'approved' }],
      m: [{ reviewStatus: 'pending' }, { reviewStatus: 'approved' }],
      r: [{ reviewStatus: 'rejected' }],
      n: [{ reviewStatus: 'pending' }],
    },
  });
  // A pending material counts as sent: the speaker has done their part.
  assert.deepEqual(result.materialsSessions, [{ id: 'r', title: 'Rejected only' }]);
  // Staff still have to review it, so the session is listed apart. One
  // approved material is enough to leave this list. A session that needs no
  // materials is never missing them, but an upload to it still waits for
  // review, so staff must see it.
  assert.deepEqual(result.pendingMaterialsSessions, [
    { id: 'p', title: 'Pending only' },
    { id: 'n', title: 'No materials needed' },
  ]);
  assert.deepEqual(result.missing, ['materials']);
});
