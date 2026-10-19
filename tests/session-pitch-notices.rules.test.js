// Session pitch emails (issue #324) against the real Firestore emulator:
// the automatic receipt, staff-sent decision emails, delivery records,
// send-once keys, failure and retry, and the operator's wording settings.
// Authentication and the mail provider are the only fakes. Mail goes
// through the real central sender (functions/src/email/send.cjs), so the
// demo guard, the email_claims rows and the sent_emails log are real.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
  createSubmitSessionPitchHandler,
  createReviewSessionPitchHandler,
} = require('../functions/src/sessions/pitches.cjs');
const {
  createSendSessionPitchNoticeHandler,
  createSavePitchNoticeSettingsHandler,
  internals: { QUEUED_STALE_MS },
} = require('../functions/src/sessions/pitchNotices.cjs');
const { createQueueHandler } = require('../functions/src/sessions/pitchQueue.cjs');
const { createEmailCore } = require('../functions/src/email/send.cjs');
const { getEventConfig } = require('../functions/src/core/config.cjs');
const { PITCH_NOTICE_DEFAULTS } = require('shared/pitch');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'notice-operator@example.test';
const STAFF_EMAIL = 'notice-staff@example.test';
const SUBMITTER_EMAIL = 'notice-submitter@example.test';
const T0 = Date.parse('2026-10-05T16:00:00.000Z');
const KEY = 'notice-key-000001';
const PITCH_ID = createHash('sha256').update(`submitter-1\0${KEY}`).digest('hex');
const TITLE = 'Local <b>reporting</b> & "partners"';
const NOTES = 'PRIVATE-NOTE: weak speaker list';
const QUIET = { error() {}, warn() {}, info() {} };

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR_EMAIL, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  submitter: { uid: 'submitter-1', email: SUBMITTER_EMAIL, email_verified: true },
};
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

// The provider fake: records every message it accepts. `mode` makes it
// report a non-retryable failure or throw, as a real adapter can.
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

async function call(create, token, body, now = () => T0) {
  const res = makeRes();
  await create({ db, auth, getConfig, sendEmail, now, log: QUIET })(
    { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body },
    res,
  );
  return res;
}

const submit = (overrides = {}) => call(createSubmitSessionPitchHandler, 'submitter', {
  title: TITLE,
  description: 'A practical session about shared reporting.',
  organization: 'Example newsroom',
  format: 'Panel',
  submissionKey: KEY,
  consent: true,
  ...overrides,
});
const review = (body, token = 'staff') => call(createReviewSessionPitchHandler, token, body, () => T0 + 1000);
const notice = (body, token = 'staff', now = () => T0 + 2000) => call(createSendSessionPitchNoticeHandler, token, body, now);
const saveSettings = (body, token = 'operator') => call(createSavePitchNoticeSettingsHandler, token, body);

async function readPitch(id = PITCH_ID) {
  return (await db.collection('session_pitches').doc(id).get()).data();
}

async function logs(action) {
  return (await db.collection('admin_logs').where('action', '==', action).get()).docs.map((d) => d.data());
}

async function accept(id = PITCH_ID, status = 'accepted') {
  const stored = await readPitch(id);
  const response = await review({
    id, status, expectedStatus: stored.status, expectedRevision: stored.reviewRevision ?? 0, privateNotes: NOTES,
  });
  expect(response.statusCode).toBe(200);
  return response.body.revision;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `session-pitch-notices-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  provider.mode = 'ok';
  provider.messages.length = 0;
  await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] });
  await db.collection('config').doc('event').set({
    name: 'Example Summit',
    historicalDemo: false,
    sender: { email: 'events@example.test', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
  });
  await db.collection('config').doc('pitch_call').set({
    enabled: true, closesAt: '2026-11-15T22:00:00.000Z', externalFormUrl: null,
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('automatic pitch receipt', () => {
  it('sends one escaped receipt after the pitch commits and records it as sent', async () => {
    const response = await submit();
    expect(response.statusCode).toBe(201);
    expect(provider.messages).toHaveLength(1);
    const [mail] = provider.messages;
    expect(mail.to).toBe(SUBMITTER_EMAIL);
    expect(mail.tag).toBe('pitch.receipt');
    expect(mail.subject).toBe('We received your session pitch for Example Summit');
    expect(mail.html).toContain('Local &lt;b&gt;reporting&lt;/b&gt; &amp; &quot;partners&quot;');
    expect(mail.html).not.toContain('<b>reporting');
    expect(mail.text).toContain(`We received “${TITLE}”.`);

    const stored = await readPitch();
    expect(stored.status).toBe('new');
    expect(stored.notices.receipt).toMatchObject({
      state: 'sent', templateId: 'pitch.receipt', attempt: 1, mode: 'automatic', to: SUBMITTER_EMAIL,
      onceKey: `pitch-notice:${PITCH_ID}:receipt:1`, error: null,
    });
    const sent = (await db.collection('sent_emails').get()).docs.map((d) => d.data());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ templateId: 'pitch.receipt', status: 'sent', source: 'session-pitches', to: SUBMITTER_EMAIL });
  });

  it('does not send a second receipt for a retried or concurrent submission', async () => {
    const results = await Promise.all([submit(), submit(), submit()]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    expect((await submit()).statusCode).toBe(201);
    expect(provider.messages).toHaveLength(1);
    expect((await db.collection('email_claims').get()).size).toBe(1);
    expect((await readPitch()).notices.receipt.attempt).toBe(1);
  });

  it('keeps the submission when the receipt fails, and staff can retry it once', async () => {
    provider.mode = 'fail';
    const response = await submit();
    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({ id: PITCH_ID, ok: true });
    let stored = await readPitch();
    expect(stored.title).toBe(TITLE);
    expect(stored.notices.receipt).toMatchObject({ state: 'failed', attempt: 1, error: 'Inactive recipient' });

    provider.mode = 'ok';
    const retry = await notice({ id: PITCH_ID, kind: 'receipt', expectedStatus: 'new', expectedRevision: 0 });
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toEqual({ state: 'sent', templateId: 'pitch.receipt', attempt: 2 });
    stored = await readPitch();
    expect(stored.notices.receipt).toMatchObject({
      state: 'sent', attempt: 2, mode: 'manual', queuedBy: STAFF_EMAIL, onceKey: `pitch-notice:${PITCH_ID}:receipt:2`, error: null,
    });
    expect(provider.messages).toHaveLength(1);

    const again = await notice({ id: PITCH_ID, kind: 'receipt', expectedStatus: 'new', expectedRevision: 0 });
    expect(again.statusCode).toBe(409);
    expect(again.body.error.code).toBe('already-sent');
    expect(provider.messages).toHaveLength(1);
  });

  it('keeps the submission when the provider throws', async () => {
    provider.mode = 'throw';
    expect((await submit()).statusCode).toBe(201);
    expect((await readPitch()).notices.receipt).toMatchObject({ state: 'failed', error: 'socket hang up' });
  });

  it('sends no receipt in the manual mode until staff send it', async () => {
    expect((await saveSettings({ receiptMode: 'manual' })).statusCode).toBe(200);
    expect((await submit()).statusCode).toBe(201);
    expect(provider.messages).toHaveLength(0);
    expect((await readPitch()).notices).toBeUndefined();

    const preview = await notice({ id: PITCH_ID, kind: 'receipt', expectedStatus: 'new', expectedRevision: 0, preview: true });
    expect(preview.statusCode).toBe(200);
    expect(preview.body.preview).toMatchObject({ to: SUBMITTER_EMAIL, templateId: 'pitch.receipt' });
    expect(provider.messages).toHaveLength(0);

    const sent = await notice({ id: PITCH_ID, kind: 'receipt', expectedStatus: 'new', expectedRevision: 0 });
    expect(sent.statusCode).toBe(200);
    expect(provider.messages).toHaveLength(1);
  });

  it('sends nothing and records nothing in a historical demo', async () => {
    await db.collection('config').doc('event').update({ historicalDemo: true });
    expect((await submit()).statusCode).toBe(201);
    expect(provider.messages).toHaveLength(0);
    expect((await readPitch()).notices).toBeUndefined();
    expect((await db.collection('email_claims').get()).empty).toBe(true);
  });

  it('never mails an imported pitch, and refuses a receipt for one', async () => {
    const imported = await call((deps) => createQueueHandler(deps, 'import'), 'staff', {
      source: 'airtable-form',
      rows: [{ externalId: 'rec1', email: 'imported@example.test', title: 'Imported pitch', description: 'From a CSV.', consent: true }],
    });
    expect(imported.statusCode).toBe(200);
    expect(provider.messages).toHaveLength(0);
    const [row] = (await db.collection('session_pitches').get()).docs;
    expect(row.data().notices).toBeUndefined();

    const receipt = await notice({ id: row.id, kind: 'receipt', expectedStatus: 'new', expectedRevision: 0 });
    expect(receipt.statusCode).toBe(400);
    expect(receipt.body.error.message).toBe('Imported pitches do not get a receipt.');
    expect(provider.messages).toHaveLength(0);
  });
});

describe('decision emails', () => {
  beforeEach(async () => {
    await saveSettings({ receiptMode: 'manual' });
    expect((await submit()).statusCode).toBe(201);
  });

  it('saving a decision sends nothing; a preview writes nothing and leaves out private notes', async () => {
    const revision = await accept();
    expect(provider.messages).toHaveLength(0);
    expect((await readPitch()).notices).toBeUndefined();

    const preview = await notice({
      id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision,
      feedback: 'Plan for 45 minutes.', preview: true,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body.preview).toMatchObject({
      to: SUBMITTER_EMAIL,
      templateId: 'pitch.accepted',
      subject: 'Your session pitch for Example Summit is accepted',
    });
    expect(preview.body.preview.text).toContain('A note from the organizers:\nPlan for 45 minutes.');
    expect(preview.body.preview.text).not.toContain('PRIVATE-NOTE');
    expect(provider.messages).toHaveLength(0);
    expect((await readPitch()).notices).toBeUndefined();
    expect(await logs('sendSessionPitchNotice')).toHaveLength(0);
  });

  it('sends one acceptance with the submitter note, audits it, and never sends it twice', async () => {
    const revision = await accept();
    const body = {
      id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision,
      feedback: 'Plan for <45> minutes.',
    };
    const response = await notice(body);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ state: 'sent', templateId: 'pitch.accepted', attempt: 1 });
    expect(provider.messages).toHaveLength(1);
    const [mail] = provider.messages;
    expect(mail.to).toBe(SUBMITTER_EMAIL);
    expect(mail.html).toContain('Plan for &lt;45&gt; minutes.');
    expect(mail.text).toContain('Plan for <45> minutes.');
    for (const part of [mail.subject, mail.html, mail.text]) expect(part).not.toContain('PRIVATE-NOTE');

    const stored = await readPitch();
    expect(stored).toMatchObject({ status: 'accepted', reviewRevision: revision, privateNotes: NOTES });
    expect(stored.notices.accepted).toMatchObject({
      state: 'sent', templateId: 'pitch.accepted', attempt: 1, feedback: 'Plan for <45> minutes.',
      queuedBy: STAFF_EMAIL, reviewRevision: revision, onceKey: `pitch-notice:${PITCH_ID}:accepted:1`,
    });
    const [audit] = await logs('sendSessionPitchNotice');
    expect(audit).toMatchObject({
      docPath: `session_pitches/${PITCH_ID}`, email: STAFF_EMAIL,
      details: { templateId: 'pitch.accepted', attempt: 1, status: 'accepted', reviewRevision: revision },
    });

    const repeat = await notice(body);
    expect(repeat.statusCode).toBe(409);
    expect(repeat.body.error.code).toBe('already-sent');

    // A repeated decision (declined, then accepted again) cannot resend the acceptance.
    const declinedRevision = await accept(PITCH_ID, 'rejected');
    const decline = await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'rejected', expectedRevision: declinedRevision });
    expect(decline.statusCode).toBe(200);
    expect(provider.messages[1].tag).toBe('pitch.declined');
    expect(provider.messages[1].subject).toBe('About your session pitch for Example Summit');
    const reacceptedRevision = await accept(PITCH_ID, 'accepted');
    const resend = await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: reacceptedRevision });
    expect(resend.statusCode).toBe(409);
    expect(provider.messages).toHaveLength(2);
  });

  it('sends one email when staff send the same decision twice at once', async () => {
    const revision = await accept();
    const body = { id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision };
    const results = await Promise.all([notice(body), notice(body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(provider.messages).toHaveLength(1);
    expect(await logs('sendSessionPitchNotice')).toHaveLength(1);
  });

  it('keeps the decision when delivery fails and offers a retry with a new send-once key', async () => {
    const revision = await accept();
    provider.mode = 'fail';
    const body = { id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision };
    const failed = await notice(body);
    expect(failed.statusCode).toBe(502);
    expect(failed.body.error.code).toBe('delivery-failed');
    let stored = await readPitch();
    expect(stored).toMatchObject({ status: 'accepted', reviewRevision: revision });
    expect(stored.notices.accepted).toMatchObject({ state: 'failed', attempt: 1, error: 'Inactive recipient' });

    provider.mode = 'ok';
    const retried = await notice(body);
    expect(retried.statusCode).toBe(200);
    expect(retried.body.attempt).toBe(2);
    stored = await readPitch();
    expect(stored.notices.accepted).toMatchObject({ state: 'sent', attempt: 2, onceKey: `pitch-notice:${PITCH_ID}:accepted:2` });
    expect(provider.messages).toHaveLength(1);
    const sentRows = (await db.collection('sent_emails').get()).docs.map((d) => d.data().status).sort();
    expect(sentRows).toEqual(['failed', 'sent']);
  });

  it('treats a fresh queued email as in progress and a stale one as retryable', async () => {
    const revision = await accept();
    const queuedAt = new Date(T0);
    await db.collection('session_pitches').doc(PITCH_ID).update({
      'notices.accepted': { state: 'queued', attempt: 1, queuedAt, templateId: 'pitch.accepted' },
    });
    const body = { id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision };
    const fresh = await notice(body, 'staff', () => T0 + 60 * 1000);
    expect(fresh.statusCode).toBe(409);
    expect(fresh.body.error.code).toBe('in-progress');
    const stale = await notice(body, 'staff', () => T0 + QUEUED_STALE_MS + 1);
    expect(stale.statusCode).toBe(200);
    expect(stale.body.attempt).toBe(2);
  });

  it('refuses stale reviews, undecided pitches, notes on receipts, non-staff, and demos without side effects', async () => {
    const undecided = await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'new', expectedRevision: 0 });
    expect(undecided.statusCode).toBe(400);
    const revision = await accept();
    const stale = await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision - 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.body.error.code).toBe('status-conflict');
    const note = await notice({ id: PITCH_ID, kind: 'receipt', expectedStatus: 'accepted', expectedRevision: revision, feedback: 'x' });
    expect(note.statusCode).toBe(400);
    const tooLong = await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision, feedback: 'x'.repeat(2001) });
    expect(tooLong.statusCode).toBe(400);
    expect((await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision }, 'submitter')).statusCode).toBe(403);
    expect((await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision }, null)).statusCode).toBe(401);

    await db.collection('config').doc('event').update({ historicalDemo: true });
    const demo = await notice({ id: PITCH_ID, kind: 'decision', expectedStatus: 'accepted', expectedRevision: revision });
    expect(demo.statusCode).toBe(403);
    expect(demo.body.error.code).toBe('read-only-demo');

    expect(provider.messages).toHaveLength(0);
    expect((await readPitch()).notices).toBeUndefined();
    expect(await logs('sendSessionPitchNotice')).toHaveLength(0);
  });
});

describe('pitch email settings', () => {
  it('lets only an operator save validated wording, audits it, and uses it for the next email', async () => {
    const wording = 'Hello,\n\nWe have “{{pitch_title}}” for {{event_name}}.';
    expect((await saveSettings({ receiptMode: 'automatic', templates: {} }, 'staff')).statusCode).toBe(403);
    const bad = await saveSettings({ receiptMode: 'automatic', templates: { 'pitch.receipt': { subject: 'Hi', wording: 'Notes: {{private_notes}}' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error.message).toContain('unknown token {{private_notes}}');
    expect((await saveSettings({ receiptMode: 'sometimes' })).statusCode).toBe(400);
    expect((await db.collection('session_pitch_settings').doc('notices').get()).exists).toBe(false);

    const saved = await saveSettings({
      receiptMode: 'automatic',
      templates: {
        'pitch.receipt': { subject: 'Thanks: {{pitch_title}}', wording },
        'pitch.accepted': { ...PITCH_NOTICE_DEFAULTS['pitch.accepted'] },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.templates['pitch.receipt']).toEqual({ subject: 'Thanks: {{pitch_title}}', wording, custom: true });
    expect(saved.body.templates['pitch.accepted'].custom).toBe(false);
    const stored = (await db.collection('session_pitch_settings').doc('notices').get()).data();
    expect(Object.keys(stored.templates)).toEqual(['pitch.receipt']);
    const [audit] = await logs('savePitchNoticeSettings');
    expect(audit).toMatchObject({ email: OPERATOR_EMAIL, details: { receiptMode: 'automatic', editedTemplates: ['pitch.receipt'] } });

    expect((await submit()).statusCode).toBe(201);
    expect(provider.messages[0].subject).toBe(`Thanks: ${TITLE}`);
    expect(provider.messages[0].text).toContain(`We have “${TITLE}” for Example Summit.`);
    expect(provider.messages[0].html).toContain('We have “Local &lt;b&gt;reporting&lt;/b&gt;');
  });
});
