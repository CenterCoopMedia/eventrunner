'use strict';
// Airtable refresh against a fake Airtable API and the in-memory Firestore
// fake. No test calls the real API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  mapRecord, runAirtableSync, airtableSecretNames, createUpdateAirtableSourceHandler, createRefreshAirtableHandler,
  internals: { pitchIdFor, MANUAL_GAP_MS, LEASE_MS },
} = require('./airtableSync.cjs');
const { readImport } = require('./pitchQueue.cjs');

const TOKEN = 'pat' + 'FAKEfake000000.' + '1'.repeat(64);
const ENV = { EVENT_AIRTABLE_ENABLED: 'true', AIRTABLE_API_TOKEN: TOKEN };
const BASE = 'appAAAAAAAAAAAAAA';
const TABLE = 'tblBBBBBBBBBBBBBB';
const fieldMap = { externalId: null, email: 'Email', title: 'Title', description: 'Description', organization: 'Organization', format: 'Format', consent: 'Consent' };
const sourceDoc = { enabled: true, baseId: BASE, table: TABLE, view: null, fieldMap, scheduleMinutes: 0 };
const bootstrap = { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] };
const T0 = Date.parse('2026-10-20T14:00:00.000Z');
const recId = (n) => `rec${String(n).padStart(14, '0')}`;

function record(n, fields = {}) {
  return {
    id: recId(n),
    fields: {
      Email: `presenter${n}@example.test`, Title: `Pitch ${n}`, Description: `A practical session, number ${n}.`,
      Organization: 'Example newsroom', Format: ['Workshop'], Consent: true, ...fields,
    },
  };
}

/** A fake Airtable table. `rows` can change between runs. */
function fakeAirtable(rows, { pageSize = 2, failWith = null } = {}) {
  const api = { rows, calls: [], failWith };
  api.fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    api.calls.push({ url: parsed, init });
    if (api.failWith) {
      const failure = api.failWith;
      return { ok: false, status: failure.status, async json() { return failure.body; } };
    }
    const start = Number(parsed.searchParams.get('offset') || 0);
    const page = api.rows.slice(start, start + pageSize);
    const next = start + pageSize < api.rows.length ? String(start + pageSize) : undefined;
    return { ok: true, status: 200, async json() { return { records: page, ...(next ? { offset: next } : {}) }; } };
  };
  return api;
}

function makeDb(extra = {}) {
  return makeFakeDb({ 'config/bootstrap': bootstrap, 'session_pitch_sources/airtable': sourceDoc, ...extra });
}

function quietLog() {
  const lines = [];
  return { lines, error: (...args) => lines.push(args.map(String).join(' ')), warn() {}, info() {} };
}

let tick = T0;
function later(ms = MANUAL_GAP_MS + 1000) { tick += ms; return tick; }
const run = (db, api, overrides = {}) => runAirtableSync({
  db, fetchImpl: api.fetchImpl, token: TOKEN, env: ENV, actor: { uid: 'staff', email: 'staff@example.test' },
  trigger: 'manual', now: () => tick, sleep: async () => {}, log: quietLog(), ...overrides,
});
const pitch = (db, n) => db.read('session_pitches', pitchIdFor(recId(n)));
const pitchWrites = (db, from) => db.writes.slice(from).filter((w) => w.path.startsWith('session_pitches/'));

test('mapRecord reads Airtable cell shapes and names each skip reason', () => {
  const ok = mapRecord(record(1, { Email: ' Presenter1@Example.TEST ' }), fieldMap);
  assert.deepEqual(ok, { ok: true, externalId: recId(1), row: { email: 'presenter1@example.test', title: 'Pitch 1', description: 'A practical session, number 1.', organization: 'Example newsroom', format: 'Workshop' } });
  assert.equal(mapRecord(record(1, { Ref: 42 }), { ...fieldMap, externalId: 'Ref' }).externalId, '42');
  assert.equal(mapRecord(record(1, { Organization: undefined, Format: undefined }), fieldMap).row.organization, null);
  for (const [fields, map, reason] of [
    [{ Consent: undefined }, fieldMap, 'no-consent'],
    [{ Consent: 'checked' }, fieldMap, 'no-consent'],
    [{ Email: 'not-an-email' }, fieldMap, 'invalid-email'],
    [{ Title: '' }, fieldMap, 'invalid-field'],
    [{ Description: 'x'.repeat(5001) }, fieldMap, 'invalid-field'],
    [{ Format: [{ url: 'attachment' }] }, fieldMap, 'invalid-field'],
    [{}, { ...fieldMap, externalId: 'Ref' }, 'missing-id'],
  ]) {
    assert.equal(mapRecord(record(1, fields), map).reason, reason, JSON.stringify(fields));
  }
  assert.equal(mapRecord(record(1, { Title: '' }), fieldMap).field, 'Title');
});

test('a first refresh creates private new pitches, skips rows without consent, and audits the run', async () => {
  const db = makeDb();
  const api = fakeAirtable([record(1), record(2), record(3, { Consent: false }), record(4, { Email: 'nope' }), record(5)]);
  tick = later();
  const result = await run(db, api);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.counts, { fetched: 5, created: 3, updated: 0, unchanged: 0, restored: 0, skipped: 2, removed: 0 });
  assert.deepEqual(result.skippedReasons, { 'no-consent': 1, 'invalid-email': 1 });
  assert.equal(api.calls.length, 3, 'three pages of two');
  const stored = pitch(db, 1);
  assert.equal(stored.source, 'airtable');
  assert.equal(stored.status, 'new');
  assert.equal(stored.reviewRevision, 0);
  assert.equal(stored.uid, null);
  assert.equal(stored.privateNotes, null);
  assert.equal(stored.consent.version, 'airtable-source');
  assert.deepEqual(stored.airtable, { baseId: BASE, table: TABLE, recordId: recId(1) });
  assert.equal(pitch(db, 3), undefined);

  const status = db.read('session_pitch_sync', 'airtable');
  assert.equal(status.running, null);
  assert.equal(status.lastRun.outcome, 'completed');
  assert.equal(status.lastRun.trigger, 'manual');
  assert.equal(status.lastRun.by, 'staff@example.test');
  assert.deepEqual(status.lastRun.skippedRecords, [
    { recordId: recId(3), reason: 'no-consent', field: 'Consent' },
    { recordId: recId(4), reason: 'invalid-email', field: 'Email' },
  ]);
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'refreshAirtablePitches');
  assert.equal(logs[0].details.counts.created, 3);
  // No email, publication or conversion: only these collections are written.
  const touched = new Set(db.writes.map((w) => w.path.split('/')[0]));
  assert.deepEqual([...touched].sort(), ['admin_logs', 'session_pitch_sync', 'session_pitches']);
  assert.ok(!JSON.stringify(db.writes).includes(TOKEN));
});

test('an unchanged refresh writes no pitch, and a changed record keeps every review decision', async () => {
  const db = makeDb();
  const api = fakeAirtable([record(1), record(2)]);
  tick = later();
  await run(db, api);
  const before = db.writes.length;
  tick = later();
  const again = await run(db, api);
  assert.deepEqual(again.counts, { fetched: 2, created: 0, updated: 0, unchanged: 2, restored: 0, skipped: 0, removed: 0 });
  assert.equal(pitchWrites(db, before).length, 0);

  // Staff review and convert pitch 1, then the submitter edits it in Airtable.
  const id = pitchIdFor(recId(1));
  const conversion = { sessionId: `pitch-${id}`, speakerId: `pitch-${id}`, revision: 3 };
  await db.collection('session_pitches').doc(id).update({ status: 'accepted', reviewRevision: 3, privateNotes: 'Strong fit', reviewedAt: new Date(T0), reviewedBy: 'staff@example.test', conversion, notices: { decision: 'sent' } });
  api.rows = [record(1, { Title: 'Pitch 1, revised' }), record(2)];
  tick = later();
  const changed = await run(db, api);
  assert.equal(changed.outcome, 'completed');
  assert.equal(changed.counts.updated, 1);
  assert.equal(changed.counts.unchanged, 1);
  const stored = pitch(db, 1);
  assert.equal(stored.title, 'Pitch 1, revised');
  assert.equal(stored.status, 'accepted');
  assert.equal(stored.privateNotes, 'Strong fit');
  assert.deepEqual(stored.conversion, conversion);
  assert.deepEqual(stored.notices, { decision: 'sent' });
  assert.equal(stored.reviewedBy, 'staff@example.test');
  assert.equal(stored.reviewRevision, 4, 'a review opened on the old text now conflicts');
  assert.deepEqual(stored.sourceChangedFields, ['title']);
  assert.equal(stored.sourceUpdatedAt.getTime(), tick);
  assert.equal(db.ids('session_pitches').length, 2, 'no duplicate');
});

test('a record that leaves the view is flagged, never deleted, and a return clears the flag', async () => {
  const db = makeDb({ 'session_pitches/native': { title: 'Native pitch', status: 'new', uid: 'u1' } });
  const api = fakeAirtable([record(1), record(2), record(3)]);
  tick = later();
  await run(db, api);
  api.rows = [record(1), record(3)];
  tick = later();
  const gone = await run(db, api);
  assert.equal(gone.counts.removed, 1);
  assert.equal(pitch(db, 2).sourceRemovedAt.getTime(), tick);
  assert.equal(pitch(db, 2).status, 'new');
  assert.equal(db.read('session_pitches', 'native').sourceRemovedAt, undefined, 'other sources are never flagged');

  tick = later();
  const still = await run(db, api);
  assert.equal(still.counts.removed, 0, 'a flag is set once');

  api.rows = [record(1), record(2), record(3)];
  tick = later();
  const back = await run(db, api);
  assert.equal(back.counts.restored, 1);
  assert.equal(pitch(db, 2).sourceRemovedAt, null);
});

test('a switch from the table name to the table ID keeps removal tracking', async () => {
  const db = makeDb({ 'session_pitch_sources/airtable': { ...sourceDoc, table: 'Pitches' } });
  const api = fakeAirtable([record(1), record(2), record(3)]);
  tick = later();
  await run(db, api);
  assert.equal(pitch(db, 2).airtable.table, 'Pitches');
  // The operator follows the hint and saves the table ID instead.
  await db.collection('session_pitch_sources').doc('airtable').set(sourceDoc);
  api.rows = [record(1), record(3)];
  tick = later();
  const gone = await run(db, api);
  assert.equal(gone.counts.removed, 1);
  assert.equal(pitch(db, 2).sourceRemovedAt.getTime(), tick);
  assert.equal(pitch(db, 1).airtable.table, TABLE, 'a seen record takes the current table');
  assert.equal(pitch(db, 1).sourceRemovedAt, null);
});

test('a record that comes back without consent loses its removed flag', async () => {
  const db = makeDb();
  const api = fakeAirtable([record(1), record(2)]);
  tick = later();
  await run(db, api);
  api.rows = [record(1)];
  tick = later();
  await run(db, api);
  assert.ok(pitch(db, 2).sourceRemovedAt);
  api.rows = [record(1), record(2, { Consent: false })];
  tick = later();
  await run(db, api);
  assert.equal(pitch(db, 2).sourceRemovedAt, null, 'back in the view');
  assert.equal(pitch(db, 2).sourceConsentMissingAt.getTime(), tick);
});

test('a partial read never flags removals', async () => {
  const db = makeDb();
  const rows = [record(1), record(2), record(3)];
  const api = fakeAirtable(rows, { pageSize: 1 });
  tick = later();
  await run(db, api);
  const { MAX_PAGES } = require('./airtableClient.cjs').internals;
  api.rows = Array.from({ length: MAX_PAGES + 1 }, (_, i) => record(i + 10));
  tick = later();
  const partial = await run(db, api);
  assert.equal(partial.outcome, 'partial');
  assert.equal(partial.counts.removed, 0);
  assert.equal(pitch(db, 1).sourceRemovedAt, null);
  assert.equal(db.read('session_pitch_sync', 'airtable').lastRun.outcome, 'partial');
});

test('a cleared consent box flags the existing pitch, and every record sharing an id is skipped', async () => {
  const db = makeDb({ 'session_pitch_sources/airtable': { ...sourceDoc, fieldMap: { ...fieldMap, externalId: 'Ref' } } });
  const api = fakeAirtable([record(1, { Ref: 'A-1' }), record(2, { Ref: 'A-1' }), record(3, { Ref: 'A-3' })]);
  tick = later();
  const first = await run(db, api);
  // Airtable's order must not pick which of two records becomes the pitch.
  assert.deepEqual(first.skippedReasons, { 'duplicate-id': 2 });
  assert.equal(first.counts.created, 1);
  assert.equal(db.read('session_pitches', pitchIdFor('A-1')), undefined);
  assert.deepEqual(first.skippedRecords.map((row) => row.recordId), [recId(1), recId(2)]);
  api.rows = [record(1, { Ref: 'A-1' }), record(3, { Ref: 'A-3', Consent: false })];
  tick = later();
  const cleared = await run(db, api);
  assert.equal(cleared.skippedReasons['no-consent'], 1);
  const stored = db.read('session_pitches', pitchIdFor('A-3'));
  assert.equal(stored.sourceConsentMissingAt.getTime(), tick);
  assert.equal(stored.sourceRemovedAt, null, 'still in Airtable');
});

test('a refresh adopts a row from an earlier CSV import under the same source name', async () => {
  const csvRow = readImport({ source: 'airtable', rows: [{ externalId: recId(1), email: 'presenter1@example.test', title: 'Pitch 1', description: 'A practical session, number 1.', organization: 'Example newsroom', format: 'Workshop', consent: true }] }).rows[0];
  assert.equal(csvRow.id, pitchIdFor(recId(1)), 'the same identity as the CSV import');
  const db = makeDb({ [`session_pitches/${csvRow.id}`]: { ...csvRow, status: 'in_review', reviewRevision: 1 } });
  tick = later();
  const result = await run(db, fakeAirtable([record(1)]));
  assert.equal(result.counts.unchanged, 1);
  assert.equal(pitch(db, 1).status, 'in_review');
  assert.deepEqual(pitch(db, 1).airtable, { baseId: BASE, table: TABLE, recordId: recId(1) });
});

test('runs never overlap, a manual refresh waits one minute, and schedules respect their timing', async () => {
  const db = makeDb();
  const api = fakeAirtable([record(1)]);
  tick = later();
  await db.collection('session_pitch_sync').doc('airtable').set({ running: { startedAt: new Date(tick - 1000) } });
  assert.equal((await run(db, api)).reason, 'busy');
  tick = later(LEASE_MS);
  assert.equal((await run(db, api)).outcome, 'completed', 'a stale lease expires');
  tick += 1000;
  const soon = await run(db, api);
  assert.equal(soon.reason, 'too-soon');
  assert.ok(soon.retryAfterMs > 0);

  const scheduled = (overrides) => run(db, api, { trigger: 'scheduled', actor: { uid: null, email: null }, ...overrides });
  const calls = api.calls.length;
  tick = later(60 * 60 * 1000);
  assert.equal((await scheduled()).reason, 'not-scheduled', 'off by default');
  await db.collection('session_pitch_sources').doc('airtable').set({ ...sourceDoc, scheduleMinutes: 60 });
  assert.equal((await scheduled({ env: { AIRTABLE_API_TOKEN: TOKEN } })).reason, 'not-scheduled', 'deployment flag off');
  assert.equal((await scheduled()).outcome, 'completed');
  tick = later(15 * 60 * 1000);
  assert.equal((await scheduled()).reason, 'not-due');
  tick = later(45 * 60 * 1000);
  assert.equal((await scheduled()).outcome, 'completed');
  assert.equal(api.calls.length, calls + 2);
  const status = db.read('session_pitch_sync', 'airtable');
  assert.equal(status.lastRun.trigger, 'scheduled');
  assert.equal(status.lastRun.by, null);
});

test('an Airtable failure is recorded, redacted and audited, and the token is never logged', async () => {
  const db = makeDb();
  const api = fakeAirtable([record(1)], { failWith: { status: 401, body: { error: { type: 'AUTHENTICATION_REQUIRED', message: `Invalid token ${TOKEN}` } } } });
  const log = quietLog();
  tick = later();
  const result = await run(db, api, { log });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.error.code, 'token-rejected');
  const status = db.read('session_pitch_sync', 'airtable');
  assert.equal(status.running, null, 'the lease is released');
  assert.equal(status.lastRun.error.code, 'token-rejected');
  assert.equal(status.lastSuccessAt, undefined);
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs[0].details.errorCode, 'token-rejected');
  assert.equal(db.ids('session_pitches').length, 0);

  // A Firestore failure mid-run is logged without the token.
  const broken = makeDb();
  broken.runTransaction = ((original) => async (fn) => {
    broken.failNext = (broken.failNext || 0) + 1;
    if (broken.failNext === 2) throw new Error(`write failed while holding Bearer ${TOKEN}`);
    return original(fn);
  })(broken.runTransaction.bind(broken));
  tick = later();
  const crashed = await run(broken, fakeAirtable([record(1)]), { log });
  assert.equal(crashed.error.code, 'internal');
  for (const text of [...log.lines, JSON.stringify(db.writes), JSON.stringify(broken.read('session_pitch_sync', 'airtable'))]) {
    assert.ok(!text.includes(TOKEN), text);
  }
  assert.ok(log.lines.length > 0);
});

test('a deployment without the flag or settings fails with a stated reason', async () => {
  tick = later();
  const off = await run(makeDb(), fakeAirtable([]), { env: { AIRTABLE_API_TOKEN: TOKEN } });
  assert.equal(off.error.code, 'not-enabled');
  const empty = makeFakeDb({ 'config/bootstrap': bootstrap });
  assert.equal((await run(empty, fakeAirtable([]))).error.code, 'not-configured');
  const paused = makeDb({ 'session_pitch_sources/airtable': { ...sourceDoc, enabled: false } });
  assert.equal((await run(paused, fakeAirtable([]))).error.code, 'turned-off');
  const noToken = await run(makeDb(), fakeAirtable([]), { token: undefined });
  assert.equal(noToken.error.code, 'no-token');
});

test('secrets are bound only when the deployment opts in, and never in the emulator', () => {
  assert.deepEqual(airtableSecretNames({}), []);
  assert.deepEqual(airtableSecretNames({ EVENT_AIRTABLE_ENABLED: 'false' }), []);
  assert.deepEqual(airtableSecretNames({ EVENT_AIRTABLE_ENABLED: 'true' }), ['AIRTABLE_API_TOKEN']);
  assert.deepEqual(airtableSecretNames({ EVENT_AIRTABLE_ENABLED: 'true', FUNCTIONS_EMULATOR: 'true' }), []);
});

const auth = { async verifyIdToken(token) { return { uid: token, email: `${token}@example.test`, email_verified: true }; } };
function makeRes() {
  return { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
}
async function invoke(create, deps, token, body, method = 'POST') {
  const res = makeRes();
  await create({ auth, log: quietLog(), ...deps })({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}

test('only an operator saves connection settings, with validation and an audit row', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const body = { ...sourceDoc, scheduleMinutes: 15 };
  assert.equal((await invoke(createUpdateAirtableSourceHandler, { db }, 'staff', body)).statusCode, 403);
  assert.equal((await invoke(createUpdateAirtableSourceHandler, { db }, null, body)).statusCode, 401);
  assert.equal((await invoke(createUpdateAirtableSourceHandler, { db }, 'operator', body, 'GET')).statusCode, 405);
  assert.equal((await invoke(createUpdateAirtableSourceHandler, { db }, 'operator', { ...body, baseId: 'bad' })).statusCode, 400);
  assert.equal(db.read('session_pitch_sources', 'airtable'), undefined);
  const saved = await invoke(createUpdateAirtableSourceHandler, { db, now: () => T0 }, 'operator', { ...body, token: TOKEN });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body, body);
  const stored = db.read('session_pitch_sources', 'airtable');
  assert.equal(stored.updatedBy, 'operator@example.test');
  assert.equal(stored.token, undefined, 'a token in the body is dropped');
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'updateAirtablePitchSource');
});

test('staff and operators refresh; others are refused; failures and limits answer plainly', async () => {
  for (const token of ['staff', 'operator']) {
    const db = makeDb();
    tick = later();
    const res = await invoke(createRefreshAirtableHandler, { db, fetchImpl: fakeAirtable([record(1)]).fetchImpl, env: ENV, now: () => tick, sleep: async () => {} }, token, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.counts.created, 1);
    const again = await invoke(createRefreshAirtableHandler, { db, fetchImpl: fakeAirtable([record(1)]).fetchImpl, env: ENV, now: () => tick + 1000 }, token, {});
    assert.equal(again.statusCode, 429);
    assert.ok(Number(again.headers['Retry-After']) > 0);
  }
  const db = makeDb();
  assert.equal((await invoke(createRefreshAirtableHandler, { db, env: ENV }, 'visitor', {})).statusCode, 403);
  assert.equal((await invoke(createRefreshAirtableHandler, { db, env: ENV }, null, {})).statusCode, 401);
  assert.equal(db.writes.length, 0);
  tick = later();
  const failed = await invoke(createRefreshAirtableHandler, { db, env: ENV, now: () => tick, fetchImpl: fakeAirtable([], { failWith: { status: 404, body: {} } }).fetchImpl }, 'staff', {});
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.error.code, 'not-found');
  await db.collection('session_pitch_sync').doc('airtable').set({ running: { startedAt: new Date(tick) } });
  assert.equal((await invoke(createRefreshAirtableHandler, { db, env: ENV, now: () => tick }, 'staff', {})).statusCode, 409);
});
