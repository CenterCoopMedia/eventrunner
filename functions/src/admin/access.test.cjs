'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createListAdminAccessHandler,
  createSetAdminAccessHandler,
  internals: { accountsOf, applyAccessChange, readEmail, ACCESS_TIERS },
} = require('./access.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-09-23T10:00:00.000Z');
const OPS = 'ops@example.org';
const SECOND_OPS = 'second@example.org';
const STAFF = 'desk@example.org';

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const auth = {
  async verifyIdToken(token) {
    const table = {
      ops: { uid: 'ops-1', email: OPS, email_verified: true },
      second: { uid: 'ops-2', email: SECOND_OPS, email_verified: true },
      staff: { uid: 'staff-1', email: STAFF, email_verified: true },
      stranger: { uid: 'x-1', email: 'x@example.org', email_verified: true },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

const req = (token, body = {}, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

/** A db seeded with one bootstrap document, and a getConfig that mirrors it. */
function world(bootstrap = { adminEmails: [OPS, SECOND_OPS], staffEmails: [STAFF], createdAt: 'seeded' }) {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const refreshes = [];
  const deps = {
    db,
    auth,
    getConfig: async () => ({ bootstrap: db.read('config', 'bootstrap') }),
    refreshConfig: async () => { refreshes.push(db.read('config', 'bootstrap')); },
    now: () => T0.getTime(),
    log: QUIET,
  };
  return { db, deps, refreshes };
}

const bootstrapOf = (db) => db.read('config', 'bootstrap');
const adminLogs = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));

// ---------------------------------------------------------------- pure parts

test('ACCESS_TIERS is the two admin tiers plus none', () => {
  assert.deepEqual([...ACCESS_TIERS], ['operator', 'staff', 'none']);
});

test('readEmail trims, lowercases, and refuses anything that is not an address', () => {
  assert.equal(readEmail('  Desk@Example.ORG '), 'desk@example.org');
  assert.equal(readEmail('not-an-address'), null);
  assert.equal(readEmail(''), null);
  assert.equal(readEmail(42), null);
  assert.equal(readEmail(`${'a'.repeat(250)}@example.org`), null);
});

test('accountsOf lists operators first, then staff, each sorted, and never an address twice', () => {
  assert.deepEqual(
    accountsOf({ adminEmails: ['Zed@Example.org', 'ops@example.org'], staffEmails: ['desk@example.org', 'ops@example.org', 'Amy@Example.org'] }),
    [
      { email: 'ops@example.org', tier: 'operator' },
      { email: 'zed@example.org', tier: 'operator' },
      { email: 'amy@example.org', tier: 'staff' },
      { email: 'desk@example.org', tier: 'staff' },
    ],
  );
  assert.deepEqual(accountsOf(null), []);
  assert.deepEqual(accountsOf({ adminEmails: 'ops@example.org' }), []);
});

// ------------------------------------------------------------- listAdminAccess

test('listAdminAccess: an operator reads every account with its tier, and their own address', async () => {
  const { deps } = world();
  const res = makeRes();
  await createListAdminAccessHandler(deps)(req('ops'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    accounts: [
      { email: OPS, tier: 'operator' },
      { email: SECOND_OPS, tier: 'operator' },
      { email: STAFF, tier: 'staff' },
    ],
    callerEmail: OPS,
  });
});

test('listAdminAccess: staff, strangers, the signed-out, and GET are refused', async () => {
  const { deps } = world();
  for (const [token, status] of [['staff', 403], ['stranger', 403], [null, 401]]) {
    const res = makeRes();
    await createListAdminAccessHandler(deps)(req(token), res);
    assert.equal(res.statusCode, status, `${token} → ${status}`);
  }
  const wrongMethod = makeRes();
  await createListAdminAccessHandler(deps)(req('ops', {}, 'GET'), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

// -------------------------------------------------------------- setAdminAccess

test('setAdminAccess: grants staff to a new address, lowercased, records it, and refreshes the cache', async () => {
  const { db, deps, refreshes } = world();
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: '  New.Desk@Example.ORG ', tier: 'staff' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, email: 'new.desk@example.org', tier: 'staff', previousTier: null, changed: true,
  });
  assert.deepEqual(bootstrapOf(db).staffEmails, [STAFF, 'new.desk@example.org']);
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS, SECOND_OPS]);
  // Other fields on the document survive the merge.
  assert.equal(bootstrapOf(db).createdAt, 'seeded');

  const logs = adminLogs(db);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    action: 'setAdminAccess',
    docPath: 'config/bootstrap',
    uid: 'ops-1',
    email: OPS,
    at: T0,
    details: { email: 'new.desk@example.org', tier: 'staff', previousTier: null },
  });
  assert.equal(refreshes.length, 1);
});

test('setAdminAccess: promoting staff to operator moves the address between the lists', async () => {
  const { db, deps } = world();
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: STAFF, tier: 'operator' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.previousTier, 'staff');
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS, SECOND_OPS, STAFF]);
  assert.deepEqual(bootstrapOf(db).staffEmails, []);
  assert.deepEqual(adminLogs(db)[0].details, { email: STAFF, tier: 'operator', previousTier: 'staff' });
});

test('setAdminAccess: demoting an operator to staff, when another operator remains', async () => {
  const { db, deps } = world();
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: SECOND_OPS, tier: 'staff' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS]);
  assert.deepEqual(bootstrapOf(db).staffEmails, [STAFF, SECOND_OPS]);
});

test('setAdminAccess: none removes the address from both lists and records the revocation', async () => {
  const { db, deps } = world();
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: STAFF, tier: 'none' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, email: STAFF, tier: null, previousTier: 'staff', changed: true });
  assert.deepEqual(bootstrapOf(db).staffEmails, []);
  assert.deepEqual(adminLogs(db)[0].details, { email: STAFF, tier: null, previousTier: 'staff' });
});

test('setAdminAccess: an operator may demote or remove THEMSELVES while another operator remains', async () => {
  const { db, deps } = world();
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: OPS, tier: 'none' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).adminEmails, [SECOND_OPS]);
});

test('setAdminAccess: refuses to remove or demote the last operator — the caller’s own grant included', async () => {
  for (const [token, target, tier] of [
    ['ops', OPS, 'none'],
    ['ops', OPS, 'staff'],
    ['second', OPS, 'none'],
  ]) {
    const { db, deps, refreshes } = world({ adminEmails: [OPS], staffEmails: [STAFF, SECOND_OPS] });
    // `second` is staff here, so only the first two calls pass the gate;
    // the third pins that a staff caller never reaches the refusal at all.
    const res = makeRes();
    await createSetAdminAccessHandler(deps)(req(token, { email: target, tier }), res);
    if (token === 'second') {
      assert.equal(res.statusCode, 403);
    } else {
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error.code, 'last-operator');
      assert.match(res.body.error.message, /At least one operator must keep access/);
    }
    assert.deepEqual(bootstrapOf(db).adminEmails, [OPS]);
    assert.deepEqual(adminLogs(db), []);
    assert.equal(refreshes.length, 0);
  }
});

test('setAdminAccess: refuses removing the only other operator too — the rule is the last operator overall', async () => {
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [] });
  // Grant a second operator, then the first may leave; before that, nobody may.
  let res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: OPS, tier: 'none' }), res);
  assert.equal(res.statusCode, 409);
  res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: SECOND_OPS, tier: 'operator' }), res);
  assert.equal(res.statusCode, 200);
  res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: OPS, tier: 'none' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).adminEmails, [SECOND_OPS]);
});

test('setAdminAccess: a change that changes nothing is answered, not written and not logged', async () => {
  const { db, deps, refreshes } = world();
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: STAFF, tier: 'staff' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, email: STAFF, tier: 'staff', previousTier: 'staff', changed: false });
  assert.deepEqual(adminLogs(db), []);
  assert.equal(refreshes.length, 0);
  assert.equal(db.writes.length, 0);
});

test('setAdminAccess: a stored mis-normalized list is rewritten lowercase on the next change', async () => {
  const { db, deps } = world({ adminEmails: ['Ops@Example.org'], staffEmails: [' Desk@Example.org '] });
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: SECOND_OPS, tier: 'operator' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS, SECOND_OPS]);
  assert.deepEqual(bootstrapOf(db).staffEmails, [STAFF]);
});

test('setAdminAccess: a missing bootstrap document is treated as empty lists', async () => {
  const db = makeFakeDb({});
  const deps = {
    db, auth, log: QUIET, now: () => T0.getTime(),
    // The gate still has to admit the caller: a cached config from before
    // the document vanished is the only way that happens.
    getConfig: async () => ({ bootstrap: { adminEmails: [OPS] } }),
  };
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: SECOND_OPS, tier: 'operator' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('config', 'bootstrap'), { adminEmails: [SECOND_OPS], staffEmails: [] });
});

test('setAdminAccess: validation — a bad address, a bad tier, a missing body', async () => {
  const { db, deps } = world();
  for (const body of [
    { email: 'not-an-address', tier: 'staff' },
    { email: STAFF, tier: 'owner' },
    { email: STAFF },
    {},
    undefined,
  ]) {
    const res = makeRes();
    await createSetAdminAccessHandler(deps)(req('ops', body), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(db.writes.length, 0);
  assert.deepEqual(adminLogs(db), []);
});

test('setAdminAccess: staff, strangers, the signed-out, and GET are refused without a write', async () => {
  const { db, deps } = world();
  for (const [token, status] of [['staff', 403], ['stranger', 403], [null, 401]]) {
    const res = makeRes();
    await createSetAdminAccessHandler(deps)(req(token, { email: 'new@example.org', tier: 'operator' }), res);
    assert.equal(res.statusCode, status, `${token} → ${status}`);
  }
  const wrongMethod = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: 'new@example.org', tier: 'operator' }, 'GET'), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(db.writes.length, 0);
  assert.deepEqual(adminLogs(db), []);
});

test('setAdminAccess: a failed audit write or cache refresh never fails a committed change', async () => {
  const { db, deps } = world();
  const realCollection = db.collection.bind(db);
  db.collection = (name) => {
    if (name === 'admin_logs') throw new Error('logs outage');
    return realCollection(name);
  };
  deps.refreshConfig = async () => { throw new Error('cache outage'); };
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: 'new@example.org', tier: 'staff' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('config', 'bootstrap').staffEmails, [STAFF, 'new@example.org']);
});

test('applyAccessChange: a concurrent grant is not lost — the transaction reads the document it writes', async () => {
  const db = makeFakeDb({ 'config/bootstrap': { adminEmails: [OPS], staffEmails: [] } });
  db.beforeCommit = async () => {
    await db.collection('config').doc('bootstrap').set(
      { adminEmails: [OPS], staffEmails: ['racer@example.org'] },
      { merge: true },
    );
  };
  const result = await applyAccessChange({ db, email: STAFF, tier: 'staff' });
  assert.equal(result.ok, true);
  assert.deepEqual(db.read('config', 'bootstrap').staffEmails, ['racer@example.org', STAFF]);
});
