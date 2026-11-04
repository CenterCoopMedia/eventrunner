'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb } = require('./fakes.cjs');
const { RESERVED, checkWebAddress, siteNameProblem } = require('./siteNames.cjs');

const ana = { uid: 'ana', email: 'ana@example.org' };

test('a name is 3 to 30 lowercase letters, digits and hyphens, with no hyphen at either end', () => {
  for (const good of ['abc', 'nclocal', 'nc-local-2027', 'a1b', 'x'.repeat(30)]) {
    assert.equal(siteNameProblem(good), null, good);
  }
  for (const bad of ['ab', 'x'.repeat(31), '-abc', 'abc-', 'NC', 'nc_local', 'nc local', 'nc.local', 'café']) {
    assert.equal(siteNameProblem(bad)?.reason, 'format', bad);
  }
});

test('reserved names and encoded international names are refused', () => {
  for (const name of ['www', 'console', 'admin', 'api', 'mail', 'app', 'docs', 'demo', 'status', 'help',
    'support', 'staging', 'test', 'xn--abc']) {
    assert.equal(siteNameProblem(name)?.reason, 'reserved', name);
  }
  assert.ok(RESERVED.has('postmaster'));
});

test('checkWebAddress says a free name is available and shows the full address', async () => {
  const db = makeFakeDb();
  const result = await checkWebAddress({ db }, { body: { name: ' NCLocal ' }, user: ana });
  assert.deepEqual(result.body, { name: 'nclocal', address: 'nclocal.eventrunner.org', available: true });
});

test('checkWebAddress says a name another request holds is taken, and one this request holds is free', async () => {
  const db = makeFakeDb({ 'site_names/nclocal': { appId: 'a1', orgId: 'o1', reservedAt: new Date() } });
  const taken = await checkWebAddress({ db }, { body: { name: 'nclocal', appId: 'a2' }, user: ana });
  assert.equal(taken.body.available, false);
  assert.equal(taken.body.reason, 'taken');
  assert.match(taken.body.message, /Another event already uses this name/);
  const mine = await checkWebAddress({ db }, { body: { name: 'nclocal', appId: 'a1' }, user: ana });
  assert.equal(mine.body.available, true);
});

test('checkWebAddress reports format and reserved problems without a database read', async () => {
  const db = makeFakeDb();
  db.collection = () => { throw new Error('no read expected'); };
  const short = await checkWebAddress({ db }, { body: { name: 'ab' }, user: ana });
  assert.equal(short.body.reason, 'format');
  const reserved = await checkWebAddress({ db }, { body: { name: 'admin' }, user: ana });
  assert.equal(reserved.body.reason, 'reserved');
  const missing = await checkWebAddress({ db }, { body: {}, user: ana });
  assert.equal(missing.body.available, false);
});
