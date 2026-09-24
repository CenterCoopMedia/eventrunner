'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const {
  createSubmitChangeRequestHandler,
  createUpdateChangeRequestStatusHandler,
  createDeleteChangeRequestHandler,
  internals: {
    MAX_MESSAGE_LENGTH, MAX_PAGE_LENGTH, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, FLAG_OFF_MESSAGE,
  },
} = require('./changeRequests.cjs');

// requireAdmin reads config/bootstrap live and fails closed on an absent
// document, and the submit handler reads config/features live, so every
// fake carries both.
const OPERATOR = 'operator@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP_DOC = { adminEmails: [OPERATOR], staffEmails: [STAFF] };
const FLAG_ON = { schedule: true, changeRequests: true };

// Every sign-in has its account document (users/lifecycle.cjs seeds it), so
// the visitors carry one. The staff and operator are admins by the
// bootstrap list and carry none, as a bootstrap admin may.
const ACCOUNTS = {
  'users/uid-ada': { uid: 'uid-ada', email: 'ada@example.com' },
  'users/uid-bo': { uid: 'uid-bo', email: 'bo@example.com' },
};

function makeFakeDb({ features = FLAG_ON, seed = {}, accounts = ACCOUNTS } = {}) {
  return makeBareFakeDb({
    'config/bootstrap': BOOTSTRAP_DOC,
    ...(features ? { 'config/features': features } : {}),
    ...accounts,
    ...seed,
  });
}

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = Date.parse('2026-09-24T10:00:00.000Z');
const getConfig = async () => ({ bootstrap: BOOTSTRAP_DOC, features: FLAG_ON });

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF, email_verified: true },
  visitor: { uid: 'uid-ada', email: 'Ada@Example.com', email_verified: true },
  other: { uid: 'uid-bo', email: 'bo@example.com', email_verified: true },
  unverified: { uid: 'uid-cy', email: 'cy@example.com', email_verified: false },
  'no-email': { uid: 'uid-di', email_verified: true },
};
// 'deleted' is a token whose sign-in was deleted after it was issued: it
// still verifies, as a real ID token does for up to an hour, unless the
// caller asks Firebase Auth to check the account (checkRevoked).
const DELETED = { uid: 'uid-gone', email: 'gone@example.com', email_verified: true };
const auth = {
  revocationChecks: [],
  async verifyIdToken(token, checkRevoked = false) {
    auth.revocationChecks.push(checkRevoked);
    if (token === 'deleted') {
      if (!checkRevoked) return DELETED;
      const err = new Error('There is no user record corresponding to the provided identifier.');
      err.code = 'auth/user-not-found';
      throw err;
    }
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
};

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const req = (token, body, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

const KEY = 'key0000000000001';

function body(overrides = {}) {
  return { message: 'The travel page lists the wrong hotel.', page: '/travel', submissionKey: KEY, ...overrides };
}

async function submit(db, { token = 'visitor', payload = body(), now = () => T0, method } = {}) {
  const res = makeRes();
  await createSubmitChangeRequestHandler({ db, auth, now, log: QUIET })(req(token, payload, method), res);
  return res;
}

async function setStatus(db, payload, token = 'staff') {
  const res = makeRes();
  await createUpdateChangeRequestStatusHandler({ db, auth, getConfig, now: () => T0 + 1000, log: QUIET })(
    req(token, payload),
    res,
  );
  return res;
}

async function remove(db, payload, token = 'staff') {
  const res = makeRes();
  await createDeleteChangeRequestHandler({ db, auth, getConfig, now: () => T0 + 2000, log: QUIET })(
    req(token, payload),
    res,
  );
  return res;
}

const requests = (db) => db.ids('change_requests').map((id) => ({ id, ...db.read('change_requests', id) }));
const adminLogs = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));
const rateLimit = (db, uid = 'uid-ada') => db.read('change_request_rate_limits', uid);

/** Every path a handler could have written, for "wrote nothing". */
function written(db) {
  return db.writes.map((write) => write.path);
}

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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// submitChangeRequest: the flag, identity, and the body
// ---------------------------------------------------------------------------

test('every endpoint answers 405 to anything but POST', async () => {
  const db = makeFakeDb();
  assert.equal((await submit(db, { method: 'GET' })).statusCode, 405);
  for (const create of [createUpdateChangeRequestStatusHandler, createDeleteChangeRequestHandler]) {
    const res = makeRes();
    await create({ db, auth, getConfig, log: QUIET })(req('staff', { id: 'x' }, 'GET'), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'POST');
  }
  assert.deepEqual(written(db), []);
});

test('the flag off, missing, or not exactly true refuses every submission with 404 and writes nothing', async () => {
  for (const features of [null, {}, { changeRequests: false }, { changeRequests: 'true' }, { changeRequests: 1 }]) {
    const db = makeFakeDb({ features });
    const res = await submit(db);
    assert.equal(res.statusCode, 404, JSON.stringify(features));
    assert.deepEqual(res.body.error, { code: 'not-found', message: FLAG_OFF_MESSAGE });
    assert.deepEqual(written(db), [], JSON.stringify(features));
  }
});

test('the flag is checked before the sign-in, so a signed-out POST with the flag off learns nothing more', async () => {
  const db = makeFakeDb({ features: { changeRequests: false } });
  assert.equal((await submit(db, { token: null })).statusCode, 404);
});

test('the flag is read live: turning it off refuses the very next submission', async () => {
  const db = makeFakeDb();
  assert.equal((await submit(db)).statusCode, 201);
  await db.collection('config').doc('features').set({ ...FLAG_ON, changeRequests: false });
  const res = await submit(db, { payload: body({ submissionKey: 'key0000000000002' }) });
  assert.equal(res.statusCode, 404);
  assert.equal(requests(db).length, 1);
});

test('a features read that fails refuses the submission and writes nothing', async () => {
  const db = makeFakeDb();
  const collection = db.collection.bind(db);
  db.collection = (name) => {
    if (name !== 'config') return collection(name);
    return { doc: () => ({ async get() { throw new Error('unavailable'); } }) };
  };
  const res = await submit(db);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(written(db), []);
});

test('no token or a bad token is 401; an unverified or missing email is 403; nothing is written', async () => {
  const db = makeFakeDb();
  assert.equal((await submit(db, { token: null })).statusCode, 401);
  assert.equal((await submit(db, { token: 'forged' })).statusCode, 401);
  const unverified = await submit(db, { token: 'unverified' });
  assert.equal(unverified.statusCode, 403);
  assert.match(unverified.body.error.message, /verified email/);
  assert.equal((await submit(db, { token: 'no-email' })).statusCode, 403);
  assert.deepEqual(written(db), []);
});

// Review finding 6: an account delete removes the account's change
// requests, so the deleted person's open session must not store a new one.
test('a token whose sign-in was deleted is refused with 401 and stores nothing', async () => {
  const db = makeFakeDb();
  auth.revocationChecks.length = 0;
  const res = await submit(db, { token: 'deleted' });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(written(db), []);
  assert.deepEqual(auth.revocationChecks, [true]);

  // A live account is checked the same way, and goes through.
  auth.revocationChecks.length = 0;
  assert.equal((await submit(db)).statusCode, 201);
  assert.deepEqual(auth.revocationChecks, [true]);
});

// Codex review on #275: the token check passes, then an account delete
// removes users/{uid} and sweeps change_requests, then the store runs. The
// store must not recreate the request and the rate-limit document after the
// sweep, so it reads the account inside its own transaction.
test('an account with no users document is refused with 403 and stores nothing', async () => {
  const db = makeFakeDb({ accounts: {} });
  const res = await submit(db);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'forbidden');
  assert.deepEqual(written(db), []);
});

test('an account deleted while the store is in flight is refused with 403 and stores nothing', async () => {
  const db = makeFakeDb();
  // deleteAttendee's phase 1 commits between this transaction's reads and
  // its commit.
  db.beforeCommit = async () => {
    await db.collection('users').doc('uid-ada').delete();
  };
  const before = written(db).length;
  const res = await submit(db);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(requests(db), []);
  assert.equal(rateLimit(db), undefined);
  assert.deepEqual(adminLogs(db), []);
  assert.equal(written(db).length, before + 1, 'only the delete itself');
});

test('a bootstrap admin with no users document still submits: an admin account is never deleted', async () => {
  const db = makeFakeDb({ accounts: {} });
  assert.equal((await submit(db, { token: 'staff' })).statusCode, 201);
  assert.equal((await submit(db, { token: 'operator', payload: body({ submissionKey: 'key0000000000002' }) })).statusCode, 201);
});

test('a body over 8 KiB is 413 and writes nothing', async () => {
  const db = makeFakeDb();
  const res = await submit(db, { payload: body({ padding: 'x'.repeat(8 * 1024) }) });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(written(db), []);
});

test('the message is required, is text, and holds at most 2000 characters', async () => {
  const db = makeFakeDb();
  for (const [message, expected] of [
    [undefined, 'message: is required.'],
    [null, 'message: is required.'],
    ['   \n ', 'message: is required.'],
    [42, 'message: must be text.'],
    [['a'], 'message: must be text.'],
    ['x'.repeat(MAX_MESSAGE_LENGTH + 1), `message: at most ${MAX_MESSAGE_LENGTH} characters.`],
  ]) {
    const res = await submit(db, { payload: body({ message }) });
    assert.equal(res.statusCode, 400, JSON.stringify(message));
    assert.equal(res.body.error.message, expected);
  }
  assert.deepEqual(written(db), []);
  // The limit counts the trimmed text.
  const edge = await submit(db, { payload: body({ message: ` ${'y'.repeat(MAX_MESSAGE_LENGTH)} ` }) });
  assert.equal(edge.statusCode, 201);
  assert.equal(requests(db)[0].message.length, MAX_MESSAGE_LENGTH);
});

test('the page is optional plain text of at most 200 characters; blank is null', async () => {
  const db = makeFakeDb();
  for (const [page, expected] of [
    [42, 'page: must be text.'],
    [{ href: '/x' }, 'page: must be text.'],
    ['p'.repeat(MAX_PAGE_LENGTH + 1), `page: at most ${MAX_PAGE_LENGTH} characters.`],
  ]) {
    const res = await submit(db, { payload: body({ page }) });
    assert.equal(res.statusCode, 400, JSON.stringify(page));
    assert.equal(res.body.error.message, expected);
  }
  assert.deepEqual(written(db), []);

  let n = 10;
  for (const [page, stored] of [
    [undefined, null], [null, null], ['   ', null], [' /faq ', '/faq'], ['p'.repeat(MAX_PAGE_LENGTH), 'p'.repeat(MAX_PAGE_LENGTH)],
  ]) {
    n += 1;
    const submissionKey = `key00000000000${n}`;
    const res = await submit(db, { payload: body({ page, submissionKey }), now: () => T0 + n * RATE_LIMIT_WINDOW_MS });
    assert.equal(res.statusCode, 201, JSON.stringify(page));
    assert.equal(db.read('change_requests', submissionKey).page, stored);
  }
});

test('a malformed submissionKey is 400 and writes nothing', async () => {
  const db = makeFakeDb();
  for (const submissionKey of ['short', 'has/slash00', 'dots.dots.dots', 'x'.repeat(129), 12345678, null]) {
    const res = await submit(db, { payload: body({ submissionKey }) });
    assert.equal(res.statusCode, 400, JSON.stringify(submissionKey));
    assert.match(res.body.error.message, /^submissionKey:/);
  }
  assert.deepEqual(written(db), []);
});

// ---------------------------------------------------------------------------
// submitChangeRequest: what it stores
// ---------------------------------------------------------------------------

test('an accepted request stores the token’s identity, never the body’s, and writes one audit row', async () => {
  const db = makeFakeDb();
  const res = await submit(db, {
    payload: body({ uid: 'uid-forged', email: 'forged@example.com', status: 'done', extra: 'ignored' }),
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: KEY, ok: true });
  assert.deepEqual(db.read('change_requests', KEY), {
    message: 'The travel page lists the wrong hotel.',
    page: '/travel',
    status: 'new',
    uid: 'uid-ada',
    email: 'ada@example.com',
    createdAt: new Date(T0),
    updatedAt: null,
    updatedBy: null,
  });
  assert.deepEqual(adminLogs(db), [{
    action: 'submitChangeRequest',
    docPath: `change_requests/${KEY}`,
    uid: 'uid-ada',
    email: 'ada@example.com',
    at: new Date(T0),
  }]);
  // The audit row never carries the text.
  assert.doesNotMatch(JSON.stringify(adminLogs(db)), /hotel/);
  assert.deepEqual(rateLimit(db), { requests: [T0], updatedAt: new Date(T0) });
});

test('a request with no submissionKey gets a random id', async () => {
  const db = makeFakeDb();
  const res = await submit(db, { payload: body({ submissionKey: undefined }) });
  assert.equal(res.statusCode, 201);
  assert.match(res.body.id, /^[0-9a-f-]{36}$/);
  assert.ok(db.read('change_requests', res.body.id));
});

test('a staff admin submits through the same endpoint and is recorded as themself', async () => {
  const db = makeFakeDb();
  const res = await submit(db, { token: 'staff' });
  assert.equal(res.statusCode, 201);
  assert.equal(db.read('change_requests', KEY).email, STAFF);
  assert.equal(adminLogs(db)[0].uid, 'staff-1');
});

test('a retry with the same key answers 201 and writes no second request, row, or rate-limit slot', async () => {
  const db = makeFakeDb();
  const first = await submit(db);
  // The retry sends the same text; the server trims both, as it stores it.
  const second = await submit(db, {
    payload: body({ message: '  The travel page lists the wrong hotel. ', page: ' /travel ' }),
    now: () => T0 + 5,
  });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.deepEqual(second.body, first.body);
  assert.equal(requests(db).length, 1);
  assert.equal(adminLogs(db).length, 1);
  assert.deepEqual(rateLimit(db).requests, [T0]);
});

// Codex review on #275: the first answer is lost, the sender edits the text,
// and the retry resends the key. A 201 would say "sent" for text that was
// never stored.
test('a retry that changes the message or the page under a used key is 409, and writes nothing', async () => {
  for (const change of [{ message: 'A different text on the retry.' }, { page: '/venue' }, { page: null }]) {
    const db = makeFakeDb();
    assert.equal((await submit(db)).statusCode, 201);
    const before = written(db).length;
    const res = await submit(db, { payload: body(change), now: () => T0 + 5 });
    assert.equal(res.statusCode, 409, JSON.stringify(change));
    assert.equal(res.body.error.code, 'conflict');
    assert.equal(written(db).length, before);
    assert.equal(db.read('change_requests', KEY).message, 'The travel page lists the wrong hotel.');
    assert.equal(db.read('change_requests', KEY).page, '/travel');
    assert.deepEqual(rateLimit(db).requests, [T0]);
  }
});

test('a key another account already holds is 409, and nothing is written', async () => {
  const db = makeFakeDb();
  assert.equal((await submit(db)).statusCode, 201);
  const before = written(db).length;
  const res = await submit(db, { token: 'other' });
  assert.equal(res.statusCode, 409);
  assert.equal(written(db).length, before);
  assert.equal(db.read('change_requests', KEY).uid, 'uid-ada');
});

// ---------------------------------------------------------------------------
// The rate limit on the public path
// ---------------------------------------------------------------------------

test('rate limit: the sixth request in 15 minutes is 429 with Retry-After, and writes nothing', async () => {
  const db = makeFakeDb();
  for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
    const res = await submit(db, {
      payload: body({ submissionKey: `burst0000000${i}` }),
      now: () => T0 + i * 60_000,
    });
    assert.equal(res.statusCode, 201, `request ${i + 1}`);
  }
  const before = written(db).length;

  const limited = await submit(db, {
    payload: body({ submissionKey: 'burst00000005' }),
    now: () => T0 + 10 * 60_000,
  });

  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.code, 'rate-limited');
  // The oldest slot frees at T0 + 15 minutes: five minutes from now, and
  // the reader is told so in the words they see.
  assert.equal(limited.headers['Retry-After'], '300');
  assert.equal(limited.body.error.retryAfterSeconds, 300);
  assert.equal(limited.body.error.message, 'Too many change requests. Try again in 5 minutes.');
  assert.equal(written(db).length, before, 'no request, no row, no slot');
  assert.equal(db.read('change_requests', 'burst00000005'), undefined);
  assert.equal(requests(db).length, RATE_LIMIT_MAX);
  assert.equal(adminLogs(db).length, RATE_LIMIT_MAX);

  // Another account has its own budget.
  const other = await submit(db, {
    token: 'other',
    payload: body({ submissionKey: 'other00000001' }),
    now: () => T0 + 10 * 60_000,
  });
  assert.equal(other.statusCode, 201);

  // And the window moves on: once the oldest slot is 15 minutes old, one more goes through.
  const later = await submit(db, {
    payload: body({ submissionKey: 'burst00000005' }),
    now: () => T0 + RATE_LIMIT_WINDOW_MS,
  });
  assert.equal(later.statusCode, 201);
  assert.equal(rateLimit(db).requests.length, RATE_LIMIT_MAX);
});

test('rate limit: the refusal names the wait in whole minutes, rounded up, singular at one', async () => {
  const db = makeFakeDb();
  for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
    await submit(db, { payload: body({ submissionKey: `wait00000000${i}` }), now: () => T0 });
  }
  for (const [elapsedMs, expected] of [
    [0, 'Try again in 15 minutes.'],
    // 4 minutes and 1 second left reads as 5.
    [RATE_LIMIT_WINDOW_MS - (4 * 60_000 + 1000), 'Try again in 5 minutes.'],
    [RATE_LIMIT_WINDOW_MS - 61_000, 'Try again in 2 minutes.'],
    [RATE_LIMIT_WINDOW_MS - 60_000, 'Try again in 1 minute.'],
    [RATE_LIMIT_WINDOW_MS - 1000, 'Try again in 1 minute.'],
  ]) {
    const res = await submit(db, { payload: body({ submissionKey: 'wait00000009' }), now: () => T0 + elapsedMs });
    assert.equal(res.statusCode, 429, String(elapsedMs));
    assert.equal(res.body.error.message, `Too many change requests. ${expected}`);
  }
});

test('rate limit: a refused request spends no slot', async () => {
  const db = makeFakeDb();
  for (let i = 0; i < RATE_LIMIT_MAX * 2; i += 1) {
    assert.equal((await submit(db, { payload: body({ message: '' }) })).statusCode, 400);
  }
  assert.equal(rateLimit(db), undefined);
  assert.equal((await submit(db)).statusCode, 201);
});

// ---------------------------------------------------------------------------
// updateChangeRequestStatus
// ---------------------------------------------------------------------------

test('status: staff and operator both change a status, and each change writes its row', async () => {
  const db = makeFakeDb({ seed: { 'change_requests/cr1': storedRequest() } });

  const staff = await setStatus(db, { id: 'cr1', status: 'in_progress' });
  assert.equal(staff.statusCode, 200);
  assert.deepEqual(staff.body, { id: 'cr1', status: 'in_progress' });
  assert.deepEqual(db.read('change_requests', 'cr1'), storedRequest({
    status: 'in_progress', updatedAt: new Date(T0 + 1000), updatedBy: STAFF,
  }));

  const operator = await setStatus(db, { id: 'cr1', status: 'done' }, 'operator');
  assert.equal(operator.statusCode, 200);
  assert.equal(db.read('change_requests', 'cr1').updatedBy, OPERATOR);

  assert.deepEqual(adminLogs(db), [
    { action: 'updateChangeRequestStatus', docPath: 'change_requests/cr1', uid: 'staff-1', email: STAFF, at: new Date(T0 + 1000) },
    { action: 'updateChangeRequestStatus', docPath: 'change_requests/cr1', uid: 'operator-1', email: OPERATOR, at: new Date(T0 + 1000) },
  ]);
});

test('status: every one of the four statuses is accepted', async () => {
  const db = makeFakeDb({ seed: { 'change_requests/cr1': storedRequest() } });
  for (const status of ['in_progress', 'done', 'declined', 'new']) {
    const res = await setStatus(db, { id: 'cr1', status });
    assert.equal(res.statusCode, 200, status);
    assert.equal(db.read('change_requests', 'cr1').status, status);
  }
  assert.equal(adminLogs(db).length, 4);
});

test('status: 401 with no token, 403 for a visitor and an unverified address, 400 for a bad body, 404 for an unknown id', async () => {
  const db = makeFakeDb({ seed: { 'change_requests/cr1': storedRequest() } });
  assert.equal((await setStatus(db, { id: 'cr1', status: 'done' }, null)).statusCode, 401);
  assert.equal((await setStatus(db, { id: 'cr1', status: 'done' }, 'visitor')).statusCode, 403);
  assert.equal((await setStatus(db, { id: 'cr1', status: 'done' }, 'unverified')).statusCode, 403);
  for (const payload of [
    { id: 'cr1', status: 'archived' },
    { id: 'cr1' },
    { id: '', status: 'done' },
    { id: 'change_requests/cr1', status: 'done' },
    { status: 'done' },
  ]) {
    assert.equal((await setStatus(db, payload)).statusCode, 400, JSON.stringify(payload));
  }
  const missing = await setStatus(db, { id: 'cr-missing', status: 'done' });
  assert.equal(missing.statusCode, 404);
  assert.equal(db.read('change_requests', 'cr-missing'), undefined, 'never a created request');
  assert.equal(db.read('change_requests', 'cr1').status, 'new');
  assert.deepEqual(adminLogs(db), []);
});

// ---------------------------------------------------------------------------
// deleteChangeRequest
// ---------------------------------------------------------------------------

test('delete: staff and operator both remove a request outright, and each removal writes its row', async () => {
  const db = makeFakeDb({
    seed: { 'change_requests/cr1': storedRequest(), 'change_requests/cr2': storedRequest({ message: 'Second.' }) },
  });

  const staff = await remove(db, { id: 'cr1' });
  assert.equal(staff.statusCode, 200);
  assert.deepEqual(staff.body, { id: 'cr1', deleted: true });
  assert.equal(db.read('change_requests', 'cr1'), undefined);

  assert.equal((await remove(db, { id: 'cr2' }, 'operator')).statusCode, 200);
  assert.deepEqual(requests(db), []);

  assert.deepEqual(adminLogs(db), [
    { action: 'deleteChangeRequest', docPath: 'change_requests/cr1', uid: 'staff-1', email: STAFF, at: new Date(T0 + 2000) },
    { action: 'deleteChangeRequest', docPath: 'change_requests/cr2', uid: 'operator-1', email: OPERATOR, at: new Date(T0 + 2000) },
  ]);
  // The removal leaves no copy of the text.
  assert.doesNotMatch(JSON.stringify(adminLogs(db)), /Fix the map|Second/);
});

test('delete: 401 with no token, 403 for a visitor, 400 for a bad id, 404 for an unknown id', async () => {
  const db = makeFakeDb({ seed: { 'change_requests/cr1': storedRequest() } });
  assert.equal((await remove(db, { id: 'cr1' }, null)).statusCode, 401);
  assert.equal((await remove(db, { id: 'cr1' }, 'visitor')).statusCode, 403);
  for (const payload of [{}, { id: '' }, { id: '..' }, { id: 'a/b' }, null]) {
    assert.equal((await remove(db, payload)).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await remove(db, { id: 'cr-missing' })).statusCode, 404);
  assert.ok(db.read('change_requests', 'cr1'));
  assert.deepEqual(adminLogs(db), []);
});

test('status changes and removals still work with the flag off, so staff can clear the store', async () => {
  const db = makeFakeDb({
    features: { changeRequests: false },
    seed: { 'change_requests/cr1': storedRequest(), 'change_requests/cr2': storedRequest() },
  });
  assert.equal((await setStatus(db, { id: 'cr1', status: 'declined' })).statusCode, 200);
  assert.equal((await remove(db, { id: 'cr2' })).statusCode, 200);
  assert.equal(adminLogs(db).length, 2);
});

// ---------------------------------------------------------------------------
// Atomicity and the audit row's shape
// ---------------------------------------------------------------------------

/** Make the next transaction commit fail after its body ran. */
function failNextCommit(db) {
  db.beforeCommit = async () => {
    throw new Error('ABORTED: the commit failed');
  };
}

test('a failed commit on submit is 500 and leaves the store as it was: no request, no row, no slot', async () => {
  const db = makeFakeDb();
  failNextCommit(db);
  const res = await submit(db);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'Your request could not be saved. Try again.');
  assert.deepEqual(written(db), []);
  // And the retry the client makes with the same key goes through once.
  assert.equal((await submit(db)).statusCode, 201);
  assert.equal(adminLogs(db).length, 1);
});

test('a failed commit on a status change or a removal is 500 and changes nothing', async () => {
  const db = makeFakeDb({ seed: { 'change_requests/cr1': storedRequest() } });
  failNextCommit(db);
  assert.equal((await setStatus(db, { id: 'cr1', status: 'done' })).statusCode, 500);
  failNextCommit(db);
  assert.equal((await remove(db, { id: 'cr1' })).statusCode, 500);
  assert.deepEqual(db.read('change_requests', 'cr1'), storedRequest());
  assert.deepEqual(written(db), []);
});

test('each write and its audit row commit together, in one transaction', async () => {
  const db = makeFakeDb({ seed: { 'change_requests/cr1': storedRequest() } });
  const seen = [];
  const observe = () => {
    db.beforeCommit = async () => {
      seen.push({ requests: requests(db).length, logs: adminLogs(db).length, status: db.read('change_requests', 'cr1')?.status });
    };
  };

  observe();
  await submit(db);
  observe();
  await setStatus(db, { id: 'cr1', status: 'done' });
  observe();
  await remove(db, { id: 'cr1' });

  // Before each commit, nothing of it had been applied…
  assert.deepEqual(seen, [
    { requests: 1, logs: 0, status: 'new' },
    { requests: 2, logs: 1, status: 'new' },
    { requests: 2, logs: 2, status: 'done' },
  ]);
  // …and each commit applied the write and its row.
  assert.equal(requests(db).length, 1);
  assert.equal(adminLogs(db).length, 3);
});

test('the audit row has exactly the fields logAdminAction writes', async () => {
  const db = makeFakeDb();
  await logAdminAction({ db, action: 'reference', docPath: 'x/y', actor: { uid: 'u', email: 'e' }, now: () => T0 });
  await submit(db);
  const reference = adminLogs(db).find((entry) => entry.action === 'reference');
  const row = adminLogs(db).find((entry) => entry.action === 'submitChangeRequest');
  assert.ok(reference && row);
  assert.deepEqual(Object.keys(row).sort(), Object.keys(reference).sort());
});
