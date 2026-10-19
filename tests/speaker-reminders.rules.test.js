// Speaker reminders against the real Firestore emulator: who may call the
// endpoint, the send-once rule per speaker per batch, the 24-hour window,
// the historical-demo guard, the wording editor, and the readiness export.
// Authentication and the mail provider are the only fakes. The email core
// is the real one (functions/src/email/send.cjs), so its send-once claims
// and sent_emails rows are real documents.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const {
  createSpeakerRemindersHandler,
  internals: { REMINDER_COOLDOWN_MS, SENDING_STALE_MS, SHIPPED_WORDING },
} = require('../functions/src/speakers/reminders.cjs');
const { createEmailCore, internals: { claimIdForOnceKey } } = require('../functions/src/email/send.cjs');
const { resetTemplateCacheForTest } = require('../functions/src/email/templates.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'reminder-operator@example.test';
const STAFF_EMAIL = 'reminder-staff@example.test';
const T0 = Date.parse('2026-10-19T15:00:00.000Z');
const QUIET = { error() {}, warn() {}, info() {} };
const BATCH = 'batch-0000000001';

const CONFIG = {
  event: {
    name: 'Example Event',
    sender: { email: 'events@example.test', name: 'Example Event' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
    days: [],
    social: { handles: [] },
  },
  theme: { colors: {} },
  tierA: { publicUrl: 'https://site.example.test' },
};

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR_EMAIL, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  stranger: { uid: 'user-1', email: 'someone@example.test', email_verified: true },
};

const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

let testEnv;
let adminApp;
let db;
let outbox;

const provider = {
  name: 'capture',
  async send(message) {
    outbox.push(message);
    return { providerMessageId: `m-${outbox.length}`, status: 'sent' };
  },
};

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

async function call(body, { token = 'staff', now = T0, method = 'POST', handlerDb = db } = {}) {
  const getConfig = async () => CONFIG;
  const core = createEmailCore({ db, provider, getConfig, sleep: async () => {}, log: QUIET });
  const res = makeRes();
  // A send carries the wording version its preview showed; the shipped
  // wording unless a test says otherwise.
  const sent = body?.action === 'send' && !('wordingVersion' in body) ? { ...body, wordingVersion: SHIPPED_WORDING } : body;
  await createSpeakerRemindersHandler({
    db: handlerDb, auth, getConfig, sendEmail: core.send, now: () => now, log: QUIET,
  })({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: sent }, res);
  return res;
}

/** The real database, except that the nth transaction and later ones throw. */
function dbFailingFromTransaction(n) {
  let count = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'runTransaction') {
        return (...args) => {
          count += 1;
          if (count >= n) return Promise.reject(new Error('transaction aborted'));
          return target.runTransaction(...args);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function seed({ historicalDemo = false } = {}) {
  await db.collection('config').doc('bootstrap').set({
    adminEmails: [OPERATOR_EMAIL],
    staffEmails: [STAFF_EMAIL],
  });
  await db.collection('config').doc('event').set({ name: 'Example Event', historicalDemo });
  const speakers = {
    // Missing a headshot, and materials for s1.
    ada: { firstName: 'Ada', lastName: 'Lee', email: 'ada@example.test', status: 'accepted', bio: 'Bio.', headshotPath: '' },
    // Profile complete; owes the description of s2 and materials for s1.
    ben: { firstName: 'Ben', lastName: 'Ode', email: 'ben@example.test', status: 'approved', bio: 'Bio.', headshotPath: 'p.png' },
    // Everything missing, but the invitation is not accepted.
    cy: { firstName: 'Cy', lastName: 'Draft', email: 'cy@example.test', status: 'invited' },
    // Accepted, no email on file.
    di: { firstName: 'Di', lastName: 'Nomail', status: 'accepted' },
  };
  for (const [id, data] of Object.entries(speakers)) await db.collection('speakers').doc(id).set(data);
  await db.collection('cmsSchedule').doc('s1').set({
    title: 'Panel <one>', description: '<p>About.</p>', visible: true, speakerIds: ['ada', 'ben'],
  });
  await db.collection('cmsSchedule').doc('s2').set({
    title: 'Workshop', description: '', visible: true, speakerIds: ['ben'],
  });
  // A hidden session never counts.
  await db.collection('cmsSchedule').doc('s3').set({ title: 'Hidden', description: '', visible: false, speakerIds: ['ada'] });
  await db.collection('session_materials').doc('m1').set({ sessionId: 's2', reviewStatus: 'pending' });
  await db.collection('session_materials').doc('m2').set({ sessionId: 's1', reviewStatus: 'rejected' });
}

async function adminLogs(action) {
  const snap = await db.collection('admin_logs').where('action', '==', action).get();
  return snap.docs.map((d) => d.data());
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `speaker-reminders-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  resetTemplateCacheForTest();
  outbox = [];
  await seed();
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('access', () => {
  it('needs a signed-in staff or operator account and POST', async () => {
    expect((await call({ action: 'list' }, { token: null })).statusCode).toBe(401);
    expect((await call({ action: 'list' }, { token: 'stranger' })).statusCode).toBe(403);
    expect((await call({ action: 'list' }, { method: 'GET' })).statusCode).toBe(405);
    expect((await call({ action: 'nope' })).statusCode).toBe(400);
    expect((await call({ action: 'list' }, { token: 'operator' })).statusCode).toBe(200);
  });

  it('keeps speaker_reminders closed to every browser, admins included', async () => {
    await db.collection('speaker_reminders').doc('ada').set({ lastBatchId: BATCH });
    const staff = testEnv.authenticatedContext('staff-1', { email: STAFF_EMAIL, email_verified: true }).firestore();
    await assertFails(getDoc(doc(staff, 'speaker_reminders/ada')));
  });
});

describe('list and preview', () => {
  it('lists accepted speakers with what each still owes, from the live stores', async () => {
    const res = await call({ action: 'list' });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.body.speakers.map((row) => [row.id, row]));
    expect(Object.keys(byId).sort()).toEqual(['ada', 'ben', 'di']);
    expect(byId.ada.readiness.missing).toEqual(['headshot', 'materials']);
    expect(byId.ada.readiness.materialsSessions).toEqual([{ id: 's1', title: 'Panel <one>' }]);
    expect(byId.ben.readiness.missing).toEqual(['description', 'materials']);
    expect(byId.ben.readiness.descriptionSessions).toEqual([{ id: 's2', title: 'Workshop' }]);
    expect(byId.di.hasEmail).toBe(false);
    expect(byId.ada.lastRemindedAt).toBeNull();
  });

  it('previews the exact message each recipient gets and says why the rest get none', async () => {
    const res = await call({ action: 'preview', speakerIds: ['ada', 'ben', 'cy', 'di', 'zz'], topics: ['materials'] });
    expect(res.statusCode).toBe(200);
    expect(res.body.recipients.map((r) => r.speakerId)).toEqual(['ada', 'ben']);
    const ada = res.body.recipients[0];
    expect(ada.to).toBe('ada@example.test');
    expect(ada.items).toEqual(['materials']);
    expect(ada.html).toContain('Panel &lt;one&gt;');
    expect(ada.html).not.toContain('Panel <one>');
    expect(ada.text).toContain('- Send your slides or other materials for: Panel <one>.');
    expect(ada.text).not.toContain('headshot');
    expect(Object.fromEntries(res.body.skipped.map((s) => [s.speakerId, s.reason]))).toEqual({
      cy: 'not-accepted', di: 'no-email', zz: 'not-found',
    });
    expect(outbox).toHaveLength(0);
  });
});

describe('send', () => {
  it('sends what the preview showed, once per speaker per batch, and records it', async () => {
    const preview = await call({ action: 'preview', speakerIds: ['ada', 'ben'], topics: ['materials'] });
    const sent = await call({ action: 'send', speakerIds: ['ada', 'ben'], topics: ['materials'], batchId: BATCH, confirmCount: 2 });
    expect(sent.statusCode).toBe(200);
    expect(sent.body.sent.map((r) => r.speakerId)).toEqual(['ada', 'ben']);
    expect(outbox.map((m) => m.to)).toEqual(['ada@example.test', 'ben@example.test']);
    // The provider got the bodies the preview showed, footer included.
    expect(outbox[0].subject).toBe(preview.body.recipients[0].subject);
    expect(outbox[0].html).toBe(preview.body.recipients[0].html);
    expect(outbox[0].text).toBe(preview.body.recipients[0].text);

    const state = (await db.collection('speaker_reminders').doc('ada').get()).data();
    expect(state).toMatchObject({ lastBatchId: BATCH, lastStatus: 'sent', lastSentBy: STAFF_EMAIL, lastItems: ['materials'], sentCount: 1 });
    const list = await call({ action: 'list' }, { now: T0 + 1000 });
    expect(list.body.speakers.find((r) => r.id === 'ada').lastRemindedAt).toBe(new Date(T0).toISOString());

    const logs = await adminLogs('sendSpeakerReminders');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ email: STAFF_EMAIL, docPath: 'speaker_reminders' });
    expect(logs[0].details).toMatchObject({ batchId: BATCH, sent: ['ada', 'ben'], requested: 2 });
    const audit = await db.collection('sent_emails').where('templateId', '==', 'speaker.reminder').get();
    expect(audit.size).toBe(2);
  });

  it('a retry or a double click with the same batch sends nothing more', async () => {
    const body = { action: 'send', speakerIds: ['ada'], topics: [], batchId: BATCH, confirmCount: 1 };
    const [first, second] = await Promise.all([call(body), call(body)]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(outbox).toHaveLength(1);
    const replay = await call(body, { now: T0 + 5000 });
    expect(replay.body.sent).toEqual([]);
    expect(replay.body.alreadySent.map((r) => r.speakerId)).toEqual(['ada']);
    expect(outbox).toHaveLength(1);
  });

  it('a new batch inside 24 hours skips the speaker; after 24 hours it sends', async () => {
    await call({ action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1 });
    const again = await call({ action: 'send', speakerIds: ['ada'], batchId: 'batch-0000000002', confirmCount: 1 }, { now: T0 + 60_000 });
    expect(again.body.skipped).toEqual([expect.objectContaining({ speakerId: 'ada', reason: 'recent' })]);
    const preview = await call({ action: 'preview', speakerIds: ['ada'] }, { now: T0 + 60_000 });
    expect(preview.body.skipped[0].reason).toBe('recent');
    const later = await call(
      { action: 'send', speakerIds: ['ada'], batchId: 'batch-0000000003', confirmCount: 1 },
      { now: T0 + REMINDER_COOLDOWN_MS + 1 },
    );
    expect(later.body.sent.map((r) => r.speakerId)).toEqual(['ada']);
    expect(outbox).toHaveLength(2);
    expect((await db.collection('speaker_reminders').doc('ada').get()).data().sentCount).toBe(2);
  });

  it('records the speakers already emailed when a send stops part way', async () => {
    const res = await call(
      { action: 'send', speakerIds: ['ada', 'ben'], batchId: BATCH, confirmCount: 2 },
      { handlerDb: dbFailingFromTransaction(2) },
    );
    expect(res.statusCode).toBe(500);
    expect(outbox.map((m) => m.to)).toEqual(['ada@example.test']);
    const logs = await adminLogs('sendSpeakerReminders');
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toMatchObject({ batchId: BATCH, sent: ['ada'], incomplete: true });

    // The retry's row names who had the mail already, not only a count.
    const retry = await call({ action: 'send', speakerIds: ['ada', 'ben'], batchId: BATCH, confirmCount: 2 }, { now: T0 + 5000 });
    expect(retry.body.sent.map((r) => r.speakerId)).toEqual(['ben']);
    const after = await adminLogs('sendSpeakerReminders');
    const retryRow = after.find((row) => !row.details.incomplete);
    expect(retryRow.details).toMatchObject({ sent: ['ben'], alreadySent: ['ada'] });
  });

  it('a send left "sending" whose mail reached the email core counts as a reminder', async () => {
    const old = 'batch-old-0000001';
    await db.collection('speaker_reminders').doc('ada').set({
      speakerId: 'ada', lastBatchId: old, lastStatus: 'sending', lastAttemptAt: new Date(T0), lastAttemptItems: ['headshot'],
    });
    await db.collection('email_claims').doc(claimIdForOnceKey(`speaker-reminder:ada:${old}`)).set({ onceKey: 'x' });
    const later = T0 + SENDING_STALE_MS + 1;
    const res = await call({ action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1 }, { now: later });
    expect(res.body.skipped).toEqual([expect.objectContaining({ speakerId: 'ada', reason: 'recent' })]);
    expect(outbox).toHaveLength(0);
    const state = (await db.collection('speaker_reminders').doc('ada').get()).data();
    expect(state).toMatchObject({ lastStatus: 'sent', lastBatchId: old, lastItems: ['headshot'] });
    const list = await call({ action: 'list' }, { now: later });
    expect(list.body.speakers.find((r) => r.id === 'ada').lastRemindedAt).toBe(new Date(T0).toISOString());
    // A replay of the old batch reports the mail as sent.
    const replay = await call({ action: 'send', speakerIds: ['ada'], batchId: old, confirmCount: 1 }, { now: later });
    expect(replay.body.alreadySent.map((r) => r.speakerId)).toEqual(['ada']);
    expect(outbox).toHaveLength(0);
  });

  it('a send left "sending" whose mail never reached the email core does not block a new batch', async () => {
    const old = 'batch-old-0000001';
    await db.collection('speaker_reminders').doc('ada').set({
      speakerId: 'ada', lastBatchId: old, lastStatus: 'sending', lastAttemptAt: new Date(T0),
    });
    const later = T0 + SENDING_STALE_MS + 1;
    const replay = await call({ action: 'send', speakerIds: ['ada'], batchId: old, confirmCount: 1 }, { now: later });
    expect(replay.body.failed.map((r) => r.speakerId)).toEqual(['ada']);
    expect(replay.body.alreadySent).toEqual([]);
    const res = await call({ action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1 }, { now: later });
    expect(res.body.sent.map((r) => r.speakerId)).toEqual(['ada']);
    expect(outbox).toHaveLength(1);
  });

  it('refuses a send when the wording changed after the preview', async () => {
    const preview = await call({ action: 'preview', speakerIds: ['ada'] });
    expect(preview.body.wordingVersion).toBe(SHIPPED_WORDING);
    await call({ action: 'saveTemplate', subject: 'New wording for {{event_name}}' });
    const res = await call({
      action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1, wordingVersion: preview.body.wordingVersion,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('stale-preview');
    expect(res.body.error.message).toMatch(/Preview again/);
    expect(outbox).toHaveLength(0);
    expect((await db.collection('speaker_reminders').get()).size).toBe(0);
    const missing = await call({ action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1, wordingVersion: undefined });
    expect(missing.statusCode).toBe(400);
  });

  it('needs the confirmed recipient count and a batch id', async () => {
    const wrong = await call({ action: 'send', speakerIds: ['ada', 'ben'], batchId: BATCH, confirmCount: 1 });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.body.error.message).toMatch(/confirmCount/);
    const noBatch = await call({ action: 'send', speakerIds: ['ada'], confirmCount: 1 });
    expect(noBatch.statusCode).toBe(400);
    expect(outbox).toHaveLength(0);
    expect((await db.collection('speaker_reminders').get()).size).toBe(0);
  });

  it('a historical demo refuses the send before anything is stored', async () => {
    await seed({ historicalDemo: true });
    const res = await call({ action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1 });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('read-only-demo');
    expect(outbox).toHaveLength(0);
    expect((await db.collection('speaker_reminders').get()).size).toBe(0);
    expect((await db.collection('email_claims').get()).size).toBe(0);
    expect(await adminLogs('sendSpeakerReminders')).toHaveLength(0);
    const save = await call({ action: 'saveTemplate', subject: 'Hello {{event_name}}' });
    expect(save.statusCode).toBe(403);
    expect((await db.collection('email_templates').doc('speaker.reminder').get()).exists).toBe(false);
  });
});

describe('wording', () => {
  it('refuses an unknown token at save, and the next preview and send use saved wording', async () => {
    const bad = await call({ action: 'saveTemplate', text: 'Hi {{speaker_name}} {{dashboard_url}} {{nope}}' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error.message).toMatch(/unknown token \{\{nope\}\}/);
    expect((await db.collection('email_templates').doc('speaker.reminder').get()).exists).toBe(false);

    // Loaded once so the in-process cache holds the shipped copy.
    await call({ action: 'preview', speakerIds: ['ada'] });
    const saved = await call({
      action: 'saveTemplate',
      subject: 'Please finish your page for {{event_name}}',
      text: 'Dear {{speaker_name}}: {{dashboard_url}}',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.saved).toMatchObject({ subject: 'Please finish your page for {{event_name}}', updatedBy: STAFF_EMAIL });
    expect(await adminLogs('saveEmailTemplate')).toHaveLength(1);

    const preview = await call({ action: 'preview', speakerIds: ['ada'] });
    expect(preview.body.recipients[0].subject).toBe('Please finish your page for Example Event');
    expect(preview.body.recipients[0].text.startsWith('Dear Ada Lee: https://site.example.test/speaker/dashboard')).toBe(true);
    await call({ action: 'send', speakerIds: ['ada'], batchId: BATCH, confirmCount: 1, wordingVersion: preview.body.wordingVersion });
    expect(outbox[0].subject).toBe('Please finish your page for Example Event');

    const reset = await call({ action: 'resetTemplate' });
    expect(reset.body.saved).toBeNull();
    expect(await adminLogs('resetEmailTemplate')).toHaveLength(1);
  });
});

describe('readiness export', () => {
  it('returns one row per speaker for the group and records the export first', async () => {
    const res = await call({ action: 'export', group: 'materials' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.rowCount).toBe(2);
    const lines = res.body.csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Ada Lee","ada@example.test","accepted","Headshot; Materials"');
    const logs = await adminLogs('exportSpeakerReadiness');
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toEqual({ group: 'materials', rowCount: 2 });
    expect((await call({ action: 'export', group: 'other' })).statusCode).toBe(400);
    expect((await call({ action: 'export', group: 'any' }, { token: 'stranger' })).statusCode).toBe(403);
  });
});
