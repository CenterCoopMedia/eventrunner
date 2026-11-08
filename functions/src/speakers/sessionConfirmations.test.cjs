'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSendSessionConfirmationHandler,
  internals: { CONFIRMATIONS, readRequest },
} = require('./sessionConfirmations.cjs');
const { QUEUED_STALE_MS } = require('../email/noticeRetry.cjs');
const { resetTemplateCacheForTest } = require('../email/templates.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const STAFF = { uid: 'staff-1', email: 'staff@example.org' };
const T0 = Date.parse('2026-11-08T15:00:00Z');
const RECORD_ID = 'sess-1__rae';

const CONFIG = {
  event: {
    name: 'Example Summit',
    days: [{ id: 'day-1', date: '2027-05-13' }],
    sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
  },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};

const SESSION = {
  title: 'Reporting on Deadline', dayId: 'day-1', startTime: '10:00 AM', endTime: '10:45 AM',
  location: 'Room B', speakerIds: ['rae'], visible: true,
};
const NAMED = { title: 'Reporting on Deadline', time: '2027-05-13 · 10:00 AM–10:45 AM', room: 'Room B' };

function world(overrides = {}) {
  return {
    'config/bootstrap': { adminEmails: ['admin@example.org'], staffEmails: [STAFF.email] },
    'config/event': { name: 'Example Summit', historicalDemo: false },
    'cmsSchedule/sess-1': SESSION,
    'speakers/rae': { firstName: 'Rae', lastName: 'Okonkwo', email: 'rae@example.org', status: 'approved' },
    ...overrides,
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function setup(seed = world(), { email = STAFF.email, outcome = { status: 'sent' } } = {}) {
  const db = makeSpeakersDb(seed);
  const sent = [];
  let clock = T0;
  const handler = createSendSessionConfirmationHandler({
    db,
    auth: { verifyIdToken: async () => ({ uid: STAFF.uid, email, email_verified: true }) },
    getConfig: async () => CONFIG,
    sendEmail: async (message) => {
      sent.push(message);
      return typeof outcome === 'function' ? outcome(message) : outcome;
    },
    now: () => clock,
    log: { error() {}, warn() {}, info() {} },
  });
  const call = async (body) => {
    const res = fakeRes();
    await handler({ method: 'POST', body, headers: { authorization: 'Bearer t' } }, res);
    return res;
  };
  return {
    db, sent, call,
    advance(ms) { clock += ms; },
    setOutcome(next) { outcome = next; },
    record: () => db.read(CONFIRMATIONS, RECORD_ID),
    logs: () => db.ids('admin_logs').map((id) => db.read('admin_logs', id)),
  };
}

const BODY = { sessionId: 'sess-1', speakerId: 'rae' };
const send = (extra = {}) => ({ ...BODY, expectedNamed: NAMED, ...extra });

test.beforeEach(() => resetTemplateCacheForTest());

test('a preview renders the email and writes nothing', async () => {
  const t = setup();
  const before = t.db.writes.length;
  const res = await t.call({ ...BODY, preview: true });
  assert.equal(res.statusCode, 200);
  const { preview } = res.body;
  assert.equal(preview.to, 'rae@example.org');
  assert.equal(preview.subject, 'Your session at Example Summit is confirmed: Reporting on Deadline');
  assert.ok(preview.text.includes('Room B'));
  assert.ok(preview.text.includes('2027-05-13 · 10:00 AM–10:45 AM'));
  assert.deepEqual(preview.named, NAMED);
  assert.equal(preview.changedSinceLastSend, false);
  assert.equal(preview.previous, null);
  assert.equal(preview.blocked, null);
  assert.equal(t.db.writes.length, before);
  assert.equal(t.sent.length, 0);
});

test('a send records the queued claim, sends with the attempt key, and stores sent', async () => {
  const t = setup();
  const res = await t.call(send());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { state: 'sent', attempt: 1 });
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].onceKey, 'speaker-confirmation:rae:sess-1:1');
  assert.equal(t.sent[0].tag, 'speaker.confirmation');
  assert.equal(t.sent[0].source, 'speaker-confirmation');
  const record = t.record();
  assert.equal(record.state, 'sent');
  assert.equal(record.attempt, 1);
  assert.equal(record.sessionId, 'sess-1');
  assert.equal(record.speakerId, 'rae');
  assert.equal(record.queuedBy, STAFF.email);
  assert.deepEqual(record.named, NAMED);
  assert.deepEqual(record.lastSent.named, NAMED);
  assert.ok(record.sentAt instanceof Date);
  assert.equal(record.error, null);
  const logs = t.logs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'sendSessionConfirmation');
  assert.equal(logs[0].docPath, `${CONFIRMATIONS}/${RECORD_ID}`);
  assert.equal(logs[0].details.attempt, 1);
});

test('the same slot is refused once sent, and a preview says so without sending', async () => {
  const t = setup();
  assert.equal((await t.call(send())).statusCode, 200);
  const again = await t.call(send());
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error.code, 'already-sent');
  const preview = await t.call({ ...BODY, preview: true });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.preview.blocked.code, 'already-sent');
  assert.equal(preview.body.preview.changedSinceLastSend, false);
  assert.equal(preview.body.preview.previous.state, 'sent');
  assert.equal(t.sent.length, 1);
  assert.equal(t.record().attempt, 1);
});

test('a changed slot allows attempt 2 with a new onceKey', async () => {
  const t = setup();
  assert.equal((await t.call(send())).statusCode, 200);
  await t.db.collection('cmsSchedule').doc('sess-1').set({ ...SESSION, location: 'Room C' });
  const moved = { ...NAMED, room: 'Room C' };

  const preview = await t.call({ ...BODY, preview: true });
  assert.equal(preview.body.preview.changedSinceLastSend, true);
  assert.equal(preview.body.preview.blocked, null);
  assert.deepEqual(preview.body.preview.previous.lastSentNamed, NAMED);

  // A send with the old slot is refused: staff send what they previewed.
  const stale = await t.call(send());
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error.code, 'slot-changed');

  const res = await t.call(send({ expectedNamed: moved }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { state: 'sent', attempt: 2 });
  assert.equal(t.sent[1].onceKey, 'speaker-confirmation:rae:sess-1:2');
  assert.ok(t.sent[1].text.includes('Room C'));
  assert.deepEqual(t.record().named, moved);
  assert.equal((await t.call(send({ expectedNamed: moved }))).body.error.code, 'already-sent');
});

test('a failed send can be retried with a new attempt', async () => {
  const t = setup(world(), { outcome: { status: 'failed', error: 'Inactive recipient' } });
  const res = await t.call(send());
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.code, 'delivery-failed');
  assert.equal(t.record().state, 'failed');
  assert.equal(t.record().error, 'Inactive recipient');
  t.setOutcome({ status: 'sent' });
  const retry = await t.call(send());
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.attempt, 2);
  assert.equal(t.sent[1].onceKey, 'speaker-confirmation:rae:sess-1:2');
});

test('a failed new attempt does not let the already-confirmed slot go again', async () => {
  const t = setup();
  assert.equal((await t.call(send())).statusCode, 200);
  await t.db.collection('cmsSchedule').doc('sess-1').set({ ...SESSION, location: 'Room C' });
  t.setOutcome({ status: 'failed', error: 'Inactive recipient' });
  assert.equal((await t.call(send({ expectedNamed: { ...NAMED, room: 'Room C' } }))).statusCode, 502);
  // The room goes back to the one the speaker already has.
  await t.db.collection('cmsSchedule').doc('sess-1').set(SESSION);
  t.setOutcome({ status: 'sent' });
  const res = await t.call(send());
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'already-sent');
});

test('an uncertain send needs confirmUnknown before a retry', async () => {
  const t = setup(world(), { outcome: { status: 'failed', ambiguous: true, error: 'socket hang up' } });
  const res = await t.call(send());
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.code, 'delivery-unknown');
  assert.equal(t.record().state, 'uncertain');
  t.setOutcome({ status: 'sent' });

  const preview = await t.call({ ...BODY, preview: true });
  assert.equal(preview.body.preview.mayHaveBeenSent, true);
  const unconfirmed = await t.call(send());
  assert.equal(unconfirmed.statusCode, 409);
  assert.equal(unconfirmed.body.error.code, 'delivery-unknown');
  assert.equal(t.record().attempt, 1);

  const confirmed = await t.call(send({ confirmUnknown: true }));
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.attempt, 2);
});

test('a queued send is in progress until stale, then needs confirmUnknown', async () => {
  const t = setup(world({
    [`${CONFIRMATIONS}/${RECORD_ID}`]: {
      sessionId: 'sess-1', speakerId: 'rae', state: 'queued', attempt: 1, named: NAMED,
      queuedAt: new Date(T0), onceKey: 'speaker-confirmation:rae:sess-1:1',
    },
  }));
  const busy = await t.call(send({ confirmUnknown: true }));
  assert.equal(busy.body.error.code, 'in-progress');
  t.advance(QUEUED_STALE_MS + 1);
  assert.equal((await t.call(send())).body.error.code, 'delivery-unknown');
  assert.equal((await t.call(send({ confirmUnknown: true }))).statusCode, 200);
  assert.equal(t.record().attempt, 2);
});

test('a legacy `unknown` state reads as uncertain', async () => {
  const t = setup(world({
    [`${CONFIRMATIONS}/${RECORD_ID}`]: { sessionId: 'sess-1', speakerId: 'rae', state: 'unknown', attempt: 1, named: NAMED },
  }));
  assert.equal((await t.call(send())).body.error.code, 'delivery-unknown');
});

const refusals = [
  ['an unpublished session', { 'cmsSchedule/sess-1': { ...SESSION, visible: false } }, 409, 'session-hidden'],
  ['a session with no start time', { 'cmsSchedule/sess-1': { ...SESSION, startTime: '' } }, 409, 'session-incomplete'],
  ['a session with no day', { 'cmsSchedule/sess-1': { ...SESSION, dayId: null } }, 409, 'session-incomplete'],
  ['a speaker not on the session', { 'cmsSchedule/sess-1': { ...SESSION, speakerIds: ['someone-else'] } }, 409, 'not-on-session'],
  ['a removed speaker', { 'speakers/rae': { firstName: 'Rae', email: 'rae@example.org', status: 'removed' } }, 409, 'speaker-removed'],
  ['a speaker with no email', { 'speakers/rae': { firstName: 'Rae', email: null, status: 'approved' } }, 409, 'no-email'],
  ['a missing session', { 'cmsSchedule/sess-1': undefined }, 404, 'not-found'],
  ['a missing speaker', { 'speakers/rae': undefined }, 404, 'not-found'],
];

for (const [label, overrides, status, code] of refusals) {
  test(`refuses ${label}, for a preview and a send, and writes nothing`, async () => {
    const seed = world(overrides);
    for (const [key, value] of Object.entries(seed)) if (value === undefined) delete seed[key];
    const t = setup(seed);
    for (const body of [{ ...BODY, preview: true }, send()]) {
      const res = await t.call(body);
      assert.equal(res.statusCode, status, label);
      assert.equal(res.body.error.code, code, label);
    }
    assert.equal(t.record(), undefined);
    assert.equal(t.sent.length, 0);
    assert.equal(t.logs().length, 0);
  });
}

test('refuses a caller who is not staff or an operator', async () => {
  const t = setup(world(), { email: 'attendee@example.org' });
  const res = await t.call(send());
  assert.equal(res.statusCode, 403);
  assert.equal(t.sent.length, 0);
  assert.equal(t.record(), undefined);
});

test('refuses a send in a historical demo', async () => {
  const t = setup(world({ 'config/event': { name: 'Example Summit', historicalDemo: true } }));
  const res = await t.call(send());
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'read-only-demo');
  assert.equal(t.sent.length, 0);
});

test('a send without the preview’s named slot is a bad request', async () => {
  const t = setup();
  const res = await t.call(BODY);
  assert.equal(res.statusCode, 400);
  assert.equal(t.sent.length, 0);
  assert.equal(readRequest({ ...BODY, preview: 'yes' }).ok, false);
  assert.equal(readRequest({ sessionId: 'a/b', speakerId: 'rae', preview: true }).ok, false);
  assert.equal(readRequest({ ...BODY, expectedNamed: { title: 'x', time: 'y' } }).ok, false);
});

test('only POST is accepted', async () => {
  const t = setup();
  const handler = createSendSessionConfirmationHandler({ db: t.db, auth: {}, getConfig: async () => CONFIG, sendEmail: async () => ({}) });
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});
