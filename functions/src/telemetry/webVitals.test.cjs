'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const telemetry = require('./webVitals.cjs');
const { createVitalsRecorder, createWebVitalsHandler, internals } = telemetry;
const { COLLECTION, RETENTION_DAYS } = require('shared/webVitals');

const NOW = Date.UTC(2026, 10, 12, 16, 30);
const SAMPLE = { route: '/schedule/:sessionId', device: 'mobile', name: 'LCP', value: 2499 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('condition did not become true');
}

function response() {
  return {
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

function request(body, overrides = {}) {
  const rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return { method: 'POST', body, rawBody, headers: {}, ...overrides };
}

function recorderFixture({ enabled = true, exists = true, configError = false, commitGate = null } = {}) {
  const waits = [];
  const commits = [];
  let configReads = 0;
  const db = {
    collection(name) {
      if (name === 'config') return { doc() { return { async get() {
        configReads += 1;
        if (configError) throw new Error('synthetic config outage');
        return { exists, data: () => ({ coreWebVitals: enabled }) };
      } }; } };
      assert.equal(name, COLLECTION);
      return { doc(id) { return { id, path: `${name}/${id}` }; } };
    },
    batch() {
      const writes = [];
      return {
        set(ref, data, options) { writes.push({ ref, data, options }); },
        async commit() {
          commits.push(writes);
          if (commitGate) await commitGate.promise;
        },
      };
    },
  };
  const recorder = createVitalsRecorder({
    db,
    now: () => NOW,
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
    increment: (amount) => ({ increment: amount }),
  });
  return {
    recorder,
    waits,
    commits,
    configReads: () => configReads,
    setEnabled(value) { enabled = value; },
    releaseWindow(index) { waits[index].resolve(); },
  };
}

test('daily aggregation uses fixed documents, histogram increments, and UTC day retention', () => {
  const rows = internals.aggregateSamples([
    SAMPLE,
    { ...SAMPLE, value: 2500 },
    { ...SAMPLE, value: 2501 },
    { route: SAMPLE.route, device: SAMPLE.device, name: 'INP', value: 201 },
    { route: '/', device: 'desktop', name: 'held_up', value: 1 },
  ], NOW, (amount) => amount);

  assert.equal(rows.length, 2);
  const mobile = rows.find(({ data }) => data.device === 'mobile');
  assert.equal(mobile.id, `2026-11-12__mobile__${Buffer.from(SAMPLE.route).toString('base64url')}`);
  assert.deepEqual(mobile.data.counts, { LCP: { 25: 2, 26: 1 }, INP: { 21: 1 } });
  assert.equal(mobile.data.expiresAt.toISOString(), '2026-12-12T00:00:00.000Z');
  assert.equal(
    mobile.data.expiresAt.getTime() - Date.parse(`${mobile.data.day}T00:00:00.000Z`),
    RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const desktop = rows.find(({ data }) => data.device === 'desktop');
  assert.deepEqual(desktop.data.counts, { held_up: { 1: 1 } });
  assert.doesNotMatch(JSON.stringify(rows), /uid|url|userAgent|ip|identifier/i);
});

test('concurrent samples share one window and every response waits for its commit', async () => {
  const commitGate = deferred();
  const fixture = recorderFixture({ commitGate });
  let settled = 0;
  const first = fixture.recorder.record(SAMPLE).then(() => { settled += 1; });
  const second = fixture.recorder.record({ ...SAMPLE, value: 2600 }).then(() => { settled += 1; });

  await until(() => fixture.waits.length === 1);
  assert.equal(fixture.waits[0].ms, 1000);
  fixture.releaseWindow(0);
  await until(() => fixture.commits.length === 1);
  assert.equal(settled, 0);
  assert.equal(fixture.configReads(), 1);
  assert.equal(fixture.commits[0].length, 1);
  assert.deepEqual(fixture.commits[0][0].data.counts, {
    LCP: { 25: { increment: 1 }, 26: { increment: 1 } },
  });

  commitGate.resolve();
  await Promise.all([first, second]);
  assert.equal(settled, 2);
});

test('a sample received during a write waits for the next window and a fresh off switch drops it', async () => {
  const commitGate = deferred();
  const fixture = recorderFixture({ commitGate });
  const first = fixture.recorder.record(SAMPLE);
  await until(() => fixture.waits.length === 1);
  fixture.releaseWindow(0);
  await until(() => fixture.commits.length === 1);

  const second = fixture.recorder.record({ ...SAMPLE, name: 'CLS', value: 0.1 });
  fixture.setEnabled(false);
  commitGate.resolve();
  await first;
  await until(() => fixture.waits.length === 2);
  assert.equal(fixture.waits[1].ms, 1000);
  fixture.releaseWindow(1);
  assert.deepEqual(await second, { stored: false });
  assert.equal(fixture.configReads(), 2);
  assert.equal(fixture.commits.length, 1);
});

test('feature missing, false, and a config read failure acknowledge valid samples without a write', async () => {
  for (const options of [{ exists: false }, { enabled: false }, { configError: true }]) {
    const fixture = recorderFixture(options);
    const handler = createWebVitalsHandler({ recorder: fixture.recorder });
    const res = response();
    const handled = handler(request(SAMPLE), res);
    await until(() => fixture.waits.length === 1);
    fixture.releaseWindow(0);
    await handled;
    assert.equal(res.statusCode, 204);
    assert.equal(fixture.commits.length, 0);
  }
});

test('the receiver parses the JSON text body used by sendBeacon', async () => {
  const seen = [];
  const handler = createWebVitalsHandler({ recorder: { async record(sample) { seen.push(sample); } } });
  const rawBody = Buffer.from(JSON.stringify(SAMPLE), 'utf8');
  const res = response();
  await handler({ method: 'POST', body: rawBody, rawBody, headers: {} }, res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(seen, [SAMPLE]);
});

test('the receiver rejects methods, raw-byte overflow, malformed samples, and extra fields', async () => {
  const recorder = { async record() { assert.fail('invalid input reached the recorder'); } };
  const handler = createWebVitalsHandler({ recorder });

  const method = response();
  await handler(request(SAMPLE, { method: 'GET' }), method);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.Allow, 'POST');

  const oversized = response();
  await handler(request(SAMPLE, { rawBody: Buffer.alloc(513) }), oversized);
  assert.equal(oversized.statusCode, 413);

  for (const body of [
    { ...SAMPLE, route: '/schedule/private-id' },
    { ...SAMPLE, value: Number.NaN },
    { ...SAMPLE, navigationId: 'forbidden' },
    '{bad json',
  ]) {
    const res = response();
    await handler(request(body), res);
    assert.equal(res.statusCode, 400);
  }
});

test('the deployed receiver keeps the public concurrency, instance, and CORS bounds', async (t) => {
  const original = Module._load;
  const options = [];
  const previousOrigins = process.env.EVENT_ALLOWED_ORIGINS;
  process.env.EVENT_ALLOWED_ORIGINS = 'https://event.example';
  t.after(() => {
    if (previousOrigins === undefined) delete process.env.EVENT_ALLOWED_ORIGINS;
    else process.env.EVENT_ALLOWED_ORIGINS = previousOrigins;
  });
  t.mock.method(Module, '_load', function (requestName, ...args) {
    if (requestName === 'firebase-functions/v2/https') return { onRequest(opts, handler) {
      options.push(opts);
      return handler;
    } };
    return original.call(this, requestName, ...args);
  });
  const handlers = telemetry.handlers;
  assert.equal(typeof handlers.logWebVitals, 'function');
  assert.deepEqual(options, [{
    region: (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1',
    maxInstances: 1,
    concurrency: 80,
    cpu: 1,
  }]);
  const res = response();
  await handlers.logWebVitals({ method: 'OPTIONS', headers: { origin: 'https://event.example' } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://event.example');
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'POST');
  const otherOrigin = response();
  await handlers.logWebVitals({ method: 'OPTIONS', headers: { origin: 'https://other.example' } }, otherOrigin);
  assert.equal(otherOrigin.statusCode, 204);
  assert.equal(otherOrigin.headers['Access-Control-Allow-Origin'], undefined);
});
