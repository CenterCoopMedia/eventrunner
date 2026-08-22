'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  requestSitePublish,
  resolvePublisherConfig,
  invokeSitePublisher,
  fetchAccessToken,
  jobResourceName,
} = require('./publisher.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

const NOW = 1_750_000_000_000;
const now = () => NOW;
const quiet = { warn() {}, error() {} };

const CONFIGURED = {
  EVENT_SITE_PUBLISHER_JOB: 'site-publisher',
  EVENT_FIREBASE_PROJECT_ID: 'demo-project',
  EVENT_FIREBASE_REGION: 'us-east4',
};

/**
 * A fetch double covering both hops (metadata token, then the Cloud Run
 * :run POST). `runResponse` is applied to the second call.
 */
function fakeFetch({ token = 'ya29.fake', runStatus = 200, runBody = {}, throwOn = null } = {}) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    if (throwOn && url.includes(throwOn)) throw new Error('network unreachable');
    if (url.startsWith('http://metadata.google.internal')) {
      return {
        ok: true,
        status: 200,
        async json() { return { access_token: token, expires_in: 3599 }; },
      };
    }
    return {
      ok: runStatus >= 200 && runStatus <= 299,
      status: runStatus,
      async json() { return runBody; },
      async text() { return JSON.stringify(runBody); },
    };
  };
  impl.calls = calls;
  return impl;
}

// --- configuration gate (§8.4 presence-of-config) ------------------------------

test('an unset job name means no publisher, with a reason', () => {
  assert.deepEqual(resolvePublisherConfig({}), {
    configured: false, reason: 'no-job-configured',
  });
  assert.equal(resolvePublisherConfig({ EVENT_SITE_PUBLISHER_JOB: '   ' }).configured, false);
});

test('a job name without a project id reads as a deployment bug, not as "no publisher"', () => {
  assert.deepEqual(resolvePublisherConfig({ EVENT_SITE_PUBLISHER_JOB: 'site-publisher' }), {
    configured: false, reason: 'no-project-id',
  });
});

test('the region defaults to us-central1, matching every other function', () => {
  const config = resolvePublisherConfig({
    EVENT_SITE_PUBLISHER_JOB: 'site-publisher',
    EVENT_FIREBASE_PROJECT_ID: 'demo-project',
  });
  assert.equal(config.region, 'us-central1');
  assert.equal(
    jobResourceName(config),
    'projects/demo-project/locations/us-central1/jobs/site-publisher',
  );
});

test('an unconfigured deployment skips cleanly and writes nothing', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'done' } });
  const result = await requestSitePublish({ db, queueId: 'q1', env: {}, now, log: quiet });
  assert.deepEqual(result, { status: 'skipped', reason: 'no-job-configured' });
  assert.deepEqual(db.writes, []);
});

test('a publish with no queue row (nothing dirty) skips', async () => {
  const db = makeFakeDb();
  const result = await requestSitePublish({
    db, queueId: null, env: CONFIGURED, now, log: quiet,
  });
  assert.deepEqual(result, { status: 'skipped', reason: 'no-queue-row' });
  assert.deepEqual(db.writes, []);
});

// --- the invoke ---------------------------------------------------------------

test('the invoke targets this project\'s job and passes the queue id as an override', async () => {
  const fetchImpl = fakeFetch({ runBody: { metadata: { name: 'projects/p/…/executions/e1' } } });
  const result = await invokeSitePublisher({
    config: { projectId: 'demo-project', region: 'us-east4', job: 'site-publisher' },
    queueId: 'q1',
    fetchImpl,
  });
  assert.equal(result.executionName, 'projects/p/…/executions/e1');

  const [tokenCall, runCall] = fetchImpl.calls;
  assert.equal(tokenCall.options.headers['Metadata-Flavor'], 'Google');
  assert.equal(
    runCall.url,
    'https://run.googleapis.com/v2/projects/demo-project/locations/us-east4/jobs/site-publisher:run',
  );
  assert.equal(runCall.options.method, 'POST');
  assert.equal(runCall.options.headers.Authorization, 'Bearer ya29.fake');
  assert.deepEqual(JSON.parse(runCall.options.body), {
    overrides: { containerOverrides: [{ env: [{ name: 'PUBLISH_QUEUE_ID', value: 'q1' }] }] },
  });
});

test('a non-2xx from Cloud Run throws with the status, so 403 and 404 stay distinguishable', async () => {
  for (const status of [403, 404, 500]) {
    await assert.rejects(
      invokeSitePublisher({
        config: { projectId: 'p', region: 'r', job: 'j' },
        queueId: 'q1',
        fetchImpl: fakeFetch({ runStatus: status, runBody: { error: { message: 'nope' } } }),
      }),
      new RegExp(`Cloud Run responded ${status}`),
    );
  }
});

test('a metadata server that will not mint a token throws before the POST', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    fetchAccessToken({ fetchImpl }),
    /metadata server responded 500/,
  );
  const noToken = async () => ({ ok: true, status: 200, async json() { return {}; } });
  await assert.rejects(fetchAccessToken({ fetchImpl: noToken }), /no access_token/);
});

// --- status row lifecycle -----------------------------------------------------

test('a successful invoke records itself on the queue row without touching publish status', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'done', progress: { cmsContent: {} } } });
  const result = await requestSitePublish({
    db,
    queueId: 'q1',
    env: CONFIGURED,
    fetchImpl: fakeFetch({ runBody: { metadata: { name: 'exec-1' } } }),
    now,
    log: quiet,
  });
  assert.equal(result.status, 'invoked');

  const row = await db.collection('cmsPublishQueue').doc('q1').get();
  assert.equal(row.data().status, 'done');
  assert.deepEqual(row.data().publisher.invoke, {
    status: 'invoked', at: new Date(NOW), executionName: 'exec-1',
  });
  // publisher.status is the JOB's field; the function must not pre-empt it.
  assert.equal(row.data().publisher.status, undefined);
});

test('an invoke failure is fail-soft: recorded, alerted, and reported back as failed', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'done' } });
  const events = [];
  const result = await requestSitePublish({
    db,
    queueId: 'q1',
    env: CONFIGURED,
    fetchImpl: fakeFetch({ runStatus: 403 }),
    notifyOperator: async (event) => { events.push(event); },
    now,
    log: quiet,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Cloud Run responded 403/);

  const row = await db.collection('cmsPublishQueue').doc('q1').get();
  assert.equal(row.data().status, 'done', 'the publish itself stays done');
  assert.equal(row.data().publisher.invoke.status, 'failed');
  assert.match(row.data().publisher.invoke.error, /403/);

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'error');
  assert.equal(events[0].fields.job, 'projects/demo-project/locations/us-east4/jobs/site-publisher');
  // Deduped per job: a broken grant fails every publish.
  assert.equal(events[0].dedupeKey, 'site-publisher-invoke-failed:site-publisher');
});

test('a network error reaching Cloud Run is a failure, never a throw', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'done' } });
  const result = await requestSitePublish({
    db,
    queueId: 'q1',
    env: CONFIGURED,
    fetchImpl: fakeFetch({ throwOn: 'run.googleapis.com' }),
    now,
    log: quiet,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /network unreachable/);
});

test('a notifier that throws still leaves the hook fail-soft', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'done' } });
  const result = await requestSitePublish({
    db,
    queueId: 'q1',
    env: CONFIGURED,
    fetchImpl: fakeFetch({ runStatus: 500 }),
    notifyOperator: async () => { throw new Error('sink exploded'); },
    now,
    log: { warn() {}, error() {} },
  });
  assert.equal(result.status, 'failed');
});

test('a queue row that cannot be written still returns, rather than throwing into the publish', async () => {
  const db = makeFakeDb();
  db.collection('cmsPublishQueue').doc = () => ({
    async set() { throw new Error('firestore unavailable'); },
  });
  const result = await requestSitePublish({
    db,
    queueId: 'q1',
    env: CONFIGURED,
    fetchImpl: fakeFetch({ runStatus: 503 }),
    now,
    log: quiet,
  });
  assert.equal(result.status, 'failed');
});

test('the invoke is bounded — the caller-supplied timeout aborts a hung endpoint', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'done' } });
  // AbortSignal.timeout's own timer is unref'd, so the fake holds the event
  // loop open on the request's behalf, exactly as a real socket would.
  const hang = (url, options = {}) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(resolve, 5_000);
    options.signal?.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(options.signal.reason);
    });
  });
  const result = await requestSitePublish({
    db, queueId: 'q1', env: CONFIGURED, fetchImpl: hang, timeoutMs: 20, now, log: quiet,
  });
  assert.equal(result.status, 'failed');
});
