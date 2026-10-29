'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { getEventConfig, internals: { resetConfigCacheForTest: resetCache } } = require('../core/config.cjs');
const { applyTicketClaimToUser } = require('./registration.cjs');
const { recomputeEntitlement, createOnApprovalPolicyWritten } = require('./entitlement.cjs');

function seed(enabled = true, status = 'pending', source = null) {
  return makeFakeDb({
    'config/features': { autoApproveTicketHolders: enabled },
    'users/ada': { registrationStatus: status, approvalSource: source },
    'tickets/one': { status: 'valid', claimedByUid: 'ada' },
  });
}

for (const [name, grant] of [
  ['claim', applyTicketClaimToUser],
  ['recomputation', recomputeEntitlement],
]) {
  test(`${name} ignores a warm true cache after policy is disabled`, async () => {
    const db = seed();
    resetCache();
    const getConfig = () => getEventConfig({ db, now: () => 100 });
    assert.equal((await getConfig()).features.autoApproveTicketHolders, true);
    await db.collection('config').doc('features').set({ autoApproveTicketHolders: false });
    assert.equal((await getConfig()).features.autoApproveTicketHolders, true);
    await grant({ db, uid: 'ada', getConfig });
    assert.equal(db.read('users', 'ada').registrationStatus, 'ticketed');
    assert.equal(db.read('users', 'ada').approvalSource, null);
    resetCache();
  });

  test(`${name} retries when policy changes between read and commit`, async () => {
    const db = seed();
    db.beforeCommit = async () => {
      await db.collection('config').doc('features').set({ autoApproveTicketHolders: false });
    };
    await grant({ db, uid: 'ada' });
    assert.equal(db.read('users', 'ada').registrationStatus, 'ticketed');
    assert.equal(db.read('users', 'ada').approvalSource, null);
  });

  test(`${name} requires an explicit true live policy`, async () => {
    for (const value of [false, 'true', null, undefined]) {
      const db = seed();
      if (value === undefined) await db.collection('config').doc('features').delete();
      else await db.collection('config').doc('features').set({ autoApproveTicketHolders: value });
      await grant({ db, uid: 'ada' });
      assert.equal(db.read('users', 'ada').registrationStatus, 'ticketed');
    }
  });

  test(`${name} propagates policy read failures without granting approval`, async () => {
    const db = seed();
    const runTransaction = db.runTransaction.bind(db);
    db.runTransaction = (fn) => runTransaction((tx) => {
      const get = tx.get.bind(tx);
      tx.get = (ref) => {
        if (ref.path === 'config/features') throw new Error('policy unavailable');
        return get(ref);
      };
      return fn(tx);
    });
    await assert.rejects(grant({ db, uid: 'ada' }), /policy unavailable/);
    assert.equal(db.read('users', 'ada').registrationStatus, 'pending');
  });
}

test('disabled policy removes ticket approval without revoking a valid ticket', async () => {
  const db = seed(false, 'approved', 'ticket');
  await recomputeEntitlement({ db, uid: 'ada' });
  assert.equal(db.read('users', 'ada').registrationStatus, 'ticketed');
  assert.equal(db.read('users', 'ada').approvalSource, null);
  assert.equal(db.read('tickets', 'one').status, 'valid');
});

test('disabled policy removes approval while an undecided ticket stays held for review', async () => {
  const db = seed(false, 'approved', 'ticket');
  await db.collection('tickets').doc('one').set({ status: 'pending_info' }, { merge: true });
  await recomputeEntitlement({ db, uid: 'ada' });
  assert.equal(db.read('users', 'ada').registrationStatus, 'ticketed');
  assert.equal(db.read('users', 'ada').approvalSource, null);
});

test('the deployed policy trigger watches config/features and retries failed sweeps', () => {
  const { handlers } = require('./entitlement.cjs');
  const endpoint = handlers.onApprovalPolicyWritten.__endpoint;
  assert.equal(endpoint.eventTrigger.eventFilters.document, 'config/features');
  assert.equal(endpoint.eventTrigger.retry, true);
});

test('policy sweep covers multiple pages and preserves admin grants and revocations', async () => {
  const db = seed(false, 'approved', 'admin');
  for (let i = 0; i < 205; i++) {
    const uid = `user-${String(i).padStart(3, '0')}`;
    await db.collection('users').doc(uid).set({ registrationStatus: 'approved', approvalSource: 'ticket' });
    await db.collection('tickets').doc(uid).set({ status: 'valid', claimedByUid: uid });
  }
  await db.collection('users').doc('revoked').set({ registrationStatus: 'revoked', approvalSource: 'ticket' });
  await db.collection('tickets').doc('revoked').set({ status: 'valid', claimedByUid: 'revoked' });
  const sweep = createOnApprovalPolicyWritten({ db });
  await sweep({ after: { autoApproveTicketHolders: false } });
  for (const uid of db.ids('users').filter((id) => id.startsWith('user-'))) {
    assert.equal(db.read('users', uid).registrationStatus, 'ticketed');
    assert.equal(db.read('users', uid).approvalSource, null);
  }
  assert.equal(db.read('users', 'ada').approvalSource, 'admin');
  assert.equal(db.read('users', 'ada').registrationStatus, 'approved');
  assert.equal(db.read('users', 'revoked').registrationStatus, 'revoked');
  const writes = db.writes.length;
  await sweep({ after: null });
  assert.equal(db.writes.length, writes);
});

test('a delayed disable event reads current policy and preserves re-enabled approval', async () => {
  const db = seed(true, 'approved', 'ticket');
  await createOnApprovalPolicyWritten({ db })({ after: { autoApproveTicketHolders: false } });
  assert.equal(db.read('users', 'ada').registrationStatus, 'approved');
  assert.equal(db.read('users', 'ada').approvalSource, 'ticket');
});

test('an admin approval racing with the sweep survives its transaction retry', async () => {
  const db = seed(false, 'approved', 'ticket');
  db.beforeCommit = async () => {
    await db.collection('users').doc('ada').set({ approvalSource: 'admin' }, { merge: true });
  };
  await createOnApprovalPolicyWritten({ db })({ after: { autoApproveTicketHolders: false } });
  assert.equal(db.read('users', 'ada').registrationStatus, 'approved');
  assert.equal(db.read('users', 'ada').approvalSource, 'admin');
});

test('a failed sweep can be retried without losing remaining ticket approvals', async () => {
  const db = seed(false, 'approved', 'ticket');
  const runTransaction = db.runTransaction.bind(db);
  db.runTransaction = async () => { throw new Error('temporarily unavailable'); };
  const sweep = createOnApprovalPolicyWritten({ db });
  await assert.rejects(sweep({ after: {} }), /temporarily unavailable/);
  assert.equal(db.read('users', 'ada').registrationStatus, 'approved');
  db.runTransaction = runTransaction;
  await sweep({ after: {} });
  assert.equal(db.read('users', 'ada').registrationStatus, 'ticketed');
});
