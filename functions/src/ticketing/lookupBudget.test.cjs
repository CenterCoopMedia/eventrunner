'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { acquireLookupBudget } = require('./lookupBudget.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
function database() {
  const docs = new Map();
  let queue = Promise.resolve();
  return {
    collection: () => ({ doc: (id) => id }),
    runTransaction(fn) {
      const result = queue.then(() => fn({
        get: async (id) => ({ exists: docs.has(id), data: () => docs.get(id) }),
        set: (id, data) => docs.set(id, data),
      }));
      queue = result.catch(() => {});
      return result;
    },
  };
}
test('concurrent user attempts stop at five and recover next minute', async () => {
  const db = database();
  let ms = 0;
  const call = () => acquireLookupBudget({ db, uid: 'one', now: () => new Date(ms) });
  const results = await Promise.all(Array.from({ length: 20 }, call));
  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.equal(results[5].retryAfter, 60);
  ms = 60000;
  assert.equal((await call()).allowed, true);
});
test('distinct accounts share the global hourly ceiling', async () => {
  const db = database();
  for (let i = 0; i < 100; i++) {
    assert.equal((await acquireLookupBudget({ db, uid: String(i), now: () => new Date(0) })).allowed, true);
  }
  const denied = await acquireLookupBudget({ db, uid: 'new', now: () => new Date(0) });
  assert.deepEqual(denied, { allowed: false, retryAfter: 3600 });
  assert.equal((await acquireLookupBudget({ db, uid: 'new', now: () => new Date(3600000) })).allowed, true);
});
test('database failure rejects instead of permitting an unbudgeted lookup', async () => {
  await assert.rejects(acquireLookupBudget({ db: { runTransaction: async () => { throw Error('offline'); } }, uid: 'one' }), /offline/);
});

for (const { name, windowMs, limit, shared } of [
  { name: 'user minute', windowMs: 60000, limit: 5, shared: false },
  { name: 'global hour', windowMs: 3600000, limit: 100, shared: true },
]) {
  test(`a retry across the ${name} boundary keeps both committed requests charged`, async () => {
    const db = makeFakeDb();
    let ms = windowMs - 1;
    const call = (uid) => acquireLookupBudget({ db, uid, now: () => new Date(ms) });
    db.beforeCommit = async () => {
      ms = windowMs;
      assert.equal((await call(shared ? 'overlap' : 'one')).allowed, true);
    };
    assert.equal((await call('one')).allowed, true);
    let remaining = 0;
    for (let i = 0; i < limit; i += 1) {
      if ((await call(shared ? `additional-${i}` : 'one')).allowed) remaining += 1;
    }
    assert.equal(remaining, limit - 2);
  });

  test(`an older instance clock cannot rewind the ${name} bucket`, async () => {
    const db = makeFakeDb();
    for (let i = 0; i < limit; i += 1) {
      const result = await acquireLookupBudget({
        db, uid: shared ? `account-${i}` : 'one', now: () => new Date(windowMs),
      });
      assert.equal(result.allowed, true);
    }
    const denied = await acquireLookupBudget({
      db, uid: shared ? 'another' : 'one', now: () => new Date(windowMs - 1),
    });
    assert.deepEqual(denied, { allowed: false, retryAfter: windowMs / 1000 + 1 });
  });
}

test('malformed persisted budget state rejects without writing an allowance', async () => {
  for (const state of [
    { start: 0, count: -1 }, { start: 0, count: 0.5 }, { start: 0, count: '1' },
    { count: 0 }, { start: 1, count: 0 },
  ]) {
    const db = makeFakeDb({ 'ticketLookupBudgets/global': state });
    await assert.rejects(acquireLookupBudget({ db, uid: 'one', now: () => new Date(0) }));
    assert.equal(db.writes.length, 0);
  }
});
