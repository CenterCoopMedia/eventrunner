'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateSessionShape,
  checkSessionParent,
  validateSessionStructure,
} = require('./sessions.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

function session(overrides = {}) {
  return { dayId: 'day-2', title: 'Workshop', startTime: '13:30', ...overrides };
}

// --- track (design brief §4.6) ----------------------------------------------

test('a session may carry no track at all', () => {
  assert.equal(validateSessionShape(session(), 'session-1').ok, true);
  assert.equal(validateSessionShape(session({ track: null }), 'session-1').ok, true);
  assert.equal(validateSessionShape(session({ track: '' }), 'session-1').ok, true);
});

test('a track is one capital letter, A to Z', () => {
  for (const letter of ['A', 'B', 'Z']) {
    assert.equal(validateSessionShape(session({ track: letter }), 'session-1').ok, true, letter);
  }
});

test('anything else is rejected, naming the field and the value', () => {
  for (const bad of ['AB', 'a', '1', ' A', 3, {}]) {
    const { ok, errors } = validateSessionShape(session({ track: bad }), 'session-1');
    assert.equal(ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.match(errors[0], /^track: /);
  }
});

// --- parentId ---------------------------------------------------------------

test('a parentId must be a document id, and never the session itself', () => {
  assert.equal(validateSessionShape(session({ parentId: 'session-2' }), 'session-1').ok, true);
  assert.match(
    validateSessionShape(session({ parentId: 'a/b' }), 'session-1').errors[0],
    /^parentId: must be a session document id/,
  );
  const self = validateSessionShape(session({ parentId: 'session-1' }), 'session-1');
  assert.equal(self.ok, false);
  assert.match(self.errors[0], /cannot be its own parent \("session-1"\)/);
});

test('an orphan parent is rejected, naming the id', async () => {
  const db = makeFakeDb();
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-ghost' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /no session exists with id "session-ghost"/);
});

test('a live parent is enough, and so is a draft-only one', async () => {
  const live = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2' } });
  assert.equal(
    (await checkSessionParent({ db: live, docId: 'c', fields: session({ parentId: 'session-parent' }) })).ok,
    true,
  );
  const draftOnly = makeFakeDb({ 'cmsSchedule_drafts/session-parent': { dayId: 'day-2' } });
  assert.equal(
    (await checkSessionParent({ db: draftOnly, docId: 'c', fields: session({ parentId: 'session-parent' }) })).ok,
    true,
  );
});

test('the draft revision is what a parent is judged by', async () => {
  // The live doc still says day-2; the unpublished draft has moved it.
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2' },
    'cmsSchedule_drafts/session-parent': { dayId: 'day-3' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', dayId: 'day-2' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /runs on day "day-3"/);
});

test('a child runs on its parent’s day, and a mismatch names both days', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-1' } });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', dayId: 'day-3' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /"day-1"/);
  assert.match(verdict.errors[0], /"day-3"/);
});

test('children are one level deep: a child cannot be a parent', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-top': { dayId: 'day-2' },
    'cmsSchedule/session-middle': { dayId: 'day-2', parentId: 'session-top' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-bottom',
    fields: session({ parentId: 'session-middle' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /is itself a child of "session-top"/);
});

test('a session that already has children cannot become a child — no cycles', async () => {
  // The second half of every cycle: A → B is already stored, so B → A is
  // the write that would close the loop, and it is refused.
  const db = makeFakeDb({
    'cmsSchedule/session-a': { dayId: 'day-2', parentId: 'session-b' },
    'cmsSchedule/session-b': { dayId: 'day-2' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-b',
    fields: session({ parentId: 'session-a' }),
  });
  assert.equal(verdict.ok, false);
  // Both halves are named: the parent is a child, and this session is a parent.
  assert.ok(verdict.errors.some((e) => e.includes('already has child sessions (session-a)')));
});

test('a draft child counts too — an unpublished child still makes this a parent', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-b': { dayId: 'day-2' },
    'cmsSchedule/session-c': { dayId: 'day-2' },
    'cmsSchedule_drafts/session-a': { dayId: 'day-2', parentId: 'session-b' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-b',
    fields: session({ parentId: 'session-c' }),
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes('already has child sessions')));
});

test('a session with no parent never reads anything', async () => {
  const db = makeFakeDb();
  const verdict = await checkSessionParent({ db, docId: 'session-1', fields: session() });
  assert.deepEqual(verdict, { ok: true, errors: [] });
});

test('validateSessionStructure joins the two halves, shape first', async () => {
  const db = makeFakeDb();
  const bad = await validateSessionStructure({
    db,
    docId: 'session-1',
    fields: session({ track: 'AA', parentId: 'session-ghost' }),
  });
  assert.equal(bad.ok, false);
  // The shape refusal comes back on its own: a malformed payload costs no
  // reads.
  assert.match(bad.message, /^track: /);
  assert.equal(bad.message.includes('parentId'), false);

  const good = await validateSessionStructure({
    db,
    docId: 'session-1',
    fields: session({ track: 'A' }),
  });
  assert.deepEqual(good, { ok: true });
});
