'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listDeployments, deploymentHistory, redeploySite, stopBuild } = require('./deployments.cjs');
const { NOW, ops, ana, seededDb, applicationDoc } = require('./testData.cjs');

function setup(status = 'building') {
  const calls = [];
  const db = seededDb({
    'applications/a1': applicationDoc({ status }),
    'console_builds/a1': { state: 'running', runUrl: 'https://github.com/owner/repo/actions/runs/42', startedAt: new Date(NOW),
      resources: { environment: 'nclocal' }, steps: [{ label: 'First deploy', state: 'running' }] },
  });
  const deployments = { repository: 'owner/repo',
    list: async (page = 1) => { calls.push(['list', page]); return { runs: [{ id: '9', status: 'completed', conclusion: 'success', clients: ['nclocal'] }], nextPage: 2 }; },
    get: async () => ({ path: '.github/workflows/provision-client.yml', display_title: 'Provision a1', head_branch: 'main', created_at: new Date(NOW).toISOString() }),
    stop: async (id) => { calls.push(['stop', id]); },
    stopChildren: async (options) => { calls.push(['children', options]); },
    redeploy: async (environment) => { calls.push(['redeploy', environment]); },
  };
  return { db, deployments, now: () => NOW, calls };
}

test('lists build progress and post-launch deploy results using one shared run read', async () => {
  const d = setup('launched');
  const result = await listDeployments(d, { user: ops });
  assert.equal(result.body.sites.length, 1);
  const site = result.body.sites[0];
  assert.equal(site.build.steps[0].label, 'First deploy');
  assert.equal(site.runs[0].conclusion, 'success');
  assert.equal(site.canRetry, false);
  assert.deepEqual(d.calls, [['list', 1]]);
  const history = await deploymentHistory(d, { user: ops, body: { appId: 'a1', page: 2 } });
  assert.equal(history.body.nextPage, 2);
  assert.deepEqual(d.calls.at(-1), ['list', 2]);
});

test('every deployment action uses the existing live operator gate before GitHub', async () => {
  for (const action of [listDeployments, deploymentHistory, redeploySite, stopBuild]) {
    const d = setup();
    await assert.rejects(action(d, { user: ana, body: { appId: 'a1', confirm: true, runId: '42' } }), { status: 403 });
    assert.deepEqual(d.calls, []);
  }
});

test('a finished live site with an active redeploy does not offer Stop the build', async () => {
  const d = setup('launched');
  await d.db.doc('console_builds/a1').update({ state: 'done' });
  d.deployments.list = async () => ({ runs: [{ id: '9', status: 'in_progress', clients: ['nclocal'] }], nextPage: null });
  const result = await listDeployments(d, { user: ops });
  assert.equal(result.body.sites[0].canStop, false);
  assert.equal(result.body.sites[0].canRedeploy, false);
});

test('stop requires confirmation and the exact recorded parent, then stops parent before children', async () => {
  const d = setup();
  for (const body of [{}, { confirm: true, runId: '43' }, { runId: '42' }]) {
    await assert.rejects(stopBuild(d, { user: ops, body: { appId: 'a1', ...body } }), { status: 409 });
  }
  assert.deepEqual(d.calls, []);
  assert.deepEqual((await stopBuild(d, { user: ops, body: { appId: 'a1', confirm: true, runId: '42' } })).body, { stopped: true });
  assert.deepEqual(d.calls, [['stop', '42'], ['children', { environment: 'nclocal', parentId: '42', after: new Date(NOW).toISOString() }]]);
  assert.equal(d.db.paths('console_audit/').length, 1);
});

test('an unrelated workflow or incomplete cancellation never reports success or cancels children', async () => {
  const d = setup();
  d.deployments.get = async () => ({ path: '.github/workflows/deploy.yml', display_title: 'Provision a1', head_branch: 'main' });
  await assert.rejects(stopBuild(d, { user: ops, body: { appId: 'a1', confirm: true, runId: '42' } }), { status: 409 });
  assert.deepEqual(d.calls, []);
  d.deployments.get = async () => ({ path: '.github/workflows/provision-client.yml', display_title: 'Provision a1', head_branch: 'main' });
  d.deployments.stop = async () => { throw new Error('still stopping'); };
  await assert.rejects(stopBuild(d, { user: ops, body: { appId: 'a1', confirm: true, runId: '42' } }), /still stopping/);
  assert.deepEqual(d.calls, []);
  assert.equal(d.db.paths('console_audit/').length, 0);
});

test('redeploy targets the recorded environment of a built site, suppresses duplicate dispatch and refuses stale controls', async () => {
  const d = setup('launched');
  const body = { appId: 'a1', environment: 'nclocal', confirm: true };
  await assert.rejects(redeploySite(d, { user: ops, body: { ...body, environment: 'other' } }), { status: 409 });
  await assert.rejects(redeploySite(d, { user: ops, body: { ...body, confirm: false } }), { status: 409 });
  await redeploySite(d, { user: ops, body });
  assert.deepEqual(d.calls, [['redeploy', 'nclocal']]);
  await assert.rejects(redeploySite(d, { user: ops, body }), { status: 409 });
  const other = setup('archived');
  await assert.rejects(redeploySite(other, { user: ops, body }), { status: 409 });
  assert.deepEqual(other.calls, []);
});
