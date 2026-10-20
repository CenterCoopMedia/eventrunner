// Change request progress and notices (issue #330) against the real
// Firestore emulator: the acknowledgement, the outcome email, the send-once
// claims, a provider failure and the staff retry, the suppression check,
// and the requester's own read, which must never show another requester's
// request or any staff-only field. Authentication and the mail provider are
// the only fakes. Mail goes through the real central sender
// (functions/src/email/send.cjs), so the demo guard, the email_claims rows
// and the sent_emails log are real.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
  createSubmitChangeRequestHandler,
  createUpdateChangeRequestStatusHandler,
  createSaveChangeRequestOutcomeHandler,
  createListMyChangeRequestsHandler,
} = require('../functions/src/admin/changeRequests.cjs');
const {
  createSaveChangeRequestNoticeSettingsHandler,
  createRetryChangeRequestNoticeHandler,
} = require('../functions/src/admin/changeRequestNotices.cjs');
const { createEmailCore } = require('../functions/src/email/send.cjs');
const { getEventConfig } = require('../functions/src/core/config.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'cr-operator@example.test';
const STAFF_EMAIL = 'cr-staff@example.test';
const ADA_EMAIL = 'cr-ada@example.test';
const BO_EMAIL = 'cr-bo@example.test';
const SITE = 'https://summit.example.test';
const T0 = Date.parse('2026-10-20T16:00:00.000Z');
const QUIET = { error() {}, warn() {}, info() {} };

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR_EMAIL, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  ada: { uid: 'ada-1', email: ADA_EMAIL, email_verified: true },
  bo: { uid: 'bo-1', email: BO_EMAIL, email_verified: true },
};
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

// The provider fake records every message it accepts. `mode` makes it
// report a non-retryable refusal, as a real adapter can.
const provider = {
  name: 'fake',
  mode: 'ok',
  messages: [],
  async send(message) {
    if (provider.mode === 'fail') return { providerMessageId: null, status: 'failed', providerStatus: 422, error: 'Inactive recipient' };
    provider.messages.push(message);
    return { providerMessageId: `msg-${provider.messages.length}`, status: 'sent' };
  },
};

let testEnv;
let adminApp;
let db;

// The site address comes from the deploy environment in production; the
// test names it here.
const getConfig = async () => ({ ...(await getEventConfig({ db, forceRefresh: true })), tierA: { publicUrl: SITE } });
const sendEmail = (message) => createEmailCore({ db, provider, getConfig, sleep: async () => {}, log: QUIET }).send(message);

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

async function call(create, token, body, now = () => T0) {
  const res = makeRes();
  await create({ db, auth, getConfig, sendEmail, now, log: QUIET })(
    { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body },
    res,
  );
  return res;
}

const submit = (token, key, message = 'The travel page lists the wrong hotel.') =>
  call(createSubmitChangeRequestHandler, token, { message, page: '/travel', submissionKey: key });
const setStatus = (id, status, at = T0 + 1000) => call(createUpdateChangeRequestStatusHandler, 'staff', { id, status }, () => at);
const listMine = (token) => call(createListMyChangeRequestsHandler, token, {});
const retry = (body, at = T0 + 5000) => call(createRetryChangeRequestNoticeHandler, 'staff', body, () => at);
const readRequest = async (id) => (await db.collection('change_requests').doc(id).get()).data();
const sentRows = async () => (await db.collection('sent_emails').get()).docs.map((d) => d.data());

async function turnOn(acknowledgement = 'automatic', outcome = 'automatic') {
  const snap = await db.collection('change_request_settings').doc('notices').get();
  const res = await call(createSaveChangeRequestNoticeSettingsHandler, 'operator', {
    acknowledgement, outcome, expectedRevision: snap.exists ? snap.data().revision : 0,
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `change-request-notices-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  provider.mode = 'ok';
  provider.messages.length = 0;
  await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] });
  await db.collection('config').doc('features').set({ changeRequests: true });
  await db.collection('config').doc('event').set({
    name: 'Example Summit',
    historicalDemo: false,
    sender: { email: 'events@example.test', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
  });
  await db.collection('users').doc('ada-1').set({ uid: 'ada-1', email: ADA_EMAIL });
  await db.collection('users').doc('bo-1').set({ uid: 'bo-1', email: BO_EMAIL });
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('notices are off by default', () => {
  it('a request and its outcome send nothing until an operator turns them on', async () => {
    expect((await submit('ada', 'ada-key-0001')).statusCode).toBe(201);
    expect((await setStatus('ada-key-0001', 'done')).statusCode).toBe(200);
    expect(provider.messages).toHaveLength(0);
    expect((await db.collection('email_claims').get()).size).toBe(0);
    expect((await readRequest('ada-key-0001')).notices).toBeUndefined();
  });
});

describe('the acknowledgement and the outcome', () => {
  it('each goes once, on the transactional stream, with a claim and a log row, and holds no request text', async () => {
    await turnOn();
    await db.collection('config').doc('providers').set({ email: { messageStream: 'outbound', announcementStream: 'broadcast' } });
    const results = await Promise.all([submit('ada', 'ada-key-0001'), submit('ada', 'ada-key-0001')]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    expect((await setStatus('ada-key-0001', 'done')).body.notice).toEqual({ slot: 'done', state: 'sent' });
    expect((await setStatus('ada-key-0001', 'done', T0 + 2000)).body.notice).toBeNull();

    expect(provider.messages.map((m) => [m.to, m.tag, m.messageStream])).toEqual([
      [ADA_EMAIL, 'changeRequest.received', 'outbound'],
      [ADA_EMAIL, 'changeRequest.done', 'outbound'],
    ]);
    for (const mail of provider.messages) {
      expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/hotel|\/travel/);
      expect(mail.text).toContain(`${SITE}/profile/change-requests`);
    }
    const claims = (await db.collection('email_claims').get()).docs.map((d) => d.data().onceKey).sort();
    expect(claims).toEqual([
      'change-request-notice:ada-key-0001:done:1',
      'change-request-notice:ada-key-0001:received:1',
    ]);
    const rows = await sentRows();
    expect(rows.map((r) => [r.templateId, r.status, r.source]).sort()).toEqual([
      ['changeRequest.done', 'sent', 'change-requests'],
      ['changeRequest.received', 'sent', 'change-requests'],
    ]);
    const stored = await readRequest('ada-key-0001');
    expect(stored.notices.received.state).toBe('sent');
    expect(stored.notices.done.state).toBe('sent');
  });

  it('a provider refusal leaves the status saved, marks the email failed, and a staff retry sends it once', async () => {
    await turnOn('off', 'automatic');
    await submit('ada', 'ada-key-0002');
    provider.mode = 'fail';
    const declined = await setStatus('ada-key-0002', 'declined');
    expect(declined.statusCode).toBe(200);
    expect(declined.body.notice).toEqual({ slot: 'declined', state: 'failed' });
    const stored = await readRequest('ada-key-0002');
    expect(stored.status).toBe('declined');
    expect(stored.notices.declined).toMatchObject({ state: 'failed', attempt: 1 });
    expect((await sentRows()).map((r) => r.status)).toEqual(['failed']);

    provider.mode = 'ok';
    const retried = await retry({ id: 'ada-key-0002', slot: 'declined' });
    expect(retried.body).toEqual({ id: 'ada-key-0002', slot: 'declined', state: 'sent', attempt: 2 });
    expect((await retry({ id: 'ada-key-0002', slot: 'declined' })).statusCode).toBe(409);
    expect(provider.messages.map((m) => m.tag)).toEqual(['changeRequest.declined']);
    const retryLogs = (await db.collection('admin_logs').where('action', '==', 'retryChangeRequestNotice').get()).docs;
    expect(retryLogs).toHaveLength(1);
  });

  it('an address with a suppression record gets nothing, and the record says so', async () => {
    await turnOn();
    const id = createHash('sha256').update(ADA_EMAIL, 'utf8').digest('hex');
    await db.collection('email_suppressions').doc(id).set({ via: 'link', at: new Date(T0) });
    await submit('ada', 'ada-key-0003');
    expect(provider.messages).toHaveLength(0);
    expect((await readRequest('ada-key-0003')).notices.received.state).toBe('suppressed');
    expect(await sentRows()).toEqual([]);
  });

  it('a historical demo queues nothing and sends nothing', async () => {
    await turnOn();
    await db.collection('config').doc('event').set({ historicalDemo: true }, { merge: true });
    expect((await submit('ada', 'ada-key-0004')).statusCode).toBe(201);
    expect(provider.messages).toHaveLength(0);
    expect((await readRequest('ada-key-0004')).notices).toBeUndefined();
  });
});

describe('the requester’s own view', () => {
  it('each requester sees only their own requests, with no identity, staff or delivery field', async () => {
    await turnOn();
    await submit('ada', 'ada-key-0005', 'Ada wants the hotel fixed.');
    await submit('bo', 'bo-key-00001', 'Bo wants a new map.');
    await setStatus('ada-key-0005', 'done');
    const saved = await call(createSaveChangeRequestOutcomeHandler, 'staff', {
      id: 'ada-key-0005', reply: 'Fixed the hotel name.', resultUrl: `${SITE}/travel`, resultChecked: true,
    });
    expect(saved.statusCode).toBe(200);

    const ada = await listMine('ada');
    expect(ada.statusCode).toBe(200);
    expect(ada.body.requests).toHaveLength(1);
    const [row] = ada.body.requests;
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'history', 'id', 'message', 'outcome', 'page', 'status']);
    expect(row).toMatchObject({ id: 'ada-key-0005', message: 'Ada wants the hotel fixed.', status: 'done' });
    expect(row.outcome).toEqual({
      status: 'done', reply: 'Fixed the hotel name.', resultUrl: `${SITE}/travel`, recordedAt: new Date(T0 + 1000).toISOString(),
    });
    expect(row.history.map((entry) => entry.status)).toEqual(['new', 'done']);
    const text = JSON.stringify(ada.body);
    for (const secret of [ADA_EMAIL, 'ada-1', STAFF_EMAIL, 'Bo wants', BO_EMAIL, 'sent', 'onceKey']) {
      expect(text).not.toContain(secret);
    }

    const bo = await listMine('bo');
    expect(bo.body.requests.map((r) => r.id)).toEqual(['bo-key-00001']);
    expect(JSON.stringify(bo.body)).not.toContain('Ada wants');
  });

  it('the requester still cannot read the stored document through the rules', async () => {
    await submit('ada', 'ada-key-0006');
    const requester = testEnv.authenticatedContext('ada-1', { email: ADA_EMAIL, email_verified: true }).firestore();
    const { getDoc, doc, getDocs, collection, query, where } = await import('firebase/firestore');
    const { assertFails } = await import('@firebase/rules-unit-testing');
    await assertFails(getDoc(doc(requester, 'change_requests/ada-key-0006')));
    await assertFails(getDocs(query(collection(requester, 'change_requests'), where('uid', '==', 'ada-1'))));
    await assertFails(getDoc(doc(requester, 'change_request_settings/notices')));
  });
});
