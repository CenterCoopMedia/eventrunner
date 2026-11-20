'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { captureVersion, restoreVersion } = require('./client-host-worker-version.cjs');

const ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'token' };
const REVIEWED = 'b449499c-a8c9-4dbc-8b9e-59f23e4716ec';
const FAULT = '77a15df5-4039-47ec-b19f-028500121cdc';
const HOST = 'https://er1063-rehearsal.eventrunner.org';
const DEPLOYMENTS = 'https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/er1063-client-host/deployments';

// A fake Cloudflare account: deployments are listed newest first, and the version API is never consulted.
function fakeCloudflare({ readbacks = [], hostStatuses = [] } = {}) {
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
    if (url.startsWith('https://er1063-rehearsal.eventrunner.org/')) {
      return new Response(null, { status: hostStatuses.shift() || 200 });
    }
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
    [`${HOST}/conference/`, `${HOST}/events/workshop`], async () => {});
  assert.deepEqual(result, {
    worker: 'er1063-client-host', versionId: REVIEWED, deploymentId: 'dep-1',
    mounts: [
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
      [`${HOST}/conference/`], async () => {}), /recorded by capture/);
  }
  assert.equal(calls.length, 0);
});

test('restore waits out a stale readback but fails when another version stays active', async () => {
  const stale = { id: 'dep-fault', versions: [{ version_id: FAULT, percentage: 100 }] };
  const late = fakeCloudflare({ readbacks: [stale, stale] });
  const sleeps = [];
  const result = await restoreVersion(late.fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    [`${HOST}/conference/`], async (ms) => sleeps.push(ms));
  assert.equal(result.deploymentId, 'dep-1');
  assert.deepEqual(sleeps, [1000, 1000]);

  const other = { id: 'dep-other', versions: [{ version_id: FAULT, percentage: 100 }] };
  const stuck = fakeCloudflare({ readbacks: Array(5).fill(other) });
  await assert.rejects(restoreVersion(stuck.fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    [`${HOST}/conference/`], async () => {}),
  /Readback: the active deployment is dep-other/);
  assert.equal(stuck.calls.some(({ url }) => url.startsWith('https://er1063-rehearsal')), false);
});

test('restore waits for a mounted path to answer 200 and fails when it never does', async () => {
  const late = fakeCloudflare({ hostStatuses: [503, 503] });
  const sleeps = [];
  const result = await restoreVersion(late.fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    [`${HOST}/conference/`], async (ms) => sleeps.push(ms));
  assert.deepEqual(result.mounts, [{ url: `${HOST}/conference/`, status: 200 }]);
  assert.deepEqual(sleeps, [1000, 1000]);

  const down = fakeCloudflare({ hostStatuses: Array(5).fill(503) });
  await assert.rejects(restoreVersion(down.fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    [`${HOST}/conference/`], async () => {}), /conference\/: expected HTTP 200, last received 503/);
});

test('restore accepts every enrollable mount and refuses a host root before calling Cloudflare', async () => {
  const { calls, fetchImpl } = fakeCloudflare();
  const result = await restoreVersion(fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    [`${HOST}/-conference`], async () => {});
  assert.equal(result.mounts[0].url, `${HOST}/-conference/`);
  const before = calls.length;
  await assert.rejects(restoreVersion(fetchImpl, ENV, 'er1063-client-host', REVIEWED,
    [`${HOST}/`], async () => {}), /mounted public base/);
  assert.equal(calls.length, before);
});
