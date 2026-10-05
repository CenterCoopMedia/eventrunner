// Session pitch API and rules boundaries against the real Firestore emulator.
// Authentication is the only mock: Firebase ID-token verification is an
// external boundary, while every transaction and rules decision is real.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const {
  createSubmitSessionPitchHandler,
  createUpdatePitchCallHandler,
  createReviewSessionPitchHandler,
  internals: {
    MAX_DESCRIPTION_LENGTH,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  },
} = require('../functions/src/sessions/pitches.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'pitch-operator@example.test';
const STAFF_EMAIL = 'pitch-staff@example.test';
const SUBMITTER_EMAIL = 'pitch-submitter@example.test';
const T0 = Date.parse('2026-10-05T16:00:00.000Z');
const CLOSES_AT = '2026-11-15T22:00:00.000Z';
const KEY = 'pitch-key-000001';
const PITCH_ID = createHash('sha256').update(`submitter-1\0${KEY}`).digest('hex');
const RATE_LIMIT_ID = createHash('sha256').update('submitter-1').digest('hex');
const QUIET = { error() {}, warn() {}, info() {} };

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR_EMAIL, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  submitter: { uid: 'submitter-1', email: ` ${SUBMITTER_EMAIL.toUpperCase()} `, email_verified: true },
  other: { uid: 'submitter-2', email: 'pitch-other@example.test', email_verified: true },
  unverified: { uid: 'submitter-3', email: 'pitch-unverified@example.test', email_verified: false },
};

const auth = {
  revocationChecks: [],
  async verifyIdToken(token, checkRevoked = false) {
    auth.revocationChecks.push(checkRevoked);
    if (token === 'deleted') throw new Error('deleted account');
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

let testEnv;
let adminApp;
let db;

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

function request(token, body, method = 'POST') {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

function pitch(overrides = {}) {
  return {
    title: 'Local reporting beyond the breaking news cycle',
    description: 'A practical session about durable local reporting partnerships.',
    organization: 'Example newsroom',
    format: 'Panel',
    submissionKey: KEY,
    consent: true,
    ...overrides,
  };
}

async function call(create, token, body, options = {}) {
  const res = makeRes();
  await create({
    db,
    auth,
    getConfig: async () => { throw new Error('the live db path must be used'); },
    now: options.now ?? (() => T0),
    log: QUIET,
  })(request(token, body, options.method), res);
  return res;
}

async function submit(body = pitch(), token = 'submitter', now = () => T0) {
  return call(createSubmitSessionPitchHandler, token, body, { now });
}

async function updateCall(body, token = 'operator', now = () => T0) {
  return call(createUpdatePitchCallHandler, token, body, { now });
}

async function review(body, token = 'staff', now = () => T0 + 1000) {
  return call(createReviewSessionPitchHandler, token, body, { now });
}

async function seedBase({ pitchCall = null } = {}) {
  await db.collection('config').doc('bootstrap').set({
    adminEmails: [OPERATOR_EMAIL],
    staffEmails: [STAFF_EMAIL],
  });
  if (pitchCall) await db.collection('config').doc('pitch_call').set(pitchCall);
}

function operatorClient() {
  return testEnv.authenticatedContext('operator-1', {
    email: OPERATOR_EMAIL,
    email_verified: true,
  }).firestore();
}

function staffClient() {
  return testEnv.authenticatedContext('staff-1', {
    email: STAFF_EMAIL,
    email_verified: true,
  }).firestore();
}

function submitterClient() {
  return testEnv.authenticatedContext('submitter-1', {
    email: SUBMITTER_EMAIL,
    email_verified: true,
  }).firestore();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `session-pitches-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  auth.revocationChecks.length = 0;
  await seedBase();
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('pitch call configuration', () => {
  it('is closed by default and refuses a new pitch when the document is absent or malformed', async () => {
    expect((await submit()).statusCode).toBe(404);

    for (const value of [
      { enabled: false, closesAt: CLOSES_AT },
      { enabled: true, closesAt: 'not-a-date' },
      { enabled: true, closesAt: '2026-02-30T12:00:00Z' },
      { enabled: true, closesAt: new Date(T0 - 1).toISOString() },
    ]) {
      await db.collection('config').doc('pitch_call').set(value);
      expect((await submit()).statusCode).toBe(404);
    }
    expect((await db.collection('session_pitches').get()).empty).toBe(true);
  });

  it('lets only an operator update the public actor-free configuration and audits that write', async () => {
    expect((await updateCall({ enabled: true, closesAt: CLOSES_AT }, 'staff')).statusCode).toBe(403);
    expect((await updateCall({ enabled: true, closesAt: '2026-02-30T12:00:00Z' })).statusCode).toBe(400);

    const response = await updateCall({
      enabled: true,
      closesAt: '2026-11-15T17:00:00-05:00',
      updatedBy: 'forged@example.test',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ enabled: true, closesAt: CLOSES_AT });

    const stored = (await db.collection('config').doc('pitch_call').get()).data();
    expect(stored).toEqual({ enabled: true, closesAt: CLOSES_AT });
    expect(Object.keys(stored).sort()).toEqual(['closesAt', 'enabled']);

    const logs = await db.collection('admin_logs').where('action', '==', 'updatePitchCall').get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().email).toBe(OPERATOR_EMAIL);

    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'config/pitch_call')));
    await assertFails(setDoc(doc(operatorClient(), 'config/pitch_call'), { enabled: false, closesAt: CLOSES_AT }));
  });
});

describe('pitch submission', () => {
  beforeEach(async () => {
    await db.collection('config').doc('pitch_call').set({ enabled: true, closesAt: CLOSES_AT });
  });

  it('requires a verified sign-in and bounded required input', async () => {
    expect((await submit(pitch(), null)).statusCode).toBe(401);
    expect((await submit(pitch(), 'invalid')).statusCode).toBe(401);
    expect((await submit(pitch(), 'deleted')).statusCode).toBe(401);
    expect((await submit(pitch(), 'unverified')).statusCode).toBe(403);
    expect(auth.revocationChecks.every((value) => value === true)).toBe(true);

    for (const body of [
      pitch({ title: '  ' }),
      pitch({ description: null }),
      pitch({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) }),
      pitch({ organization: { name: 'Example' } }),
      pitch({ format: ['Panel'] }),
      pitch({ submissionKey: 'short' }),
      pitch({ consent: undefined }),
      pitch({ consent: false }),
      pitch({ consent: 'true' }),
    ]) {
      expect((await submit(body)).statusCode).toBe(400);
    }
    expect((await db.collection('session_pitches').get()).empty).toBe(true);
    expect((await db.collection('session_pitch_rate_limits').get()).empty).toBe(true);
  });

  it('stores token identity without a ticket or user document and keeps the row private', async () => {
    expect((await db.collection('users').doc('submitter-1').get()).exists).toBe(false);
    expect((await db.collection('tickets').where('email', '==', SUBMITTER_EMAIL).get()).empty).toBe(true);

    const response = await submit(pitch({
      uid: 'forged-uid',
      email: 'forged@example.test',
      status: 'accepted',
      privateNotes: 'forged note',
    }));
    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({ id: PITCH_ID, ok: true });

    const stored = (await db.collection('session_pitches').doc(PITCH_ID).get()).data();
    expect(stored).toMatchObject({
      title: pitch().title,
      description: pitch().description,
      organization: 'Example newsroom',
      format: 'Panel',
      uid: 'submitter-1',
      email: SUBMITTER_EMAIL,
      status: 'new',
      reviewRevision: 0,
      privateNotes: null,
      reviewedAt: null,
      reviewedBy: null,
      consent: { version: 'session-pitch-review-v1' },
    });
    expect((await db.collection('session_pitch_rate_limits').doc(RATE_LIMIT_ID).get()).data().requests).toEqual([T0]);

    await assertFails(getDoc(doc(submitterClient(), `session_pitches/${PITCH_ID}`)));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), `session_pitches/${PITCH_ID}`)));
    await assertSucceeds(getDoc(doc(staffClient(), `session_pitches/${PITCH_ID}`)));
    await assertSucceeds(getDoc(doc(operatorClient(), `session_pitches/${PITCH_ID}`)));
    await assertFails(setDoc(doc(staffClient(), `session_pitches/${PITCH_ID}`), { status: 'accepted' }));
    await assertFails(getDoc(doc(operatorClient(), `session_pitch_rate_limits/${RATE_LIMIT_ID}`)));
  });

  it('replays the same account key, conflicts on changed payload, and isolates another account using the same key', async () => {
    expect((await submit()).statusCode).toBe(201);
    expect((await submit(pitch({
      title: ` ${pitch().title} `,
      description: ` ${pitch().description} `,
      organization: ' Example newsroom ',
      format: ' Panel ',
    }), 'submitter', () => T0 + 1000)).statusCode).toBe(201);

    expect((await submit(pitch({ description: 'Changed on retry.' }))).statusCode).toBe(409);
    const other = await submit(pitch(), 'other');
    expect(other.statusCode).toBe(201);
    expect(other.body.id).not.toBe(PITCH_ID);
    expect((await db.collection('session_pitches').get()).size).toBe(2);
    expect((await db.collection('session_pitch_rate_limits').doc(RATE_LIMIT_ID).get()).data().requests).toEqual([T0]);
  });

  it('concurrent retries create one pitch and spend one rate-limit slot', async () => {
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(new Set(responses.map((response) => response.body.id))).toEqual(new Set([PITCH_ID]));
    expect((await db.collection('session_pitches').get()).size).toBe(1);
    expect((await db.collection('session_pitch_rate_limits').doc(RATE_LIMIT_ID).get()).data().requests).toEqual([T0]);
  });

  it('stores the pitch and rate slot atomically and enforces a per-user sliding window', async () => {
    for (let index = 0; index < RATE_LIMIT_MAX; index += 1) {
      const response = await submit(
        pitch({ submissionKey: `pitch-burst-000${index}` }),
        'submitter',
        () => T0 + index * 1000,
      );
      expect(response.statusCode).toBe(201);
    }
    const limited = await submit(
      pitch({ submissionKey: 'pitch-burst-0005' }),
      'submitter',
      () => T0 + 5000,
    );
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['Retry-After']).toBe(String((RATE_LIMIT_WINDOW_MS - 5000) / 1000));
    expect((await db.collection('session_pitches').get()).size).toBe(RATE_LIMIT_MAX);
    const limitedId = createHash('sha256').update('submitter-1\0pitch-burst-0005').digest('hex');
    expect((await db.collection('session_pitches').doc(limitedId).get()).exists).toBe(false);
    expect((await db.collection('session_pitch_rate_limits').doc(RATE_LIMIT_ID).get()).data().requests).toHaveLength(RATE_LIMIT_MAX);

    expect((await submit(pitch({ submissionKey: 'pitch-other-0001' }), 'other')).statusCode).toBe(201);
  });

  it('reads the live call state and deadline while preserving a completed retry', async () => {
    expect((await submit()).statusCode).toBe(201);
    expect((await updateCall({ enabled: false, closesAt: CLOSES_AT })).statusCode).toBe(200);
    expect((await submit(pitch({ submissionKey: 'pitch-after-close' }))).statusCode).toBe(404);
    expect((await submit()).statusCode).toBe(201);
    await db.collection('config').doc('pitch_call').set({ enabled: true, closesAt: CLOSES_AT });
    const afterDeadline = () => Date.parse(CLOSES_AT) + 1;
    expect((await submit(pitch({ submissionKey: 'pitch-after-deadline' }), 'submitter', afterDeadline)).statusCode).toBe(404);
    expect((await submit(pitch(), 'submitter', afterDeadline)).statusCode).toBe(201);
    expect((await db.collection('session_pitches').get()).size).toBe(1);
  });
});

describe('pitch review', () => {
  beforeEach(async () => {
    await db.collection('config').doc('pitch_call').set({ enabled: true, closesAt: CLOSES_AT });
    expect((await submit()).statusCode).toBe(201);
  });

  it('admits staff, stores private notes, and commits each status change with its audit row', async () => {
    expect((await review({
      id: PITCH_ID,
      status: 'in_review',
      expectedStatus: 'new',
      expectedRevision: 0,
      privateNotes: 'Confirm the co-presenter before acceptance.',
    })).statusCode).toBe(200);

    let stored = (await db.collection('session_pitches').doc(PITCH_ID).get()).data();
    expect(stored).toMatchObject({
      status: 'in_review',
      reviewRevision: 1,
      privateNotes: 'Confirm the co-presenter before acceptance.',
      reviewedBy: STAFF_EMAIL,
    });
    let logs = await db.collection('admin_logs').where('action', '==', 'reviewSessionPitch').get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().details).toEqual({
      fromStatus: 'new',
      toStatus: 'in_review',
      fromRevision: 0,
      toRevision: 1,
    });

    const stale = await review({
      id: PITCH_ID,
      status: 'accepted',
      expectedStatus: 'new',
      expectedRevision: 0,
      privateNotes: 'This stale note must not replace the saved note.',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.body.error.code).toBe('status-conflict');
    logs = await db.collection('admin_logs').where('action', '==', 'reviewSessionPitch').get();
    expect(logs.size).toBe(1);

    expect((await review({
      id: PITCH_ID,
      status: 'accepted',
      expectedStatus: 'in_review',
      expectedRevision: 1,
    }, 'operator')).statusCode).toBe(200);
    stored = (await db.collection('session_pitches').doc(PITCH_ID).get()).data();
    expect(stored.status).toBe('accepted');
    expect(stored.reviewRevision).toBe(2);
    expect(stored.privateNotes).toBe('Confirm the co-presenter before acceptance.');
    expect(stored.reviewedBy).toBe(OPERATOR_EMAIL);
    logs = await db.collection('admin_logs').where('action', '==', 'reviewSessionPitch').get();
    expect(logs.size).toBe(2);
  });

  it('lets only one concurrent review with the same status and revision commit its private notes', async () => {
    const reviews = await Promise.all([
      review({
        id: PITCH_ID,
        status: 'new',
        expectedStatus: 'new',
        expectedRevision: 0,
        privateNotes: 'First reviewer note.',
      }),
      review({
        id: PITCH_ID,
        status: 'new',
        expectedStatus: 'new',
        expectedRevision: 0,
        privateNotes: 'Second reviewer note.',
      }, 'operator'),
    ]);
    expect(reviews.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = reviews.find((response) => response.statusCode === 200);
    const stored = (await db.collection('session_pitches').doc(PITCH_ID).get()).data();
    expect(stored.status).toBe(winner.body.status);
    expect(stored.reviewRevision).toBe(1);
    expect(stored.status).toBe('new');
    expect(['First reviewer note.', 'Second reviewer note.']).toContain(stored.privateNotes);
    expect((await db.collection('admin_logs').where('action', '==', 'reviewSessionPitch').get()).size).toBe(1);
  });

  it('refuses non-staff and invalid or missing review targets without side effects', async () => {
    expect((await review({ id: PITCH_ID, status: 'accepted', expectedStatus: 'new', expectedRevision: 0 }, 'submitter')).statusCode).toBe(403);
    expect((await review({ id: PITCH_ID, status: 'published', expectedStatus: 'new', expectedRevision: 0 })).statusCode).toBe(400);
    expect((await review({ id: PITCH_ID, status: 'accepted', expectedStatus: 'new' })).statusCode).toBe(400);
    expect((await review({ id: 'missing-pitch', status: 'rejected', expectedStatus: 'new', expectedRevision: 0 })).statusCode).toBe(404);
    expect((await db.collection('admin_logs').where('action', '==', 'reviewSessionPitch').get()).empty).toBe(true);
    expect((await db.collection('session_pitches').doc(PITCH_ID).get()).data().status).toBe('new');
    expect((await db.collection('cmsSchedule').get()).empty).toBe(true);
    expect((await db.collection('sent_emails').get()).empty).toBe(true);
  });
});
