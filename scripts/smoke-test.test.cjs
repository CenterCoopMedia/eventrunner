'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { main, probe, runChecks } = require('./smoke-test.cjs');
const { endpoints } = require('../.github/smoke-endpoints.json');
const { createDeliveryWebhookHandler } = require('../functions/src/email/send.cjs');
const { createTicketingWebhookHandler } = require('../functions/src/ticketing/webhook.cjs');

// Run the real method guards. Null dependencies make an accidental POST fail
// before it can authenticate a delivery or write data.
const webhooks = {
  emailDeliveryWebhook: createDeliveryWebhookHandler({ db: null, provider: null }),
  ticketingWebhook: createTicketingWebhookHandler({ db: null, provider: null }),
};
const PUBLIC_URL = 'https://summit.example.org';

async function runSmoke(t, { failedEndpoint, status, networkError, publicStatus = 200 } = {}) {
  const requests = [];
  const preflighted = new Set();
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    if (url === PUBLIC_URL) return new Response(null, { status: publicStatus });
    const name = new URL(url).pathname.slice(1);
    if (!preflighted.has(url)) {
      preflighted.add(url);
      if (name === failedEndpoint) return new Response(null, { status: 204 });
    }
    if (name === failedEndpoint) {
      if (networkError) throw new Error('Connection failed');
      return new Response(null, { status });
    }
    if (Object.hasOwn(webhooks, name)) {
      const res = {
        statusCode: null,
        set() { return this; },
        status(code) { this.statusCode = code; return this; },
        json() { return this; },
      };
      await webhooks[name]({ method: options.method }, res);
      assert.equal(res.statusCode, 405, `${name} rejects OPTIONS`);
      return new Response(null, { status: res.statusCode });
    }
    return new Response(null, { status: 204 });
  });

  const exitCode = await main([
    '--region', 'us-central1', '--project-id', 'demo-run-of-show',
    '--public-url', PUBLIC_URL,
  ]);
  const failedUrls = console.log.mock.calls
    .map(({ arguments: [line] }) => line)
    .filter((line) => line.startsWith('FAIL'))
    .map((line) => line.trim().split(/\s+/)[2]);
  const expectedFailures = failedEndpoint
    ? [`https://us-central1-demo-run-of-show.cloudfunctions.net/${failedEndpoint}`]
    : publicStatus >= 400 ? [PUBLIC_URL] : [];
  assert.deepEqual(failedUrls, expectedFailures);
  const preflights = endpoints.map((name) => ({
    url: `https://us-central1-demo-run-of-show.cloudfunctions.net/${name}`,
    method: 'OPTIONS',
    redirect: 'manual',
  }));
  const expected = [...preflights, { url: PUBLIC_URL, method: 'GET', redirect: 'manual' }, ...preflights];
  assert.deepEqual(requests.map(({ signal, ...request }) => {
    assert.ok(signal instanceof AbortSignal);
    return request;
  }), expected);
  return exitCode;
}

test('smoke accepts the real POST-only webhook guards without submitting deliveries', async (t) => {
  assert.equal(await runSmoke(t), 0);
});

for (const failure of ['transport', 'unavailable']) {
  test(`a check never retries a transient ${failure} failure`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) {
        if (failure === 'transport') throw new Error('Connection reset');
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 204 });
    });
    const result = await probe(PUBLIC_URL, { method: 'OPTIONS' });
    assert.equal(result.ok, false);
    assert.equal(result.status, failure === 'transport' ? null : 503);
    assert.equal(calls, 1);
  });
}

test('a request with no response is aborted on its only attempt', { timeout: 5000 }, async (t) => {
  let aborted = 0;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted += 1; reject(signal.reason); }, { once: true });
  }));
  const result = await probe(PUBLIC_URL, { timeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.equal(result.error, 'request timed out after 5 ms');
  assert.equal(aborted, 1);
});

test('a transient response never retries a method that can write', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  assert.equal((await probe(PUBLIC_URL, { method: 'POST' })).ok, false);
  assert.equal(fetch.mock.calls.length, 1);
});

for (const name of [...Object.keys(webhooks), 'getSiteContent']) {
  for (const status of [404, 500, 503]) {
    test(`smoke fails when ${name} returns ${status}`, async (t) => {
      assert.equal(await runSmoke(t, { failedEndpoint: name, status }), 1);
    });
  }
  test(`smoke fails when ${name} has no response`, async (t) => {
    assert.equal(await runSmoke(t, { failedEndpoint: name, networkError: true }), 1);
  });
}

test('smoke rejects 405 from a browser handler', async (t) => {
  assert.equal(await runSmoke(t, { failedEndpoint: 'getSiteContent', status: 405 }), 1);
});

for (const publicStatus of [200, 302, 404, 405, 500]) {
  test(`public GET keeps its existing behavior for ${publicStatus}`, async (t) => {
    assert.equal(await runSmoke(t, { publicStatus }), publicStatus < 400 ? 0 : 1);
  });
}

async function smokeServer(t, statuses) {
  const requests = [];
  const counts = new Map();
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const count = counts.get(req.url) || 0;
    counts.set(req.url, count + 1);
    const sequence = statuses[req.url] || [200];
    res.writeHead(sequence[Math.min(count, sequence.length - 1)]);
    res.end();
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const checks = [
    { url: `${base}/public`, method: 'GET' },
    ...Object.keys(statuses).map((pathname) => ({
      url: `${base}${pathname}`,
      method: 'OPTIONS',
      expectedStatus: pathname === '/emailDeliveryWebhook' ? 405 : undefined,
    })),
  ];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  return { checks, requests, counts, base };
}

test('HTTP: immediately ready endpoints run every check once', { timeout: 5000 }, async (t) => {
  const { checks, requests, counts } = await smokeServer(t, {
    '/getSentEmail': [204],
    '/emailDeliveryWebhook': [405],
  });
  assert.equal(await runChecks(checks), 0);
  assert.equal(counts.get('/getSentEmail'), 2, 'one readiness request and one check');
  assert.equal(counts.get('/emailDeliveryWebhook'), 2, '405 is ready and an accepted webhook check');
  assert.equal(counts.get('/public'), 1);
  assert.equal(requests.indexOf('GET /public'), 2, 'all endpoints ready before any check');
});

test('HTTP: a rollout 500 then 204 becomes ready within the bound', { timeout: 5000 }, async (t) => {
  const { checks, requests, counts } = await smokeServer(t, {
    '/getSentEmail': [500, 204],
    '/getSiteContent': [204],
  });
  assert.equal(await runChecks(checks, { timeoutMs: 1000, intervalMs: 20 }), 0);
  assert.equal(counts.get('/getSentEmail'), 3, 'two readiness requests and one check');
  assert.equal(counts.get('/getSiteContent'), 2, 'ready endpoints leave the wait set');
  assert.equal(counts.get('/public'), 1);
  assert.equal(requests.indexOf('GET /public'), 3);
});

test('persistent 500s time out naming only endpoints never ready', { timeout: 5000 }, async (t) => {
  const base = 'https://smoke.example.test';
  const statuses = new Map([['/getSentEmail', 500], ['/getSiteContent', 503], ['/emailDeliveryWebhook', 405]]);
  const requests = [];
  const counts = new Map();
  const checks = [
    { url: `${base}/public`, method: 'GET' },
    ...[...statuses.keys()].map((pathname) => ({ url: `${base}${pathname}`, method: 'OPTIONS' })),
  ];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  // This checks readiness diagnostics, without a final HTTP request racing its
  // own deadline. The HTTP rollout and probe-abort cases cover real transport.
  t.mock.method(globalThis, 'fetch', async (url, { method }) => {
    const pathname = new URL(url).pathname;
    requests.push(`${method} ${pathname}`);
    counts.set(pathname, (counts.get(pathname) || 0) + 1);
    return new Response(null, { status: statuses.get(pathname) ?? 200 });
  });
  const started = performance.now();
  assert.equal(await runChecks(checks, { timeoutMs: 250, intervalMs: 20 }), 1);
  assert.ok(performance.now() - started < 2000, 'the readiness phase is bounded');
  assert.deepEqual(console.error.mock.calls.map(({ arguments: [line] }) => line), [
    `smoke-test: readiness timeout; endpoints never ready: ${base}/getSentEmail, ${base}/getSiteContent`,
  ]);
  assert.equal(counts.get('/emailDeliveryWebhook'), 1);
  assert.ok(!requests.includes('GET /public'), 'no checks run after readiness times out');
  assert.deepEqual(console.log.mock.calls.map(({ arguments: [line] }) => line), [
    `FAIL 500  ${base}/getSentEmail`,
    `FAIL 503  ${base}/getSiteContent`,
  ]);
});

test('HTTP: a real 500 after readiness fails without retrying the check', { timeout: 5000 }, async (t) => {
  const { checks, counts, base } = await smokeServer(t, {
    '/getSentEmail': [204, 500, 204],
    '/getSiteContent': [204],
  });
  assert.equal(await runChecks(checks), 1);
  assert.equal(counts.get('/getSentEmail'), 2, 'a retry would hide the real 500');
  assert.equal(counts.get('/getSiteContent'), 2, 'remaining checks still run once');
  assert.equal(counts.get('/public'), 1);
  assert.ok(console.log.mock.calls.some(({ arguments: [line] }) => line === `FAIL 500  ${base}/getSentEmail`));
});
