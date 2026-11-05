'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSaveSessionPitchNoteHandler, internals: { applyNoteChange } } = require('./pitchNotes.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

const bootstrap = { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test', 'other@example.test'] };
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.test`, email_verified: true };
} };

async function invoke(db, token, body) {
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await createSaveSessionPitchNoteHandler({
    db, auth, getConfig: async () => ({ bootstrap }), now: () => 1_800_000_000_000, log: { error() {} },
  })({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('each staff member adds a signed note, and only the author can edit it', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap, 'session_pitches/p1': { status: 'new', reviewRevision: 4 } });
  const added = await invoke(db, 'staff', { id: 'p1', action: 'add', text: '  Strong fit.  ' });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  assert.equal(added.body.note.text, 'Strong fit.');
  assert.equal(added.body.note.email, 'staff@example.test');

  const second = await invoke(db, 'other', { id: 'p1', action: 'add', text: 'Needs a co-presenter.' });
  assert.equal(second.statusCode, 200);

  const stolen = await invoke(db, 'other', { id: 'p1', action: 'edit', noteId: added.body.note.id, text: 'Changed.', baseText: 'Strong fit.' });
  assert.equal(stolen.statusCode, 403);

  const edited = await invoke(db, 'staff', { id: 'p1', action: 'edit', noteId: added.body.note.id, text: 'Strong fit. Ask for slides.', baseText: 'Strong fit.' });
  assert.equal(edited.statusCode, 200);
  // A second window still holding the old text is refused, not applied.
  const stale = await invoke(db, 'staff', { id: 'p1', action: 'edit', noteId: added.body.note.id, text: 'Older draft.', baseText: 'Strong fit.' });
  assert.equal(stale.statusCode, 409);

  const stored = (await db.collection('session_pitches').doc('p1').get()).data();
  assert.deepEqual(stored.reviewNotes.map((note) => [note.email, note.text]), [
    ['staff@example.test', 'Strong fit. Ask for slides.'],
    ['other@example.test', 'Needs a co-presenter.'],
  ]);
  assert.notEqual(stored.reviewNotes[0].editedAt, null);
  // A note never makes another reviewer's decision stale.
  assert.equal(stored.reviewRevision, 4);
});

test('a note needs text, a pitch and a staff sign-in', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap, 'session_pitches/p1': { status: 'new' } });
  assert.equal((await invoke(db, 'staff', { id: 'p1', action: 'add', text: '   ' })).statusCode, 400);
  assert.equal((await invoke(db, 'staff', { id: 'gone', action: 'add', text: 'Hi' })).statusCode, 404);
  assert.equal((await invoke(db, 'stranger', { id: 'p1', action: 'add', text: 'Hi' })).statusCode, 403);
});

test('applyNoteChange refuses a missing note and a full list', () => {
  const actor = { uid: 'a', email: 'a@example.test' };
  const at = new Date(0);
  assert.equal(applyNoteChange([], { action: 'edit', noteId: 'x', text: 'y', baseText: '' }, actor, at).code, 'note-missing');
  const full = Array.from({ length: 200 }, (_, i) => ({ id: String(i), uid: 'a' }));
  assert.equal(applyNoteChange(full, { action: 'add', text: 'y' }, actor, at).code, 'too-many-notes');
  const heavy = Array.from({ length: 30 }, (_, i) => ({ id: String(i), uid: 'a', text: '\u4e2d'.repeat(5000) }));
  assert.equal(applyNoteChange(heavy, { action: 'add', text: 'y' }, actor, at).code, 'notes-full');
});

test('editing a stored note answers with its dates even when Firestore returns a Timestamp', async () => {
  const createdAt = { toDate: () => new Date(0) };
  const db = makeFakeDb({ 'config/bootstrap': bootstrap, 'session_pitches/p1': { status: 'new', reviewNotes: [
    { id: 'abcdef0123456789', uid: 'staff', email: 'staff@example.test', text: 'Old.', createdAt, editedAt: null },
  ] } });
  const edited = await invoke(db, 'staff', { id: 'p1', action: 'edit', noteId: 'abcdef0123456789', text: 'New.', baseText: 'Old.' });
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.note.createdAt, new Date(0).toISOString());
});
