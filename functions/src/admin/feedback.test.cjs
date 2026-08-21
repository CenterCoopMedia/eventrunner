'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSubmitFeedbackHandler,
  createUpdateFeedbackStatusHandler,
  takeFeedbackRateLimitSlot,
  looksLikeBot,
  internals,
} = require('./feedback.cjs');

// ---------------------------------------------------------------- fixtures

/** Minimal in-memory Firestore fake: doc get/set/update, collection.doc() auto-id, transactions. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  let autoId = 0;
  function docRef(c, id) {
    return {
      __c: c,
      __id: id,
      get id() { return id; },
      async get() {
        const data = store.get(key(c, id));
        return { exists: data !== undefined, data: () => data };
      },
      async set(data) { store.set(key(c, id), data); },
      async update(patch) {
        const existing = store.get(key(c, id)) || {};
        store.set(key(c, id), { ...existing, ...patch });
      },
    };
  }
  return {
    store,
    collection: (c) => ({
      doc: (id) => docRef(c, id === undefined ? `auto-${(autoId += 1)}` : id),
    }),
    async runTransaction(fn) {
      return fn({
        get: async (ref) => ref.get(),
        set: (ref, data) => { store.set(key(ref.__c, ref.__id), data); },
      });
    },
  };
}

function fakeReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return {
    method,
    body,
    headers,
    get(name) { return headers[name.toLowerCase()]; },
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

const ADMIN_TOKEN = 'admin-token';
const NON_ADMIN_TOKEN = 'user-token';
const fakeAuth = {
  async verifyIdToken(token) {
    if (token === ADMIN_TOKEN) return { uid: 'admin1', email: 'admin@example.org', email_verified: true };
    if (token === NON_ADMIN_TOKEN) return { uid: 'user1', email: 'user@example.org', email_verified: true };
    throw new Error('bad token');
  },
};
const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.org'] } });
function adminReq(body) {
  return { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, body };
}

const NOW = 1_700_000_000_000;
/** A submission that clears the honeypot + time-gate checks. */
function realBody(overrides = {}) {
  return {
    message: 'The registration link on the schedule page 404s.',
    startedAt: NOW - internals.MIN_ELAPSED_MS - 1000,
    honeypot: '',
    ...overrides,
  };
}

// --------------------------------------------------------------- looksLikeBot

test('looksLikeBot flags a filled honeypot regardless of timing', () => {
  assert.equal(looksLikeBot({ honeypot: 'i am a bot', startedAt: NOW - 60000, now: NOW }), true);
});

test('looksLikeBot flags a submission faster than a human could type', () => {
  assert.equal(looksLikeBot({ honeypot: '', startedAt: NOW - 100, now: NOW }), true);
});

test('looksLikeBot flags a missing/invalid startedAt', () => {
  assert.equal(looksLikeBot({ honeypot: '', startedAt: undefined, now: NOW }), true);
  assert.equal(looksLikeBot({ honeypot: '', startedAt: 'nope', now: NOW }), true);
});

test('looksLikeBot passes a normal, slower submission', () => {
  assert.equal(looksLikeBot({ honeypot: '', startedAt: NOW - 10000, now: NOW }), false);
});

// ------------------------------------------------------------- submitFeedback

test('accepts a well-formed submission and writes the feedback collection', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ email: 'ATTENDEE@Example.org', category: 'bug' }) }), res);
  assert.equal(res.statusCode, 201);
  assert.ok(res.body.ok);
  const [, row] = [...db.store.entries()].find(([k]) => k.startsWith('feedback/'));
  assert.equal(row.message, realBody().message);
  assert.equal(row.email, 'attendee@example.org');
  assert.equal(row.category, 'bug');
  assert.equal(row.status, 'new');
  assert.match(row.ipHash, /^[0-9a-f]{64}$/);
});

test('rejects non-POST with 405', async () => {
  const handler = createSubmitFeedbackHandler({ db: fakeDb() });
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('rejects a missing message with 400 and writes nothing', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ message: '' }) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.store.size, 0);
});

test('rejects an invalid email with 400', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ email: 'not-an-email' }) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.store.size, 0);
});

test('an unknown category falls back to feedback rather than rejecting', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  await handler(fakeReq({ body: realBody({ category: 'nonsense' }) }), fakeRes());
  const [, row] = [...db.store.entries()].find(([k]) => k.startsWith('feedback/'));
  assert.equal(row.category, 'feedback');
});

test('rejects an oversized body with 413 before writing anything', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ message: 'x'.repeat(internals.MAX_BODY_BYTES + 1) }) }), res);
  assert.equal(res.statusCode, 413);
  assert.equal(db.store.size, 0);
});

test('truncates an oversized message instead of rejecting', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const longMessage = 'm'.repeat(internals.MAX_MESSAGE_LEN + 500);
  await handler(fakeReq({ body: realBody({ message: longMessage }) }), fakeRes());
  const [, row] = [...db.store.entries()].find(([k]) => k.startsWith('feedback/'));
  assert.equal(row.message.length, internals.MAX_MESSAGE_LEN);
});

// --- honeypot / time gate: identical-looking success, nothing written -------------

test('a filled honeypot gets a success-shaped response but writes nothing', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ honeypot: 'gotcha' }) }), res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(db.store.size, 0);
});

test('a submission faster than the minimum elapsed time is silently dropped', async () => {
  const db = fakeDb();
  const handler = createSubmitFeedbackHandler({ db, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ startedAt: NOW - 10 }) }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(db.store.size, 0);
});

// --- rate limiting -----------------------------------------------------------------

test('bounds submissions per IP: the (N+1)th within the window is rate-limited', async () => {
  const db = fakeDb();
  let nowMs = NOW;
  const handler = createSubmitFeedbackHandler({ db, now: () => nowMs });
  const ip = '198.51.100.9';

  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    const res = fakeRes();
    await handler(
      fakeReq({
        body: realBody({ startedAt: nowMs - internals.MIN_ELAPSED_MS - 1000, message: `report ${i}` }),
        headers: { 'x-forwarded-for': ip },
      }),
      res,
    );
    assert.equal(res.statusCode, 201, `request ${i} should succeed`);
    nowMs += 1;
  }

  const limitedRes = fakeRes();
  await handler(
    fakeReq({
      body: realBody({ startedAt: nowMs - internals.MIN_ELAPSED_MS - 1000, message: 'one too many' }),
      headers: { 'x-forwarded-for': ip },
    }),
    limitedRes,
  );
  assert.equal(limitedRes.statusCode, 429);
  assert.equal(limitedRes.body.error.code, 'rate-limited');
  assert.ok(limitedRes.headers['Retry-After']);

  const rows = [...db.store.keys()].filter((k) => k.startsWith('feedback/'));
  assert.equal(rows.length, internals.RATE_LIMIT_MAX);
});

test('takeFeedbackRateLimitSlot resets after the window elapses', async () => {
  const db = fakeDb();
  let nowMs = 0;
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    const r = await takeFeedbackRateLimitSlot({ db, ipHash: 'h', now: () => nowMs });
    assert.equal(r.limited, false);
  }
  assert.equal((await takeFeedbackRateLimitSlot({ db, ipHash: 'h', now: () => nowMs })).limited, true);
  nowMs += internals.RATE_LIMIT_WINDOW_MS + 1;
  assert.equal((await takeFeedbackRateLimitSlot({ db, ipHash: 'h', now: () => nowMs })).limited, false);
});

// --- confirmation email (onceKey-gated) ---------------------------------------------

test('sends an onceKey-gated confirmation email when an email address is given', async () => {
  const db = fakeDb();
  const sent = [];
  const sendEmail = async (message) => { sent.push(message); return { status: 'sent' }; };
  const handler = createSubmitFeedbackHandler({
    db,
    now: () => NOW,
    sendEmail,
    getConfig: async () => ({ event: { name: 'Test Summit', sender: {} } }),
  });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ email: 'attendee@example.org' }) }), res);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'attendee@example.org');
  assert.equal(sent[0].tag, 'feedback.confirmation');
  assert.equal(sent[0].onceKey, `feedback-confirmation:${res.body.id}`);
});

test('does not attempt to send an email when none was given', async () => {
  const db = fakeDb();
  const sent = [];
  const sendEmail = async (message) => { sent.push(message); return { status: 'sent' }; };
  const handler = createSubmitFeedbackHandler({
    db,
    now: () => NOW,
    sendEmail,
    getConfig: async () => ({ event: { name: 'Test Summit', sender: {} } }),
  });
  await handler(fakeReq({ body: realBody() }), fakeRes());
  assert.equal(sent.length, 0);
});

test('a failed confirmation send still returns success for the durable submission', async () => {
  const db = fakeDb();
  const sendEmail = async () => { throw new Error('provider down'); };
  const handler = createSubmitFeedbackHandler({
    db,
    now: () => NOW,
    sendEmail,
    getConfig: async () => ({ event: { name: 'Test Summit', sender: {} } }),
    log: { error() {}, warn() {} },
  });
  const res = fakeRes();
  await handler(fakeReq({ body: realBody({ email: 'attendee@example.org' }) }), res);
  assert.equal(res.statusCode, 201);
  assert.ok(res.body.ok);
});

// ------------------------------------------------------------ updateFeedbackStatus

test('updateFeedbackStatus marks a row reviewed and logs the action', async () => {
  const db = fakeDb();
  await db.collection('feedback').doc('f1').set({ message: 'x', status: 'new' });
  const handler = createUpdateFeedbackStatusHandler({ db, auth: fakeAuth, getConfig, now: () => NOW });
  const res = fakeRes();
  await handler(adminReq({ id: 'f1', status: 'reviewed' }), res);
  assert.equal(res.statusCode, 200);
  const row = db.store.get('feedback/f1');
  assert.equal(row.status, 'reviewed');
  assert.equal(row.reviewedBy, 'admin@example.org');
  const logEntry = [...db.store.entries()].find(([k]) => k.startsWith('admin_logs/'))?.[1];
  assert.equal(logEntry.action, 'updateFeedbackStatus');
});

test('updateFeedbackStatus rejects an unknown status', async () => {
  const db = fakeDb();
  await db.collection('feedback').doc('f1').set({ message: 'x', status: 'new' });
  const handler = createUpdateFeedbackStatusHandler({ db, auth: fakeAuth, getConfig, now: () => NOW });
  const res = fakeRes();
  await handler(adminReq({ id: 'f1', status: 'bogus' }), res);
  assert.equal(res.statusCode, 400);
});

test('updateFeedbackStatus 404s on an unknown id, gates on admin', async () => {
  const db = fakeDb();
  let res = fakeRes();
  await createUpdateFeedbackStatusHandler({ db, auth: fakeAuth, getConfig })(adminReq({ id: 'ghost', status: 'reviewed' }), res);
  assert.equal(res.statusCode, 404);

  await db.collection('feedback').doc('f1').set({ message: 'x', status: 'new' });
  res = fakeRes();
  await createUpdateFeedbackStatusHandler({ db, auth: fakeAuth, getConfig })(
    { method: 'POST', headers: {}, body: { id: 'f1', status: 'reviewed' } },
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(db.store.get('feedback/f1').status, 'new');
});
