'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createTicketingWebhookHandler, claimAndEnqueue, internals } = require('./webhook.cjs');
const { createFakeTicketingProvider, buildDelivery, SIGNATURE_HEADER } = require('./ticketingFake.cjs');

const QUIET = { warn() {}, error() {}, info() {} };

/** Minimal Express double: records status and JSON body. */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    send(payload) { res.body = payload; return res; },
  };
  return res;
}

function makeReq({ method = 'POST', rawBody, headers = {}, body } = {}) {
  return { method, rawBody, headers, body };
}

function makeHandler({ db, provider, now } = {}) {
  return createTicketingWebhookHandler({
    db: db || makeFakeDb(),
    provider: provider || createFakeTicketingProvider(),
    now,
    log: QUIET,
  });
}

test('a verified delivery claims and enqueues in ONE transaction (§3.3 step 2)', async () => {
  const db = makeFakeDb();
  const provider = createFakeTicketingProvider();
  const delivery = buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1', eventId: 'evt-1' });
  const res = makeRes();

  await makeHandler({ db, provider })(makeReq(delivery), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, enqueued: true, duplicate: false });

  const claim = db.read('ticket_webhook_deliveries', 'del-1');
  assert.equal(claim.orderId, 'ord-1');
  assert.equal(claim.eventType, 'order.placed');
  assert.equal(claim.provider, 'eventbrite');

  const row = db.read('ticket_sync_queue', 'ord-1');
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0);
  assert.equal(row.lastDeliveryId, 'del-1');
  assert.ok(row.readyAt instanceof Date);
});

test('a replayed delivery is a no-op 200 and writes nothing', async () => {
  const db = makeFakeDb();
  const provider = createFakeTicketingProvider();
  const handler = makeHandler({ db, provider });
  const delivery = buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1' });

  await handler(makeReq(delivery), makeRes());
  // The queue row is drained away between the two deliveries; a replay
  // must not resurrect it.
  await db.collection('ticket_sync_queue').doc('ord-1').delete();
  const writesBefore = db.writes.length;

  const res = makeRes();
  await handler(makeReq(delivery), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, enqueued: false, duplicate: true });
  assert.equal(db.writes.length, writesBefore, 'a duplicate delivery applied a write');
  assert.equal(db.read('ticket_sync_queue', 'ord-1'), undefined);
});

test('the duplicate claim aborts the WHOLE transaction — no orphan queue row', async () => {
  const db = makeFakeDb();
  // Claim already present, queue row already drained: the failing create
  // must take the queue set down with it.
  await db.collection('ticket_webhook_deliveries').doc('del-1').set({ deliveryId: 'del-1' });

  const outcome = await claimAndEnqueue({
    db, deliveryId: 'del-1', orderId: 'ord-1', eventType: 'order.placed', providerName: 'eventbrite',
  });

  assert.deepEqual(outcome, { enqueued: false, duplicate: true });
  assert.equal(db.read('ticket_sync_queue', 'ord-1'), undefined);
});

test('two distinct deliveries about one order collapse onto ONE queue row', async () => {
  const db = makeFakeDb();
  const handler = makeHandler({ db });

  await handler(makeReq(buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1', eventType: 'order.placed' })), makeRes());
  await handler(makeReq(buildDelivery({ deliveryId: 'del-2', orderId: 'ord-1', eventType: 'order.updated' })), makeRes());

  assert.deepEqual(db.ids('ticket_sync_queue'), ['ord-1']);
  assert.deepEqual(db.ids('ticket_webhook_deliveries').sort(), ['del-1', 'del-2']);
  assert.equal(db.read('ticket_sync_queue', 'ord-1').lastEventType, 'order.updated');
});

test('concurrent deliveries about one order serialize: one row, both claims', async () => {
  const db = makeFakeDb();
  const handler = makeHandler({ db });
  const first = buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1' });
  const second = buildDelivery({ deliveryId: 'del-2', orderId: 'ord-1' });

  // Interleave exactly at the commit point of the first transaction: the
  // second delivery's write lands between the first's read and its
  // commit, so the first must abort and re-run against the new version.
  db.beforeCommit = async () => {
    await handler(makeReq(second), makeRes());
  };
  const res = makeRes();
  await handler(makeReq(first), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.ids('ticket_sync_queue'), ['ord-1']);
  assert.deepEqual(db.ids('ticket_webhook_deliveries').sort(), ['del-1', 'del-2']);
  assert.equal(db.read('ticket_sync_queue', 'ord-1').attempts, 0);
});

test('a fresh delivery never resets the attempts of a pending row', async () => {
  const db = makeFakeDb({
    'ticket_sync_queue/ord-1': { orderId: 'ord-1', status: 'pending', attempts: 4, readyAt: new Date(0) },
  });
  await makeHandler({ db })(makeReq(buildDelivery({ deliveryId: 'del-9', orderId: 'ord-1' })), makeRes());
  assert.equal(db.read('ticket_sync_queue', 'ord-1').attempts, 4);
});

test('a delivery re-arms an exhausted row and clears its give-up forensics', async () => {
  const db = makeFakeDb({
    'ticket_sync_queue/ord-1': {
      orderId: 'ord-1', status: 'exhausted', attempts: 6,
      exhaustedAt: new Date(0), lastError: 'order never became complete',
    },
  });
  await makeHandler({ db })(makeReq(buildDelivery({ deliveryId: 'del-9', orderId: 'ord-1' })), makeRes());

  const row = db.read('ticket_sync_queue', 'ord-1');
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0);
  assert.equal(row.exhaustedAt, null);
  assert.equal(row.lastError, null);
});

test('an unsigned delivery is refused 401 and writes nothing', async () => {
  const db = makeFakeDb();
  const delivery = buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1' });
  const res = makeRes();

  await makeHandler({ db })(makeReq({ ...delivery, headers: {} }), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: { code: 'unauthorized', message: 'Verification failed.' } });
  assert.equal(db.writes.length, 0);
});

test('a wrong-signature refusal is byte-identical to a malformed one (no oracle)', async () => {
  const bad = makeRes();
  const garbage = makeRes();
  const delivery = buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1' });

  await makeHandler({})(makeReq({ ...delivery, headers: { [SIGNATURE_HEADER]: 'a'.repeat(64) } }), bad);
  await makeHandler({})(makeReq({ rawBody: Buffer.from('not json'), headers: { [SIGNATURE_HEADER]: 'b'.repeat(64) } }), garbage);

  assert.equal(bad.statusCode, garbage.statusCode);
  assert.deepEqual(bad.body, garbage.body);
});

test('a wrong-event delivery is acknowledged 200, so the provider stops retrying', async () => {
  const db = makeFakeDb();
  const res = makeRes();
  const delivery = buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1', eventId: 'some-other-event' });

  await makeHandler({ db })(makeReq(delivery), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, ignored: 'wrong_event' });
  assert.equal(db.writes.length, 0);
});

test('a verified but unactionable delivery is acknowledged without a queue row', async () => {
  const db = makeFakeDb();

  const unknownType = makeRes();
  await makeHandler({ db })(
    makeReq(buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1', eventType: 'refund.issued' })),
    unknownType,
  );
  assert.deepEqual(unknownType.body, { ok: true, ignored: 'not_actionable' });

  const noOrder = makeRes();
  await makeHandler({ db })(
    makeReq(buildDelivery({ deliveryId: 'del-2', orderId: null })),
    noOrder,
  );
  assert.deepEqual(noOrder.body, { ok: true, ignored: 'not_actionable' });

  const noDeliveryId = makeRes();
  await makeHandler({ db })(makeReq(buildDelivery({ deliveryId: '', orderId: 'ord-1' })), noDeliveryId);
  assert.deepEqual(noDeliveryId.body, { ok: true, ignored: 'no_delivery_id' });

  assert.equal(db.writes.length, 0);
});

test('a path-traversing order id never becomes a document id', async () => {
  const db = makeFakeDb();
  const res = makeRes();
  await makeHandler({ db })(
    makeReq(buildDelivery({ deliveryId: 'del-1', orderId: '../config/bootstrap' })),
    res,
  );
  assert.deepEqual(res.body, { ok: true, ignored: 'not_actionable' });
  assert.equal(db.writes.length, 0);
});

test('non-POST is 405 and an oversized body is 413, before any provider call', async () => {
  const provider = createFakeTicketingProvider();

  const wrongMethod = makeRes();
  await makeHandler({ provider })(makeReq({ method: 'GET' }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, 'POST');

  const tooBig = makeRes();
  await makeHandler({ provider })(
    makeReq({ rawBody: Buffer.alloc(internals.MAX_BODY_BYTES + 1) }),
    tooBig,
  );
  assert.equal(tooBig.statusCode, 413);
  assert.equal(provider.calls.verifyWebhook, 0);
});

test('a provider that throws during verification gets a 500, so the delivery is retried', async () => {
  const provider = createFakeTicketingProvider();
  provider.verifyWebhook = async () => { throw new Error('key store down'); };
  const res = makeRes();

  await makeHandler({ provider })(makeReq(buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1' })), res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: { code: 'internal', message: 'Delivery could not be processed.' } });
});

test('a failed commit is never acknowledged as accepted work', async () => {
  const db = makeFakeDb();
  db.runTransaction = async () => { throw new Error('UNAVAILABLE: firestore down'); };
  const res = makeRes();

  await makeHandler({ db })(makeReq(buildDelivery({ deliveryId: 'del-1', orderId: 'ord-1' })), res);

  assert.equal(res.statusCode, 500);
});

test('isDuplicateClaim recognizes both codes §3.3 can produce', () => {
  assert.equal(internals.isDuplicateClaim({ code: 6 }), true);
  assert.equal(internals.isDuplicateClaim({ code: 9 }), true);
  assert.equal(internals.isDuplicateClaim({ code: 'already-exists' }), true);
  assert.equal(internals.isDuplicateClaim({ code: 'failed-precondition' }), true);
  assert.equal(internals.isDuplicateClaim(new Error('ALREADY_EXISTS: document exists')), true);
  assert.equal(internals.isDuplicateClaim(new Error('UNAVAILABLE')), false);
  assert.equal(internals.isDuplicateClaim(null), false);
});

test('rawBodyOf prefers the exact bytes the signature covers', () => {
  const buf = Buffer.from('{"a":1}');
  assert.equal(internals.rawBodyOf({ rawBody: buf }), buf);
  assert.deepEqual(internals.rawBodyOf({ rawBody: '{"a":1}' }), buf);
  assert.deepEqual(internals.rawBodyOf({ body: { a: 1 } }), buf);
  const circular = {};
  circular.self = circular;
  assert.equal(internals.rawBodyOf({ body: circular }).length, 0);
});
