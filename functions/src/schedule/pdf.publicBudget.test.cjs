'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const pdf = require('./pdf.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { PUBLIC_PDF_TTL_MS, MAX_PUBLIC_SESSIONS, MAX_PUBLIC_SPEAKERS } = pdf.internals;

function response() {
  return {
    headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function fixture(seed = {}) {
  const underlying = makeFakeDb(seed);
  const reads = [];
  let fail = false;
  let clock = 1000;
  let config = { features: { schedulePdf: true }, event: { name: 'Fixture', days: [{ id: 'day' }] } };
  const db = {
    collection(name) {
      const collection = underlying.collection(name);
      if (name === 'cmsSchedule') {
        return { where(...args) {
          const query = collection.where(...args);
          return { limit(count) {
            assert.equal(count, MAX_PUBLIC_SESSIONS + 1);
            return { async get() {
              reads.push('sessions');
              if (fail) throw new Error('Synthetic outage');
              return query.limit(count).get();
            } };
          } };
        } };
      }
      assert.equal(name, 'speakers');
      return { doc(id) { return { async get() {
        reads.push(`speaker:${id}`);
        return collection.doc(id).get();
      } }; } };
    },
  };
  const deps = { db, getConfig: async () => config, now: () => clock, log: { error() {} } };
  const handler = pdf.createBuildSchedulePdfHandler(deps);
  return {
    deps, reads, underlying,
    advance(ms) { clock += ms; },
    setConfig(value) { config = value; },
    fail(value) { fail = value; },
    async get(request = {}) {
      const res = response();
      await handler({ method: 'GET', ...request }, res);
      return res;
    },
  };
}

const session = (overrides = {}) => ({ visible: true, dayId: 'day', title: 'Fixture session', ...overrides });

test('public PDF: concurrent and repeated requests perform one read/build, ignoring cache-busting input', async () => {
  const f = fixture({ 'cmsSchedule/one': session() });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    f.get({ query: { nonce: i }, headers: { 'cache-control': 'no-cache' } }),
  ));
  const repeated = await f.get();
  for (const res of [...results, repeated]) {
    assert.equal(res.statusCode, 200);
    assert.strictEqual(res.body, results[0].body, 'same generated buffer');
    assert.match(res.headers['Cache-Control'], /public, max-age=0, s-maxage=60, must-revalidate/);
  }
  assert.deepEqual(f.reads, ['sessions']);
});

test('public PDF: cache expires and refreshes after schedule edits', async () => {
  const f = fixture({ 'cmsSchedule/one': session() });
  const first = await f.get();
  await f.underlying.collection('cmsSchedule').doc('one').update({ title: 'Updated title' });
  f.advance(PUBLIC_PDF_TTL_MS - 1);
  assert.strictEqual((await f.get()).body, first.body);
  f.advance(1);
  const refreshed = await f.get();
  assert.equal(refreshed.statusCode, 200);
  assert.notDeepEqual(refreshed.body, first.body);
  assert.deepEqual(f.reads, ['sessions', 'sessions']);
});

test('public PDF: disablement blocks cached output; config changes do not serve the old PDF', async () => {
  const f = fixture();
  await f.get();
  f.setConfig({ features: { schedulePdf: false } });
  const disabled = await f.get();
  assert.equal(disabled.statusCode, 404);
  assert.equal(disabled.headers['Cache-Control'], 'no-store');
  f.setConfig({ features: { schedulePdf: true }, event: { name: 'Changed' } });
  const limited = await f.get();
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '60');
  f.advance(PUBLIC_PDF_TTL_MS);
  assert.equal((await f.get()).statusCode, 200);
  assert.deepEqual(f.reads, ['sessions', 'sessions']);
});

test('public PDF: failed builds consume the refresh budget and recover after cooldown', async () => {
  const f = fixture();
  f.fail(true);
  assert.equal((await f.get()).statusCode, 500);
  for (let i = 0; i < 10; i += 1) {
    const res = await f.get();
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.deepEqual(f.reads, ['sessions']);
  f.fail(false);
  f.advance(PUBLIC_PDF_TTL_MS);
  assert.equal((await f.get()).statusCode, 200);
  assert.deepEqual(f.reads, ['sessions', 'sessions']);
});

test('public PDF: only unique referenced speakers from visible sessions are read', async () => {
  const f = fixture({
    'cmsSchedule/one': session({ speakerIds: ['approved', 'approved', 'pending', 'missing', '', null, 'bad/path'] }),
    'cmsSchedule/hidden': session({ visible: false, speakerIds: ['hidden-only'] }),
    'speakers/approved': { firstName: 'Alex', lastName: 'Fixture', status: 'approved' },
    'speakers/pending': { firstName: 'Pending', status: 'pending' },
    'speakers/unrelated': { firstName: 'Unrelated', status: 'approved' },
  });
  assert.equal((await f.get()).statusCode, 200);
  assert.deepEqual(f.reads, ['sessions', 'speaker:approved', 'speaker:pending', 'speaker:missing']);
});

test('public PDF: session and speaker budgets refuse oversized builds before speaker reads', async () => {
  const many = Object.fromEntries(Array.from({ length: MAX_PUBLIC_SESSIONS + 1 }, (_, i) =>
    [`cmsSchedule/${i}`, session()],
  ));
  for (const seed of [many, { 'cmsSchedule/one': session({
    speakerIds: Array.from({ length: MAX_PUBLIC_SPEAKERS + 1 }, (_, i) => `sp-${i}`),
  }) }]) {
    const f = fixture(seed);
    assert.equal((await f.get()).statusCode, 500);
    assert.deepEqual(f.reads, ['sessions']);
    assert.equal((await f.get()).statusCode, 429);
  }
});

test('public PDF: deployed wrapper preserves the handler and enforces runtime caps', async (t) => {
  const f = fixture();
  const original = Module._load;
  const options = [];
  t.mock.method(Module, '_load', function (request, ...args) {
    if (request === 'firebase-functions/v2/https') return { onRequest(opts, handler) {
      options.push(opts);
      return handler;
    } };
    if (request === '../core/firestore.cjs') return { getDb: () => f.deps.db };
    if (request === 'firebase-admin/auth') return { getAuth: () => ({}) };
    if (request === '../core/config.cjs') return { getEventConfig: f.deps.getConfig };
    if (request === '../core/http.cjs') return { applyCors: () => false, parseAllowedOrigins: () => [] };
    return original.call(this, request, ...args);
  });
  const handlers = pdf.handlers;
  assert.equal(options[0].maxInstances, 1);
  assert.equal(options[0].concurrency, 20);
  assert.equal(options[0].timeoutSeconds, 60);
  for (let i = 0; i < 3; i += 1) {
    const res = response();
    await handlers.buildSchedulePdf({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
  }
  assert.deepEqual(f.reads, ['sessions']);
});
