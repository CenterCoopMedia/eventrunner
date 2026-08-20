'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateUpdateDoc,
  createSaveUpdateHandler,
  createDeleteUpdateHandler,
  internals,
} = require('./updates.cjs');

// ---------------------------------------------------------------- fixtures

function validUpdate(overrides = {}) {
  return {
    title: 'Venue change',
    body: 'The Thursday sessions move to the annex.',
    publishAt: null,
    pinned: false,
    ...overrides,
  };
}

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const added = [];
  return {
    docs,
    added,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              const data = docs.get(key);
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
        async add(data) {
          added.push({ collection: name, data });
          return { id: `auto${added.length}` };
        },
      };
    },
  };
}

function fakeStore() {
  const writes = [];
  const deletes = [];
  const logs = [];
  return {
    writes,
    deletes,
    logs,
    async writeDraft(args) { writes.push(args); },
    async deleteBoth(args) { deletes.push(args); },
    async logAdminAction(args) { logs.push(args); },
  };
}

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

const ADMIN_TOKEN = 'admin-token';
const NON_ADMIN_TOKEN = 'user-token';

const fakeAuth = {
  async verifyIdToken(token) {
    if (token === ADMIN_TOKEN) {
      return { uid: 'admin1', email: 'admin@example.org', email_verified: true };
    }
    if (token === NON_ADMIN_TOKEN) {
      return { uid: 'user1', email: 'user@example.org', email_verified: true };
    }
    throw new Error('bad token');
  },
};

const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.org'] } });

function adminReq(body) {
  return { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, body };
}

function deps(overrides = {}) {
  return {
    db: fakeDb(),
    auth: fakeAuth,
    getConfig,
    store: fakeStore(),
    now: () => 1700000000000,
    log: { warn() {}, error() {} },
    ...overrides,
  };
}

// -------------------------------------------------------- validateUpdateDoc

test('validateUpdateDoc accepts the spec shape with publishAt null', () => {
  assert.deepEqual(validateUpdateDoc(validUpdate()), { ok: true, errors: [] });
});

test('validateUpdateDoc accepts ISO and millis publishAt, rejects garbage', () => {
  assert.equal(validateUpdateDoc(validUpdate({ publishAt: '2026-05-14T09:00:00Z' })).ok, true);
  assert.equal(validateUpdateDoc(validUpdate({ publishAt: 1770000000000 })).ok, true);
  const { ok, errors } = validateUpdateDoc(validUpdate({ publishAt: 'soonish' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('publishAt:')));
});

test('validateUpdateDoc requires publishAt to be present (explicit null)', () => {
  const doc = validUpdate();
  delete doc.publishAt;
  const { ok, errors } = validateUpdateDoc(doc);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('publishAt:')));
});

test('validateUpdateDoc names every offending field', () => {
  const { ok, errors } = validateUpdateDoc({ title: '', body: 7, publishAt: null, pinned: 'yes', extra: 1 });
  assert.equal(ok, false);
  for (const field of ['title:', 'body:', 'pinned:', 'extra:']) {
    assert.ok(errors.some((e) => e.startsWith(field)), `missing ${field} error`);
  }
});

test('normalizePublishAt: null passes through, invalid Date rejected', () => {
  assert.equal(internals.normalizePublishAt(null), null);
  assert.equal(internals.normalizePublishAt(new Date('nope')), undefined);
  assert.ok(internals.normalizePublishAt('2026-01-01') instanceof Date);
});

// ----------------------------------------------------------- cmsSaveUpdate

test('cmsSaveUpdate writes the DRAFT collection only', async () => {
  const d = deps();
  const res = fakeRes();
  await createSaveUpdateHandler(d)(adminReq({ id: 'venue-change', update: validUpdate() }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'venue-change', status: 'dirty' });
  const write = d.store.writes[0];
  assert.equal(write.collection, 'cmsUpdates');
  assert.equal(write.docId, 'venue-change');
  // Omitted visible must reach the store as undefined so it preserves the
  // prior draft/live visibility instead of resetting a hidden update.
  assert.equal(write.visible, undefined);
  assert.deepEqual(write.actor, { uid: 'admin1', email: 'admin@example.org' });
  assert.deepEqual(Object.keys(write.fields).sort(), ['body', 'pinned', 'publishAt', 'title']);
});

test('cmsSaveUpdate stores publishAt as a Date, not the raw string', async () => {
  const d = deps();
  await createSaveUpdateHandler(d)(
    adminReq({ id: 'u1', update: validUpdate({ publishAt: '2026-05-14T09:00:00Z' }) }),
    fakeRes(),
  );
  const stored = d.store.writes[0].fields.publishAt;
  assert.ok(stored instanceof Date);
  assert.equal(stored.toISOString(), '2026-05-14T09:00:00.000Z');
});

test('cmsSaveUpdate mints an id when none is given', async () => {
  const d = deps();
  const res = fakeRes();
  await createSaveUpdateHandler(d)(adminReq({ update: validUpdate() }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.body.id === 'string' && res.body.id.length > 0);
  assert.equal(d.store.writes[0].docId, res.body.id);
});

test('cmsSaveUpdate rejects an invalid doc with 400 naming fields', async () => {
  const d = deps();
  const res = fakeRes();
  await createSaveUpdateHandler(d)(adminReq({ update: { title: '', body: '', publishAt: null, pinned: false } }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.message.includes('title:'));
  assert.equal(d.store.writes.length, 0);
});

test('cmsSaveUpdate gates on admin (401 no token, 403 non-admin)', async () => {
  const d = deps();
  let res = fakeRes();
  await createSaveUpdateHandler(d)({ method: 'POST', headers: {}, body: { update: validUpdate() } }, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await createSaveUpdateHandler(d)(
    { method: 'POST', headers: { authorization: `Bearer ${NON_ADMIN_TOKEN}` }, body: { update: validUpdate() } },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(d.store.writes.length, 0);
});

test('cmsSaveUpdate rejects non-POST and non-boolean visible', async () => {
  let res = fakeRes();
  await createSaveUpdateHandler(deps())({ method: 'DELETE', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  res = fakeRes();
  await createSaveUpdateHandler(deps())(adminReq({ update: validUpdate(), visible: 'yes' }), res);
  assert.equal(res.statusCode, 400);
});

test('cmsSaveUpdate passes an explicit visible boolean through unchanged', async () => {
  const d = deps();
  await createSaveUpdateHandler(d)(adminReq({ id: 'u-hidden', update: validUpdate(), visible: false }), fakeRes());
  assert.equal(d.store.writes[0].visible, false);
  const d2 = deps();
  await createSaveUpdateHandler(d2)(adminReq({ id: 'u-shown', update: validUpdate(), visible: true }), fakeRes());
  assert.equal(d2.store.writes[0].visible, true);
});

test('cmsSaveUpdate records an admin_logs entry via the store', async () => {
  const d = deps();
  await createSaveUpdateHandler(d)(adminReq({ id: 'u1', update: validUpdate() }), fakeRes());
  const entry = d.store.logs[0];
  assert.equal(entry.action, 'cmsSaveUpdate');
  assert.equal(entry.docPath, 'cmsUpdates_drafts/u1');
  assert.deepEqual(entry.actor, { uid: 'admin1', email: 'admin@example.org' });
});

// --------------------------------------------------------- cmsDeleteUpdate

test('cmsDeleteUpdate deletes both revisions and logs', async () => {
  const db = fakeDb({ 'cmsUpdates/u1': { title: 't' }, 'cmsUpdates_drafts/u1': { title: 't' } });
  const d = deps({ db });
  const res = fakeRes();
  await createDeleteUpdateHandler(d)(adminReq({ id: 'u1' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(d.store.deletes[0], { db, collection: 'cmsUpdates', docId: 'u1' });
  assert.equal(d.store.logs[0].action, 'cmsDeleteUpdate');
  assert.equal(d.store.logs[0].docPath, 'cmsUpdates/u1');
});

test('cmsDeleteUpdate works when only a never-published draft exists', async () => {
  const db = fakeDb({ 'cmsUpdates_drafts/u2': { title: 't' } });
  const d = deps({ db });
  const res = fakeRes();
  await createDeleteUpdateHandler(d)(adminReq({ id: 'u2' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(d.store.deletes.length, 1);
});

test('cmsDeleteUpdate 404s when nothing exists, gates on admin', async () => {
  let res = fakeRes();
  await createDeleteUpdateHandler(deps())(adminReq({ id: 'ghost' }), res);
  assert.equal(res.statusCode, 404);
  res = fakeRes();
  const d = deps({ db: fakeDb({ 'cmsUpdates/u1': {} }) });
  await createDeleteUpdateHandler(d)({ method: 'POST', headers: {}, body: { id: 'u1' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(d.store.deletes.length, 0);
});
