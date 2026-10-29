'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { acquireLookupBudget } = require('./lookupBudget.cjs');
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
