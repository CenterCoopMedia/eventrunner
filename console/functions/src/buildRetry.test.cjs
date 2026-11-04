'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { canRetryBuild, reportSilentBuilds, retryBuild } = require('./buildRetry.cjs');
const { buildForClient } = require('./buildState.cjs');
const { getApplicationForReview } = require('./reviewQueue.cjs');
const { NOW, ana, application, deps, ops, seeded } = require('./fakeReview.cjs');
const { fakeMailer } = require('./testData.cjs');

const ben = { uid: 'ben', email: 'ben@example.org' };
const zed = { uid: 'zed', email: 'zed@example.org' };

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

function setup({ app = {}, record = null, startBuild, extra = {} } = {}) {
  const db = seeded({
    'applications/a1': application({ status: 'approved', buildStart: { state: 'failed', at: new Date(NOW - 500) }, ...app }),
    ...(record ? { 'console_builds/a1': record } : {}),
    ...extra,
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

test('an Editor cannot retry, a stranger and a missing request read as missing', async () => {
  const { deps: d, started } = setup();
  await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: ben }), { status: 403 });
  await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: zed }), { status: 404 });
  await assert.rejects(retryBuild(d, { body: { appId: 'gone' }, user: ops }), { status: 404 });
  assert.equal(started.length, 0);
});

test('an Owner can retry a failed build, and the gate is the same as the operator\'s', async () => {
  const { db, deps: d, started } = setup({ app: { status: 'building' }, record: FAILED_RECORD });
  assert.deepEqual((await retryBuild(d, { body: { appId: 'a1' }, user: ana })).body, { started: true });
  assert.equal(started.length, 1);
  assert.equal(db.read('console_builds/a1').state, 'queued');
  assert.deepEqual(db.paths('console_audit').map((p) => db.read(p)).map((a) => [a.action, a.by]), [['build-retried', 'ana']]);

  await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: ana }), { status: 409, code: 'not-retryable' });
  assert.equal(started.length, 1, 'a second click starts nothing');
  assert.equal(db.read('console_rate_limits/retry-build-ana').count, 1, 'a refused retry uses no slot');

  for (const status of ['draft', 'ready', 'launched', 'declined']) {
    const other = setup({ app: { status }, record: FAILED_RECORD });
    await assert.rejects(retryBuild(other.deps, { body: { appId: 'a1' }, user: ana }), { status: 409, code: 'not-retryable' }, status);
    assert.equal(other.started.length, 0);
  }
});

test('an Owner has a daily limit on retries, and an operator does not', async () => {
  const limit = { 'console_rate_limits/retry-build-ana': { count: 5, windowStart: new Date(NOW - 1000) } };
  const owner = setup({ extra: limit });
  await assert.rejects(retryBuild(owner.deps, { body: { appId: 'a1' }, user: ana }), { status: 429, code: 'rate-limited' });
  assert.equal(owner.started.length, 0);
  const operator = setup({ extra: { 'console_rate_limits/retry-build-ops': limit['console_rate_limits/retry-build-ana'] } });
  assert.deepEqual((await retryBuild(operator.deps, { body: { appId: 'a1' }, user: ops })).body, { started: true });
});

test('a retry on a connection that can only fail again asks to reconnect first', async () => {
  const cases = [
    {},
    { stripe: { connected: true, displayName: 'NC Local', livemode: false } },
    { stripe: { connected: false, change: { id: 'c1', until: new Date(NOW + 60000) } } },
  ];
  for (const connections of cases) {
    const { db, deps: d, started } = setup({ app: { connections }, record: FAILED_RECORD });
    await assert.rejects(retryBuild(d, { body: { appId: 'a1' }, user: ana }), { status: 409, code: 'connection-needed', message: /(Connect|test mode|Choose).* Then retry the build\.$/ });
    assert.equal(started.length, 0);
    assert.equal(db.read('console_builds/a1').state, 'failed');
  }
});

test('a record stuck at running can be retried once no run can still be alive', async () => {
  const at = NOW;
  const hour = 60 * 60 * 1000;
  const app = { status: 'building', buildStart: { state: 'started', at: new Date(at - 7 * hour) } };
  const running = (ago) => ({ state: 'running', startedAt: new Date(at - ago) });
  assert.equal(canRetryBuild(app, running(5.5 * hour), at), false);
  assert.equal(canRetryBuild(app, running(6 * hour + 1), at), true);

  const { deps: d, started } = setup({ app: { status: 'building', buildStart: app.buildStart }, record: running(7 * hour) });
  assert.deepEqual((await retryBuild(d, { body: { appId: 'a1' }, user: ana })).body, { started: true });
  assert.equal(started.length, 1);
});

test('the watch job tells Owners and operators once about a run that went silent, and leaves the rest', async () => {
  const hour = 60 * 60 * 1000;
  const silent = { status: 'approved', buildStart: { state: 'started', at: new Date(NOW - 2 * hour) } };
  const { db, deps: d } = setup({
    app: silent,
    extra: {
      'applications/a2': application({ status: 'approved', buildStart: { state: 'started', at: new Date(NOW - 1000) } }),
      'applications/a3': application({ status: 'building', buildStart: { state: 'started', at: new Date(NOW - 7 * hour) } }),
      'console_builds/a3': { state: 'running', startedAt: new Date(NOW - 7 * hour) },
      'applications/a4': application({ status: 'building', buildStart: { state: 'failed', at: new Date(NOW - 7 * hour) } }),
      'applications/a5': application({ status: 'ready', buildStart: { state: 'started', at: new Date(NOW - 7 * hour) } }),
    },
  });
  d.mailer = fakeMailer();
  const first = await reportSilentBuilds(d);
  assert.deepEqual(first, { flagged: ['a1', 'a3'], failed: [] });
  assert.equal(db.read('applications/a1').buildStart.state, 'failed');
  assert.equal(db.read('applications/a2').buildStart.state, 'started');
  // Two Owners on each of the two requests, and two operators on each.
  assert.equal(d.mailer.sent.filter((m) => m.status === 'build-failed').length, 4);
  assert.equal(d.mailer.sent.filter((m) => m.problem?.includes('without reporting')).length, 4);
  const sent = d.mailer.sent.length;
  assert.ok(db.paths('console_audit/').some((p) => db.read(p).action === 'build-went-silent'));

  assert.deepEqual(await reportSilentBuilds(d), { flagged: [], failed: [] });
  assert.equal(d.mailer.sent.length, sent);
});

test('an acceptance whose function died can be retried after an hour', () => {
  const at = Date.parse('2026-11-04T12:00:00Z');
  const pending = (ago) => ({ status: 'approved', buildStart: { state: 'pending', at: new Date(at - ago) } });
  const hour = 60 * 60 * 1000;
  assert.equal(canRetryBuild(pending(hour - 1), null, at), false);
  assert.equal(canRetryBuild(pending(hour + 1), null, at), true);
});

test('a client hears only that the build failed and whether the ticket account is why', () => {
  const failed = { status: 'building', buildStart: { state: 'started', at: new Date(NOW) } };
  assert.deepEqual(buildForClient(failed, { state: 'failed', failedStep: 'tickets', error: 'x' }, NOW), { failed: true, needsReconnect: true });
  assert.deepEqual(buildForClient(failed, { state: 'failed', failedStep: 'domain' }, NOW), { failed: true, needsReconnect: false });
  assert.deepEqual(buildForClient(failed, { state: 'running', failedStep: 'tickets' }, NOW), { failed: false, needsReconnect: false });
  assert.deepEqual(buildForClient({ status: 'approved', buildStart: { state: 'failed', at: new Date(NOW) } }, null, NOW), { failed: true, needsReconnect: false });
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
