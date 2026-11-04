'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSecretStore } = require('./secretStore.cjs');

const json = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const BASE = 'https://secretmanager.googleapis.com/v1/projects/p1/secrets';

function store(...answers) {
  const fetch = async (url, init = {}) => {
    fetch.calls.push({ url, ...init });
    return answers.shift();
  };
  fetch.calls = [];
  const logged = [];
  const secrets = createSecretStore({
    projectId: 'p1',
    getAccessToken: async () => ({ access_token: 'google-token' }),
    fetch,
    log: { error: (...args) => logged.push(args) },
  });
  return { secrets, fetch, logged };
}

test('writing creates the secret, adds a version and destroys older ones', async () => {
  const { secrets, fetch } = store(
    json(200),
    json(200, { name: 'projects/1/secrets/s1/versions/2' }),
    json(200, { versions: [{ name: 'projects/1/secrets/s1/versions/2' }, { name: 'projects/1/secrets/s1/versions/1' }] }),
    json(200),
  );
  await secrets.writeSecret('s1', 'the value');
  const [create, add, list, destroy] = fetch.calls;
  assert.equal(create.url, `${BASE}?secretId=s1`);
  assert.deepEqual(JSON.parse(create.body), { replication: { automatic: {} } });
  assert.equal(create.headers.Authorization, 'Bearer google-token');
  assert.equal(add.url, `${BASE}/s1:addVersion`);
  assert.equal(Buffer.from(JSON.parse(add.body).payload.data, 'base64').toString(), 'the value');
  assert.match(list.url, /\/s1\/versions\?filter=state%3AENABLED$/);
  assert.equal(destroy.url, 'https://secretmanager.googleapis.com/v1/projects/1/secrets/s1/versions/1:destroy');
  assert.equal(fetch.calls.length, 4);
});

test('writing to a secret that already exists adds a version', async () => {
  const { secrets, fetch } = store(json(409), json(200, { name: 'v2' }), json(200, { versions: [{ name: 'v2' }] }));
  await secrets.writeSecret('s1', 'x');
  assert.equal(fetch.calls.length, 3);
});

test('a failed clean-up of older versions does not fail the write, and is logged', async () => {
  const { secrets, logged } = store(json(200), json(200, { name: 'v2' }), json(500));
  await secrets.writeSecret('s1', 'the value');
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(logged).includes('the value'));
});

test('a failed write throws an error with the status and not the value', async () => {
  const { secrets } = store(json(200), json(403, { error: { message: 'denied the value' } }));
  await assert.rejects(secrets.writeSecret('s1', 'the value'), (err) => {
    assert.equal(err.message, 'secret add: HTTP 403');
    return true;
  });
});

test('reading returns the value, or null when it is gone', async () => {
  const { secrets, fetch } = store(json(200, { payload: { data: Buffer.from('the value').toString('base64') } }), json(404));
  assert.equal(await secrets.readSecret('s1'), 'the value');
  assert.equal(fetch.calls[0].url, `${BASE}/s1/versions/latest:access`);
  assert.equal(await secrets.readSecret('s2'), null);
});

test('deleting is safe to repeat, and a real failure throws', async () => {
  const { secrets, fetch } = store(json(200), json(404), json(500));
  await secrets.deleteSecret('s1');
  assert.equal(fetch.calls[0].method, 'DELETE');
  assert.equal(fetch.calls[0].url, `${BASE}/s1`);
  await secrets.deleteSecret('s1');
  await assert.rejects(secrets.deleteSecret('s1'), { message: 'secret delete: HTTP 500' });
});

test('with no project it refuses rather than calling out', async () => {
  const fetch = async () => assert.fail('no call');
  const secrets = createSecretStore({ projectId: '', getAccessToken: async () => ({ access_token: 't' }), fetch });
  await assert.rejects(secrets.readSecret('s1'), { message: 'secret read: no project' });
});
