'use strict';

// Change request progress (issue #330): the history and the outcome staff
// record, the optional reply and checked result link, and the requester's
// own read of their requests. The requester sees their own requests only,
// and only the fields listed in REQUESTER_FIELDS.

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createUpdateChangeRequestStatusHandler,
  createSaveChangeRequestOutcomeHandler,
  createListMyChangeRequestsHandler,
  internals: { HISTORY_LIMIT, MAX_REPLY_LENGTH, MY_REQUESTS_LIMIT, readResultUrl },
} = require('./changeRequests.cjs');

const OPERATOR = 'operator@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP_DOC = { adminEmails: [OPERATOR], staffEmails: [STAFF] };
const SITE = 'https://summit.example.org';
const T0 = Date.parse('2026-10-20T10:00:00.000Z');
const QUIET = { warn() {}, error() {}, info() {} };
const OUTCOME_ID = '00000000-0000-4000-8000-000000000001';
const CONFIG = { bootstrap: BOOTSTRAP_DOC, tierA: { publicUrl: SITE } };

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF, email_verified: true },
  visitor: { uid: 'uid-ada', email: 'ada@example.com', email_verified: true },
  other: { uid: 'uid-bo', email: 'bo@example.com', email_verified: true },
  unverified: { uid: 'uid-cy', email: 'cy@example.com', email_verified: false },
};
const auth = {
  revocationChecks: [],
  async verifyIdToken(token, checkRevoked = false) {
    auth.revocationChecks.push(checkRevoked);
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

function makeFakeDb(seed = {}, { features = { changeRequests: true } } = {}) {
  return makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, 'config/features': features, ...seed });
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
const req = (token, body, method = 'POST') => ({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body });

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

async function setStatus(db, id, status, at, token = 'staff') {
  const res = makeRes();
  await createUpdateChangeRequestStatusHandler({ db, auth, getConfig: async () => CONFIG, now: () => at, log: QUIET })(req(token, { id, status }), res);
  return res;
}

/** A save from a form that loaded the request's current outcome, unless the body says otherwise. */
async function saveOutcome(db, body, { token = 'staff', config = CONFIG } = {}) {
  const stored = body?.id ? db.read('change_requests', body.id) : null;
  const loaded = stored && stored.outcome?.status === stored.status ? stored.outcome : null;
  const full = { expectedStatus: stored?.status ?? 'done', expectedOutcomeId: loaded?.id ?? null, ...body };
  const res = makeRes();
  await createSaveChangeRequestOutcomeHandler({ db, auth, getConfig: async () => config, now: () => T0 + 9000, log: QUIET })(req(token, full), res);
  return res;
}

async function listMine(db, token = 'visitor', method = 'POST') {
  const res = makeRes();
  await createListMyChangeRequestsHandler({ db, auth, log: QUIET })(req(token, {}, method), res);
  return res;
}

const adminLogs = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));

// ---------------------------------------------------------------------------
// History and outcome
// ---------------------------------------------------------------------------

test('history: each status change adds the new status and its time, never who made it', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': storedRequest() });
  await setStatus(db, 'cr1', 'in_progress', T0 + 1000);
  await setStatus(db, 'cr1', 'in_progress', T0 + 2000);
  await setStatus(db, 'cr1', 'done', T0 + 3000);
  const stored = db.read('change_requests', 'cr1');
  assert.deepEqual(stored.history, [
    { status: 'new', at: new Date(T0) },
    { status: 'in_progress', at: new Date(T0 + 1000) },
    // The repeat of the same status adds nothing.
    { status: 'done', at: new Date(T0 + 3000) },
  ]);
  assert.doesNotMatch(JSON.stringify(stored.history), /staff/);
});

test('history: it keeps at most the newest HISTORY_LIMIT entries', async () => {
  const history = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ status: i % 2 ? 'in_progress' : 'new', at: new Date(T0 + i) }));
  const db = makeFakeDb({ 'change_requests/cr1': storedRequest({ status: 'in_progress', history }) });
  await setStatus(db, 'cr1', 'done', T0 + 10_000);
  const stored = db.read('change_requests', 'cr1').history;
  assert.equal(stored.length, HISTORY_LIMIT);
  assert.deepEqual(stored.at(-1), { status: 'done', at: new Date(T0 + 10_000) });
  assert.deepEqual(stored[0], history[1]);
});

test('outcome: done and declined record an outcome; reopening clears it; a new outcome starts empty', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': storedRequest() });
  await setStatus(db, 'cr1', 'done', T0 + 1000);
  assert.deepEqual(db.read('change_requests', 'cr1').outcome, {
    id: db.read('change_requests', 'cr1').outcome.id,
    status: 'done', reply: null, resultUrl: null, resultCheckedBy: null, resultCheckedAt: null, recordedAt: new Date(T0 + 1000), recordedBy: STAFF,
  });
  assert.match(db.read('change_requests', 'cr1').outcome.id, /^[0-9a-f-]{36}$/);
  const loaded = db.read('change_requests', 'cr1').outcome;
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'Fixed the hotel name.', expectedStatus: 'done', expectedOutcomeId: loaded.id })).statusCode, 200);

  // The same status again keeps the outcome and its reply.
  await setStatus(db, 'cr1', 'done', T0 + 2000);
  assert.equal(db.read('change_requests', 'cr1').outcome.reply, 'Fixed the hotel name.');

  await setStatus(db, 'cr1', 'new', T0 + 3000);
  assert.equal(db.read('change_requests', 'cr1').outcome, null);

  await setStatus(db, 'cr1', 'declined', T0 + 4000);
  const declinedOutcome = db.read('change_requests', 'cr1').outcome;
  assert.notEqual(declinedOutcome.id, loaded.id);
  assert.deepEqual(declinedOutcome, {
    id: declinedOutcome.id,
    status: 'declined', reply: null, resultUrl: null, resultCheckedBy: null, resultCheckedAt: null, recordedAt: new Date(T0 + 4000), recordedBy: STAFF,
  });
});

// ---------------------------------------------------------------------------
// saveChangeRequestOutcome: the reply and the checked result link
// ---------------------------------------------------------------------------

function doneRequest(overrides = {}) {
  return storedRequest({
    status: 'done',
    outcome: { id: OUTCOME_ID, status: 'done', reply: null, resultUrl: null, resultCheckedBy: null, resultCheckedAt: null, recordedAt: new Date(T0 + 1000), recordedBy: STAFF },
    ...overrides,
  });
}

test('outcome details: staff save a reply and a result link they checked on this site; the audit row holds neither', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest() });
  const res = await saveOutcome(db, {
    id: 'cr1', reply: '  The hotel name is fixed.\r\nThanks.  ', resultUrl: `${SITE}/travel#hotel`, resultChecked: true,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'cr1', saved: true, outcomeId: OUTCOME_ID });
  assert.deepEqual(db.read('change_requests', 'cr1').outcome, {
    id: OUTCOME_ID,
    status: 'done',
    reply: 'The hotel name is fixed.\nThanks.',
    resultUrl: 'https://summit.example.org/travel#hotel',
    resultCheckedBy: STAFF,
    resultCheckedAt: new Date(T0 + 9000),
    recordedAt: new Date(T0 + 1000),
    recordedBy: STAFF,
  });
  assert.deepEqual(adminLogs(db), [{
    action: 'saveChangeRequestOutcome', docPath: 'change_requests/cr1', uid: 'staff-1', email: STAFF, at: new Date(T0 + 9000),
  }]);
  assert.doesNotMatch(JSON.stringify(adminLogs(db)), /hotel|travel/);

  // Clearing both is a save too.
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: '', resultUrl: null })).statusCode, 200);
  const cleared = db.read('change_requests', 'cr1').outcome;
  assert.equal(cleared.reply, null);
  assert.equal(cleared.resultUrl, null);
  assert.equal(cleared.resultCheckedBy, null);
  assert.equal(cleared.resultCheckedAt, null);
});

test('outcome details: a result link needs the staff check, and a declined request has no result link', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest(), 'change_requests/cr2': doneRequest({ status: 'declined', outcome: { ...doneRequest().outcome, status: 'declined' } }) });
  const unchecked = await saveOutcome(db, { id: 'cr1', resultUrl: `${SITE}/travel` });
  assert.equal(unchecked.statusCode, 400);
  assert.match(unchecked.body.error.message, /^resultChecked:/);
  const declined = await saveOutcome(db, { id: 'cr2', resultUrl: `${SITE}/travel`, resultChecked: true });
  assert.equal(declined.statusCode, 400);
  // A reply on a declined request is fine.
  assert.equal((await saveOutcome(db, { id: 'cr2', reply: 'We keep the current hotel.' })).statusCode, 200);
});

test('outcome details: a request without an outcome is 409; staff only; 404 for an unknown id', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': storedRequest({ status: 'in_progress' }) });
  const open = await saveOutcome(db, { id: 'cr1', reply: 'Soon.', expectedStatus: 'done', expectedOutcomeId: null });
  assert.equal(open.statusCode, 409);
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'x' }, { token: 'visitor' })).statusCode, 403);
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'x' }, { token: null })).statusCode, 401);
  assert.equal((await saveOutcome(db, { id: 'missing', reply: 'x' })).statusCode, 404);
  assert.equal(db.read('change_requests', 'cr1').outcome, null);
  assert.deepEqual(adminLogs(db), []);
});

test('outcome details: the reply is text of at most MAX_REPLY_LENGTH characters', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest() });
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'x'.repeat(MAX_REPLY_LENGTH + 1) })).statusCode, 400);
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 42 })).statusCode, 400);
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'x'.repeat(MAX_REPLY_LENGTH) })).statusCode, 200);
});

test('result link: only an address on this site’s own origin, compared exactly after parsing', () => {
  const accepted = [
    [`${SITE}/travel`, 'https://summit.example.org/travel'],
    [`${SITE}`, 'https://summit.example.org/'],
    ['HTTPS://Summit.Example.org/a?b=c#d', 'https://summit.example.org/a?b=c#d'],
  ];
  for (const [input, href] of accepted) {
    assert.deepEqual(readResultUrl(input, SITE), { ok: true, href }, input);
  }
  for (const input of [
    'https://summit.example.org.evil.test/travel',
    'https://evil.test/?u=https://summit.example.org',
    'https://evil.test/summit.example.org',
    'https://summit.example.org@evil.test/',
    'https://user:pass@summit.example.org/',
    'http://summit.example.org/travel',
    'https://summit.example.org:8443/travel',
    '//summit.example.org/travel',
    '/travel',
    'javascript:alert(1)//summit.example.org',
    'data:text/html,summit.example.org',
    'not a url',
    `${SITE}/${'a'.repeat(2048)}`,
  ]) {
    assert.equal(readResultUrl(input, SITE).ok, false, input);
  }
  // With no public site address configured, no link can be checked.
  assert.equal(readResultUrl(`${SITE}/travel`, '').ok, false);
});

test('outcome details: a link on another site is 400 and is not stored', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest() });
  const res = await saveOutcome(db, { id: 'cr1', resultUrl: 'https://summit.example.org.evil.test/x', resultChecked: true });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^resultUrl:/);
  assert.equal(db.read('change_requests', 'cr1').outcome.resultUrl, null);
});

// ---------------------------------------------------------------------------
// listMyChangeRequests: the requester's own, requester-safe view
// ---------------------------------------------------------------------------

test('mine: a requester reads only their own requests, newest first, in the requester-safe shape', async () => {
  const db = makeFakeDb({
    'change_requests/old': storedRequest({ message: 'Old one.', createdAt: new Date(T0 - 5000), history: [{ status: 'new', at: new Date(T0 - 5000) }] }),
    'change_requests/new': doneRequest({
      message: 'New one.',
      createdAt: new Date(T0),
      updatedAt: new Date(T0 + 1000),
      updatedBy: STAFF,
      history: [{ status: 'new', at: new Date(T0) }, { status: 'done', at: new Date(T0 + 1000) }],
      outcome: {
        status: 'done', reply: 'Fixed.', resultUrl: `${SITE}/travel`, resultCheckedBy: STAFF,
        resultCheckedAt: new Date(T0 + 1500), recordedAt: new Date(T0 + 1000), recordedBy: STAFF,
      },
      notices: { done: { state: 'failed', error: 'provider refused: 422', queuedBy: STAFF } },
      staffNote: 'INTERNAL: do not share',
    }),
    'change_requests/bos': storedRequest({ uid: 'uid-bo', email: 'bo@example.com', message: 'Bo’s request.' }),
  });

  const res = await listMine(db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    requests: [
      {
        id: 'new',
        message: 'New one.',
        page: '/travel',
        status: 'done',
        createdAt: new Date(T0).toISOString(),
        history: [
          { status: 'new', at: new Date(T0).toISOString() },
          { status: 'done', at: new Date(T0 + 1000).toISOString() },
        ],
        outcome: { status: 'done', reply: 'Fixed.', resultUrl: 'https://summit.example.org/travel', recordedAt: new Date(T0 + 1000).toISOString() },
      },
      {
        id: 'old',
        message: 'Old one.',
        page: '/travel',
        status: 'new',
        createdAt: new Date(T0 - 5000).toISOString(),
        history: [{ status: 'new', at: new Date(T0 - 5000).toISOString() }],
        outcome: null,
      },
    ],
  });
  // No identity, staff address, delivery record or internal field reaches the requester.
  const text = JSON.stringify(res.body);
  for (const secret of ['ada@example.com', 'uid-ada', STAFF, 'INTERNAL', 'provider refused', 'Bo’s request', 'bo@example.com']) {
    assert.ok(!text.includes(secret), secret);
  }

  // The other requester sees only theirs.
  const other = await listMine(db, 'other');
  assert.deepEqual(other.body.requests.map((row) => row.id), ['bos']);
});

test('mine: a request stored before the history existed gets one rebuilt from its own times', async () => {
  const legacy = storedRequest({ status: 'in_progress', updatedAt: new Date(T0 + 1000), updatedBy: STAFF });
  delete legacy.history;
  delete legacy.outcome;
  const db = makeFakeDb({ 'change_requests/legacy': legacy });
  const [row] = (await listMine(db)).body.requests;
  assert.deepEqual(row.history, [
    { status: 'new', at: new Date(T0).toISOString() },
    { status: 'in_progress', at: new Date(T0 + 1000).toISOString() },
  ]);
  assert.equal(row.outcome, null);
});

test('mine: an outcome left on a request that is open again is not shown', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest({ status: 'new' }) });
  const [row] = (await listMine(db)).body.requests;
  assert.equal(row.outcome, null);
});

test('mine: it reads at most MY_REQUESTS_LIMIT requests', async () => {
  const seed = {};
  for (let i = 0; i < MY_REQUESTS_LIMIT + 3; i += 1) {
    seed[`change_requests/r${String(i).padStart(3, '0')}`] = storedRequest({ createdAt: new Date(T0 + i) });
  }
  const res = await listMine(makeFakeDb(seed));
  assert.equal(res.body.requests.length, MY_REQUESTS_LIMIT);
  assert.equal(res.body.requests[0].id, `r${String(MY_REQUESTS_LIMIT + 2).padStart(3, '0')}`);
});

test('mine: 401 with no token, 403 for an unverified address, 405 for anything but POST; the token is checked for revocation', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': storedRequest() });
  auth.revocationChecks.length = 0;
  assert.equal((await listMine(db, null)).statusCode, 401);
  assert.equal((await listMine(db, 'bad-token')).statusCode, 401);
  assert.equal((await listMine(db, 'unverified')).statusCode, 403);
  assert.equal((await listMine(db, 'visitor', 'GET')).statusCode, 405);
  assert.ok(auth.revocationChecks.length > 0);
  assert.ok(auth.revocationChecks.every((checked) => checked === true));
});

test('mine: it works with the flag off, so a requester can still read what they sent', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': storedRequest() }, { features: { changeRequests: false } });
  const res = await listMine(db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requests.length, 1);
});

test('mine: the (uid ASC, createdAt DESC) composite index the query needs is declared for deploy', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const declared = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8'));
  const match = (declared.indexes || []).find((ix) => ix.collectionGroup === 'change_requests'
    && JSON.stringify(ix.fields) === JSON.stringify([
      { fieldPath: 'uid', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ]));
  assert.ok(match, 'firestore.indexes.json must declare (uid ASC, createdAt DESC) on change_requests');
});

// Review finding 5 (#539): a reply or link saved from a form that loaded an
// earlier outcome is refused, so it never lands on a different outcome.
test('outcome details: a save for an outcome that changed since the form loaded is 409 and changes nothing', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest() });
  const formLoaded = { expectedStatus: 'done', expectedOutcomeId: OUTCOME_ID };

  // done -> declined
  await setStatus(db, 'cr1', 'declined', T0 + 2000);
  const declined = await saveOutcome(db, { id: 'cr1', reply: 'Fixed.', ...formLoaded });
  assert.equal(declined.statusCode, 409);
  assert.equal(declined.body.error.code, 'outcome-changed');
  assert.equal(db.read('change_requests', 'cr1').outcome.reply, null);

  // done -> reopen -> done: the same status, a new outcome
  const again = makeFakeDb({ 'change_requests/cr1': doneRequest() });
  await setStatus(again, 'cr1', 'new', T0 + 2000);
  await setStatus(again, 'cr1', 'done', T0 + 3000);
  const stale = await saveOutcome(again, { id: 'cr1', reply: 'Fixed.', ...formLoaded });
  assert.equal(stale.statusCode, 409);
  assert.equal(again.read('change_requests', 'cr1').outcome.reply, null);
});

test('outcome details: the save must name the status and the outcome it loaded', async () => {
  const db = makeFakeDb({ 'change_requests/cr1': doneRequest() });
  for (const body of [
    { id: 'cr1', reply: 'x', expectedStatus: undefined },
    { id: 'cr1', reply: 'x', expectedStatus: 'new' },
    { id: 'cr1', reply: 'x', expectedOutcomeId: undefined },
    { id: 'cr1', reply: 'x', expectedOutcomeId: 42 },
  ]) {
    assert.equal((await saveOutcome(db, body)).statusCode, 400, JSON.stringify(body));
  }
});

test('outcome details: a request done before outcomes existed is saved once, then needs its new id', async () => {
  const legacy = storedRequest({ status: 'done', updatedAt: new Date(T0 + 1000), updatedBy: STAFF });
  delete legacy.outcome;
  const db = makeFakeDb({ 'change_requests/cr1': legacy });
  const first = await saveOutcome(db, { id: 'cr1', reply: 'Done.', expectedStatus: 'done', expectedOutcomeId: null });
  assert.equal(first.statusCode, 200);
  const id = db.read('change_requests', 'cr1').outcome.id;
  assert.equal(first.body.outcomeId, id);
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'Again.', expectedStatus: 'done', expectedOutcomeId: null })).statusCode, 409);
  assert.equal((await saveOutcome(db, { id: 'cr1', reply: 'Again.', expectedStatus: 'done', expectedOutcomeId: id })).statusCode, 200);
});
