'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('./demoWrites.cjs');

function fakeDb(event) {
  return {
    event,
    reads: 0,
    collection(name) {
      assert.equal(name, 'config');
      return { doc: (id) => {
        assert.equal(id, 'event');
        return { get: async () => {
          this.reads += 1;
          return { exists: this.event !== undefined, data: () => this.event };
        } };
      } };
    },
  };
}

test('historicalDemo true is a distinct read-only refusal', async () => {
  const result = await checkDemoWrites({ db: fakeDb({ historicalDemo: true }) });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'read-only-demo');
  assert.doesNotThrow(() => throwIfDemoPolicyUnavailable(result));
});

test('ordinary events work with false or an absent flag', async () => {
  for (const event of [{}, { historicalDemo: false }]) {
    assert.deepEqual(await checkDemoWrites({ db: fakeDb(event) }), { ok: true });
  }
});

test('missing and malformed policy fails closed without leaking read errors', async () => {
  for (const event of [undefined, null, [], 'event', 1,
    ...['true', 'false', null, 1, 0, {}, []].map((historicalDemo) => ({ historicalDemo }))]) {
    const result = await checkDemoWrites({ db: fakeDb(event) });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'config-unavailable');
    assert.throws(() => throwIfDemoPolicyUnavailable(result), { code: 'config-unavailable' });
  }
  const db = { collection() { throw new Error('private connection details'); } };
  const result = await checkDemoWrites({ db });
  assert.equal(result.code, 'config-unavailable');
  assert.doesNotMatch(JSON.stringify(result), /private connection/);
});

test('the next boundary rereads policy, including enabling a demo on a warm instance', async () => {
  const db = fakeDb({ historicalDemo: false });
  assert.deepEqual(await checkDemoWrites({ db }), { ok: true });
  db.event = { historicalDemo: true };
  assert.equal((await checkDemoWrites({ db })).code, 'read-only-demo');
  db.event = undefined;
  assert.equal((await checkDemoWrites({ db })).code, 'config-unavailable');
  db.event = {};
  assert.deepEqual(await checkDemoWrites({ db }), { ok: true });
  assert.equal(db.reads, 4);
});
