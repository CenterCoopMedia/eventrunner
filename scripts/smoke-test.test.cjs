'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('./smoke-test.cjs');
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
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    if (url === PUBLIC_URL) return new Response(null, { status: publicStatus });
    const name = new URL(url).pathname.slice(1);
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
  assert.equal(requests.length, endpoints.length + 1);
  assert.deepEqual(requests[0], { url: PUBLIC_URL, method: 'GET', redirect: 'manual' });
  assert.deepEqual(requests.slice(1), endpoints.map((name) => ({
    url: `https://us-central1-demo-run-of-show.cloudfunctions.net/${name}`,
    method: 'OPTIONS',
    redirect: 'manual',
  })));
  return exitCode;
}

test('smoke accepts the real POST-only webhook guards without submitting deliveries', async (t) => {
  assert.equal(await runSmoke(t), 0);
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
