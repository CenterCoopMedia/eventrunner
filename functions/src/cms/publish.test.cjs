'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCmsPublishHandler,
  createGetPublishQueueHandler,
  createUpdatePublishStatusHandler,
} = require('./publish.cjs');
const { makeFakeDb } = require('./firestoreFake.cjs');

const NOW = 1_750_000_000_000;
const now = () => NOW;
const ADMIN = { uid: 'admin1', email: 'admin@example.org', email_verified: true };
const USER = { uid: 'user1', email: 'user@example.org', email_verified: true };

function fakeAuth() {
  return {
    async verifyIdToken(t) {
      if (t === 'admin-token') return ADMIN;
      if (t === 'user-token') return USER;
      throw new Error('auth/argument-error');
    },
  };
}

const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.org'] } });

function req({ method = 'POST', token = 'admin-token', body = {} } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

function deps(db) {
  return { db, auth: fakeAuth(), getConfig, now, log: { warn() {}, error() {} } };
}

// --- gates --------------------------------------------------------------------

test('publish endpoints: 401 no token, 403 non-admin, 405 non-POST', async () => {
  const db = makeFakeDb();
  for (const create of [
    createCmsPublishHandler,
    createGetPublishQueueHandler,
    createUpdatePublishStatusHandler,
  ]) {
    const handler = create(deps(db));
    let res = fakeRes();
    await handler(req({ token: null }), res);
    assert.equal(res.statusCode, 401);

    res = fakeRes();
    await handler(req({ token: 'user-token' }), res);
    assert.equal(res.statusCode, 403);

    res = fakeRes();
    await handler(req({ method: 'PUT' }), res);
    assert.equal(res.statusCode, 405);
  }
  assert.equal(db.writes.length, 0);
});

// --- cmsPublish -----------------------------------------------------------------

test('cmsPublish { collection, docIds } publishes, marks the queue row done, and logs', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/hero__title': { value: 'v1', visible: true, status: 'dirty', basedOnRevision: null },
  });
  const res = fakeRes();
  await createCmsPublishHandler(deps(db))(
    req({ body: { collection: 'cmsContent', docIds: ['hero__title'] } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'done');
  assert.deepEqual(res.body.results.cmsContent.published, ['hero__title']);

  const row = db.read('cmsPublishQueue', res.body.queueId);
  assert.equal(row.status, 'done');
  assert.equal(row.requestedBy, ADMIN.email);
  assert.deepEqual(row.request, { cmsContent: ['hero__title'] });
  assert.deepEqual(row.progress.cmsContent.published, ['hero__title']);
  assert.equal(row.finishedAt instanceof Date, true);

  assert.equal(db.read('cmsContent', 'hero__title').revision, 1);
  assert.equal(db.read('cmsContent_drafts', 'hero__title').status, 'clean');
  assert.equal(db.ids('admin_logs').length, 1);
});

test('cmsPublish { all: true } publishes every dirty draft across collections, skipping clean ones', async () => {
  const db = makeFakeDb({
    'cmsContent_drafts/a': { value: '1', visible: true, status: 'dirty' },
    'cmsContent_drafts/b': { value: '2', visible: true, status: 'clean', basedOnRevision: 1 },
    'cmsPages_drafts/home': { label: 'Home', visible: true, status: 'dirty' },
  });
  const res = fakeRes();
  await createCmsPublishHandler(deps(db))(req({ body: { all: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.results.cmsContent.published, ['a']);
  assert.deepEqual(res.body.results.cmsPages.published, ['home']);
  assert.equal(db.read('cmsContent', 'a').revision, 1);
  assert.equal(db.read('cmsContent', 'b'), undefined); // clean draft not published
  assert.equal(db.read('cmsPages', 'home').revision, 1);
});

test('cmsPublish { all: true } with nothing dirty is a no-op: no queue row', async () => {
  const db = makeFakeDb({ 'cmsContent_drafts/a': { value: '1', visible: true, status: 'clean' } });
  const res = fakeRes();
  await createCmsPublishHandler(deps(db))(req({ body: { all: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { queueId: null, status: 'done', results: {} });
  assert.equal(db.ids('cmsPublishQueue').length, 0);
});

test('cmsPublish → 400 on unknown collection or bad docIds', async () => {
  const db = makeFakeDb();
  const handler = createCmsPublishHandler(deps(db));
  for (const body of [
    {},
    { collection: 'admin_logs', docIds: ['x'] },
    { collection: 'cmsContent', docIds: [] },
    { collection: 'cmsContent', docIds: ['ok', 42] },
    { collection: 'cmsContent', docIds: ['a/b'] },
  ]) {
    const res = fakeRes();
    await handler(req({ body }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(db.writes.length, 0);
});

test('cmsPublish failure mid-way → 500 with queueId, row failed; resume with { queueId } completes', async () => {
  // 134 dirty drafts → two chunks; the second batch commit fails.
  const seed = {};
  const ids = [];
  for (let i = 0; i < 134; i += 1) {
    const id = `s-${String(i).padStart(3, '0')}`;
    ids.push(id);
    seed[`cmsSchedule_drafts/${id}`] = { title: `S${i}`, visible: true, status: 'dirty' };
  }
  const db = makeFakeDb(seed);
  db.failAtCommit = 2;

  let res = fakeRes();
  await createCmsPublishHandler(deps(db))(
    req({ body: { collection: 'cmsSchedule', docIds: ids } }),
    res,
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'publish-failed');
  const queueId = res.body.queueId;
  assert.equal(typeof queueId, 'string');

  let row = db.read('cmsPublishQueue', queueId);
  assert.equal(row.status, 'failed');
  assert.equal(row.progress.cmsSchedule.published.length, 133);
  assert.equal(db.ids('cmsSchedule').length, 133);

  // Resume: only the remainder publishes, revisions never double-bump.
  res = fakeRes();
  await createCmsPublishHandler(deps(db))(req({ body: { queueId } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.queueId, queueId);
  assert.equal(res.body.results.cmsSchedule.published.length, 134);

  row = db.read('cmsPublishQueue', queueId);
  assert.equal(row.status, 'done');
  assert.equal(db.ids('cmsSchedule').length, 134);
  assert.equal(db.ids('cmsVersionHistory').length, 134);
  for (const id of ids) assert.equal(db.read('cmsSchedule', id).revision, 1);

  // Resuming an already-done row is a cheap no-op answer.
  res = fakeRes();
  await createCmsPublishHandler(deps(db))(req({ body: { queueId } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'done');
  assert.equal(db.ids('cmsVersionHistory').length, 134); // nothing re-published
});

test('cmsPublish resume of an unknown queueId → 404', async () => {
  const res = fakeRes();
  await createCmsPublishHandler(deps(makeFakeDb()))(req({ body: { queueId: 'nope' } }), res);
  assert.equal(res.statusCode, 404);
});

// --- cmsGetPublishQueue -----------------------------------------------------------

test('cmsGetPublishQueue returns one row by id, 404 when missing', async () => {
  const db = makeFakeDb({
    'cmsPublishQueue/q1': { status: 'done', requestedAt: new Date(1000), requestedBy: 'a@example.org' },
  });
  let res = fakeRes();
  await createGetPublishQueueHandler(deps(db))(req({ body: { queueId: 'q1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows[0].id, 'q1');
  assert.equal(res.body.rows[0].status, 'done');

  res = fakeRes();
  await createGetPublishQueueHandler(deps(db))(req({ body: { queueId: 'missing' } }), res);
  assert.equal(res.statusCode, 404);
});

test('cmsGetPublishQueue lists rows newest-first with a limit', async () => {
  const db = makeFakeDb({
    'cmsPublishQueue/q1': { status: 'done', requestedAt: new Date(1000) },
    'cmsPublishQueue/q2': { status: 'failed', requestedAt: new Date(3000) },
    'cmsPublishQueue/q3': { status: 'running', requestedAt: new Date(2000) },
  });
  const res = fakeRes();
  await createGetPublishQueueHandler(deps(db))(req({ body: { limit: 2 } }), res);
  assert.deepEqual(res.body.rows.map((r) => r.id), ['q2', 'q3']);
});

// --- cmsUpdatePublishStatus -------------------------------------------------------

test('cmsUpdatePublishStatus marks a stranded running row failed and logs the action', async () => {
  const db = makeFakeDb({
    'cmsPublishQueue/q1': { status: 'running', requestedAt: new Date(1000), request: {} },
  });
  const res = fakeRes();
  await createUpdatePublishStatusHandler(deps(db))(
    req({ body: { queueId: 'q1', status: 'failed', note: 'stranded > 1h' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const row = db.read('cmsPublishQueue', 'q1');
  assert.equal(row.status, 'failed');
  assert.equal(row.note, 'stranded > 1h');
  assert.equal(row.statusSetBy, ADMIN.email);
  assert.equal(db.ids('admin_logs').length, 1);
});

test('cmsUpdatePublishStatus: 400 on a status outside failed/done, 404 on missing row', async () => {
  const db = makeFakeDb({ 'cmsPublishQueue/q1': { status: 'running' } });
  const handler = createUpdatePublishStatusHandler(deps(db));

  let res = fakeRes();
  await handler(req({ body: { queueId: 'q1', status: 'running' } }), res);
  assert.equal(res.statusCode, 400);

  res = fakeRes();
  await handler(req({ body: { status: 'failed' } }), res);
  assert.equal(res.statusCode, 400);

  res = fakeRes();
  await handler(req({ body: { queueId: 'ghost', status: 'failed' } }), res);
  assert.equal(res.statusCode, 404);
});

test('cmsPublish resume of a still-running row → 409, no writes', async () => {
  const db = makeFakeDb({
    'cmsPublishQueue/q1': { status: 'running', request: { cmsContent: ['a'] }, progress: {} },
    'cmsContent_drafts/a': { value: '1', visible: true, status: 'dirty' },
  });
  const res = fakeRes();
  await createCmsPublishHandler(deps(db))(req({ body: { queueId: 'q1' } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'already-running');
  assert.equal(db.writes.length, 0); // no revision bump, no history row
});

// --- site-publisher hook (spec §8.4 phase 5, issue #36) -------------------------

const PUBLISHER_ENV = {
  EVENT_SITE_PUBLISHER_JOB: 'site-publisher',
  EVENT_FIREBASE_PROJECT_ID: 'demo-project',
  EVENT_FIREBASE_REGION: 'us-central1',
};

function dirtyDb() {
  return makeFakeDb({
    'cmsContent_drafts/hero__title': { value: 'v1', visible: true, status: 'dirty' },
  });
}

const publishOne = { collection: 'cmsContent', docIds: ['hero__title'] };

test('cmsPublish skips the publisher when none is configured, and publishes anyway', async () => {
  const db = dirtyDb();
  const res = fakeRes();
  await createCmsPublishHandler({ ...deps(db), env: {} })(req({ body: publishOne }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.publisher, { status: 'skipped', reason: 'no-job-configured' });
  assert.equal(db.read('cmsPublishQueue', res.body.queueId).publisher, undefined);
  assert.equal(db.read('cmsContent', 'hero__title').revision, 1);
});

test('cmsPublish invokes the publisher after the revision copy commits', async () => {
  const db = dirtyDb();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('http://metadata')) {
      return { ok: true, status: 200, async json() { return { access_token: 't' }; } };
    }
    return { ok: true, status: 200, async json() { return { metadata: { name: 'exec-1' } }; } };
  };
  const res = fakeRes();
  await createCmsPublishHandler({ ...deps(db), env: PUBLISHER_ENV, fetchImpl })(
    req({ body: publishOne }), res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.publisher.status, 'invoked');
  assert.ok(calls.some((u) => u.endsWith('/jobs/site-publisher:run')));

  const row = db.read('cmsPublishQueue', res.body.queueId);
  assert.equal(row.status, 'done');
  assert.equal(row.publisher.invoke.status, 'invoked');
});

test('a publisher invoke failure never fails the publish response', async () => {
  const db = dirtyDb();
  const events = [];
  const fetchImpl = async (url) => (
    url.startsWith('http://metadata')
      ? { ok: true, status: 200, async json() { return { access_token: 't' }; } }
      : { ok: false, status: 403, async text() { return 'missing run.invoker'; } }
  );
  const res = fakeRes();
  await createCmsPublishHandler({
    ...deps(db),
    env: PUBLISHER_ENV,
    fetchImpl,
    notifyOperator: async (event) => { events.push(event); },
  })(req({ body: publishOne }), res);

  assert.equal(res.statusCode, 200, 'the publish committed; the snapshot refresh is best-effort');
  assert.equal(res.body.status, 'done');
  assert.equal(res.body.publisher.status, 'failed');
  assert.equal(db.read('cmsContent', 'hero__title').revision, 1);
  assert.equal(db.read('cmsPublishQueue', res.body.queueId).status, 'done');
  assert.equal(events.length, 1);
  assert.match(events[0].title, /Site publisher/);
});

test('a publish with nothing dirty creates no row and never invokes the publisher', async () => {
  const db = makeFakeDb();
  let invoked = false;
  const res = fakeRes();
  await createCmsPublishHandler({
    ...deps(db),
    env: PUBLISHER_ENV,
    fetchImpl: async () => { invoked = true; throw new Error('must not be called'); },
  })(req({ body: { all: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.queueId, null);
  assert.equal(invoked, false);
});

test('a failed publish never invokes the publisher — there is no new snapshot to build', async () => {
  const db = dirtyDb();
  db.failAtCommit = 1;
  let invoked = false;
  const res = fakeRes();
  await createCmsPublishHandler({
    ...deps(db),
    env: PUBLISHER_ENV,
    fetchImpl: async () => { invoked = true; throw new Error('must not be called'); },
  })(req({ body: publishOne }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(invoked, false);
});

test('publish endpoints: 400 on a queueId the real SDK would throw on', async () => {
  const db = makeFakeDb();
  for (const [create, extra] of [
    [createCmsPublishHandler, {}],
    [createGetPublishQueueHandler, {}],
    [createUpdatePublishStatusHandler, { status: 'failed' }],
  ]) {
    for (const queueId of ['', 'a/b', 'a/b/c', '.', 42]) {
      const res = fakeRes();
      await create(deps(db))(req({ body: { queueId, ...extra } }), res);
      assert.equal(res.statusCode, 400, `${create.name} queueId=${JSON.stringify(queueId)}`);
    }
  }
  assert.equal(db.writes.length, 0);
});
