'use strict';

// Saved announcement messages (issue #496): the staff-tier
// announcementMessages endpoint over the server-only
// `announcement_messages` store. The draft check is the composer's own
// (compose.cjs validateDraft), so a message that saves is a message the
// composer can preview.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAnnouncementMessagesHandler, internals } = require('./messages.cjs');
const { internals: composeInternals } = require('./compose.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

const STAFF = 'staff@example.org';
const TOKENS = {
  staff: { uid: 'u-staff', email: STAFF, email_verified: true },
  operator: { uid: 'u-op', email: 'operator@example.org', email_verified: true },
  outsider: { uid: 'u-out', email: 'outsider@example.org', email_verified: true },
};
const auth = { async verifyIdToken(token) { if (TOKENS[token]) return TOKENS[token]; throw new Error('bad token'); } };
const getConfig = async () => ({});
const QUIET = { error() {}, warn() {}, info() {} };

function seeded(extra = {}, event = { historicalDemo: false }) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: [STAFF] },
    'config/event': event,
    ...extra,
  });
}

function call(db, body, { token = 'staff', method = 'POST', now = () => 1_800_000_000_000 } = {}) {
  let ids = 0;
  const handler = createAnnouncementMessagesHandler({
    db, auth, getConfig, now, log: QUIET, newId: () => `msg-${Date.now().toString(36)}-${(ids += 1)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    Promise.resolve(handler({ method, headers, body }, res)).catch(reject);
  });
}

const DRAFT = {
  subject: 'Doors open at nine',
  message: 'Doors open at nine.\n\nBring your badge {{event_name}}.',
  linkUrl: 'https://example.org/schedule',
  linkLabel: 'Read the schedule',
};

const adminLogs = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));

test('every action refuses a caller with no token or no admin tier', async () => {
  const db = seeded();
  for (const action of internals.ACTIONS) {
    assert.equal((await call(db, { action }, { token: null })).status, 401, action);
    assert.equal((await call(db, { action }, { token: 'outsider' })).status, 403, action);
  }
  assert.equal((await call(db, { action: 'list' }, { method: 'GET' })).status, 405);
  assert.equal((await call(db, { action: 'nope' })).status, 400);
  assert.equal((await call(db, { action: 'list' }, { token: 'operator' })).status, 200);
  assert.equal(db.ids('announcement_messages').length, 0);
});

test('save makes a new message with its own id each time; two may share a name', async () => {
  const db = seeded();
  let clock = 1_800_000_000_000;
  const first = await call(db, { action: 'save', name: '  Weekly   note ', draft: DRAFT }, { now: () => clock });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  clock += 60_000;
  const second = await call(db, { action: 'save', name: 'Weekly note', draft: { subject: 'Other', message: 'Other text.' } }, { now: () => clock });
  assert.equal(second.status, 200);
  assert.notEqual(first.body.message.id, second.body.message.id);
  assert.equal(first.body.message.name, 'Weekly note');

  // Only the editable fields are stored: no audience, recipient, or send state.
  const stored = db.read('announcement_messages', first.body.message.id);
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'linkLabel', 'linkUrl', 'message', 'name', 'subject', 'updatedAt']);
  assert.equal(stored.message, DRAFT.message);

  const list = await call(db, { action: 'list' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.messages.map((m) => [m.name, m.subject]), [['Weekly note', 'Other'], ['Weekly note', DRAFT.subject]]);
  assert.deepEqual(list.body.messages.map((m) => m.updatedAt), [clock, clock - 60_000]);
  // The list holds no body.
  assert.equal(JSON.stringify(list.body).includes('Bring your badge'), false);
});

test('load returns the content; an update or rename changes only the message it names', async () => {
  const db = seeded();
  const a = (await call(db, { action: 'save', name: 'Same name', draft: DRAFT })).body.message.id;
  const b = (await call(db, { action: 'save', name: 'Same name', draft: DRAFT })).body.message.id;

  const loaded = await call(db, { action: 'load', id: a });
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body.message.draft, DRAFT);
  assert.equal(loaded.body.message.name, 'Same name');

  const updated = await call(db, { action: 'save', id: a, name: 'Same name', draft: { ...DRAFT, subject: 'Changed' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.message.id, a);
  assert.equal(db.read('announcement_messages', a).subject, 'Changed');
  assert.equal(db.read('announcement_messages', b).subject, DRAFT.subject);

  const renamed = await call(db, { action: 'rename', id: b, name: 'New label' });
  assert.equal(renamed.status, 200);
  assert.equal(db.read('announcement_messages', b).name, 'New label');
  assert.equal(db.read('announcement_messages', b).subject, DRAFT.subject, 'a rename keeps the content');
  assert.equal(db.read('announcement_messages', a).name, 'Same name');
  assert.equal(db.ids('announcement_messages').length, 2);
});

test('the server refuses malformed fields, unknown fields, and the reserved render words', async () => {
  const db = seeded();
  const bad = [
    [{ action: 'save', name: 'x', draft: { ...DRAFT, audience: 'registered' } }, /audience: unknown field/],
    [{ action: 'save', name: 'x', draft: { ...DRAFT, recipients: ['a@example.org'] } }, /recipients: unknown field/],
    [{ action: 'save', name: 'x', draft: { ...DRAFT, subject: '' } }, /subject: must contain text/],
    [{ action: 'save', name: 'x', draft: { ...DRAFT, linkUrl: 'javascript:alert(1)' } }, /linkUrl: must be an absolute http or https URL/],
    [{ action: 'save', name: 'x', draft: { ...DRAFT, message: `Hi ${composeInternals.UNSUBSCRIBE_SLOT}` } }, /message: must not contain a reserved word/],
    [{ action: 'save', name: '   ', draft: DRAFT }, /name: must contain text/],
    [{ action: 'save', name: 'n'.repeat(internals.MAX_NAME_LENGTH + 1), draft: DRAFT }, /name: must be 80 characters or fewer/],
    [{ action: 'save', name: 'Tab\u0000name', draft: DRAFT }, /name: must not contain control characters/],
    [{ action: 'save', name: 'x', draft: 'text' }, /draft: must be an object/],
    [{ action: 'save', id: 'a/b', name: 'x', draft: DRAFT }, /id: must name a saved message/],
    [{ action: 'load', id: '..' }, /id: must name a saved message/],
    [{ action: 'rename', id: 'msg-ok-12345', name: '' }, /name: must contain text/],
    [{ action: 'remove' }, /id: must name a saved message/],
  ];
  for (const [body, pattern] of bad) {
    const res = await call(db, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error.message, pattern);
  }
  assert.equal(db.ids('announcement_messages').length, 0);
  assert.equal(adminLogs(db).length, 0);
});

test('an id that names no saved message is a 404, and creates nothing', async () => {
  const db = seeded();
  for (const body of [
    { action: 'load', id: 'msg-missing-1' },
    { action: 'save', id: 'msg-missing-1', name: 'x', draft: DRAFT },
    { action: 'rename', id: 'msg-missing-1', name: 'x' },
    { action: 'remove', id: 'msg-missing-1' },
  ]) {
    const res = await call(db, body);
    assert.equal(res.status, 404, body.action);
  }
  assert.equal(db.ids('announcement_messages').length, 0);
});

test('remove deletes one message; a copy loaded before stays as it was', async () => {
  const db = seeded();
  const id = (await call(db, { action: 'save', name: 'Note', draft: DRAFT })).body.message.id;
  const copy = (await call(db, { action: 'load', id })).body.message.draft;
  const removed = await call(db, { action: 'remove', id });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { removed: id });
  assert.equal(db.ids('announcement_messages').length, 0);
  assert.equal((await call(db, { action: 'load', id })).status, 404);
  assert.deepEqual(copy, DRAFT);
});

test('each change writes an admin_logs row with the actor and the id, never the name or the content', async () => {
  const db = seeded();
  const id = (await call(db, { action: 'save', name: 'Private label', draft: DRAFT })).body.message.id;
  await call(db, { action: 'save', id, name: 'Private label', draft: DRAFT });
  await call(db, { action: 'rename', id, name: 'Other label' });
  await call(db, { action: 'load', id });
  await call(db, { action: 'list' });
  await call(db, { action: 'remove', id });
  const logs = adminLogs(db);
  assert.deepEqual(logs.map((row) => row.action).sort(), [
    'createAnnouncementMessage', 'removeAnnouncementMessage', 'renameAnnouncementMessage', 'updateAnnouncementMessage',
  ]);
  for (const row of logs) {
    assert.equal(row.docPath, `announcement_messages/${id}`);
    assert.equal(row.email, STAFF);
    assert.equal(row.uid, 'u-staff');
    assert.equal(row.details, undefined);
  }
  const text = JSON.stringify(logs);
  for (const word of ['Private label', 'Other label', 'Doors open', 'Bring your badge']) assert.equal(text.includes(word), false, word);
});

test('a read-only historical demo refuses every change and still lists and loads', async () => {
  const id = 'msg-seeded-0001';
  const db = seeded({
    [`announcement_messages/${id}`]: {
      name: 'Seeded', subject: 's', message: 'm', linkUrl: '', linkLabel: '', createdAt: new Date(1000), updatedAt: new Date(1000),
    },
  }, { historicalDemo: true });
  for (const body of [
    { action: 'save', name: 'x', draft: DRAFT },
    { action: 'save', id, name: 'x', draft: DRAFT },
    { action: 'rename', id, name: 'x' },
    { action: 'remove', id },
  ]) {
    const res = await call(db, body);
    assert.equal(res.status, 403, body.action);
    assert.equal(res.body.error.code, 'read-only-demo');
  }
  assert.equal(db.writes.length, 0);
  assert.equal((await call(db, { action: 'list' })).body.messages.length, 1);
  assert.equal((await call(db, { action: 'load', id })).status, 200);
});

test('the store holds at most MAX_MESSAGES; an update still works at the limit', async () => {
  const seed = {};
  for (let n = 0; n < internals.MAX_MESSAGES; n += 1) {
    seed[`announcement_messages/msg-seeded-${String(n).padStart(4, '0')}`] = {
      name: `Note ${n}`, subject: 's', message: 'm', linkUrl: '', linkLabel: '', createdAt: new Date(n), updatedAt: new Date(n),
    };
  }
  const db = seeded(seed);
  const full = await call(db, { action: 'save', name: 'One more', draft: DRAFT });
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, 'too-many-messages');
  assert.equal(db.ids('announcement_messages').length, internals.MAX_MESSAGES);
  const update = await call(db, { action: 'save', id: 'msg-seeded-0000', name: 'Kept', draft: DRAFT });
  assert.equal(update.status, 200);
  assert.equal((await call(db, { action: 'list' })).body.messages.length, internals.MAX_MESSAGES);
});

test('saving, loading, renaming and removing touch only the saved-message store and the audit log', async () => {
  const db = seeded();
  const id = (await call(db, { action: 'save', name: 'Note', draft: DRAFT })).body.message.id;
  await call(db, { action: 'load', id });
  await call(db, { action: 'rename', id, name: 'Renamed' });
  await call(db, { action: 'remove', id });
  const touched = new Set(db.writes.map((w) => w.path.split('/')[0]));
  // Not the site banners, the speaker wording overrides, the send records,
  // the send-once claims, or the email log.
  assert.deepEqual([...touched].sort(), ['admin_logs', 'announcement_messages']);
});

test('firestore.rules names the saved-message store and closes it to every client (a drift alarm; the emulator test is the proof)', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const rules = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
  const lines = rules.split('\n').filter((line) => line.includes('announcement_messages'));
  assert.deepEqual(lines.map((line) => line.trim()), [
    'match /announcement_messages/{docId} { allow read, write: if false; }',
  ]);
});
