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

test('setAdminAccess: refuses demoting or removing the last operator until a second operator exists', async () => {
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

test('setAdminAccess: a write that only tidies the stored lists is still a change — answered, written, logged as a normalization, and refreshed', async () => {
  // Connector review: a mixed-case entry the rules newly match once it is
  // rewritten lowercase is an effective grant, so it cannot go unaudited.
  const { db, deps, refreshes } = world({ adminEmails: ['Ops@Example.org', OPS, SECOND_OPS], staffEmails: [' Desk@Example.org '] });
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: STAFF, tier: 'staff' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, email: STAFF, tier: 'staff', previousTier: 'staff', changed: true });
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS, SECOND_OPS]);
  assert.deepEqual(bootstrapOf(db).staffEmails, [STAFF]);
  const logs = adminLogs(db);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].details, { email: STAFF, tier: 'staff', previousTier: 'staff', normalized: true });
  assert.equal(refreshes.length, 1);
});

test('setAdminAccess: a stored mis-normalized list is rewritten lowercase on the next change', async () => {
  const { db, deps } = world({ adminEmails: ['Ops@Example.org'], staffEmails: [' Desk@Example.org '] });
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: SECOND_OPS, tier: 'operator' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS, SECOND_OPS]);
  assert.deepEqual(bootstrapOf(db).staffEmails, [STAFF]);
});

test('setAdminAccess: a missing bootstrap document admits nobody, even a caller the cached copy lists', async () => {
  // The gate reads the document live and fails closed; a stale cached copy
  // is not a way back in once the document is gone.
  const db = makeFakeDb({});
  const deps = {
    db, auth, log: QUIET, now: () => T0.getTime(),
    getConfig: async () => ({ bootstrap: { adminEmails: [OPS] } }),
  };
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req('ops', { email: SECOND_OPS, tier: 'operator' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(db.writes.length, 0);
});

test('applyAccessChange: an absent bootstrap document is written as fresh lists (the seed path, not the gate)', async () => {
  const db = makeFakeDb({});
  const result = await applyAccessChange({ db, email: SECOND_OPS, tier: 'operator' });
  assert.deepEqual(result, {
    ok: true, changed: true, tierChanged: true, expiryChanged: false, previousTier: null,
    previousExpiresAtMs: null, expiresAtMs: null,
  });
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

// ------------------------------------------------- expiring staff access (#331)
//
// T0 is the handler's clock (deps.now). An end time is an ISO 8601 string
// with an explicit offset, later than T0 and at most MAX_STAFF_ACCESS_DAYS
// after it. It is stored as `staffExpiry[address]`; the Admin SDK turns the
// Date into a Firestore Timestamp, and the fake keeps the Date.

const { requireAdmin } = require('../core/auth.cjs');
const { internals: { MAX_STAFF_ACCESS_DAYS } } = require('./access.cjs');

const DEMO = 'demo@example.org';
const HOUR = 3_600_000;
const inHours = (hours) => new Date(T0.getTime() + hours * HOUR);
const iso = (date) => date.toISOString();

const demoAuth = {
  async verifyIdToken(token) {
    if (token === 'demo') return { uid: 'demo-1', email: DEMO, email_verified: true };
    if (token === 'demo2') return { uid: 'demo-2', email: 'demo2@example.org', email_verified: true };
    return auth.verifyIdToken(token);
  },
};

async function grant(deps, body, token = 'ops') {
  const res = makeRes();
  await createSetAdminAccessHandler(deps)(req(token, body), res);
  return res;
}

async function list(deps, token = 'ops') {
  const res = makeRes();
  await createListAdminAccessHandler(deps)(req(token), res);
  return res;
}

test('MAX_STAFF_ACCESS_DAYS is 90', () => {
  assert.equal(MAX_STAFF_ACCESS_DAYS, 90);
});

test('setAdminAccess: grants staff access with an end time, stores it, answers it, and records it', async () => {
  const { db, deps, refreshes } = world();
  const ends = inHours(24);
  const res = await grant(deps, { email: 'Demo@Example.org', tier: 'staff', expiresAt: iso(ends) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    ok: true, email: DEMO, tier: 'staff', previousTier: null, changed: true,
    expiresAt: iso(ends), previousExpiresAt: null,
  });
  const stored = bootstrapOf(db);
  assert.deepEqual(stored.staffEmails, [STAFF, DEMO]);
  assert.deepEqual(stored.staffExpiry, { [DEMO]: ends });
  // Every other field on the document stays.
  assert.equal(stored.createdAt, 'seeded');
  assert.deepEqual(adminLogs(db)[0].details, {
    email: DEMO, tier: 'staff', previousTier: null, expiresAt: iso(ends), previousExpiresAt: null,
  });
  assert.equal(refreshes.length, 1);
});

test('setAdminAccess: an end time with a non-UTC offset is stored as the same instant', async () => {
  const { db, deps } = world();
  const res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: '2026-09-24T08:00:00-04:00' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.expiresAt, '2026-09-24T12:00:00.000Z');
  assert.equal(bootstrapOf(db).staffExpiry[DEMO].toISOString(), '2026-09-24T12:00:00.000Z');
});

test('setAdminAccess: a bad end time is refused before anything is written', async () => {
  const { db, deps } = world();
  const cases = [
    // Operator access never ends, so it cannot take an end time.
    [{ email: DEMO, tier: 'operator', expiresAt: iso(inHours(1)) }, /only staff access can end/],
    // Removing access takes none either.
    [{ email: STAFF, tier: 'none', expiresAt: iso(inHours(1)) }, /only staff access can end/],
    [{ email: DEMO, tier: 'staff', expiresAt: 'tomorrow' }, /expiresAt/],
    // No offset: the server would read it in its own zone, so it is refused.
    [{ email: DEMO, tier: 'staff', expiresAt: '2026-09-24T12:00' }, /expiresAt/],
    [{ email: DEMO, tier: 'staff', expiresAt: '2026-13-40T99:00:00Z' }, /expiresAt/],
    [{ email: DEMO, tier: 'staff', expiresAt: T0.getTime() + HOUR }, /expiresAt/],
    [{ email: DEMO, tier: 'staff', expiresAt: { seconds: 1 } }, /expiresAt/],
    // Now, or earlier, is not an end time.
    [{ email: DEMO, tier: 'staff', expiresAt: iso(T0) }, /must be later than now/],
    [{ email: DEMO, tier: 'staff', expiresAt: iso(inHours(-1)) }, /must be later than now/],
    // At most 90 days.
    [{ email: DEMO, tier: 'staff', expiresAt: iso(new Date(T0.getTime() + (MAX_STAFF_ACCESS_DAYS * 24 * HOUR) + 1000)) }, /90 days/],
  ];
  for (const [body, message] of cases) {
    const res = await grant(deps, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.match(res.body.error.message, message, JSON.stringify(body));
  }
  assert.equal(db.writes.length, 0);
  assert.deepEqual(adminLogs(db), []);
});

test('setAdminAccess: exactly 90 days is allowed, and null or an absent end time is a permanent grant', async () => {
  const { db, deps } = world();
  const limit = new Date(T0.getTime() + MAX_STAFF_ACCESS_DAYS * 24 * HOUR);
  let res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(limit) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  res = await grant(deps, { email: 'perm@example.org', tier: 'staff', expiresAt: null });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, email: 'perm@example.org', tier: 'staff', previousTier: null, changed: true });
  assert.deepEqual(bootstrapOf(db).staffExpiry, { [DEMO]: limit });
});

test('setAdminAccess: changing the end time of a staff grant is a change, recorded with both times', async () => {
  const first = inHours(2);
  const later = inHours(48);
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: first } });
  const res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(later) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, email: DEMO, tier: 'staff', previousTier: 'staff', changed: true,
    expiresAt: iso(later), previousExpiresAt: iso(first),
  });
  assert.deepEqual(bootstrapOf(db).staffExpiry, { [DEMO]: later });
  // Not a normalization: the end time moved.
  assert.deepEqual(adminLogs(db)[0].details, {
    email: DEMO, tier: 'staff', previousTier: 'staff', expiresAt: iso(later), previousExpiresAt: iso(first),
  });
});

test('setAdminAccess: the same end time again changes nothing and writes nothing', async () => {
  const ends = inHours(2);
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: ends } });
  const res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(ends) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  assert.equal(db.writes.length, 0);
  assert.deepEqual(adminLogs(db), []);
});

test('setAdminAccess: a staff grant with no end time makes a temporary grant permanent, and says so in the log', async () => {
  const ends = inHours(2);
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: ends } });
  const res = await grant(deps, { email: DEMO, tier: 'staff' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, email: DEMO, tier: 'staff', previousTier: 'staff', changed: true,
    expiresAt: null, previousExpiresAt: iso(ends),
  });
  assert.equal(bootstrapOf(db).staffExpiry, undefined);
  assert.deepEqual(adminLogs(db)[0].details, {
    email: DEMO, tier: 'staff', previousTier: 'staff', expiresAt: null, previousExpiresAt: iso(ends),
  });
});

test('setAdminAccess: an ended grant can be renewed with a new end time', async () => {
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: inHours(-1) } });
  const res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(inHours(3)) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, true);
  assert.deepEqual(bootstrapOf(db).staffExpiry, { [DEMO]: inHours(3) });
});

test('setAdminAccess: promoting a temporary staff account to operator removes its end time; operators never expire', async () => {
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO, STAFF], staffExpiry: { [DEMO]: inHours(2), [STAFF]: inHours(5) } });
  const res = await grant(deps, { email: DEMO, tier: 'operator' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, email: DEMO, tier: 'operator', previousTier: 'staff', changed: true,
    expiresAt: null, previousExpiresAt: iso(inHours(2)),
  });
  assert.deepEqual(bootstrapOf(db).adminEmails, [OPS, DEMO]);
  // The other temporary grant keeps its own end time.
  assert.deepEqual(bootstrapOf(db).staffExpiry, { [STAFF]: inHours(5) });
});

test('setAdminAccess: removing a temporary grant removes its end time too', async () => {
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: inHours(2) } });
  const res = await grant(deps, { email: DEMO, tier: 'none' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).staffEmails, []);
  assert.equal(bootstrapOf(db).staffExpiry, undefined);
  assert.deepEqual(adminLogs(db)[0].details, {
    email: DEMO, tier: null, previousTier: 'staff', expiresAt: null, previousExpiresAt: iso(inHours(2)),
  });
});

test('setAdminAccess: the last operator cannot be made temporary — demoting them to staff with an end time is refused', async () => {
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [] });
  const res = await grant(deps, { email: OPS, tier: 'staff', expiresAt: iso(inHours(1)) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'last-operator');
  assert.deepEqual(bootstrapOf(db), { adminEmails: [OPS], staffEmails: [] });
});

test('setAdminAccess: a change to one account never turns another temporary grant permanent, a malformed one included', async () => {
  // An end time the rules cannot read refuses that grant. Dropping it on a
  // rewrite would make the grant permanent, so it is carried as it is.
  const { db, deps } = world({
    adminEmails: [OPS],
    staffEmails: [STAFF, 'bad@example.org', 'later@example.org'],
    staffExpiry: { 'bad@example.org': 'next week', 'later@example.org': inHours(9), 'gone@example.org': inHours(1) },
  });
  const res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(inHours(1)) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).staffExpiry, {
    'bad@example.org': 'next week',
    'later@example.org': inHours(9),
    // An end time for an address on no list does nothing, so it goes.
    [DEMO]: inHours(1),
  });
});

test('setAdminAccess: a staffExpiry field that is not a map keeps every other staff grant refused after a write', async () => {
  // While the field cannot be read, the rules and the server refuse every
  // staff grant. A write marks each other staff address with an end time
  // that cannot be read (null), so they stay refused until an operator
  // grants them again, and the operator can still repair the list here.
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [STAFF, 'two@example.org'], staffExpiry: 'broken' });
  const res = await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(inHours(1)) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bootstrapOf(db).staffExpiry, { [STAFF]: null, 'two@example.org': null, [DEMO]: inHours(1) });
  const { resolveAdminTier } = require('../core/auth.cjs');
  assert.equal(resolveAdminTier(bootstrapOf(db), STAFF, T0.getTime()), null);
  assert.equal(resolveAdminTier(bootstrapOf(db), DEMO, T0.getTime()), 'staff');
});

test('listAdminAccess: shows each temporary grant with its end time and whether it still works', async () => {
  const { deps } = world({
    adminEmails: [OPS],
    staffEmails: [STAFF, DEMO, 'ended@example.org', 'bad@example.org'],
    staffExpiry: { [DEMO]: inHours(2), 'ended@example.org': inHours(-2), 'bad@example.org': 'soon' },
  });
  const res = await list(deps);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.accounts, [
    { email: OPS, tier: 'operator' },
    { email: 'bad@example.org', tier: 'staff', expiresAt: null, expiryState: 'invalid' },
    { email: DEMO, tier: 'staff', expiresAt: iso(inHours(2)), expiryState: 'active' },
    { email: STAFF, tier: 'staff' },
    { email: 'ended@example.org', tier: 'staff', expiresAt: iso(inHours(-2)), expiryState: 'expired' },
  ]);
});

test('listAdminAccess: a grant is shown as ended at its end time exactly, by the server clock', async () => {
  const { deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: T0 } });
  const res = await list(deps);
  assert.equal(res.body.accounts[1].expiryState, 'expired');
  deps.now = () => T0.getTime() - 1;
  const before = await list(deps);
  assert.equal(before.body.accounts[1].expiryState, 'active');
});

test('two temporary grants end on their own times; an ended one is refused while the other still works', async () => {
  const { deps } = world({ adminEmails: [OPS], staffEmails: [], createdAt: 'seeded' });
  deps.auth = demoAuth;
  assert.equal((await grant(deps, { email: DEMO, tier: 'staff', expiresAt: iso(inHours(1)) })).statusCode, 200);
  assert.equal((await grant(deps, { email: 'demo2@example.org', tier: 'staff', expiresAt: iso(inHours(3)) })).statusCode, 200);
  const gate = (token, nowMs) => requireAdmin(
    { auth: demoAuth, db: deps.db, getConfig: deps.getConfig, now: () => nowMs },
    req(token),
    { tier: 'staff' },
  );
  const oneHour = inHours(1).getTime();
  assert.equal((await gate('demo', oneHour - 1)).ok, true);
  assert.equal((await gate('demo', oneHour)).ok, false);
  assert.equal((await gate('demo2', oneHour)).ok, true);
  assert.equal((await gate('demo2', inHours(3).getTime())).ok, false);
  // Revoking the second one before its end stops it at once as well.
  assert.equal((await grant(deps, { email: 'demo2@example.org', tier: 'none' })).statusCode, 200);
  assert.equal((await gate('demo2', oneHour)).ok, false);
});

// ------------------------------------------- the end-time sweep (#331, PR #541)
//
// endExpiredStaffAccess runs every minute. In one transaction on
// config/bootstrap it takes each staff address whose end time is at or
// before now off staffEmails, drops its staffExpiry key, and writes one
// admin_logs row per address, by the "system" actor. The request-time
// checks already refuse an ended grant; the sweep changes the document so
// a connection the rules admitted before the end is checked again.

const { endExpiredStaffAccess } = require('./access.cjs');

const sweepLogs = (db) => adminLogs(db).filter((row) => row.action === 'endExpiredStaffAccess');

test('endExpiredStaffAccess: removes a grant at its end time exactly, not a millisecond before', async () => {
  const ends = inHours(1);
  const seed = { adminEmails: [OPS], staffEmails: [STAFF, DEMO], staffExpiry: { [DEMO]: ends }, createdAt: 'seeded' };
  const early = makeFakeDb({ 'config/bootstrap': seed });
  assert.deepEqual(await endExpiredStaffAccess({ db: early, now: () => ends.getTime() - 1, log: QUIET }), { removed: [] });
  assert.equal(early.writes.length, 0);

  const db = makeFakeDb({ 'config/bootstrap': seed });
  assert.deepEqual(await endExpiredStaffAccess({ db, now: () => ends.getTime(), log: QUIET }), { removed: [DEMO] });
  assert.deepEqual(bootstrapOf(db), { adminEmails: [OPS], staffEmails: [STAFF], createdAt: 'seeded' });
  assert.deepEqual(sweepLogs(db), [{
    action: 'endExpiredStaffAccess',
    docPath: 'config/bootstrap',
    uid: 'system',
    email: null,
    at: ends,
    details: { email: DEMO, expiresAt: iso(ends) },
  }]);
});

test('endExpiredStaffAccess: keeps grants that have not ended, permanent grants, and every operator', async () => {
  const db = makeFakeDb({
    'config/bootstrap': {
      // An operator with a stale staff entry and an ended key: never touched.
      adminEmails: [OPS, SECOND_OPS],
      staffEmails: [STAFF, DEMO, 'later@example.org', SECOND_OPS],
      staffExpiry: { [DEMO]: inHours(-1), 'later@example.org': inHours(5), [SECOND_OPS]: inHours(-3) },
    },
  });
  const result = await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET });
  assert.deepEqual(result, { removed: [DEMO] });
  const stored = bootstrapOf(db);
  assert.deepEqual(stored.adminEmails, [OPS, SECOND_OPS]);
  assert.deepEqual(stored.staffEmails, [STAFF, 'later@example.org', SECOND_OPS]);
  assert.deepEqual(stored.staffExpiry, { 'later@example.org': inHours(5), [SECOND_OPS]: inHours(-3) });
});

test('endExpiredStaffAccess: leaves malformed end times alone, still refused, and a broken map untouched', async () => {
  const malformed = { adminEmails: [OPS], staffEmails: [DEMO, 'nul@example.org'], staffExpiry: { [DEMO]: 'last week', 'nul@example.org': null } };
  const db = makeFakeDb({ 'config/bootstrap': malformed });
  assert.deepEqual(await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET }), { removed: [] });
  assert.equal(db.writes.length, 0);
  const { resolveAdminTier } = require('../core/auth.cjs');
  assert.equal(resolveAdminTier(bootstrapOf(db), DEMO, T0.getTime()), null);

  const broken = makeFakeDb({ 'config/bootstrap': { adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: 'broken' } });
  assert.deepEqual(await endExpiredStaffAccess({ db: broken, now: () => T0.getTime(), log: QUIET }), { removed: [] });
  assert.equal(broken.writes.length, 0);
});

test('endExpiredStaffAccess: does nothing when nothing has ended, or there is no document', async () => {
  const db = makeFakeDb({ 'config/bootstrap': { adminEmails: [OPS], staffEmails: [STAFF] } });
  assert.deepEqual(await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET }), { removed: [] });
  assert.equal(db.writes.length, 0);
  const empty = makeFakeDb({});
  assert.deepEqual(await endExpiredStaffAccess({ db: empty, now: () => T0.getTime(), log: QUIET }), { removed: [] });
  assert.equal(empty.writes.length, 0);
});

test('endExpiredStaffAccess: removes every ended grant in one write, one audit row each, and a second run does nothing', async () => {
  const db = makeFakeDb({
    'config/bootstrap': {
      adminEmails: [OPS],
      staffEmails: [DEMO, 'demo2@example.org', STAFF],
      staffExpiry: { [DEMO]: inHours(-2), 'demo2@example.org': inHours(-1) },
    },
  });
  const before = db.writes.length;
  const first = await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET });
  assert.deepEqual(first, { removed: [DEMO, 'demo2@example.org'] });
  assert.equal(db.writes.slice(before).filter((w) => w.path === 'config/bootstrap').length, 1);
  assert.deepEqual(bootstrapOf(db), { adminEmails: [OPS], staffEmails: [STAFF] });
  assert.equal(sweepLogs(db).length, 2);
  const again = await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET });
  assert.deepEqual(again, { removed: [] });
  assert.equal(sweepLogs(db).length, 2);
});

test('endExpiredStaffAccess: two runs at once remove the grant once and write one audit row', async () => {
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: [OPS], staffEmails: [DEMO, STAFF], staffExpiry: { [DEMO]: inHours(-1) } },
  });
  // The second run lands while the first is about to commit: the first
  // then sees a changed document, retries, and finds nothing to do.
  let raced = false;
  let inner = null;
  db.beforeCommit = async () => {
    raced = true;
    inner = await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET });
  };
  const results = await Promise.all([
    endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET }),
    endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET }),
  ]);
  assert.ok(raced);
  assert.deepEqual(bootstrapOf(db), { adminEmails: [OPS], staffEmails: [STAFF] });
  assert.equal(sweepLogs(db).length, 1);
  // Three runs in all; exactly one of them removed the address.
  assert.deepEqual([...results, inner].flatMap((r) => r.removed), [DEMO]);
});

test('endExpiredStaffAccess: a renewal that lands first is not undone, and nothing is brought back', async () => {
  const db = makeFakeDb({
    'config/bootstrap': { adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: inHours(-1) } },
  });
  // The operator renews while the sweep is about to commit.
  db.beforeCommit = async () => {
    db.beforeCommit = null;
    await db.collection('config').doc('bootstrap').set({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: inHours(4) } });
  };
  const result = await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET });
  assert.deepEqual(result, { removed: [] });
  assert.deepEqual(bootstrapOf(db).staffExpiry, { [DEMO]: inHours(4) });
  assert.deepEqual(bootstrapOf(db).staffEmails, [DEMO]);
  assert.equal(sweepLogs(db).length, 0);

  // And a sweep never adds an address or a key that is not there.
  const removed = makeFakeDb({ 'config/bootstrap': { adminEmails: [OPS], staffEmails: [], staffExpiry: { [DEMO]: inHours(-1) } } });
  await endExpiredStaffAccess({ db: removed, now: () => T0.getTime(), log: QUIET });
  assert.deepEqual(bootstrapOf(removed).staffEmails, []);
});

test('endExpiredStaffAccess: an address the sweep removed leaves the Access list', async () => {
  const { db, deps } = world({ adminEmails: [OPS], staffEmails: [DEMO], staffExpiry: { [DEMO]: inHours(-1) } });
  assert.equal((await list(deps)).body.accounts[1].expiryState, 'expired');
  await endExpiredStaffAccess({ db, now: () => T0.getTime(), log: QUIET });
  assert.deepEqual((await list(deps)).body.accounts, [{ email: OPS, tier: 'operator' }]);
});
