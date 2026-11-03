'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readImport, createQueueHandler } = require('./pitchQueue.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const row = { externalId: '17', email: 'speaker@example.test', title: 'Local reporting', description: 'A practical session.', consent: true };
test('external-form import requires real consent and stable unique source identities', () => {
  const parsed = readImport({ source: 'external-form', rows: [row] });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].externalId, '17');
  assert.equal(parsed.rows[0].id, readImport({ source: 'external-form', rows: [row] }).rows[0].id);
  assert.notEqual(parsed.rows[0].id, readImport({ source: 'other-form', rows: [row] }).rows[0].id);
  assert.match(readImport({ source: 'external-form', rows: [{ ...row, consent: false }] }).error, /consent/);
  assert.match(readImport({ source: 'external-form', rows: [null] }).error, /externalId/);
  assert.match(readImport({ source: 'external-form', rows: [row, row] }).error, /unique externalId/);
  assert.match(readImport({ source: 'external-form', rows: [row, { ...row, externalId: '18', title: '' }] }).error, /title/);
});

test('an import row carries the pitch stepper fields it has, and a legacy row stays as it was', () => {
  const legacy = readImport({ source: 'external-form', rows: [row] }).rows[0];
  assert.deepEqual(Object.keys(legacy).sort(), ['description', 'email', 'externalId', 'format', 'id', 'organization', 'source', 'title']);
  const full = readImport({ source: 'external-form', rows: [{
    ...row, summary: 'One line.', lengthMinutes: '60', track: 'Audience', audienceLevel: 'beginner', leadName: 'Ada',
    presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test',
  }] }).rows[0];
  assert.equal(full.lengthMinutes, 60);
  assert.equal(full.audienceLevel, 'beginner');
  assert.deepEqual(full.presenters.map((p) => [p.name, p.email, p.lead]), [['Ada', 'speaker@example.test', true], ['Bo', 'bo@example.test', false]]);
  assert.match(readImport({ source: 'external-form', rows: [{ ...row, lengthMinutes: 'long' }] }).error, /Row 1: lengthMinutes/);
});

test('re-importing the same row with presenters is unchanged, and a changed presenter conflicts', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const handler = createQueueHandler({ db, auth, getConfig: async () => ({ bootstrap }), now: () => 1000, log: { error() {} } }, 'import');
  const body = { source: 'external-form', rows: [{ ...row, leadName: 'Ada', presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test' }] };
  const send = async (payload) => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, set() { return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer staff' }, body: payload }, res);
    return res;
  };
  assert.deepEqual((await send(body)).body, { imported: 1, unchanged: 0 });
  assert.deepEqual((await send(body)).body, { imported: 0, unchanged: 1 });
  const changed = { ...body, rows: [{ ...body.rows[0], presenter_1_name: 'Someone else' }] };
  assert.equal((await send(changed)).statusCode, 409);
});

const bootstrap = { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] };
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.test`, email_verified: token !== 'unverified' };
} };
function queueDb(pitch = { ...row, status: 'accepted', reviewRevision: 1 }) {
  return makeFakeDb({
    'config/bootstrap': bootstrap,
    'config/event': { days: [{ id: 'day-one' }] },
    'session_pitches/proposal': pitch,
  });
}
const conversion = { id: 'proposal', expectedRevision: 1, firstName: 'Example', lastName: 'Presenter', dayId: 'day-one', startTime: '10:00', endTime: '11:00' };
async function invoke(db, action, token, body, method = 'POST') {
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await createQueueHandler({ db, auth, now: () => 1_800_000_000_000, log: { error() {} } }, action)({
    method, headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }, res);
  return res;
}

test('both private queue actions admit staff and operators and refuse other identities', async () => {
  for (const action of ['import', 'convert']) {
    const body = action === 'import' ? { source: 'external-form', rows: [row] } : conversion;
    for (const token of ['staff', 'operator']) {
      const db = queueDb();
      assert.equal((await invoke(db, action, token, body)).statusCode, 200);
      if (action === 'convert') {
        assert.equal(db.read('cmsSchedule_drafts', 'pitch-proposal').visible, false);
        assert.equal(db.read('speakers', 'pitch-proposal').status, 'draft');
        assert.equal(db.read('cmsSchedule', 'pitch-proposal'), undefined);
      }
    }
    for (const [token, status] of [[null, 401], ['visitor', 403], ['unverified', 403]]) {
      const db = queueDb();
      assert.equal((await invoke(db, action, token, body)).statusCode, status);
      assert.equal(db.writes.length, 0);
    }
    const revoked = queueDb();
    await revoked.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: [] });
    assert.equal((await invoke(revoked, action, 'staff', body)).statusCode, 403);
  }
});

test('conversion checks the accepted revision and replays its frozen result without new writes', async () => {
  const db = queueDb({ ...row, format: 'Workshop', status: 'accepted', reviewRevision: 1 });
  assert.equal((await invoke(db, 'convert', 'staff', { ...conversion, id: 'missing' })).statusCode, 404);
  assert.equal((await invoke(db, 'convert', 'staff', { ...conversion, expectedRevision: 0 })).statusCode, 409);
  await db.collection('session_pitches').doc('proposal').update({ status: 'new' });
  assert.equal((await invoke(db, 'convert', 'staff', conversion)).statusCode, 409);
  await db.collection('session_pitches').doc('proposal').update({ status: 'accepted' });
  const result = await invoke(db, 'convert', 'staff', conversion);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.revision, 2);
  const draft = db.read('cmsSchedule_drafts', 'pitch-proposal');
  assert.equal(draft.type, 'Workshop');
  assert.equal(Object.hasOwn(draft, 'format'), false);
  await db.collection('session_pitches').doc('proposal').update({ reviewRevision: 3 });
  const writes = db.writes.length;
  assert.deepEqual((await invoke(db, 'convert', 'staff', conversion)).body, { ...result.body, replayed: true });
  assert.equal(db.writes.length, writes);
});

test('queue size and method gates refuse requests before proposal writes', async () => {
  for (const action of ['import', 'convert']) {
    const db = queueDb();
    assert.equal((await invoke(db, action, 'staff', { padding: 'x'.repeat(512 * 1024) })).statusCode, 413);
    assert.equal((await invoke(db, action, 'staff', {}, 'GET')).statusCode, 405);
    assert.equal(db.writes.length, 0);
  }
});

test('an unchanged re-import stays unchanged after Firestore returns the presenter keys in another order', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const handler = createQueueHandler({ db, auth, getConfig: async () => ({ bootstrap }), now: () => 1000, log: { error() {} } }, 'import');
  const body = { source: 'external-form', rows: [{ ...row, leadName: 'Ada', presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test' }] };
  const send = async (payload) => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, set() { return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer staff' }, body: payload }, res);
    return res;
  };
  assert.deepEqual((await send(body)).body, { imported: 1, unchanged: 0 });
  const [id] = db.ids('session_pitches');
  const stored = db.read('session_pitches', id);
  const reordered = stored.presenters.map((p) => Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k]])));
  await db.collection('session_pitches').doc(id).update({ presenters: reordered });
  assert.deepEqual((await send(body)).body, { imported: 0, unchanged: 1 });
});
