'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { canRetryBuild, retryBuild } = require('./buildRetry.cjs');
const { getApplicationForReview } = require('./reviewQueue.cjs');
const { NOW, ana, application, deps, ops, seeded } = require('./fakeReview.cjs');

const FAILED_RECORD = {
  state: 'failed',
  runUrl: 'https://github.example/run/1',
  testMode: false,
  startedAt: new Date(NOW - 1000),
  updatedAt: new Date(NOW - 500),
  finishedAt: new Date(NOW - 500),
  failedStep: 'web-address',
  error: 'web-address: the certificate is not active',
  steps: [
    { id: 'project', label: 'Project', state: 'done', at: new Date(NOW - 900), detail: 'already right' },
    { id: 'web-address', label: 'Web address', state: 'failed', at: new Date(NOW - 500), detail: 'the certificate is not active' },
  ],
};

function setup({ app = {}, record = null, startBuild } = {}) {
  const db = seeded({
    'applications/a1': application({ status: 'approved', buildStart: { state: 'failed', at: new Date(NOW - 500) }, ...app }),
    ...(record ? { 'console_builds/a1': record } : {}),
  });
  const started = [];
  return {
    db,
    started,
    deps: { ...deps(db), startBuild: startBuild || (async (args) => { started.push(args); }) },
  };
}

test('a run that never reported can be retried after an hour, and not before', () => {
  const at = Date.parse('2026-11-04T12:00:00Z');
  const started = (ago) => ({ status: 'approved', buildStart: { state: 'started', at: new Date(at - ago) } });
  const hour = 60 * 60 * 1000;
  assert.equal(canRetryBuild(started(hour - 1), null, at), false);
  assert.equal(canRetryBuild(started(hour + 1), null, at), true);
  assert.equal(canRetryBuild(started(hour + 1), { state: 'queued' }, at), true);
  assert.equal(canRetryBuild(started(hour + 1), { state: 'running' }, at), false);
});

test('an operator can retry a build that did not start', async () => {
  const { db, deps: d, started } = setup();
  const result = await retryBuild(d, { body: { appId: 'a1' }, user: ops });
  assert.deepEqual(result.body, { started: true });
  assert.deepEqual(started, [{ orgId: 'o1', appId: 'a1' }]);
  assert.equal(db.read('applications/a1').buildStart.state, 'started');
  const audit = db.paths('console_audit').map((p) => db.read(p));
  assert.deepEqual(audit.map((a) => [a.action, a.by]), [['build-retried', 'ops']]);
});

test('an operator can retry a run that failed while building, and a second click does nothing', async () => {
  const { db, deps: d, started } = setup({
    app: { status: 'building', buildStart: { state: 'started', at: new Date(NOW - 1000) } },
    record: FAILED_RECORD,
  });
  await retryBuild(d, { body: { appId: 'a1' }, user: ops });
  assert.equal(started.length, 1);
  assert.equal(db.read('console_builds/a1').state, 'queued');
  await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: ops }), { status: 409, code: 'not-retryable' });
  assert.equal(started.length, 1);
});

test('a failed dispatch answers started false, and can be retried again', async () => {
  const { db, deps: d } = setup({ record: FAILED_RECORD, startBuild: async () => { throw new Error('down'); } });
  const result = await retryBuild(d, { body: { appId: 'a1' }, user: ops });
  assert.deepEqual(result.body, { started: false });
  assert.equal(db.read('applications/a1').buildStart.state, 'failed');
  assert.ok(db.paths('console_audit').map((p) => db.read(p).action).includes('build-start-failed'));
  await retryBuild(d, { body: { appId: 'a1' }, user: ops });
});

for (const [name, setting] of [
  ['a running build', { app: { buildStart: { state: 'started' } }, record: { ...FAILED_RECORD, state: 'running' } }],
  ['a build that was never started', { app: { buildStart: null } }],
  ['a site that is ready', { app: { status: 'ready' }, record: FAILED_RECORD }],
  ['a declined request', { app: { status: 'declined' } }],
]) {
  test(`${name} cannot be retried`, async () => {
    const { deps: d, started } = setup(setting);
    await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: ops }), { status: 409, code: 'not-retryable' });
    assert.equal(started.length, 0);
  });
}

test('a client cannot retry, and a missing request reads as missing', async () => {
  const { deps: d, started } = setup();
  await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: ana }), { status: 403, code: 'not-operator' });
  await assert.rejects(retryBuild(d, { body: { appId: 'gone' }, user: ops }), { status: 404 });
  assert.equal(started.length, 0);
});

test('the review page gets the record and whether it can be retried', async () => {
  const { deps: d } = setup({ app: { status: 'building' }, record: FAILED_RECORD });
  const { body } = await getApplicationForReview(d, { body: { appId: 'a1' }, user: ops });
  assert.equal(body.canRetryBuild, true);
  assert.equal(body.build.failedStep, 'web-address');
  assert.equal(body.build.steps[0].at, new Date(NOW - 900).toISOString());
  const none = setup({ app: { buildStart: null } });
  const empty = await getApplicationForReview(none.deps, { body: { appId: 'a1' }, user: ops });
  assert.equal(empty.body.canRetryBuild, false);
  assert.equal(empty.body.build, null);
});
