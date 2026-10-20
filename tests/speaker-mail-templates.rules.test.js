// Speaker mail wording (issue #204) against the real Firestore emulator:
// who may call the endpoint, the save-time token check, the historical-demo
// guard, and the issue's "Done when": wording saved here is what the next
// invitation says. Authentication and the mail provider are the only fakes.
// The email core is the real one (functions/src/email/send.cjs).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { createSpeakerMailTemplatesHandler } = require('../functions/src/speakers/mailTemplates.cjs');
const { createSendSpeakerInviteHandler } = require('../functions/src/speakers/invites.cjs');
const { createEmailCore } = require('../functions/src/email/send.cjs');
const { resetTemplateCacheForTest } = require('../functions/src/email/templates.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'mail-operator@example.test';
const STAFF_EMAIL = 'mail-staff@example.test';
const T0 = Date.parse('2026-10-20T15:00:00.000Z');
const QUIET = { error() {}, warn() {}, info() {} };

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

function request(body, { token = 'staff', method = 'POST' } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}

async function call(body, options) {
  const res = makeRes();
  await createSpeakerMailTemplatesHandler({
    db, auth, getConfig: async () => CONFIG, now: () => T0, log: QUIET,
  })(request(body, options), res);
  return res;
}

async function invite(speakerId) {
  const core = createEmailCore({ db, provider, getConfig: async () => CONFIG, sleep: async () => {}, log: QUIET });
  const res = makeRes();
  await createSendSpeakerInviteHandler({
    db, auth, getConfig: async () => CONFIG, sendEmail: core.send, now: () => T0, log: QUIET,
  })(request({ speakerId }), res);
  return res;
}

async function seed({ historicalDemo = false } = {}) {
  await db.collection('config').doc('bootstrap').set({
    adminEmails: [OPERATOR_EMAIL],
    staffEmails: [STAFF_EMAIL],
  });
  await db.collection('config').doc('event').set({ name: 'Example Event', historicalDemo });
  for (const [id, firstName] of [['ada', 'Ada'], ['ben', 'Ben']]) {
    await db.collection('speakers').doc(id).set({
      firstName, lastName: 'Lee', email: `${id}@example.test`, status: 'draft', uid: null, inviteToken: null,
    });
  }
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
  adminApp = initializeApp({ projectId: PROJECT_ID }, `speaker-mail-templates-${process.pid}`);
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
    expect((await call({ action: 'templates' }, { token: null })).statusCode).toBe(401);
    expect((await call({ action: 'templates' }, { token: 'stranger' })).statusCode).toBe(403);
    expect((await call({ action: 'templates' }, { method: 'GET' })).statusCode).toBe(405);
    expect((await call({ action: 'templates' })).statusCode).toBe(200);
    expect((await call({ action: 'templates' }, { token: 'operator' })).statusCode).toBe(200);
  });

  it('keeps email_templates closed to every browser, admins included', async () => {
    await db.collection('email_templates').doc('speaker.invite').set({ subject: 'Hi {{event_name}}' });
    const staff = testEnv.authenticatedContext('staff-1', { email: STAFF_EMAIL, email_verified: true }).firestore();
    await assertFails(getDoc(doc(staff, 'email_templates/speaker.invite')));
  });
});

describe('wording', () => {
  it('refuses an unknown token at save, and the next invite uses the saved wording', async () => {
    const bad = await call({
      action: 'saveTemplate', templateId: 'speaker.invite', text: 'Hi {{speaker_name}} {{invite_url}} {{nope}}',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error.message).toMatch(/text: unknown token \{\{nope\}\}/);
    expect((await db.collection('email_templates').doc('speaker.invite').get()).exists).toBe(false);

    // A first invite renders, and would cache, the shipped copy.
    expect((await invite('ada')).statusCode).toBe(200);
    expect(outbox[0].subject).toBe('You are invited to speak at Example Event');

    const saved = await call({
      action: 'saveTemplate',
      templateId: 'speaker.invite',
      subject: 'Join us at {{event_name}}',
      text: 'Dear {{speaker_name}}, accept here: {{invite_url}}',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.template.saved).toMatchObject({ subject: 'Join us at {{event_name}}', updatedBy: STAFF_EMAIL });
    expect(await adminLogs('saveEmailTemplate')).toHaveLength(1);

    const preview = await call({ action: 'preview', templateId: 'speaker.invite' });
    expect(preview.body.preview.source).toBe('saved');
    expect(preview.body.preview.subject).toBe('Join us at Example Event');

    expect((await invite('ben')).statusCode).toBe(200);
    expect(outbox[1].subject).toBe('Join us at Example Event');
    expect(outbox[1].text.startsWith('Dear Ben Lee, accept here: https://site.example.test/speaker/accept?token=')).toBe(true);
    // The invite body carries a bearer link, so sent_emails never stores it.
    const rows = await db.collection('sent_emails').get();
    expect(rows.size).toBe(2);
    for (const row of rows.docs) expect(row.data()).toMatchObject({ bodyStored: false, html: null, text: null });

    const reset = await call({ action: 'resetTemplate', templateId: 'speaker.invite' });
    expect(reset.body.template.saved).toBeNull();
    expect(await adminLogs('resetEmailTemplate')).toHaveLength(1);
  });

  it('a historical demo refuses save and reset before anything is stored', async () => {
    await seed({ historicalDemo: true });
    const save = await call({ action: 'saveTemplate', templateId: 'speaker.accepted', subject: 'Hi {{event_name}}' });
    expect(save.statusCode).toBe(403);
    expect(save.body.error.code).toBe('read-only-demo');
    const reset = await call({ action: 'resetTemplate', templateId: 'speaker.accepted' });
    expect(reset.statusCode).toBe(403);
    expect((await db.collection('email_templates').doc('speaker.accepted').get()).exists).toBe(false);
    expect(await adminLogs('saveEmailTemplate')).toHaveLength(0);
    expect(await adminLogs('resetEmailTemplate')).toHaveLength(0);
  });
});
