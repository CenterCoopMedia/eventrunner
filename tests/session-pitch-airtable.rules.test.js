// Airtable pitch refresh against the real Firestore emulator: the rules for
// the settings and status documents, and the handlers' real transactions.
// Authentication and the Airtable API are the only fakes. No test calls
// the real Airtable API.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const {
  createUpdateAirtableSourceHandler,
  createRefreshAirtableHandler,
  internals: { pitchIdFor },
} = require('../functions/src/sessions/airtableSync.cjs');
const { createReviewSessionPitchHandler } = require('../functions/src/sessions/pitches.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'airtable-operator@example.test';
const STAFF_EMAIL = 'airtable-staff@example.test';
const VISITOR_EMAIL = 'airtable-visitor@example.test';
const TOKEN = 'pat' + 'FAKEfake000000.' + '2'.repeat(64);
const ENV = { EVENT_AIRTABLE_ENABLED: 'true', AIRTABLE_API_TOKEN: TOKEN };
const T0 = Date.parse('2026-10-20T14:00:00.000Z');
const QUIET = { error() {}, warn() {}, info() {} };
const SETTINGS = {
  enabled: true,
  baseId: 'appAAAAAAAAAAAAAA',
  table: 'tblBBBBBBBBBBBBBB',
  view: 'viwCCCCCCCCCCCCCC',
  fieldMap: { externalId: null, email: 'Email', title: 'Title', description: 'Description', organization: 'Organization', format: 'Format', consent: 'Consent' },
  scheduleMinutes: 60,
};
const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR_EMAIL, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  visitor: { uid: 'visitor-1', email: VISITOR_EMAIL, email_verified: true },
};
const auth = { async verifyIdToken(token) { if (!TOKENS[token]) throw new Error('invalid token'); return TOKENS[token]; } };
const recId = (n) => `rec${String(n).padStart(14, '0')}`;
const record = (n, fields = {}) => ({ id: recId(n), fields: { Email: `presenter${n}@example.test`, Title: `Pitch ${n}`, Description: `Session ${n}.`, Consent: true, ...fields } });

let testEnv;
let adminApp;
let db;
let airtable;
let clock;

function fakeAirtable(rows) {
  const api = { rows, calls: [] };
  api.fetchImpl = async (url, init) => {
    api.calls.push({ url: new URL(url), init });
    return { ok: true, status: 200, async json() { return { records: api.rows }; } };
  };
  return api;
}

function makeRes() {
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; } };
  return res;
}

async function call(create, token, body, extra = {}) {
  const res = makeRes();
  await create({ db, auth, getConfig: async () => { throw new Error('the live db path must be used'); }, log: QUIET, now: () => clock, ...extra })({
    method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }, res);
  return res;
}
const saveSettings = (body = SETTINGS, token = 'operator') => call(createUpdateAirtableSourceHandler, token, body);
const refresh = (token = 'staff') => call(createRefreshAirtableHandler, token, {}, { fetchImpl: airtable.fetchImpl, env: ENV, sleep: async () => {} });
const client = (key) => testEnv.authenticatedContext(TOKENS[key].uid, { email: TOKENS[key].email, email_verified: true }).firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `session-pitch-airtable-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] });
  airtable = fakeAirtable([record(1), record(2), record(3, { Consent: false })]);
  clock = T0;
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('Airtable settings and status rules', () => {
  it('lets only an operator read the settings and nobody write them from a client', async () => {
    expect((await saveSettings()).statusCode).toBe(200);
    await assertSucceeds(getDoc(doc(client('operator'), 'session_pitch_sources/airtable')));
    await assertFails(getDoc(doc(client('staff'), 'session_pitch_sources/airtable')));
    await assertFails(getDoc(doc(client('visitor'), 'session_pitch_sources/airtable')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'session_pitch_sources/airtable')));
    for (const key of ['operator', 'staff', 'visitor']) {
      await assertFails(setDoc(doc(client(key), 'session_pitch_sources/airtable'), { ...SETTINGS, baseId: 'appZZZZZZZZZZZZZZ' }));
    }
  });

  it('lets either admin tier read the refresh status and nobody write it from a client', async () => {
    await saveSettings();
    expect((await refresh()).statusCode).toBe(200);
    await assertSucceeds(getDoc(doc(client('staff'), 'session_pitch_sync/airtable')));
    await assertSucceeds(getDoc(doc(client('operator'), 'session_pitch_sync/airtable')));
    await assertFails(getDoc(doc(client('visitor'), 'session_pitch_sync/airtable')));
    for (const key of ['operator', 'staff', 'visitor']) {
      await assertFails(setDoc(doc(client(key), 'session_pitch_sync/airtable'), { running: null }));
    }
    // Imported pitches keep the existing private queue rules.
    await assertSucceeds(getDoc(doc(client('staff'), `session_pitches/${pitchIdFor(recId(1))}`)));
    await assertFails(getDoc(doc(client('visitor'), `session_pitches/${pitchIdFor(recId(1))}`)));
  });
});

describe('Airtable refresh handlers', () => {
  it('saves operator settings with an audit row and refuses staff', async () => {
    expect((await saveSettings(SETTINGS, 'staff')).statusCode).toBe(403);
    expect((await saveSettings({ ...SETTINGS, baseId: 'https://example.test' })).statusCode).toBe(400);
    expect((await saveSettings()).statusCode).toBe(200);
    const stored = (await db.doc('session_pitch_sources/airtable').get()).data();
    expect(stored).toMatchObject({ ...SETTINGS, updatedBy: OPERATOR_EMAIL });
    expect((await db.collection('admin_logs').where('action', '==', 'updateAirtablePitchSource').get()).size).toBe(1);
  });

  it('creates, refreshes without duplicates, keeps review decisions and flags removed records', async () => {
    await saveSettings();
    const first = await refresh();
    expect(first.statusCode).toBe(200);
    expect(first.body.counts).toMatchObject({ fetched: 3, created: 2, skipped: 1 });
    expect(first.body.skippedReasons).toEqual({ 'no-consent': 1 });
    expect(airtable.calls[0].url.origin).toBe('https://api.airtable.com');
    expect(airtable.calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);

    const id = pitchIdFor(recId(1));
    clock += 1000;
    const reviewed = await call(createReviewSessionPitchHandler, 'staff', { id, status: 'accepted', expectedStatus: 'new', expectedRevision: 0, privateNotes: 'Keep this note.' });
    expect(reviewed.statusCode).toBe(200);

    airtable.rows = [record(1, { Description: 'Session 1, with a new outline.' }), record(3, { Consent: false })];
    clock += 2 * 60 * 1000;
    const second = await refresh('operator');
    expect(second.statusCode).toBe(200);
    expect(second.body.counts).toMatchObject({ created: 0, updated: 1, removed: 1 });
    const pitches = await db.collection('session_pitches').get();
    expect(pitches.size).toBe(2);
    const changed = (await db.doc(`session_pitches/${id}`).get()).data();
    expect(changed).toMatchObject({ status: 'accepted', privateNotes: 'Keep this note.', reviewedBy: STAFF_EMAIL, reviewRevision: 2, description: 'Session 1, with a new outline.', sourceChangedFields: ['description'] });
    expect(changed.sourceUpdatedAt.toMillis()).toBe(clock);
    const removed = (await db.doc(`session_pitches/${pitchIdFor(recId(2))}`).get()).data();
    expect(removed.sourceRemovedAt.toMillis()).toBe(clock);

    // A review opened on the old text now conflicts instead of overwriting.
    const stale = await call(createReviewSessionPitchHandler, 'staff', { id, status: 'rejected', expectedStatus: 'accepted', expectedRevision: 1 });
    expect(stale.statusCode).toBe(409);

    const status = (await db.doc('session_pitch_sync/airtable').get()).data();
    expect(status.running).toBeNull();
    expect(status.lastRun).toMatchObject({ outcome: 'completed', trigger: 'manual', by: OPERATOR_EMAIL });
    expect((await db.collection('admin_logs').where('action', '==', 'refreshAirtablePitches').get()).size).toBe(2);
    expect((await db.collection('sent_emails').get()).empty).toBe(true);
    expect((await db.collection('cmsSchedule_drafts').get()).empty).toBe(true);
  });

  it('records a refused token without storing the token anywhere, and admits no visitor', async () => {
    await saveSettings();
    expect((await refresh('visitor')).statusCode).toBe(403);
    airtable.fetchImpl = async () => ({ ok: false, status: 401, async json() { return { error: { type: 'AUTHENTICATION_REQUIRED', message: `bad ${TOKEN}` } }; } });
    const failed = await refresh();
    expect(failed.statusCode).toBe(502);
    expect(failed.body.error.code).toBe('token-rejected');
    const status = (await db.doc('session_pitch_sync/airtable').get()).data();
    expect(status.lastRun.error.code).toBe('token-rejected');
    for (const name of ['session_pitch_sync', 'session_pitch_sources', 'admin_logs', 'session_pitches']) {
      const snap = await db.collection(name).get();
      expect(JSON.stringify(snap.docs.map((d) => d.data()))).not.toContain(TOKEN);
    }
    expect(JSON.stringify(failed.body)).not.toContain(TOKEN);
  });
});
