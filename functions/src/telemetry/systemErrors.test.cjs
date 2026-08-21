'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { logError, claimAlert, handleSystemErrorCreated } = require('./systemErrors.cjs');

/** Minimal in-memory Firestore fake: doc get/update, collection.add, transactions. */
function fakeDb() {
  const store = new Map(); // "collection/id" -> data
  let counter = 0;
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    __c: c,
    __id: id,
    async get() {
      const data = store.get(key(c, id));
      return { exists: data !== undefined, data: () => data, ref: docRef(c, id), id };
    },
    async update(patch) {
      Object.assign(store.get(key(c, id)), patch);
    },
  });
  return {
    store,
    failNextAdd: false,
    collection(c) {
      return {
        doc: (id) => docRef(c, id),
        async add(data) {
          if (this.__db?.failNextAdd) {
            this.__db.failNextAdd = false;
            throw new Error('simulated firestore outage');
          }
          const id = `gen-${(counter += 1)}`;
          store.set(key(c, id), data);
          return docRef(c, id);
        },
      };
    },
    async runTransaction(fn) {
      return fn({
        get: async (ref) => ref.get(),
        update: (ref, patch) => { Object.assign(store.get(key(ref.__c, ref.__id)), patch); },
      });
    },
  };
}

// The fake's `add` needs to see the outer db's failNextAdd flag; wire it in.
function makeDb() {
  const db = fakeDb();
  const originalCollection = db.collection.bind(db);
  db.collection = (c) => {
    const col = originalCollection(c);
    col.__db = db;
    return col;
  };
  return db;
}

function fakeNotify(result = { delivered: true, sink: 'webhook' }) {
  const calls = [];
  const impl = async (event) => { calls.push(event); return result; };
  impl.calls = calls;
  return impl;
}

// --- logError ------------------------------------------------------------------

test('logError persists a row with the expected shape and idempotency fields', async () => {
  const db = makeDb();
  const result = await logError({
    db,
    kind: 'client-error',
    message: 'boom',
    stack: 'at x',
    url: 'https://example.org',
    userAgent: 'UA',
    context: '{"page":"schedule"}',
    ipHash: 'abc123',
    now: () => Date.parse('2026-08-20T00:00:00.000Z'),
  });
  assert.equal(result.persisted, true);
  assert.ok(result.id);
  const row = db.store.get(`system_errors/${result.id}`);
  assert.deepEqual(row, {
    kind: 'client-error',
    message: 'boom',
    stack: 'at x',
    url: 'https://example.org',
    userAgent: 'UA',
    context: '{"page":"schedule"}',
    ipHash: 'abc123',
    resolved: false,
    alertedAt: null,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
  });
});

test('logError never throws to the caller', async () => {
  const db = makeDb();
  db.failNextAdd = true;
  const result = await logError({ db, kind: 'client-error', message: 'boom', log: { error() {} } });
  assert.deepEqual(result, { id: null, persisted: false });
});

test('a persist failure notifies the operator inline (a trigger cannot fire for a doc that never committed)', async () => {
  const db = makeDb();
  db.failNextAdd = true;
  const notifyOperator = fakeNotify();
  await logError({ db, kind: 'client-error', message: 'boom', notifyOperator, log: { error() {} } });
  assert.equal(notifyOperator.calls.length, 1);
  assert.equal(notifyOperator.calls[0].dedupeKey, 'system-errors-persist-fail:client-error');
  assert.match(notifyOperator.calls[0].summary, /simulated firestore outage/);
});

test('a successful persist never calls notifyOperator (that is onSystemErrorCreated\'s job)', async () => {
  const db = makeDb();
  const notifyOperator = fakeNotify();
  await logError({ db, kind: 'client-error', message: 'boom', notifyOperator });
  assert.equal(notifyOperator.calls.length, 0);
});

// --- claimAlert / handleSystemErrorCreated --------------------------------------

test('claimAlert sets alertedAt and returns true exactly once', async () => {
  const db = makeDb();
  db.store.set('system_errors/e1', { kind: 'client-error', message: 'x', alertedAt: null });
  const ref = db.collection('system_errors').doc('e1');

  assert.equal(await claimAlert({ db, ref, now: () => 1000 }), true);
  assert.deepEqual(db.store.get('system_errors/e1').alertedAt, new Date(1000));

  // A second claim (simulating a retried trigger delivery) is refused.
  assert.equal(await claimAlert({ db, ref, now: () => 2000 }), false);
  assert.deepEqual(db.store.get('system_errors/e1').alertedAt, new Date(1000));
});

test('claimAlert returns false for a doc that no longer exists', async () => {
  const db = makeDb();
  const ref = db.collection('system_errors').doc('missing');
  assert.equal(await claimAlert({ db, ref }), false);
});

test('handleSystemErrorCreated notifies once and is a no-op on a retried delivery', async () => {
  const db = makeDb();
  db.store.set('system_errors/e1', {
    kind: 'client-error',
    message: 'TypeError: boom',
    url: 'https://example.org/x',
    userAgent: 'UA',
    alertedAt: null,
  });
  const ref = db.collection('system_errors').doc('e1');
  const notifyOperator = fakeNotify();

  const first = await handleSystemErrorCreated({ db, ref, data: db.store.get('system_errors/e1'), notifyOperator });
  assert.equal(first.delivered, true);
  assert.equal(notifyOperator.calls.length, 1);
  assert.equal(notifyOperator.calls[0].errorId, 'e1');
  assert.equal(notifyOperator.calls[0].title, 'system error: client-error');
  assert.equal(notifyOperator.calls[0].summary, 'TypeError: boom');
  assert.equal(notifyOperator.calls[0].fields.url, 'https://example.org/x');
  assert.match(notifyOperator.calls[0].dedupeKey, /^system-error:client-error:[0-9a-f]{16}$/);

  // Retried delivery for the SAME doc: alertedAt is already set, so this
  // must not call notifyOperator again.
  const second = await handleSystemErrorCreated({
    db, ref, data: db.store.get('system_errors/e1'), notifyOperator,
  });
  assert.deepEqual(second, { delivered: false, reason: 'already-alerted' });
  assert.equal(notifyOperator.calls.length, 1);
});

test('two distinct docs with the same kind+message share a dedupeKey (defense against a burst)', async () => {
  const db = makeDb();
  const row = { kind: 'client-error', message: 'same failure', alertedAt: null };
  db.store.set('system_errors/e1', { ...row });
  db.store.set('system_errors/e2', { ...row });
  const notifyOperator = fakeNotify();

  await handleSystemErrorCreated({ db, ref: db.collection('system_errors').doc('e1'), data: row, notifyOperator });
  await handleSystemErrorCreated({ db, ref: db.collection('system_errors').doc('e2'), data: row, notifyOperator });

  assert.equal(notifyOperator.calls.length, 2);
  assert.equal(notifyOperator.calls[0].dedupeKey, notifyOperator.calls[1].dedupeKey);
});

test('handleSystemErrorCreated tolerates missing message/kind/url/userAgent', async () => {
  const db = makeDb();
  db.store.set('system_errors/e1', { alertedAt: null });
  const notifyOperator = fakeNotify();
  const result = await handleSystemErrorCreated({
    db, ref: db.collection('system_errors').doc('e1'), data: db.store.get('system_errors/e1'), notifyOperator,
  });
  assert.equal(result.delivered, true);
  assert.equal(notifyOperator.calls[0].title, 'system error: unknown');
  assert.equal(notifyOperator.calls[0].summary, '(no message)');
  assert.deepEqual(notifyOperator.calls[0].fields, {});
});
