'use strict';

// Change request notices (issue #330): the acknowledgement and the outcome
// emails, their settings, their delivery records and the staff retry. The
// mail sender is a fake that records each message; the store is the cms
// in-memory Firestore fake, transactions and all.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createSubmitChangeRequestHandler,
  createUpdateChangeRequestStatusHandler,
} = require('./changeRequests.cjs');
const {
  createSaveChangeRequestNoticeSettingsHandler,
  createRetryChangeRequestNoticeHandler,
  renderNotice,
  internals: { QUEUED_STALE_MS, onceKeyFor, readNoticeSettings },
} = require('./changeRequestNotices.cjs');

const OPERATOR = 'operator@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP_DOC = { adminEmails: [OPERATOR], staffEmails: [STAFF] };
const SITE = 'https://summit.example.org';
const REQUESTS_URL = `${SITE}/profile/change-requests`;
const T0 = Date.parse('2026-10-20T10:00:00.000Z');
const KEY = 'key0000000000001';
const QUIET = { warn() {}, error() {}, info() {} };
const BOTH_ON = { acknowledgement: 'automatic', outcome: 'automatic', revision: 1 };

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF, email_verified: true },
  visitor: { uid: 'uid-ada', email: 'ada@example.com', email_verified: true },
};
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

const CONFIG = {
  event: {
    name: 'Example Summit',
    sender: { email: 'summit@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
  },
  bootstrap: BOOTSTRAP_DOC,
  tierA: { publicUrl: SITE },
  providers: { email: { messageStream: 'outbound', announcementStream: 'broadcast' } },
};

function makeFakeDb({ settings = BOTH_ON, seed = {}, event = { historicalDemo: false } } = {}) {
  return makeBareFakeDb({
    'config/bootstrap': BOOTSTRAP_DOC,
    'config/features': { changeRequests: true },
    ...(event ? { 'config/event': event } : {}),
    'users/uid-ada': { uid: 'uid-ada', email: 'ada@example.com' },
    ...(settings ? { 'change_request_settings/notices': settings } : {}),
    ...seed,
  });
}

/** A sender fake. `mode`: 'ok', 'failed' (a refusal) or 'throw' (ambiguous). */
function makeMailer(mode = 'ok') {
  const sent = [];
  const sendEmail = async (message) => {
    sent.push(message);
    if (mode === 'failed') return { status: 'failed', error: 'provider refused: 422', retries: 0 };
    if (mode === 'throw') return { status: 'failed', ambiguous: true, error: 'socket hang up', retries: 0 };
    return { status: 'sent', providerMessageId: `pm-${sent.length}`, retries: 0 };
  };
  return { sent, sendEmail };
}

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const req = (token, body) => ({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body });
const getConfig = async () => CONFIG;

async function submit(db, mailer, { token = 'visitor', payload = {}, config = getConfig } = {}) {
  const res = makeRes();
  await createSubmitChangeRequestHandler({ db, auth, getConfig: config, sendEmail: mailer.sendEmail, now: () => T0, log: QUIET })(
    req(token, { message: 'The travel page lists the wrong hotel.', page: '/travel', submissionKey: KEY, ...payload }),
    res,
  );
  return res;
}

async function setStatus(db, mailer, status, { id = KEY, token = 'staff', at = T0 + 1000, config = getConfig } = {}) {
  const res = makeRes();
  await createUpdateChangeRequestStatusHandler({ db, auth, getConfig: config, sendEmail: mailer.sendEmail, now: () => at, log: QUIET })(
    req(token, { id, status }),
    res,
  );
  return res;
}

async function retry(db, mailer, body, { token = 'staff', at = T0 + 5000 } = {}) {
  const res = makeRes();
  await createRetryChangeRequestNoticeHandler({ db, auth, getConfig, sendEmail: mailer.sendEmail, now: () => at, log: QUIET })(
    req(token, body),
    res,
  );
  return res;
}

async function saveSettings(db, body, token = 'operator') {
  const res = makeRes();
  await createSaveChangeRequestNoticeSettingsHandler({ db, auth, getConfig, now: () => T0, log: QUIET })(req(token, body), res);
  return res;
}

const notices = (db, id = KEY) => db.read('change_requests', id)?.notices ?? {};
const adminLogs = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));
const suppressionId = (email) => crypto.createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');

function storedRequest(overrides = {}) {
  return {
    message: 'Fix the map.',
    page: '/travel',
    status: 'new',
    uid: 'uid-ada',
    email: 'ada@example.com',
    createdAt: new Date(T0),
    updatedAt: null,
    updatedBy: null,
    history: [{ status: 'new', at: new Date(T0) }],
    outcome: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test('settings: both notices are off until an operator turns them on', () => {
  assert.deepEqual(readNoticeSettings(undefined), { acknowledgement: 'off', outcome: 'off', revision: 0 });
  assert.deepEqual(readNoticeSettings({ acknowledgement: 'yes', outcome: true, revision: -1 }), { acknowledgement: 'off', outcome: 'off', revision: 0 });
  assert.deepEqual(readNoticeSettings(BOTH_ON), BOTH_ON);
});

test('settings: an operator saves them with the revision they edited; each save writes its audit row', async () => {
  const db = makeFakeDb({ settings: null });
  const res = await saveSettings(db, { acknowledgement: 'automatic', outcome: 'off', expectedRevision: 0 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { acknowledgement: 'automatic', outcome: 'off', revision: 1 });
  assert.deepEqual(db.read('change_request_settings', 'notices'), {
    acknowledgement: 'automatic', outcome: 'off', revision: 1, updatedAt: new Date(T0), updatedBy: OPERATOR,
  });
  assert.deepEqual(adminLogs(db), [{
    action: 'saveChangeRequestNoticeSettings', docPath: 'change_request_settings/notices', uid: 'operator-1', email: OPERATOR, at: new Date(T0),
  }]);

  // A save that names an old revision is refused and changes nothing.
  const stale = await saveSettings(db, { acknowledgement: 'off', outcome: 'automatic', expectedRevision: 0 });
  assert.equal(stale.statusCode, 409);
  assert.equal(db.read('change_request_settings', 'notices').revision, 1);
});

test('settings: staff and visitors cannot change them, and a bad body is 400', async () => {
  const db = makeFakeDb({ settings: null });
  assert.equal((await saveSettings(db, { acknowledgement: 'automatic', outcome: 'off', expectedRevision: 0 }, 'staff')).statusCode, 403);
  assert.equal((await saveSettings(db, { acknowledgement: 'automatic', outcome: 'off', expectedRevision: 0 }, 'visitor')).statusCode, 403);
  for (const payload of [
    { acknowledgement: 'sometimes', outcome: 'off', expectedRevision: 0 },
    { acknowledgement: 'off', outcome: 'manual', expectedRevision: 0 },
    { acknowledgement: 'off', outcome: 'off' },
    { acknowledgement: 'off', outcome: 'off', expectedRevision: -1 },
  ]) {
    assert.equal((await saveSettings(db, payload)).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(db.read('change_request_settings', 'notices'), undefined);
  assert.deepEqual(adminLogs(db), []);
});

// ---------------------------------------------------------------------------
// Fixed wording
// ---------------------------------------------------------------------------

test('wording: each notice is fixed, links to the requester’s own page, and never quotes the request', () => {
  const received = renderNotice({ config: CONFIG, slot: 'received' });
  assert.equal(received.subject, 'We got your change request for Example Summit');
  assert.match(received.text, /^Hello,\n\nWe got your change request\. The event team will read it\.\n\nYou can check its status at any time on your change requests page:\nhttps:\/\/summit\.example\.org\/profile\/change-requests\n/);

  const done = renderNotice({ config: CONFIG, slot: 'done' });
  assert.equal(done.subject, 'Your change request for Example Summit is marked done');
  assert.match(done.text, /^Hello,\n\nThe event team marked your change request as done\.\n\n/);
  // It never says the change is live: staff record the outcome, not a deploy.
  assert.doesNotMatch(`${done.subject} ${done.text}`, /\blive\b|published|deployed/i);

  const declined = renderNotice({ config: CONFIG, slot: 'declined' });
  assert.equal(declined.subject, 'An update on your change request for Example Summit');
  assert.match(declined.text, /^Hello,\n\nThe event team decided not to make the change you asked for\.\n\n/);

  for (const rendered of [received, done, declined]) {
    // The notice's one link, then the layout's support address.
    const hrefs = [...rendered.html.matchAll(/<a href="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(hrefs, [REQUESTS_URL, 'mailto:help@example.org']);
    assert.equal(rendered.usedFallback, false);
  }
});

test('wording: a stored email_templates override is never used', async () => {
  const db = makeFakeDb({ seed: { 'email_templates/changeRequest.done': { subject: 'Your change is LIVE now', text: 'LIVE', html: '<p>LIVE</p>' } } });
  await db.collection('change_requests').doc(KEY).set(storedRequest({ status: 'in_progress' }));
  const mailer = makeMailer();
  await setStatus(db, mailer, 'done');
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].subject, 'Your change request for Example Summit is marked done');
  assert.doesNotMatch(mailer.sent[0].text, /LIVE/);
});

test('wording: with no public site address the email still goes, and names no link', () => {
  const rendered = renderNotice({ config: { ...CONFIG, tierA: {} }, slot: 'done' });
  const hrefs = [...rendered.html.matchAll(/<a href="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ['mailto:help@example.org']);
  assert.doesNotMatch(rendered.text, /change requests page/);
});

// ---------------------------------------------------------------------------
// The acknowledgement
// ---------------------------------------------------------------------------

test('acknowledgement: on, a stored request queues one email to the token’s address and records it sent', async () => {
  const db = makeFakeDb();
  const mailer = makeMailer();
  const res = await submit(db, mailer);
  assert.equal(res.statusCode, 201);

  assert.equal(mailer.sent.length, 1);
  const [message] = mailer.sent;
  assert.equal(message.to, 'ada@example.com');
  assert.equal(message.tag, 'changeRequest.received');
  assert.equal(message.source, 'change-requests');
  assert.equal(message.onceKey, onceKeyFor(KEY, 'received', 1));
  assert.equal(message.onceKey, `change-request-notice:${KEY}:received:1`);
  assert.equal(message.messageStream, 'outbound');
  // The request's own words never go into the email.
  assert.doesNotMatch(`${message.subject} ${message.text} ${message.html}`, /hotel|\/travel/);

  assert.deepEqual(notices(db).received, {
    state: 'sent',
    templateId: 'changeRequest.received',
    attempt: 1,
    onceKey: `change-request-notice:${KEY}:received:1`,
    mode: 'automatic',
    queuedAt: new Date(T0),
    queuedBy: 'automatic',
    updatedAt: new Date(T0),
    sentAt: new Date(T0),
    error: null,
  });
});

test('acknowledgement: a retried submission sends nothing more', async () => {
  const db = makeFakeDb();
  const mailer = makeMailer();
  assert.equal((await submit(db, mailer)).statusCode, 201);
  assert.equal((await submit(db, mailer)).statusCode, 201);
  assert.equal(mailer.sent.length, 1);
});

test('acknowledgement: off (the default), nothing is queued or sent', async () => {
  for (const settings of [null, { acknowledgement: 'off', outcome: 'automatic', revision: 1 }]) {
    const db = makeFakeDb({ settings });
    const mailer = makeMailer();
    assert.equal((await submit(db, mailer)).statusCode, 201);
    assert.equal(mailer.sent.length, 0);
    assert.deepEqual(notices(db), {});
  }
});

test('acknowledgement: a historical demo queues nothing', async () => {
  const db = makeFakeDb({ event: { historicalDemo: true } });
  const mailer = makeMailer();
  assert.equal((await submit(db, mailer)).statusCode, 201);
  assert.equal(mailer.sent.length, 0);
  assert.deepEqual(notices(db), {});
});

test('acknowledgement: a refused or uncertain send never fails the stored request', async () => {
  const failed = makeFakeDb();
  const res = await submit(failed, makeMailer('failed'));
  assert.equal(res.statusCode, 201);
  assert.equal(notices(failed).received.state, 'failed');
  assert.equal(notices(failed).received.error, 'provider refused: 422');

  const unknown = makeFakeDb();
  assert.equal((await submit(unknown, makeMailer('throw'))).statusCode, 201);
  assert.equal(notices(unknown).received.state, 'unknown');

  // A sender that throws before it reaches the provider is a plain failure.
  const broken = makeFakeDb();
  const thrower = { sendEmail: async () => { throw new Error('config unavailable'); } };
  assert.equal((await submit(broken, thrower)).statusCode, 201);
  assert.equal(notices(broken).received.state, 'failed');
});

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

test('outcome: marking done sends the done email once; a repeat, a reopen and a second done send nothing more', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'in_progress' }) } });
  const mailer = makeMailer();

  const res = await setStatus(db, mailer, 'done');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: KEY, status: 'done', notice: { slot: 'done', state: 'sent' } });
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].tag, 'changeRequest.done');
  assert.equal(mailer.sent[0].to, 'ada@example.com');
  assert.equal(mailer.sent[0].onceKey, `change-request-notice:${KEY}:done:1`);
  assert.equal(notices(db).done.state, 'sent');
  assert.equal(notices(db).done.queuedBy, 'automatic');

  assert.deepEqual((await setStatus(db, mailer, 'done', { at: T0 + 2000 })).body, { id: KEY, status: 'done', notice: null });
  await setStatus(db, mailer, 'new', { at: T0 + 3000 });
  await setStatus(db, mailer, 'done', { at: T0 + 4000 });
  assert.equal(mailer.sent.length, 1);

  // A later decline is a different outcome: its own email, once.
  await setStatus(db, mailer, 'declined', { at: T0 + 5000 });
  await setStatus(db, mailer, 'declined', { at: T0 + 6000 });
  assert.deepEqual(mailer.sent.map((message) => message.tag), ['changeRequest.done', 'changeRequest.declined']);
});

test('outcome: in progress and reopen send nothing; off sends nothing', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest() } });
  const mailer = makeMailer();
  await setStatus(db, mailer, 'in_progress');
  await setStatus(db, mailer, 'new');
  assert.equal(mailer.sent.length, 0);

  const off = makeFakeDb({ settings: { acknowledgement: 'automatic', outcome: 'off', revision: 2 }, seed: { [`change_requests/${KEY}`]: storedRequest() } });
  assert.deepEqual((await setStatus(off, mailer, 'done')).body, { id: KEY, status: 'done', notice: null });
  assert.equal(mailer.sent.length, 0);
  assert.deepEqual(notices(off), {});
});

test('outcome: a failed send keeps the status, and the response says the email was not sent', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest() } });
  const res = await setStatus(db, makeMailer('failed'), 'declined');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: KEY, status: 'declined', notice: { slot: 'declined', state: 'failed' } });
  assert.equal(db.read('change_requests', KEY).status, 'declined');
  assert.equal(notices(db).declined.state, 'failed');
});

test('suppression: an address with a suppression record gets no email, and the record says why', async () => {
  const db = makeFakeDb({
    seed: {
      [`change_requests/${KEY}`]: storedRequest(),
      [`email_suppressions/${suppressionId('ada@example.com')}`]: { via: 'link', at: new Date(T0) },
    },
  });
  const mailer = makeMailer();
  const res = await setStatus(db, mailer, 'done');
  assert.deepEqual(res.body.notice, { slot: 'done', state: 'suppressed' });
  assert.equal(mailer.sent.length, 0);
  assert.equal(notices(db).done.state, 'suppressed');
});

test('stream: a transactional stream set to the announcement stream sends nothing', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest() } });
  const mailer = makeMailer();
  const misconfigured = async () => ({ ...CONFIG, providers: { email: { messageStream: 'broadcast', announcementStream: 'broadcast' } } });
  const res = await setStatus(db, mailer, 'done', { config: misconfigured });
  assert.deepEqual(res.body.notice, { slot: 'done', state: 'failed' });
  assert.equal(mailer.sent.length, 0);
  assert.match(notices(db).done.error, /announcement stream/);
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

function failedRecord(slot, overrides = {}) {
  return {
    state: 'failed',
    templateId: `changeRequest.${slot}`,
    attempt: 1,
    onceKey: onceKeyFor(KEY, slot, 1),
    mode: 'automatic',
    queuedAt: new Date(T0),
    queuedBy: 'automatic',
    updatedAt: new Date(T0),
    error: 'provider refused: 422',
    ...overrides,
  };
}

test('retry: staff retry a failed email with a new attempt and a new send-once key, and it writes its row', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', notices: { done: failedRecord('done') } }) } });
  const mailer = makeMailer();
  const res = await retry(db, mailer, { id: KEY, slot: 'done' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: KEY, slot: 'done', state: 'sent', attempt: 2 });
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].onceKey, `change-request-notice:${KEY}:done:2`);
  assert.equal(notices(db).done.state, 'sent');
  assert.equal(notices(db).done.queuedBy, STAFF);
  assert.equal(notices(db).done.mode, 'retry');
  assert.deepEqual(adminLogs(db), [{
    action: 'retryChangeRequestNotice', docPath: `change_requests/${KEY}`, uid: 'staff-1', email: STAFF, at: new Date(T0 + 5000),
  }]);

  // A sent email is never sent again.
  const again = await retry(db, mailer, { id: KEY, slot: 'done' });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error.code, 'already-sent');
  assert.equal(mailer.sent.length, 1);
});

test('retry: an email whose delivery is unknown, or a stale queued one, needs the Email log check', async () => {
  for (const record of [
    failedRecord('done', { state: 'unknown' }),
    failedRecord('done', { state: 'queued', queuedAt: new Date(T0 + 5000 - QUEUED_STALE_MS) }),
  ]) {
    const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', notices: { done: record } }) } });
    const mailer = makeMailer();
    const refused = await retry(db, mailer, { id: KEY, slot: 'done' });
    assert.equal(refused.statusCode, 409, record.state);
    assert.equal(refused.body.error.code, 'delivery-unknown');
    assert.equal(mailer.sent.length, 0);
    const confirmed = await retry(db, mailer, { id: KEY, slot: 'done', confirmUnknown: true });
    assert.equal(confirmed.statusCode, 200, record.state);
    assert.equal(mailer.sent.length, 1);
  }
});

test('retry: a fresh queued email is in progress, and is not sent twice', async () => {
  const record = failedRecord('done', { state: 'queued', queuedAt: new Date(T0 + 4000) });
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', notices: { done: record } }) } });
  const mailer = makeMailer();
  const res = await retry(db, mailer, { id: KEY, slot: 'done', confirmUnknown: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'in-progress');
  assert.equal(mailer.sent.length, 0);
});

test('retry: an outcome email is sent only while the request still has that outcome', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'new', notices: { done: failedRecord('done') } }) } });
  const mailer = makeMailer();
  const res = await retry(db, mailer, { id: KEY, slot: 'done' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'status-changed');
  assert.equal(mailer.sent.length, 0);
});

test('retry: an acknowledgement is not sent once the request has an outcome', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'declined', notices: { received: failedRecord('received') } }) } });
  const res = await retry(db, makeMailer(), { id: KEY, slot: 'received' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'status-changed');
});

test('retry: nothing is sent while that kind of email is off, or for an email that was never queued', async () => {
  const off = makeFakeDb({
    settings: { acknowledgement: 'automatic', outcome: 'off', revision: 3 },
    seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', notices: { done: failedRecord('done') } }) },
  });
  const mailer = makeMailer();
  const res = await retry(off, mailer, { id: KEY, slot: 'done' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'notices-off');

  const never = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done' }) } });
  const none = await retry(never, mailer, { id: KEY, slot: 'done' });
  assert.equal(none.statusCode, 409);
  assert.equal(none.body.error.code, 'not-queued');
  assert.equal(mailer.sent.length, 0);
});

test('retry: 401 with no token, 403 for a visitor, 400 for a bad body, 404 for an unknown id', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', notices: { done: failedRecord('done') } }) } });
  const mailer = makeMailer();
  assert.equal((await retry(db, mailer, { id: KEY, slot: 'done' }, { token: null })).statusCode, 401);
  assert.equal((await retry(db, mailer, { id: KEY, slot: 'done' }, { token: 'visitor' })).statusCode, 403);
  for (const payload of [{ id: KEY }, { id: KEY, slot: 'in_progress' }, { slot: 'done' }, { id: 'a/b', slot: 'done' }, { id: KEY, slot: 'done', confirmUnknown: 'yes' }]) {
    assert.equal((await retry(db, mailer, payload)).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await retry(db, mailer, { id: 'missing-id', slot: 'done' })).statusCode, 404);
  assert.equal(mailer.sent.length, 0);
  assert.deepEqual(adminLogs(db), []);
});

test('a late finish never overwrites a newer attempt’s record', async () => {
  const db = makeFakeDb({ seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', notices: { done: failedRecord('done') } }) } });
  // The first retry's sender stalls; a second retry (confirmed) goes first.
  let release;
  const slow = { sendEmail: () => new Promise((resolve) => { release = () => resolve({ status: 'failed', error: 'late' }); }) };
  const first = retry(db, slow, { id: KEY, slot: 'done' });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await retry(db, makeMailer(), { id: KEY, slot: 'done', confirmUnknown: true }, { at: T0 + 5000 + QUEUED_STALE_MS });
  assert.equal(second.statusCode, 200);
  release();
  await first;
  assert.equal(notices(db).done.attempt, 3);
  assert.equal(notices(db).done.state, 'sent');
});

// Review finding 4 (#539): an outcome email goes only on the request's
// first-ever move to that outcome, read from the status history, so turning
// the setting on later never emails about an old outcome.
test('outcome: a request that was done before the setting went on gets no email when it is done again', async () => {
  const db = makeFakeDb({
    seed: {
      [`change_requests/${KEY}`]: storedRequest({
        status: 'new',
        history: [
          { status: 'new', at: new Date(T0) },
          { status: 'done', at: new Date(T0 + 100) },
          { status: 'new', at: new Date(T0 + 200) },
        ],
      }),
    },
  });
  const mailer = makeMailer();
  const res = await setStatus(db, mailer, 'done');
  assert.deepEqual(res.body, { id: KEY, status: 'done', notice: null });
  assert.equal(mailer.sent.length, 0);
  assert.deepEqual(notices(db), {});

  // A first decline is still a first outcome of its kind.
  await setStatus(db, mailer, 'declined', { at: T0 + 2000 });
  assert.deepEqual(mailer.sent.map((message) => message.tag), ['changeRequest.declined']);
});

test('outcome: repeating a done that predates the setting sends nothing', async () => {
  const db = makeFakeDb({
    seed: { [`change_requests/${KEY}`]: storedRequest({ status: 'done', history: [{ status: 'new', at: new Date(T0) }, { status: 'done', at: new Date(T0 + 100) }] }) },
  });
  const mailer = makeMailer();
  assert.deepEqual((await setStatus(db, mailer, 'done')).body.notice, null);
  assert.equal(mailer.sent.length, 0);
});
