'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateLiveUpdateDoc,
  createSaveLiveUpdateHandler,
  createDeleteLiveUpdateHandler,
  internals,
} = require('./liveUpdates.cjs');

// ---------------------------------------------------------------- fixtures

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const logs = [];
  let autoId = 0;
  return {
    docs,
    logs,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id === undefined ? `auto${(autoId += 1)}` : id}`;
          return {
            async get() {
              const data = docs.get(key);
              return { exists: data !== undefined, data: () => data };
            },
            async set(data) { docs.set(key, data); },
            async delete() { docs.delete(key); },
            // admin_logs writes go through this same fake collection().
            ...(name === 'admin_logs' ? {} : {}),
          };
        },
      };
    },
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

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function deps(overrides = {}) {
  return {
    db: fakeDb(),
    auth: fakeAuth,
    getConfig,
    now: () => 1700000000000,
    log: { warn() {}, error() {} },
    ...overrides,
  };
}

// ---------------------------------------------------------- validateLiveUpdateDoc

test('validateLiveUpdateDoc accepts a plain message, defaults pinned optional', () => {
  assert.deepEqual(validateLiveUpdateDoc({ message: 'Doors open at 9am.' }), { ok: true, errors: [] });
  assert.deepEqual(validateLiveUpdateDoc({ message: 'Doors open.', pinned: true }), { ok: true, errors: [] });
});

test('validateLiveUpdateDoc names every offending field', () => {
  const { ok, errors } = validateLiveUpdateDoc({ message: '', pinned: 'yes', extra: 1 });
  assert.equal(ok, false);
  for (const field of ['message:', 'pinned:', 'extra:']) {
    assert.ok(errors.some((e) => e.startsWith(field)), `missing ${field} error`);
  }
});

test('validateLiveUpdateDoc rejects a message over the length cap', () => {
  const { ok, errors } = validateLiveUpdateDoc({ message: 'x'.repeat(internals.MAX_MESSAGE_LEN + 1) });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith('message:')));
});

// -------------------------------------------------------------- saveLiveUpdate

test('saveLiveUpdate creates a new entry, stamping postedAt', async () => {
  const d = deps();
  const res = fakeRes();
  await createSaveLiveUpdateHandler(d)(adminReq({ id: 'u1', update: { message: 'Hello', pinned: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'u1' });
  const stored = d.db.docs.get('live_updates/u1');
  assert.equal(stored.message, 'Hello');
  assert.equal(stored.pinned, true);
  assert.deepEqual(stored.postedAt, new Date(1700000000000));
});

test('saveLiveUpdate never stamps actor identity onto the public doc (Codex P1)', async () => {
  // live_updates is anonymously readable and admin identity is a
  // server-only allowlist (config/bootstrap.adminEmails) — an `updatedBy`
  // field here would let any visitor enumerate admin addresses just by
  // reading the public feed. Actor identity belongs only in admin_logs.
  const d = deps();
  await createSaveLiveUpdateHandler(d)(adminReq({ id: 'u1', update: { message: 'Hello' } }), fakeRes());
  const stored = d.db.docs.get('live_updates/u1');
  assert.equal('updatedBy' in stored, false);
  assert.equal('email' in stored, false);
  assert.equal('uid' in stored, false);
  // ...but the admin_logs row still records who made the change.
  const logEntry = d.db.docs.get([...d.db.docs.keys()].find((k) => k.startsWith('admin_logs/')));
  assert.equal(logEntry.email, 'admin@example.org');
});

test('saveLiveUpdate mints an id when none is given', async () => {
  const d = deps();
  const res = fakeRes();
  await createSaveLiveUpdateHandler(d)(adminReq({ update: { message: 'Hi' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.body.id === 'string' && res.body.id.length > 0);
});

test('saveLiveUpdate defaults pinned to false when omitted', async () => {
  const d = deps();
  await createSaveLiveUpdateHandler(d)(adminReq({ id: 'u1', update: { message: 'Hi' } }), fakeRes());
  assert.equal(d.db.docs.get('live_updates/u1').pinned, false);
});

test('saveLiveUpdate preserves postedAt on an edit instead of bumping it', async () => {
  const originalPostedAt = new Date(1690000000000);
  const db = fakeDb({ 'live_updates/u1': { message: 'old', pinned: false, postedAt: originalPostedAt } });
  const d = deps({ db, now: () => 1700000000000 });
  await createSaveLiveUpdateHandler(d)(adminReq({ id: 'u1', update: { message: 'fixed typo' } }), fakeRes());
  const stored = d.db.docs.get('live_updates/u1');
  assert.equal(stored.message, 'fixed typo');
  assert.deepEqual(stored.postedAt, originalPostedAt);
  assert.deepEqual(stored.updatedAt, new Date(1700000000000));
});

test('saveLiveUpdate rejects an invalid doc with 400, writes nothing', async () => {
  const d = deps();
  const res = fakeRes();
  await createSaveLiveUpdateHandler(d)(adminReq({ update: { message: '' } }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.message.includes('message:'));
  assert.equal(d.db.docs.size, 0);
});

test('saveLiveUpdate gates on admin (401 no token, 403 non-admin)', async () => {
  const d = deps();
  let res = fakeRes();
  await createSaveLiveUpdateHandler(d)({ method: 'POST', headers: {}, body: { update: { message: 'x' } } }, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await createSaveLiveUpdateHandler(d)(
    { method: 'POST', headers: { authorization: `Bearer ${NON_ADMIN_TOKEN}` }, body: { update: { message: 'x' } } },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(d.db.docs.size, 0);
});

test('saveLiveUpdate rejects non-POST and an invalid id', async () => {
  let res = fakeRes();
  await createSaveLiveUpdateHandler(deps())({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  res = fakeRes();
  await createSaveLiveUpdateHandler(deps())(adminReq({ id: 'not/a valid id', update: { message: 'x' } }), res);
  assert.equal(res.statusCode, 400);
});

test('saveLiveUpdate records an admin_logs entry', async () => {
  const db = fakeDb();
  const d = deps({ db });
  await createSaveLiveUpdateHandler(d)(adminReq({ id: 'u1', update: { message: 'Hi' } }), fakeRes());
  const entry = db.docs.get([...db.docs.keys()].find((k) => k.startsWith('admin_logs/')));
  assert.equal(entry.action, 'saveLiveUpdate');
  assert.equal(entry.docPath, 'live_updates/u1');
});

// ------------------------------------------------------------ deleteLiveUpdate

test('deleteLiveUpdate removes the entry and logs', async () => {
  const db = fakeDb({ 'live_updates/u1': { message: 'x' } });
  const d = deps({ db });
  const res = fakeRes();
  await createDeleteLiveUpdateHandler(d)(adminReq({ id: 'u1' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'u1', deleted: true });
  assert.equal(db.docs.has('live_updates/u1'), false);
  const entry = db.docs.get([...db.docs.keys()].find((k) => k.startsWith('admin_logs/')));
  assert.equal(entry.action, 'deleteLiveUpdate');
});

test('deleteLiveUpdate 404s when nothing exists, gates on admin', async () => {
  let res = fakeRes();
  await createDeleteLiveUpdateHandler(deps())(adminReq({ id: 'ghost' }), res);
  assert.equal(res.statusCode, 404);
  res = fakeRes();
  const db = fakeDb({ 'live_updates/u1': {} });
  await createDeleteLiveUpdateHandler(deps({ db }))({ method: 'POST', headers: {}, body: { id: 'u1' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(db.docs.has('live_updates/u1'), true);
});
