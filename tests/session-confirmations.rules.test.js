// Staff-sent session confirmations against the real Firestore emulator:
// the preview, the claim transaction, the delivery record, send-once keys,
// the changed-slot resend, failure, uncertain delivery, and the rules on
// the record. Authentication and the mail provider are the only fakes.
// Mail goes through the real central sender (functions/src/email/send.cjs),
// so the demo guard, the email_claims rows and the sent_emails log are real.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { createSendSessionConfirmationHandler } = require('../functions/src/speakers/sessionConfirmations.cjs');
const { createEmailCore } = require('../functions/src/email/send.cjs');
const { getEventConfig } = require('../functions/src/core/config.cjs');
const { resetTemplateCacheForTest } = require('../functions/src/email/templates.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'confirm-operator@example.test';
const STAFF_EMAIL = 'confirm-staff@example.test';
const SPEAKER_EMAIL = 'rae@example.test';
const T0 = Date.parse('2026-11-08T16:00:00.000Z');
const RECORD_ID = 'sess-1__rae';
const QUIET = { error() {}, warn() {}, info() {} };

const TOKENS = {
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  attendee: { uid: 'attendee-1', email: 'attendee@example.test', email_verified: true },
};
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

const provider = {
  name: 'fake',
  mode: 'ok',
  messages: [],
  async send(message) {
    if (provider.mode === 'throw') throw new Error('socket hang up');
    if (provider.mode === 'fail') return { providerMessageId: null, status: 'failed', providerStatus: 422, error: 'Inactive recipient' };
    provider.messages.push(message);
    return { providerMessageId: `msg-${provider.messages.length}`, status: 'sent' };
  },
};

const SESSION = {
  title: 'Reporting on Deadline', dayId: 'day-1', startTime: '10:00 AM', endTime: '10:45 AM',
  location: 'Room B', speakerIds: ['rae'], visible: true,
};
const NAMED = { title: 'Reporting on Deadline', time: '2027-05-13 · 10:00 AM–10:45 AM', room: 'Room B' };

let testEnv;
let adminApp;
let db;

const getConfig = () => getEventConfig({ db, forceRefresh: true });
const sendEmail = (message) => createEmailCore({ db, provider, getConfig, sleep: async () => {}, log: QUIET }).send(message);

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

async function confirm(body, token = 'staff', now = () => T0) {
  // A send carries the preview's content hash, as the panel does.
  if (!body.preview && !body.expectedContent) {
    const preview = await confirm({ sessionId: body.sessionId, speakerId: body.speakerId, preview: true }, 'staff', now);
    body = { ...body, expectedContent: preview.body?.preview?.contentHash ?? 'f'.repeat(64) };
  }
  const res = makeRes();
  await createSendSessionConfirmationHandler({ db, auth, getConfig, sendEmail, now, log: QUIET })(
    { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body },
    res,
  );
  return res;
}

const BODY = { sessionId: 'sess-1', speakerId: 'rae' };
const record = async () => (await db.collection('session_confirmations').doc(RECORD_ID).get()).data();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `session-confirmations-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  resetTemplateCacheForTest();
  provider.mode = 'ok';
  provider.messages.length = 0;
  await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] });
  await db.collection('config').doc('event').set({
    name: 'Example Summit',
    historicalDemo: false,
    days: [{ id: 'day-1', date: '2027-05-13' }],
    sender: { email: 'events@example.test', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
  });
  await db.collection('cmsSchedule').doc('sess-1').set(SESSION);
  await db.collection('speakers').doc('rae').set({ firstName: 'Rae', lastName: 'Okonkwo', email: SPEAKER_EMAIL, status: 'approved' });
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('sendSessionConfirmation', () => {
  it('previews without a write, then sends once and records it as sent', async () => {
    const preview = await confirm({ ...BODY, preview: true });
    expect(preview.statusCode).toBe(200);
    expect(preview.body.preview).toMatchObject({
      to: SPEAKER_EMAIL, named: NAMED, changedSinceLastSend: false, previous: null, blocked: null,
      subject: 'Your session at Example Summit is confirmed: Reporting on Deadline',
    });
    expect((await db.collection('session_confirmations').get()).size).toBe(0);
    expect(provider.messages).toHaveLength(0);

    const sent = await confirm({ ...BODY, expectedNamed: preview.body.preview.named });
    expect(sent.statusCode).toBe(200);
    expect(sent.body).toEqual({ state: 'sent', attempt: 1 });
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0].to).toBe(SPEAKER_EMAIL);
    expect(provider.messages[0].text).toContain('Room B');
    expect(await record()).toMatchObject({
      sessionId: 'sess-1', speakerId: 'rae', state: 'sent', attempt: 1, named: NAMED, queuedBy: STAFF_EMAIL,
      onceKey: 'speaker-confirmation:rae:sess-1:1', error: null,
    });
    const log = (await db.collection('sent_emails').get()).docs.map((d) => d.data());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ templateId: 'speaker.confirmation', status: 'sent', source: 'speaker-confirmation' });
    const audit = (await db.collection('admin_logs').where('action', '==', 'sendSessionConfirmation').get()).docs;
    expect(audit).toHaveLength(1);

    const again = await confirm({ ...BODY, expectedNamed: NAMED });
    expect(again.statusCode).toBe(409);
    expect(again.body.error.code).toBe('already-sent');
    expect(provider.messages).toHaveLength(1);
  });

  it('does not send twice for concurrent sends of the same slot', async () => {
    const results = await Promise.all([1, 2, 3].map(() => confirm({ ...BODY, expectedNamed: NAMED })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(provider.messages).toHaveLength(1);
    expect((await record()).attempt).toBe(1);
  });

  it('sends a new attempt after the room changes, and refuses the old slot', async () => {
    expect((await confirm({ ...BODY, expectedNamed: NAMED })).statusCode).toBe(200);
    await db.collection('cmsSchedule').doc('sess-1').set({ ...SESSION, location: 'Room C' });
    const preview = await confirm({ ...BODY, preview: true });
    expect(preview.body.preview.changedSinceLastSend).toBe(true);
    const stale = await confirm({ ...BODY, expectedNamed: NAMED });
    expect(stale.body.error.code).toBe('slot-changed');
    const moved = await confirm({ ...BODY, expectedNamed: preview.body.preview.named });
    expect(moved.statusCode).toBe(200);
    expect(moved.body.attempt).toBe(2);
    expect(provider.messages).toHaveLength(2);
    expect(provider.messages[1].text).toContain('Room C');
    expect((await db.collection('email_claims').get()).size).toBe(2);
  });

  it('records a refusal as failed and a provider throw as uncertain', async () => {
    provider.mode = 'fail';
    const failed = await confirm({ ...BODY, expectedNamed: NAMED });
    expect(failed.statusCode).toBe(502);
    expect(failed.body.error.code).toBe('delivery-failed');
    expect(await record()).toMatchObject({ state: 'failed', attempt: 1, error: 'Inactive recipient' });

    provider.mode = 'throw';
    const unknown = await confirm({ ...BODY, expectedNamed: NAMED });
    expect(unknown.body.error.code).toBe('delivery-unknown');
    expect(await record()).toMatchObject({ state: 'uncertain', attempt: 2 });

    provider.mode = 'ok';
    expect((await confirm({ ...BODY, expectedNamed: NAMED })).body.error.code).toBe('delivery-unknown');
    const confirmed = await confirm({ ...BODY, expectedNamed: NAMED, confirmUnknown: true });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.body.attempt).toBe(3);
  });

  it('refuses an attendee and an unpublished session', async () => {
    expect((await confirm({ ...BODY, expectedNamed: NAMED }, 'attendee')).statusCode).toBe(403);
    await db.collection('cmsSchedule').doc('sess-1').set({ ...SESSION, visible: false });
    const hidden = await confirm({ ...BODY, expectedNamed: NAMED });
    expect(hidden.statusCode).toBe(409);
    expect(hidden.body.error.code).toBe('session-hidden');
    expect(provider.messages).toHaveLength(0);
  });

  it('lets staff read the record and no client write it', async () => {
    expect((await confirm({ ...BODY, expectedNamed: NAMED })).statusCode).toBe(200);
    const staff = testEnv.authenticatedContext('staff-1', { email: STAFF_EMAIL, email_verified: true }).firestore();
    const attendee = testEnv.authenticatedContext('attendee-1', { email: 'attendee@example.test', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(staff, `session_confirmations/${RECORD_ID}`)));
    await assertFails(getDoc(doc(attendee, `session_confirmations/${RECORD_ID}`)));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), `session_confirmations/${RECORD_ID}`)));
    await assertFails(setDoc(doc(staff, `session_confirmations/${RECORD_ID}`), { state: 'failed' }));
  });
});
