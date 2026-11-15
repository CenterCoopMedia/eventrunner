'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { createDeploymentRuns } = require('./deploymentRuns.cjs');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
let sequence = 0;
function setup(route) {
  const calls = [];
  const env = { CONSOLE_GITHUB_REPOSITORY: `owner/repo${++sequence}`, CONSOLE_GITHUB_APP_ID: '1', CONSOLE_GITHUB_INSTALLATION_ID: '2' };
  const client = createDeploymentRuns({ env, privateKey, wait: async () => {}, fetch: async (url, options) => {
    const path = url.replace('https://api.github.com', '');
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path.includes('/access_tokens')) return new Response(JSON.stringify({ token: 'synthetic-installation-token' }));
    const result = await route(path, body);
    return new Response(result === null ? null : JSON.stringify(result), { status: result === null ? 204 : 200 });
  } });
  return { client, calls };
}

test('history maps manual, provisioned and automatic deploys to their actual clients and caches the shared page', async () => {
  const { client, calls } = setup((path) => {
    if (path.includes('/jobs?')) return { jobs: [{ name: 'Deploy (nclocal) / Build and host' }, { name: 'Deploy (second) / Smoke test' }] };
    return { total_count: 21, workflow_runs: [
      { id: 1, event: 'workflow_dispatch', display_title: 'Deploy nclocal [build 42]', status: 'completed', conclusion: 'success' },
      { id: 2, event: 'push', head_branch: 'main', run_attempt: 1, status: 'completed', conclusion: 'failure' },
    ] };
  });
  const first = await client.list();
  assert.deepEqual(first.runs.map((r) => r.clients), [['nclocal'], ['nclocal', 'second']]);
  assert.equal(first.nextPage, 2);
  const count = calls.length;
  assert.deepEqual(await client.list(), first);
  assert.equal(calls.length, count);
});

test('stopping waits for a completed parent and cancels only child runs bearing that parent id across pages', async () => {
  const cancelled = new Set();
  const { client, calls } = setup((path) => {
    const cancel = /\/runs\/(\d+)\/cancel$/.exec(path);
    if (cancel) { cancelled.add(cancel[1]); return null; }
    const get = /\/runs\/(\d+)$/.exec(path);
    if (get) return { status: cancelled.has(get[1]) ? 'completed' : 'in_progress' };
    if (path.includes('page=2')) return { workflow_runs: [{ id: 3, status: 'queued', display_title: 'Deploy nclocal [build 42]' }] };
    return { workflow_runs: [
      { id: 1, status: 'in_progress', display_title: 'Deploy nclocal (bootstrap) [build 42]' },
      { id: 2, status: 'in_progress', display_title: 'Deploy nclocal [build 43]' },
      ...Array.from({ length: 98 }, (_, i) => ({ id: 100 + i, status: 'completed', display_title: 'Deploy nclocal [build 42]' })),
    ] };
  });
  await client.stop('42');
  await client.stopChildren({ environment: 'nclocal', parentId: '42', after: '2026-11-15T15:00:00Z' });
  assert.deepEqual([...cancelled], ['42', '1', '3']);
  assert.ok(calls.some((call) => call.path.includes('page=2')));
});

test('a cancellation that never finishes fails honestly after bounded reads', async () => {
  const { client, calls } = setup((path) => path.endsWith('/cancel') ? null : { status: 'in_progress' });
  await assert.rejects(client.stop('42'), { status: 409, code: 'run-stopping', message: /still stopping/ });
  assert.equal(calls.filter((call) => /\/runs\/42$/.test(call.path)).length, 13);
});

test('redeploy dispatches only the named environment from main', async () => {
  const { client, calls } = setup(() => null);
  await client.redeploy('nclocal');
  assert.deepEqual(calls.at(-1).body, { ref: 'main', inputs: { client: 'nclocal' } });
});
