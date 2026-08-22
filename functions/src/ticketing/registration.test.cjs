'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createTicketingVerifyOrderHandler,
  createCreateUserFromTicketHandler,
  claimTicket,
  claimTicketsForUser,
} = require('./registration.cjs');
const { createFakeTicketingProvider, fakeTicket } = require('./ticketingFake.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-20T10:00:00.000Z');
const ADMIN = 'admin@example.com';

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

/** Token strings map to identities: 'admin', 'ada', 'ada-unverified', 'bob'. */
const auth = {
  async verifyIdToken(token) {
    const table = {
      admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
      ada: { uid: 'uid-ada', email: 'attendee@example.com', email_verified: true },
      'ada-unverified': { uid: 'uid-ada', email: 'attendee@example.com', email_verified: false },
      bob: { uid: 'uid-bob', email: 'bob@example.com', email_verified: true },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

const getConfig = async () => ({
  bootstrap: { adminEmails: [ADMIN] },
  features: {},
});

function seededDb(extra = {}) {
  return makeFakeDb({
    'users/uid-ada': { uid: 'uid-ada', registrationStatus: 'pending', approvalSource: null },
    'users/uid-bob': { uid: 'uid-bob', registrationStatus: 'pending', approvalSource: null },
    ...extra,
  });
}

function verifyHandler({ db, provider, config } = {}) {
  return createTicketingVerifyOrderHandler({
    db,
    provider: provider || createFakeTicketingProvider({
      orders: { 'ord-1': { tickets: [fakeTicket()] } },
    }),
    auth,
    getConfig: config || getConfig,
    now: () => T0,
    log: QUIET,
  });
}

const claimReq = (token, body = { orderNumber: 'ord-1' }) => ({
  method: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

test('a self-service claim writes the ticket, claims it, and advances the account', async () => {
  const db = seededDb();
  const res = makeRes();

  await verifyHandler({ db })(claimReq('ada'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, claimed: 1, registrationStatus: 'ticketed' });
  const ticket = db.read('tickets', 'tkt-1');
  assert.equal(ticket.claimedByUid, 'uid-ada');
  assert.deepEqual(ticket.claimedAt, T0);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'ticketed');
});

test('autoApproveTicketHolders approves with approvalSource ticket, never admin (§3.4)', async () => {
  const db = seededDb();
  const res = makeRes();

  await verifyHandler({
    db,
    config: async () => ({ bootstrap: { adminEmails: [ADMIN] }, features: { autoApproveTicketHolders: true } }),
  })(claimReq('ada'), res);

  const user = db.read('users', 'uid-ada');
  assert.equal(user.registrationStatus, 'approved');
  assert.equal(user.approvalSource, 'ticket');
});

test('every failure answers the SAME 404 — no order or address oracle', async () => {
  const db = seededDb();
  const provider = createFakeTicketingProvider({
    orders: {
      'ord-1': { tickets: [fakeTicket()] },
      'ord-other-event': { externalEventId: 'evt-other', tickets: [fakeTicket({ externalId: 'tkt-x' })] },
    },
  });
  const handler = verifyHandler({ db, provider });
  const bodies = [];

  for (const orderNumber of ['ord-1', 'ord-nope', 'ord-other-event']) {
    const res = makeRes();
    // 'bob' owns none of these tickets; ord-nope does not exist; the third
    // belongs to another event.
    await handler(claimReq('bob', { orderNumber }), res);
    assert.equal(res.statusCode, 404);
    bodies.push(JSON.stringify(res.body));
  }
  assert.equal(new Set(bodies).size, 1);
  assert.equal(db.read('users', 'uid-bob').registrationStatus, 'pending');
});

test('an already-claimed ticket answers the same 404 and does not move the claim', async () => {
  const db = seededDb({
    'tickets/tkt-1': { ...fakeTicket(), claimedByUid: 'uid-ada', claimedAt: T0 },
  });
  const res = makeRes();

  await verifyHandler({ db })(claimReq('ada'), res);

  assert.equal(res.statusCode, 404);
  assert.equal(db.read('tickets', 'tkt-1').claimedByUid, 'uid-ada');
});

test('an unverified email cannot claim a ticket', async () => {
  const db = seededDb();
  const res = makeRes();

  await verifyHandler({ db })(claimReq('ada-unverified'), res);

  assert.equal(res.statusCode, 403);
  assert.equal(db.read('tickets', 'tkt-1'), undefined);
});

test('an anonymous claim is 401, a bad request is 400, a GET is 405', async () => {
  const db = seededDb();
  const handler = verifyHandler({ db });

  const anon = makeRes();
  await handler(claimReq(null), anon);
  assert.equal(anon.statusCode, 401);

  const empty = makeRes();
  await handler(claimReq('ada', { orderNumber: '   ' }), empty);
  assert.equal(empty.statusCode, 400);

  const long = makeRes();
  await handler(claimReq('ada', { orderNumber: 'x'.repeat(500) }), long);
  assert.equal(long.statusCode, 400);

  const wrongMethod = makeRes();
  await handler({ method: 'GET', headers: {} }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test('a provider outage during a claim is a 502, not a lost claim', async () => {
  const provider = createFakeTicketingProvider({ withLookup: false });
  provider.fetchOrder = async () => { throw new Error('upstream down'); };
  const res = makeRes();

  await verifyHandler({ db: seededDb(), provider })(claimReq('ada'), res);

  assert.equal(res.statusCode, 502);
});

test('lookupByOrderNumber is preferred when the provider offers it', async () => {
  const provider = createFakeTicketingProvider({ orders: { 'ord-1': { tickets: [fakeTicket()] } } });
  await verifyHandler({ db: seededDb(), provider })(claimReq('ada'), makeRes());
  assert.equal(provider.calls.lookupByOrderNumber.length, 1);
  assert.equal(provider.calls.fetchOrder.length, 0);
});

test('claimTicket refuses a ticket held by someone else or addressed elsewhere', async () => {
  const db = makeFakeDb({
    'tickets/held': { ...fakeTicket({ externalId: 'held' }), claimedByUid: 'uid-bob' },
    'tickets/theirs': fakeTicket({ externalId: 'theirs', email: 'someone@else.test' }),
  });

  assert.deepEqual(
    await claimTicket({ db, externalId: 'held', uid: 'uid-ada', email: 'attendee@example.com' }),
    { claimed: false, reason: 'claimed_by_other' },
  );
  assert.deepEqual(
    await claimTicket({ db, externalId: 'theirs', uid: 'uid-ada', email: 'attendee@example.com' }),
    { claimed: false, reason: 'email_mismatch' },
  );
  assert.deepEqual(
    await claimTicket({ db, externalId: 'gone', uid: 'uid-ada' }),
    { claimed: false, reason: 'not_found' },
  );
  assert.deepEqual(
    await claimTicket({ db, externalId: '../users/uid-ada', uid: 'uid-ada' }),
    { claimed: false, reason: 'invalid_id' },
  );
});

test('two concurrent claims on one ticket cannot both win', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': fakeTicket() });
  // Bob's claim commits between Ada's read and her commit; the read set
  // makes Ada's transaction re-run and see the ticket taken.
  db.beforeCommit = async () => {
    await claimTicket({ db, externalId: 'tkt-1', uid: 'uid-bob', email: 'attendee@example.com' });
  };
  const ada = await claimTicket({ db, externalId: 'tkt-1', uid: 'uid-ada', email: 'attendee@example.com' });

  assert.deepEqual(ada, { claimed: false, reason: 'claimed_by_other' });
  assert.equal(db.read('tickets', 'tkt-1').claimedByUid, 'uid-bob');
});

test('the account state is advanced once for a multi-ticket claim', async () => {
  const db = seededDb({
    'tickets/a': fakeTicket({ externalId: 'a' }),
    'tickets/b': fakeTicket({ externalId: 'b' }),
  });
  const result = await claimTicketsForUser({
    db, uid: 'uid-ada', email: 'attendee@example.com', externalIds: ['a', 'b', 'missing'], getConfig, now: () => T0,
  });

  assert.deepEqual(result.claimed, ['a', 'b']);
  assert.deepEqual(result.refused, [{ externalId: 'missing', reason: 'not_found' }]);
  assert.equal(result.registrationStatus, 'ticketed');
});

test('a claim never rewrites an approved account backwards', async () => {
  const db = makeFakeDb({
    'users/uid-ada': { uid: 'uid-ada', registrationStatus: 'approved', approvalSource: 'admin' },
    'tickets/tkt-1': fakeTicket(),
  });
  const result = await claimTicketsForUser({
    db, uid: 'uid-ada', email: 'attendee@example.com', externalIds: ['tkt-1'], getConfig, now: () => T0,
  });

  assert.deepEqual(result.claimed, ['tkt-1']);
  assert.equal(result.registrationStatus, 'approved');
  assert.equal(db.read('users', 'uid-ada').approvalSource, 'admin');
});

// --- createUserFromTicket ---------------------------------------------

function fakeAuth(existing = {}) {
  const users = new Map(Object.entries(existing));
  let next = 1;
  return {
    created: [],
    async verifyIdToken(token) { return auth.verifyIdToken(token); },
    async getUserByEmail(email) {
      if (!users.has(email)) throw new Error('auth/user-not-found');
      return users.get(email);
    },
    async createUser({ email, displayName }) {
      const user = { uid: `new-${next++}`, email, displayName: displayName || null };
      users.set(email, user);
      this.created.push(user);
      return user;
    },
  };
}

function createUserHandler({ db, authImpl }) {
  return createCreateUserFromTicketHandler({
    db, auth: authImpl, getConfig, now: () => T0, log: QUIET,
  });
}

const adminReq = (body) => ({ method: 'POST', headers: { authorization: 'Bearer admin' }, body });

test('createUserFromTicket seeds an account, claims the ticket, and marks it ticketed', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': { ...fakeTicket(), claimedByUid: null } });
  const authImpl = fakeAuth();
  const res = makeRes();

  await createUserHandler({ db, authImpl })(adminReq({ externalId: 'tkt-1' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.created, true);
  assert.equal(res.body.registrationStatus, 'ticketed');
  const uid = res.body.uid;
  // Seeded with the SAME document the auth trigger writes.
  const user = db.read('users', uid);
  assert.equal(user.email, 'attendee@example.com');
  assert.equal(user.role, 'attendee');
  assert.equal(user.registrationStatus, 'ticketed');
  assert.equal(user.approvalSource, null);
  assert.equal(db.read('tickets', 'tkt-1').claimedByUid, uid);
  assert.equal(authImpl.created[0].displayName, 'Ada Lovelace');
});

test('createUserFromTicket reuses an existing account and its existing profile', async () => {
  const db = makeFakeDb({
    'tickets/tkt-1': fakeTicket(),
    'users/uid-ada': { uid: 'uid-ada', registrationStatus: 'pending', displayName: 'Ada L.' },
  });
  const authImpl = fakeAuth({ 'attendee@example.com': { uid: 'uid-ada', displayName: 'Ada L.' } });
  const res = makeRes();

  await createUserHandler({ db, authImpl })(adminReq({ externalId: 'tkt-1' }), res);

  assert.deepEqual(
    { uid: res.body.uid, created: res.body.created },
    { uid: 'uid-ada', created: false },
  );
  assert.equal(db.read('users', 'uid-ada').displayName, 'Ada L.');
  assert.equal(authImpl.created.length, 0);
});

test('createUserFromTicket is admin-gated and validates its input', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': fakeTicket() });
  const handler = createUserHandler({ db, authImpl: fakeAuth() });

  const attendee = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer ada' }, body: { externalId: 'tkt-1' } }, attendee);
  assert.equal(attendee.statusCode, 403);

  const anon = makeRes();
  await handler({ method: 'POST', headers: {}, body: { externalId: 'tkt-1' } }, anon);
  assert.equal(anon.statusCode, 401);

  const bad = makeRes();
  await handler(adminReq({ externalId: '../users/uid-ada' }), bad);
  assert.equal(bad.statusCode, 400);

  const missing = makeRes();
  await handler(adminReq({ externalId: 'nope' }), missing);
  assert.equal(missing.statusCode, 404);

  assert.equal(db.read('tickets', 'tkt-1').claimedByUid, undefined);
});

test('an already-claimed ticket reports the holder instead of creating a second account', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': { ...fakeTicket(), claimedByUid: 'uid-ada' } });
  const authImpl = fakeAuth();
  const res = makeRes();

  await createUserHandler({ db, authImpl })(adminReq({ externalId: 'tkt-1' }), res);

  assert.deepEqual(res.body, { ok: true, uid: 'uid-ada', created: false, alreadyClaimed: true });
  assert.equal(authImpl.created.length, 0);
});

test('a ticket with no email address cannot mint an account', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': { ...fakeTicket(), email: null } });
  const authImpl = fakeAuth();
  const res = makeRes();

  await createUserHandler({ db, authImpl })(adminReq({ externalId: 'tkt-1' }), res);

  assert.equal(res.statusCode, 422);
  assert.equal(authImpl.created.length, 0);
});
