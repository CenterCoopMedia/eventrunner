'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPacedFetch, QUOTA_WAIT_MS } = require('./functions-write-pacing.cjs');

const FUNCTIONS = 'https://cloudfunctions.googleapis.com';
const RUN = 'https://run.googleapis.com';
const quiet = { warn() {} };

test('concurrent function and invoker writes fit every rolling provider quota window', async () => {
  let clock = 0;
  const writes = [];
  const paced = createPacedFetch(async (url, options) => {
    writes.push({ url, options, at: clock });
    return new Response('{}');
  }, { origins: [FUNCTIONS, RUN], now: () => clock, wait: async (delay) => { clock += delay; }, log: quiet });
  const requests = Array.from({ length: 140 }, (_, index) => [
    paced(`${FUNCTIONS}/v2/projects/demo/locations/us-central1/functions/handler${index}`, { method: 'PATCH' }),
    paced(`${RUN}/v1/projects/demo/locations/us-central1/services/handler${index}:setIamPolicy`, { method: 'POST', body: '{}' }),
  ]).flat();
  await Promise.all(requests);
  assert.equal(writes.length, 280);
  for (let index = 1; index < writes.length; index += 1) {
    assert.ok(writes[index].at - writes[index - 1].at >= 1500, 'actual dispatches must remain spaced under concurrency');
  }
  for (const write of writes) {
    assert.ok(writes.filter((other) => other.at >= write.at && other.at < write.at + 60_000).length <= 40);
    assert.ok(writes.filter((other) => other.at >= write.at && other.at < write.at + 100_000).length <= 67);
  }
});

test('reads and other providers retain the original request and response without waiting', async () => {
  const options = { method: 'POST', body: 'private-request-sentinel' };
  const response = new Response('private-response-sentinel');
  const calls = [];
  const paced = createPacedFetch(async (...args) => { calls.push(args); return response; }, {
    origins: [FUNCTIONS, RUN], wait: async () => assert.fail('unrelated requests must not wait'), log: quiet,
  });
  assert.equal(await paced(`${FUNCTIONS}/v2/operations/read`, { method: 'GET' }), response);
  assert.equal(await paced('https://storage.googleapis.com/upload', options), response);
  assert.equal(calls[1][1], options);
});

test('quota responses wait out the full window and retain the final response after bounded retries', async () => {
  for (const statuses of [[429, 200], [429, 429, 429], [403], [500]]) {
    let clock = 0;
    const starts = [];
    const logs = [];
    const responses = statuses.map((status) => new Response('private-response-sentinel', { status }));
    const options = { method: 'PATCH', body: 'private-body-sentinel', headers: { Authorization: 'private-header-sentinel' } };
    const paced = createPacedFetch(async (_url, supplied) => {
      assert.equal(supplied, options);
      starts.push(clock);
      return responses[starts.length - 1];
    }, { origins: [FUNCTIONS, RUN], now: () => clock, wait: async (delay) => { clock += delay; }, log: { warn: (message) => logs.push(message) } });
    const result = await paced(`${RUN}/v1/private-path-sentinel:setIamPolicy`, options);
    assert.equal(result, responses.at(-1));
    assert.deepEqual(starts, statuses.map((_, index) => index * QUOTA_WAIT_MS));
    assert.equal(await result.text(), 'private-response-sentinel', 'the final response remains available to the CLI');
    assert.doesNotMatch(logs.join('\n'), /private-|Authorization|googleapis/);
  }
});

test('a quota response pauses writes already waiting for their next turn', async () => {
  let clock = 0;
  const timers = [];
  const starts = [];
  let rejectQuota;
  const pending = new Promise((resolve) => { rejectQuota = resolve; });
  const paced = createPacedFetch(async () => {
    starts.push(clock);
    return starts.length === 1 ? pending : new Response('{}');
  }, { origins: [FUNCTIONS, RUN], now: () => clock,
    wait: (delay) => new Promise((resolve) => timers.push({ delay, resolve })), log: quiet });
  const first = paced(`${FUNCTIONS}/v2/functions/first`, { method: 'PATCH' });
  const second = paced(`${RUN}/v1/services/second:setIamPolicy`, { method: 'POST' });
  await new Promise(setImmediate);
  assert.deepEqual(starts, [0]);
  rejectQuota(new Response('{}', { status: 429 }));
  await new Promise(setImmediate);
  const initialTimer = timers.shift();
  assert.equal(initialTimer.delay, 1500);
  clock += initialTimer.delay;
  initialTimer.resolve();
  await new Promise(setImmediate);
  assert.deepEqual(starts, [0], 'an old spacing timer cannot bypass the new quota cooldown');
  const cooldown = timers.shift();
  assert.equal(cooldown.delay, QUOTA_WAIT_MS - 1500);
  clock += cooldown.delay;
  cooldown.resolve();
  await new Promise(setImmediate);
  assert.equal(starts[1], QUOTA_WAIT_MS);
  const retrySpacing = timers.shift();
  clock += retrySpacing.delay;
  retrySpacing.resolve();
  await Promise.all([first, second]);
  assert.equal(starts.length, 3);
});

test('the pinned SDK routes Functions mutations and actual invoker policies through the paced fetch', async (t) => {
  const { createRequire } = require('node:module');
  const firebaseRequire = createRequire(require.resolve('firebase-tools/package.json'));
  const fetchModule = firebaseRequire('node-fetch');
  const original = fetchModule.default;
  const { Client } = firebaseRequire('./lib/apiv2.js');
  const { setInvokerCreate } = firebaseRequire('./lib/gcp/run.js');
  let clock = 0;
  const calls = [];
  fetchModule.default = createPacedFetch(async (url, options) => {
    calls.push({ url, method: options.method, at: clock });
    return new fetchModule.Response('{}', { status: 200 });
  }, { origins: [FUNCTIONS, RUN], now: () => clock, wait: async (delay) => { clock += delay; }, log: quiet });
  t.after(() => { fetchModule.default = original; });
  const functions = new Client({ urlPrefix: FUNCTIONS, auth: false });
  const run = new Client({ urlPrefix: RUN, auth: false });
  await Promise.all([
    functions.patch('/v2/projects/demo/locations/us-central1/functions/handler', {}),
    setInvokerCreate('demo', 'projects/demo/locations/us-central1/services/handler', ['public'], run),
  ]);
  assert.deepEqual(calls.map(({ method, at }) => ({ method, at })), [
    { method: 'PATCH', at: 0 }, { method: 'POST', at: 1500 },
  ]);
  assert.match(calls[1].url, /:setIamPolicy$/);
});
