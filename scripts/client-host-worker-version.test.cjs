'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { captureVersion, restoreVersion } = require('./client-host-worker-version.cjs');

const ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'token' };
const REVIEWED = 'b449499c-a8c9-4dbc-8b9e-59f23e4716ec';
const FAULT = '77a15df5-4039-47ec-b19f-028500121cdc';
const DEPLOYMENTS = 'https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/er1063-client-host/deployments';

// A fake Cloudflare account: deployments are listed newest first, and the version API is never consulted.
function fakeCloudflare({ readbacks = [], hostStatus = 200 } = {}) {
  const calls = [];
  const deployments = [{ id: 'dep-fault', versions: [{ version_id: FAULT, percentage: 100 }] }];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body && JSON.parse(init.body) });
    if (url === DEPLOYMENTS && init.method === 'POST') {
      assert.equal(init.headers.authorization, 'Bearer token');
      const created = { id: `dep-${deployments.length}`, versions: JSON.parse(init.body).versions };
      deployments.unshift(created);
      return Response.json({ success: true, errors: [], result: created });
    }
    if (url === DEPLOYMENTS) {
      return Response.json({ success: true, errors: [], result: { deployments: [readbacks.shift() || deployments[0]] } });
    }
    if (url.startsWith('https://er1063-rehearsal.eventrunner.org/')) return new Response(null, { status: hostStatus });
    return Response.json({ success: false, errors: [{ code: 100146, message: 'version not found' }] });
  };
  return { calls, fetchImpl };
}

test('capture records the single version serving the Worker', async () => {
  const { fetchImpl } = fakeCloudflare();
  assert.deepEqual(await captureVersion(fetchImpl, ENV, 'er1063-client-host'),
    { worker: 'er1063-client-host', versionId: FAULT, deploymentId: 'dep-fault' });
});

test('restore deploys the recorded version, reads it back and checks each mounted path', async () => {
  const { calls, fetchImpl } = fakeCloudflare();
  const result = await restoreVersion(fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    'er1063-rehearsal.eventrunner.org', ['/conference', '/events/workshop'], async () => {});
  assert.deepEqual(result, {
    worker: 'er1063-client-host', versionId: REVIEWED, deploymentId: 'dep-1',
    hosts: [
      { url: 'https://er1063-rehearsal.eventrunner.org/conference/', status: 200 },
      { url: 'https://er1063-rehearsal.eventrunner.org/events/workshop/', status: 200 },
    ],
  });
  assert.deepEqual(calls[0].body.versions, [{ version_id: REVIEWED, percentage: 100 }]);
  assert.equal(calls.some(({ url }) => url.includes('/versions/')), false);
});

test('restore refuses without a recorded version id and calls nothing', async () => {
  const { calls, fetchImpl } = fakeCloudflare();
  for (const versionId of [undefined, '', 'previous']) {
    await assert.rejects(restoreVersion(fetchImpl, ENV, 'er1063-client-host', versionId,
      'er1063-rehearsal.eventrunner.org', ['/conference'], async () => {}), /recorded by capture/);
  }
  assert.equal(calls.length, 0);
});

test('restore waits out a stale readback but fails when another version stays active', async () => {
  const stale = { id: 'dep-fault', versions: [{ version_id: FAULT, percentage: 100 }] };
  const late = fakeCloudflare({ readbacks: [stale, stale] });
  const sleeps = [];
  const result = await restoreVersion(late.fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    'er1063-rehearsal.eventrunner.org', ['/conference'], async (ms) => sleeps.push(ms));
  assert.equal(result.deploymentId, 'dep-1');
  assert.deepEqual(sleeps, [1000, 1000]);

  const other = { id: 'dep-other', versions: [{ version_id: FAULT, percentage: 100 }] };
  const stuck = fakeCloudflare({ readbacks: Array(5).fill(other) });
  await assert.rejects(restoreVersion(stuck.fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    'er1063-rehearsal.eventrunner.org', ['/conference'], async () => {}),
  /Readback: the active deployment is dep-other/);
  assert.equal(stuck.calls.some(({ url }) => url.startsWith('https://er1063-rehearsal')), false);
});

test('restore fails when a mounted path does not answer 200', async () => {
  const { fetchImpl } = fakeCloudflare({ hostStatus: 503 });
  await assert.rejects(restoreVersion(fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    'er1063-rehearsal.eventrunner.org', ['/conference'], async () => {}),
  /conference\/: expected HTTP 200, received 503/);
});
