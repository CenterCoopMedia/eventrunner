'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deleteSpamApplication, isExpired, runRetention } = require('./cleanup.cjs');
const { DAY, NOW, QUIET, ana, answers, application, deps, ops, seeded } = require('./fakeReview.cjs');

const auditRows = (db) => db.paths('console_audit/').map((p) => db.read(p));

test('an operator deletes a spam request, frees its name and leaves an audit record with no client data', async () => {
  const db = seeded();
  const result = await deleteSpamApplication(deps(db), { body: { appId: 'a1', confirm: true }, user: ops });
  assert.deepEqual(result.body, { appId: 'a1', deleted: true });
  assert.equal(db.read('applications/a1'), undefined);
  assert.equal(db.read('site_names/nclocal'), undefined);
  assert.deepEqual(auditRows(db), [{ action: 'delete-spam', appId: 'a1', by: 'ops', at: new Date(NOW) }]);
  assert.ok(!JSON.stringify(auditRows(db)).includes('NC Local'));
});

test('deleteSpamApplication needs confirm: true', async () => {
  const db = seeded();
  for (const confirm of [undefined, false, 'true', 1]) {
    await assert.rejects(deleteSpamApplication(deps(db), { body: { appId: 'a1', confirm }, user: ops }), { status: 400, code: 'confirm-required' });
  }
  assert.ok(db.read('applications/a1'));
});

test('a client cannot delete a request as spam', async () => {
  const db = seeded();
  await assert.rejects(deleteSpamApplication(deps(db), { body: { appId: 'a1', confirm: true }, user: ana }), { status: 403 });
  assert.ok(db.read('applications/a1'));
});

test('an approved or later request is never deleted as spam', async () => {
  for (const status of ['approved', 'building', 'ready', 'launched']) {
    const db = seeded({ 'applications/a1': application({ status }) });
    await assert.rejects(deleteSpamApplication(deps(db), { body: { appId: 'a1', confirm: true }, user: ops }), { status: 409, code: 'cannot-delete' });
    assert.ok(db.read('applications/a1'), status);
    assert.equal(auditRows(db).length, 0);
  }
});

test('a missing request is a 404', async () => {
  await assert.rejects(deleteSpamApplication(deps(seeded()), { body: { appId: 'zz', confirm: true }, user: ops }), { status: 404 });
});

test('isExpired is true only for withdrawn or declined requests 90 days after the last change', () => {
  const at = NOW;
  assert.equal(isExpired({ status: 'declined', updatedAt: new Date(at - 90 * DAY) }, at), true);
  assert.equal(isExpired({ status: 'withdrawn', updatedAt: new Date(at - 91 * DAY) }, at), true);
  assert.equal(isExpired({ status: 'declined', updatedAt: new Date(at - 90 * DAY + 1) }, at), false);
  assert.equal(isExpired({ status: 'approved', updatedAt: new Date(at - 400 * DAY) }, at), false);
  assert.equal(isExpired({ status: 'declined' }, at), false);
});

test('the retention job deletes old withdrawn and declined requests, frees their names, and keeps the rest', async () => {
  const old = new Date(NOW - 95 * DAY);
  const db = seeded({
    'applications/a1': application({ status: 'declined', updatedAt: old }),
    'applications/w1': application({ status: 'withdrawn', updatedAt: old, frozen: answers({ webAddress: { name: 'gone' } }) }),
    'site_names/gone': { appId: 'w1', orgId: 'o1' },
    'applications/recent': application({ status: 'declined', updatedAt: new Date(NOW - 10 * DAY) }),
    'applications/kept': application({ status: 'approved', updatedAt: old }),
    'applications/sub': application({ status: 'submitted', updatedAt: old }),
  });
  const result = await runRetention({ db, now: () => NOW, log: QUIET });
  assert.deepEqual(result.deleted.sort(), ['a1', 'w1']);
  assert.deepEqual(result.failed, []);
  assert.equal(db.read('applications/a1'), undefined);
  assert.equal(db.read('applications/w1'), undefined);
  assert.equal(db.read('site_names/nclocal'), undefined);
  assert.equal(db.read('site_names/gone'), undefined);
  for (const id of ['recent', 'kept', 'sub']) assert.ok(db.read(`applications/${id}`), id);
  assert.deepEqual(auditRows(db).map((r) => [r.action, r.appId, r.by]).sort(), [
    ['retention-delete', 'a1', 'retention'],
    ['retention-delete', 'w1', 'retention'],
  ]);
});

test('the clock decides: the same request is kept on day 89 and deleted on day 90', async () => {
  const changed = NOW;
  const db = seeded({ 'applications/a1': application({ status: 'withdrawn', updatedAt: new Date(changed) }) });
  assert.deepEqual((await runRetention({ db, now: () => changed + 89 * DAY, log: QUIET })).deleted, []);
  assert.deepEqual((await runRetention({ db, now: () => changed + 90 * DAY, log: QUIET })).deleted, ['a1']);
  assert.deepEqual((await runRetention({ db, now: () => changed + 91 * DAY, log: QUIET })).deleted, [], 'a second run is safe');
});

test('the retention job keeps a request that changed after the query', async () => {
  const db = seeded({ 'applications/a1': application({ status: 'declined', updatedAt: new Date(NOW - 100 * DAY) }) });
  const realTransaction = db.runTransaction;
  db.runTransaction = async (fn) => {
    await db.doc('applications/a1').update({ updatedAt: new Date(NOW) });
    return realTransaction(fn);
  };
  const result = await runRetention({ db, now: () => NOW, log: QUIET });
  assert.deepEqual(result.deleted, []);
  assert.ok(db.read('applications/a1'));
});

test('the retention job logs a failed delete and carries on', async () => {
  const old = new Date(NOW - 100 * DAY);
  const db = seeded({
    'applications/a1': application({ status: 'declined', updatedAt: old }),
    'applications/a2': application({ status: 'declined', updatedAt: old, frozen: null, answers: null }),
  });
  const realTransaction = db.runTransaction;
  let calls = 0;
  db.runTransaction = async (fn) => {
    calls += 1;
    if (calls === 1) throw new Error('aborted');
    return realTransaction(fn);
  };
  const logged = [];
  const result = await runRetention({ db, now: () => NOW, log: { info() {}, error: (...a) => logged.push(a) } });
  assert.equal(result.failed.length, 1);
  assert.equal(result.deleted.length, 1);
  assert.equal(logged.length, 1);
});
