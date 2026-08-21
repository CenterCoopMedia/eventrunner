'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLogClientErrorHandler, takeClientErrorRateLimitSlot, internals } = require('./clientErrors.cjs');

/** Minimal in-memory Firestore fake: doc get/set, collection.add, transactions. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    __c: c,
    __id: id,
    async get() {
      const data = store.get(key(c, id));
      return { exists: data !== undefined, data: () => data };
    },
    async set(data) { store.set(key(c, id), data); },
  });
  let autoId = 0;
  return {
    store,
    collection: (c) => ({
      doc: (id) => docRef(c, id),
      async add(data) {
        autoId += 1;
        const id = `auto-${autoId}`;
        store.set(key(c, id), data);
        return { id };
      },
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
    sentEmpty: false,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.sentEmpty = body === ''; return this; },
  };
}

function fakeNotify() {
  const calls = [];
  const impl = async (e) => { calls.push(e); return { delivered: true, sink: 'webhook' }; };
  impl.calls = calls;
  return impl;
}

// --- happy path ------------------------------------------------------------------

test('persists a well-formed report to system_errors, redacted', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db, now: () => 1000 });
  const req = fakeReq({
    body: {
      message: 'TypeError: fetch failed for user jane@example.org',
      stack: 'at f (app.js:1:1)',
      url: 'https://example.org/x?token=abc123&keep=me',
      userAgent: 'Mozilla/5.0',
      context: { page: 'schedule' },
    },
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });

  const rows = [...db.store.entries()].filter(([k]) => k.startsWith('system_errors/'));
  assert.equal(rows.length, 1);
  const [, row] = rows[0];
  assert.equal(row.kind, 'client-error');
  assert.equal(row.message, 'TypeError: fetch failed for user [redacted-email]');
  assert.match(row.url, /token=\[redacted\]/);
  assert.match(row.url, /keep=me/);
  assert.equal(row.userAgent, 'Mozilla/5.0');
  assert.equal(row.context, '{"page":"schedule"}');
  assert.match(row.ipHash, /^[0-9a-f]{64}$/);
  assert.equal(row.resolved, false);
  assert.equal(row.alertedAt, null);
});

test('falls back to the User-Agent header when userAgent is not in the body', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db });
  const req = fakeReq({ body: { message: 'boom' }, headers: { 'user-agent': 'HeaderUA/1.0' } });
  const res = fakeRes();
  await handler(req, res);
  const [, row] = [...db.store.entries()].find(([k]) => k.startsWith('system_errors/'));
  assert.equal(row.userAgent, 'HeaderUA/1.0');
});

// --- method / validation ----------------------------------------------------------

test('rejects non-POST with 405', async () => {
  const handler = createLogClientErrorHandler({ db: fakeDb() });
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('rejects a missing/empty message with 400 and writes nothing', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db });
  const res = fakeRes();
  await handler(fakeReq({ body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.store.size, 0);
});

// --- size caps -----------------------------------------------------------------

test('rejects an oversized body with 413 before writing anything', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db });
  const res = fakeRes();
  const req = fakeReq({ body: { message: 'x'.repeat(internals.MAX_BODY_BYTES + 1) } });
  await handler(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(db.store.size, 0);
});

test('truncates an oversized message/stack instead of rejecting', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db });
  const res = fakeRes();
  const longMessage = 'm'.repeat(internals.MAX_MESSAGE_LEN + 500);
  const longStack = 's'.repeat(internals.MAX_STACK_LEN + 500);
  await handler(fakeReq({ body: { message: longMessage, stack: longStack } }), res);
  assert.equal(res.statusCode, 201);
  const [, row] = [...db.store.entries()].find(([k]) => k.startsWith('system_errors/'));
  assert.ok(row.message.length <= internals.MAX_MESSAGE_LEN + 20);
  assert.ok(row.message.endsWith('[truncated]'));
  assert.ok(row.stack.length <= internals.MAX_STACK_LEN + 20);
});

// --- benign filter ---------------------------------------------------------------

test('a benign (SafeLinks) report is dropped with 204 and no write', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db });
  const res = fakeRes();
  const req = fakeReq({
    body: { message: 'Failed to fetch', url: 'https://nam02.safelinks.protection.outlook.com/?url=x' },
  });
  await handler(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(db.store.size, 0);
});

test('a benign (stale-bundle) report is dropped with 204 and no write', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db });
  const res = fakeRes();
  await handler(fakeReq({ body: { message: 'ChunkLoadError: Loading chunk 3 failed.' } }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(db.store.size, 0);
});

// --- rate limiting -----------------------------------------------------------------

test('bounds writes per IP: the (N+1)th report within the window is rate-limited', async () => {
  const db = fakeDb();
  let nowMs = 0;
  const handler = createLogClientErrorHandler({ db, now: () => nowMs });
  const ip = '198.51.100.9';

  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    const res = fakeRes();
     
    await handler(fakeReq({ body: { message: `err ${i}` }, headers: { 'x-forwarded-for': ip } }), res);
    assert.equal(res.statusCode, 201, `request ${i} should succeed`);
    nowMs += 1;
  }

  const limitedRes = fakeRes();
  await handler(fakeReq({ body: { message: 'one too many' }, headers: { 'x-forwarded-for': ip } }), limitedRes);
  assert.equal(limitedRes.statusCode, 429);
  assert.equal(limitedRes.body.error.code, 'rate-limited');
  assert.ok(limitedRes.headers['Retry-After']);

  const rows = [...db.store.keys()].filter((k) => k.startsWith('system_errors/'));
  assert.equal(rows.length, internals.RATE_LIMIT_MAX);
});

test('a different IP gets its own rate-limit bucket', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db, now: () => 0 });
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
     
    await handler(fakeReq({ body: { message: `a${i}` }, headers: { 'x-forwarded-for': '1.1.1.1' } }), fakeRes());
  }
  const res = fakeRes();
  await handler(fakeReq({ body: { message: 'from another ip' }, headers: { 'x-forwarded-for': '2.2.2.2' } }), res);
  assert.equal(res.statusCode, 201);
});

test('takeClientErrorRateLimitSlot resets after the window elapses', async () => {
  const db = fakeDb();
  let nowMs = 0;
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
     
    const r = await takeClientErrorRateLimitSlot({ db, ipHash: 'h', now: () => nowMs });
    assert.equal(r.limited, false);
  }
  assert.equal((await takeClientErrorRateLimitSlot({ db, ipHash: 'h', now: () => nowMs })).limited, true);
  nowMs += internals.RATE_LIMIT_WINDOW_MS + 1;
  assert.equal((await takeClientErrorRateLimitSlot({ db, ipHash: 'h', now: () => nowMs })).limited, false);
});

// --- client identity (Codex review finding, P1) -----------------------------------
//
// Cloud Functions v2 runs behind Google's front end, which APPENDS the real
// connecting client's IP to X-Forwarded-For rather than trusting/stripping
// whatever arrived with the request — so the platform-vetted entry is the
// LAST one, never the first (see extractClientIp's doc comment).

test('extractClientIp uses the LAST X-Forwarded-For entry, not the first', () => {
  const req = { headers: {}, get(name) { return this.headers[name]; } };
  req.headers['x-forwarded-for'] = '9.9.9.9, 203.0.113.7';
  assert.equal(internals.extractClientIp(req), '203.0.113.7');
});

test('a caller cannot mint a fresh rate-limit bucket by spoofing the FIRST XFF entry', async () => {
  const db = fakeDb();
  const handler = createLogClientErrorHandler({ db, now: () => 0 });
  const realClientIp = '203.0.113.7'; // the entry Cloud Run's front end appends

  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    const spoofedFirstEntry = `10.0.0.${i}`; // caller-controlled, changes every request
    await handler(
      fakeReq({ body: { message: `err ${i}` }, headers: { 'x-forwarded-for': `${spoofedFirstEntry}, ${realClientIp}` } }),
      fakeRes(),
    );
  }

  const limitedRes = fakeRes();
  await handler(
    fakeReq({ body: { message: 'one too many' }, headers: { 'x-forwarded-for': `10.0.0.999, ${realClientIp}` } }),
    limitedRes,
  );
  // The last (platform-appended) entry is unchanged across every request,
  // so the shared bucket is exhausted despite the spoofed first entry.
  assert.equal(limitedRes.statusCode, 429);
});

test('falls back to req.ip when there is no X-Forwarded-For header at all', () => {
  assert.equal(internals.extractClientIp({ headers: {}, ip: '198.51.100.1' }), '198.51.100.1');
  assert.equal(internals.extractClientIp({ headers: {} }), 'unknown');
});

// --- persist-fail fallback (delegated to systemErrors.cjs) -----------------------

test('a persist failure still responds successfully (202) and notifies the operator', async () => {
  const db = fakeDb();
  db.collection = (c) => {
    if (c === 'system_errors') {
      return { add: async () => { throw new Error('firestore down'); } };
    }
    return fakeDb().collection(c); // fresh rate-limit collection, unused across calls here
  };
  // Rebuild a working rate-limit path alongside the broken system_errors one.
  const rateLimitStore = new Map();
  const realCollection = db.collection;
  db.collection = (c) => {
    if (c === 'client_error_rate_limits') {
      return {
        doc: (id) => ({
          __id: id,
          async get() {
            const data = rateLimitStore.get(id);
            return { exists: data !== undefined, data: () => data };
          },
        }),
      };
    }
    return realCollection(c);
  };
  db.runTransaction = async (fn) => fn({
    get: async (ref) => ref.get(),
    set: (ref, data) => rateLimitStore.set(ref.__id, data),
  });

  const notifyOperator = fakeNotify();
  const handler = createLogClientErrorHandler({ db, notifyOperator, log: { error() {} } });
  const res = fakeRes();
  await handler(fakeReq({ body: { message: 'boom' } }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(notifyOperator.calls.length, 1);
  assert.equal(notifyOperator.calls[0].dedupeKey, 'system-errors-persist-fail:client-error');
});
