'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerify, generateKeyPairSync } = require('node:crypto');
const { createStartBuild, installationToken } = require('./buildDispatch.cjs');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const ENV = {
  CONSOLE_GITHUB_APP_ID: '111',
  CONSOLE_GITHUB_INSTALLATION_ID: '222',
  CONSOLE_GITHUB_REPOSITORY: 'owner/repo',
};
const NOW = 1_800_000_000_000;

function fakeGithub({ tokenStatus = 201, dispatchStatus = 204 } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.includes('/access_tokens')) {
      return { ok: tokenStatus < 300, status: tokenStatus, json: async () => ({ token: 'ghs_token_value', detail: 'secret-body' }) };
    }
    return { ok: dispatchStatus < 300, status: dispatchStatus, json: async () => ({}) };
  };
  return { fetch, calls };
}

test('it asks for actions write on one repository, then dispatches the workflow on main', async () => {
  const { fetch, calls } = fakeGithub();
  await createStartBuild({ env: ENV, privateKey, fetch, now: () => NOW })({ orgId: 'o1', appId: 'app_1' });

  assert.equal(calls[0].url, 'https://api.github.com/app/installations/222/access_tokens');
  assert.deepEqual(calls[0].body, { repositories: ['repo'], permissions: { actions: 'write' } });

  const [header, claims, signature] = calls[0].headers.Authorization.replace('Bearer ', '').split('.');
  const verified = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url');
  assert.equal(verified, true);
  const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(parsed.iss, '111');
  assert.ok(parsed.exp - parsed.iat <= 600);

  assert.equal(calls[1].url, 'https://api.github.com/repos/owner/repo/actions/workflows/provision-client.yml/dispatches');
  assert.equal(calls[1].headers.Authorization, 'Bearer ghs_token_value');
  assert.deepEqual(calls[1].body, { ref: 'main', inputs: { application_id: 'app_1' } });
});

test('a rehearsal console asks for a test-mode build, and no other console does', async () => {
  const { fetch, calls } = fakeGithub();
  await createStartBuild({ env: { ...ENV, CONSOLE_TEST_MODE: 'true' }, privateKey, fetch, now: () => NOW })({ appId: 'app_1' });
  assert.deepEqual(calls[1].body.inputs, { application_id: 'app_1', test_mode: 'true' });
});

for (const [name, env, key] of [
  ['no app id', { ...ENV, CONSOLE_GITHUB_APP_ID: '' }, privateKey],
  ['no installation id', { ...ENV, CONSOLE_GITHUB_INSTALLATION_ID: ' ' }, privateKey],
  ['no repository', { ...ENV, CONSOLE_GITHUB_REPOSITORY: undefined }, privateKey],
  ['a malformed repository', { ...ENV, CONSOLE_GITHUB_REPOSITORY: 'repo' }, privateKey],
  ['no key', ENV, ''],
]) {
  test(`it refuses to dispatch with ${name}`, async () => {
    const { fetch, calls } = fakeGithub();
    await assert.rejects(createStartBuild({ env, privateKey: key, fetch })({ appId: 'a' }), /not set up/);
    assert.equal(calls.length, 0);
  });
}

test('a placeholder key is refused before any request, and the error does not repeat it', async () => {
  const { fetch, calls } = fakeGithub();
  await assert.rejects(
    createStartBuild({ env: ENV, privateKey: 'placeholder-value', fetch })({ appId: 'a' }),
    (err) => err.message === 'github app: the private key is not usable',
  );
  assert.equal(calls.length, 0);
});

test('a refused dispatch throws with the status and no token or body', async () => {
  const { fetch } = fakeGithub({ dispatchStatus: 404 });
  await assert.rejects(
    createStartBuild({ env: ENV, privateKey, fetch })({ appId: 'a' }),
    (err) => err.message === 'github dispatch: HTTP 404',
  );
});

test('a refused token throws with the status and no body', async () => {
  const { fetch } = fakeGithub({ tokenStatus: 401 });
  await assert.rejects(
    installationToken({
      appId: '1', installationId: '2', privateKey, repository: 'owner/repo', permissions: { actions: 'write' }, fetch,
    }),
    (err) => err.message === 'github installation token: HTTP 401',
  );
});
