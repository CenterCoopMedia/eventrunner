'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deleteSpamApplication, isExpired, runRetention } = require('./cleanup.cjs');
const { makeFakeConnector, makeFakeSecrets } = require('./fakes.cjs');
const { DAY, NOW, QUIET, ana, answers, application, deps, ops, seeded: seededReview, } = require('./fakeReview.cjs');

const seeded = (extra) => seededReview({ 'applications/a1': application({ status: 'draft' }), ...extra });

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
    'applications/draft': application({ status: 'draft', updatedAt: old }),
  });
  const result = await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET });
  assert.deepEqual(result.deleted.sort(), ['a1', 'w1']);
  assert.deepEqual(result.failed, []);
  assert.equal(db.read('applications/a1'), undefined);
  assert.equal(db.read('applications/w1'), undefined);
  assert.equal(db.read('site_names/nclocal'), undefined);
  assert.equal(db.read('site_names/gone'), undefined);
  for (const id of ['recent', 'kept', 'draft']) assert.ok(db.read(`applications/${id}`), id);
  // A run may have made this name's project, so it stays taken after the request goes.
  const built = seeded({
    'applications/a1': application({ status: 'declined', updatedAt: old }),
    'console_builds/a1': { state: 'failed' },
  });
  await runRetention({ db: built, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET });
  assert.equal(built.read('applications/a1'), undefined);
  assert.ok(built.read('site_names/nclocal'));
  assert.deepEqual(auditRows(db).map((r) => [r.action, r.appId, r.by]).sort(), [
    ['retention-delete', 'a1', 'retention'],
    ['retention-delete', 'w1', 'retention'],
  ]);
});

test('the clock decides: the same request is kept on day 89 and deleted on day 90', async () => {
  const changed = NOW;
  const db = seeded({ 'applications/a1': application({ status: 'withdrawn', updatedAt: new Date(changed) }) });
  assert.deepEqual((await runRetention({ db, secrets: makeFakeSecrets(), now: () => changed + 89 * DAY, log: QUIET })).deleted, []);
  assert.deepEqual((await runRetention({ db, secrets: makeFakeSecrets(), now: () => changed + 90 * DAY, log: QUIET })).deleted, ['a1']);
  assert.deepEqual((await runRetention({ db, secrets: makeFakeSecrets(), now: () => changed + 91 * DAY, log: QUIET })).deleted, [], 'a second run is safe');
});

test('the retention job keeps a request that changed after the query', async () => {
  const db = seeded({ 'applications/a1': application({ status: 'declined', updatedAt: new Date(NOW - 100 * DAY) }) });
  const realTransaction = db.runTransaction;
  db.runTransaction = async (fn) => {
    await db.doc('applications/a1').update({ updatedAt: new Date(NOW) });
    return realTransaction(fn);
  };
  const result = await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET });
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
  const result = await runRetention({ db, secrets: makeFakeSecrets(), connectors: { stripe: makeFakeConnector() }, now: () => NOW, log: { info() {}, error: (...a) => logged.push(a) } });
  assert.equal(result.failed.length, 1);
  assert.equal(result.deleted.length, 1);
  assert.equal(logged.length, 1);
});

test('the retention job finds old requests behind many recent ones and pages through them all', async () => {
  const recent = new Date(NOW - 10 * DAY);
  const old = new Date(NOW - 100 * DAY);
  const extra = {};
  for (const id of ['r1', 'r2', 'r3']) extra[`applications/${id}`] = application({ status: 'declined', updatedAt: recent });
  for (const id of ['o1', 'o2', 'o3', 'o4', 'o5']) extra[`applications/${id}`] = application({ status: 'declined', updatedAt: old });
  const db = seeded(extra);
  const result = await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET, batchSize: 2 });
  assert.deepEqual(result.deleted.sort(), ['o1', 'o2', 'o3', 'o4', 'o5']);
  for (const id of ['r1', 'r2', 'r3']) assert.ok(db.read(`applications/${id}`), `${id} is kept`);
});

test('the retention job stops when a full batch has nothing it can delete', async () => {
  const db = seeded({ 'applications/a1': application({ status: 'declined', updatedAt: new Date(NOW - 100 * DAY) }) });
  db.runTransaction = async () => { throw new Error('aborted'); };
  const result = await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET, batchSize: 1 });
  assert.deepEqual(result, { deleted: [], failed: ['a1'] });
});

test('a spam delete frees every name the request holds', async () => {
  const live = { ...application().answers, webAddress: { name: 'nclocal2' } };
  const db = seeded({
    'applications/a1': application({ status: 'draft', answers: live }),
    'site_names/nclocal2': { appId: 'a1', orgId: 'o1' },
  });
  await deleteSpamApplication(deps(db), { body: { appId: 'a1', confirm: true }, user: ops });
  assert.equal(db.read('site_names/nclocal2'), undefined);
  assert.equal(db.read('site_names/nclocal'), undefined);
});

test('a closed request\'s acceptance record outlives it', async () => {
  const old = new Date(NOW - 90 * DAY);
  const db = seeded({
    'applications/a1': application({ status: 'withdrawn', updatedAt: old }),
    'agreement_acceptances/r1': { version: 1, appId: 'a1' },
  });
  const { deleted } = await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET });
  assert.deepEqual(deleted, ['a1']);
  assert.ok(db.read('agreement_acceptances/r1'), 'the signed record is kept');
});

const TOKEN_ID = 'connection-stripe-a1';
const closedOld = { status: 'declined', updatedAt: new Date(NOW - 100 * DAY) };
const privateRow = { stripe: { accountId: 'acct_client1', connectedBy: 'ana' } };

test('the retention job deletes a closed request\'s stored tokens and ends its connection', async () => {
  const db = seeded({ 'applications/a1': application(closedOld), 'console_connections/a1': privateRow });
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored', 'connection-eventbrite-a1': 'eb-stored' });
  const stripe = makeFakeConnector();
  const result = await runRetention({ db, secrets, connectors: { stripe, eventbrite: null }, now: () => NOW, log: QUIET });
  assert.deepEqual(result, { deleted: ['a1'], failed: [] });
  assert.equal(secrets.store.size, 0);
  assert.deepEqual(stripe.revoked, ['acct_client1']);
  assert.equal(db.read('console_connections/a1'), undefined);
});

test('retention keeps the connection of an account a live site still uses, and deletes its own token', async () => {
  const db = seeded({
    'applications/a1': application(closedOld),
    'console_connections/a1': privateRow,
    'applications/live': application({ orgId: 'o2', status: 'launched' }),
    'console_connections/live': privateRow,
  });
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  const stripe = makeFakeConnector();
  const result = await runRetention({ db, secrets, connectors: { stripe }, now: () => NOW, log: QUIET });
  assert.deepEqual(result.deleted, ['a1']);
  assert.equal(secrets.store.size, 0);
  assert.deepEqual(stripe.revoked, []);
  assert.ok(db.read('console_connections/live'));
});

test('two closed requests on one account end the connection once, with the last', async () => {
  const db = seeded({
    'applications/a1': application(closedOld),
    'console_connections/a1': privateRow,
    'applications/a2': application(closedOld),
    'console_connections/a2': privateRow,
  });
  const stripe = makeFakeConnector();
  const result = await runRetention({ db, secrets: makeFakeSecrets(), connectors: { stripe }, now: () => NOW, log: QUIET });
  assert.deepEqual(result.deleted.sort(), ['a1', 'a2']);
  assert.deepEqual(stripe.revoked, ['acct_client1']);
});

test('a kept request does not end its connection', async () => {
  const db = seeded({ 'applications/a1': application(closedOld), 'console_connections/a1': privateRow });
  const realTransaction = db.runTransaction;
  db.runTransaction = async (fn) => {
    await db.doc('applications/a1').update({ updatedAt: new Date(NOW) });
    return realTransaction(fn);
  };
  const stripe = makeFakeConnector();
  await runRetention({ db, secrets: makeFakeSecrets(), connectors: { stripe }, now: () => NOW, log: QUIET });
  assert.deepEqual(stripe.revoked, []);
  assert.ok(db.read('console_connections/a1'));
});

test('the retention job leaves the tokens of a request it keeps', async () => {
  const db = seeded({ 'applications/a1': application({ status: 'declined', updatedAt: new Date(NOW - 10 * DAY) }) });
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  await runRetention({ db, secrets, now: () => NOW, log: QUIET });
  assert.equal(secrets.store.size, 1);
});

test('a token that cannot be deleted keeps its row, so the next run tries again', async () => {
  const db = seeded({ 'applications/a1': application(closedOld) });
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  secrets.failDelete = true;
  const first = await runRetention({ db, secrets, now: () => NOW, log: QUIET });
  assert.deepEqual(first, { deleted: ['a1'], failed: [] });
  assert.equal(db.read('applications/a1'), undefined);
  assert.equal(secrets.store.size, 1);
  assert.ok(db.read('console_token_deletions/a1'));
  secrets.failDelete = false;
  await runRetention({ db, secrets, now: () => NOW, log: QUIET });
  assert.equal(secrets.store.size, 0);
  assert.equal(db.read('console_token_deletions/a1'), undefined);
});

test('a delete refused at the last moment has touched no token', async () => {
  const db = seeded({ 'applications/a1': application(closedOld) });
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  const run = db.runTransaction.bind(db);
  db.runTransaction = async (fn) => {
    db.runTransaction = run;
    await db.collection('applications').doc('a1').update({ updatedAt: new Date(NOW) });
    return run(fn);
  };
  assert.deepEqual((await runRetention({ db, secrets, now: () => NOW, log: QUIET })).deleted, []);
  assert.equal(secrets.store.size, 1);
  assert.equal(db.read('console_token_deletions/a1'), undefined);
});

test('a request with a connection change running is not deleted', async () => {
  const changing = { connections: { stripe: { connected: false, change: { id: 'c1', until: new Date(NOW + 1000) } } } };
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  const old = seeded({ 'applications/a1': application({ ...closedOld, ...changing }) });
  assert.deepEqual((await runRetention({ db: old, secrets, now: () => NOW, log: QUIET })).deleted, []);
  const db = seeded({ 'applications/a1': application({ status: 'draft', ...changing }) });
  await assert.rejects(deleteSpamApplication(deps(db, { secrets }), { body: { appId: 'a1', confirm: true }, user: ops }), { code: 'connection-busy' });
  assert.equal(secrets.store.size, 1);
});

test('a failed revoke does not stop the token being deleted or the request going', async () => {
  const db = seeded({ 'applications/a1': application(closedOld), 'console_connections/a1': privateRow });
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  const stripe = makeFakeConnector();
  stripe.revokeError = new Error('stripe revoke: HTTP 500');
  const result = await runRetention({ db, secrets, connectors: { stripe }, now: () => NOW, log: QUIET });
  assert.deepEqual(result.deleted, ['a1']);
  assert.equal(secrets.store.size, 0);
});

test('the retention job clears connection states nobody came back for', async () => {
  const db = seeded({
    'console_connection_states/old': { uid: 'ana', expiresAt: new Date(NOW - 1) },
    'console_connection_states/open': { uid: 'ana', expiresAt: new Date(NOW + 1000) },
  });
  await runRetention({ db, secrets: makeFakeSecrets(), now: () => NOW, log: QUIET });
  assert.deepEqual(db.paths('console_connection_states/'), ['console_connection_states/open']);
});

test('a spam delete removes the stored tokens, and an approved request keeps them', async () => {
  const secrets = makeFakeSecrets({ [TOKEN_ID]: 'sk_test_stored' });
  const approved = seeded({ 'applications/a1': application({ status: 'approved' }) });
  await assert.rejects(deleteSpamApplication(deps(approved, { secrets }), { body: { appId: 'a1', confirm: true }, user: ops }), { code: 'cannot-delete' });
  assert.equal(secrets.store.size, 1);
  const db = seeded();
  await deleteSpamApplication(deps(db, { secrets }), { body: { appId: 'a1', confirm: true }, user: ops });
  assert.equal(secrets.store.size, 0);
});
