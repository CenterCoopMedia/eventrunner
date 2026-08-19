'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmailCore, createDeliveryWebhookHandler, internals } = require('./send.cjs');

// --- Fakes -----------------------------------------------------------------

function alreadyExistsError() {
  const err = new Error('6 ALREADY_EXISTS: Document already exists');
  err.code = 6;
  return err;
}

/** Minimal Firestore fake covering what send.cjs touches. */
function fakeDb() {
  const state = { claims: new Map(), sentRows: [], updates: [] };
  return {
    state,
    collection(name) {
      if (name === 'email_claims') {
        return {
          doc: (id) => ({
            async create(data) {
              if (state.claims.has(id)) throw alreadyExistsError();
              state.claims.set(id, data);
            },
          }),
        };
      }
      if (name === 'sent_emails') {
        return {
          async add(row) {
            state.sentRows.push(row);
            return { id: `row-${state.sentRows.length}` };
          },
          where: (field, op, value) => ({
            limit: () => ({
              async get() {
                const i = state.sentRows.findIndex((r) => r[field] === value);
                if (i === -1) return { empty: true, docs: [] };
                return { empty: false, docs: [{ ref: { __index: i } }] };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
    async runTransaction(fn) {
      const tx = {
        get: async (ref) => ({ data: () => state.sentRows[ref.__index] }),
        update: (ref, patch) => {
          Object.assign(state.sentRows[ref.__index], patch);
          state.updates.push({ index: ref.__index, patch });
        },
      };
      return fn(tx);
    },
  };
}

const CONFIG = {
  event: { sender: { email: 'summit@example.org', name: 'Example Summit', replyTo: 'reply@example.org' } },
};

function core({ db = fakeDb(), provider, sleeps = [] } = {}) {
  return {
    db,
    sleeps,
    core: createEmailCore({
      db,
      provider,
      getConfig: async () => CONFIG,
      sleep: async (ms) => { sleeps.push(ms); },
      log: { error() {}, warn() {}, info() {} },
    }),
  };
}

// --- send ------------------------------------------------------------------

test('happy path: sends, defaults sender, writes one audit row', async () => {
  const sent = [];
  const { db, core: c } = core({
    provider: { name: 'console', send: async (m) => { sent.push(m); return { providerMessageId: 'id-1', status: 'sent', providerStatus: 200 }; } },
  });
  const result = await c.send({ to: 'a@example.org', subject: 'Hi', html: '<p>x</p>', text: 'x', tag: 'auth.otp' });
  assert.equal(result.status, 'sent');
  assert.equal(result.providerMessageId, 'id-1');
  assert.equal(result.retries, 0);
  assert.equal(sent[0].from.email, 'summit@example.org');
  assert.equal(sent[0].replyTo, 'reply@example.org');
  assert.equal(db.state.sentRows.length, 1);
  assert.equal(db.state.sentRows[0].templateId, 'auth.otp');
  assert.equal(db.state.sentRows[0].status, 'sent');
});

test('retries on 5xx up to 3 attempts with [500, 2000] backoff', async () => {
  let calls = 0;
  const { db, sleeps, core: c } = core({
    provider: { name: 'x', send: async () => { calls += 1; return { providerMessageId: null, status: 'failed', providerStatus: 503, error: 'unavailable' }; } },
  });
  const result = await c.send({ to: 'a@example.org', subject: 's' });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 2000]);
  assert.equal(result.status, 'failed');
  assert.equal(result.retries, 2);
  assert.equal(db.state.sentRows.length, 1); // one row despite 3 attempts
  assert.equal(db.state.sentRows[0].retries, 2);
});

test('retries 429 only with a retry hint', async () => {
  let calls = 0;
  const { core: c } = core({
    provider: { name: 'x', send: async () => { calls += 1; return { providerMessageId: null, status: 'failed', providerStatus: 429, error: 'slow down' }; } },
  });
  await c.send({ to: 'a@example.org', subject: 's' });
  assert.equal(calls, 1); // no hint, no retry

  calls = 0;
  const { core: c2 } = core({
    provider: { name: 'x', send: async () => { calls += 1; return { providerMessageId: null, status: 'failed', providerStatus: 429, retryAfterMs: 100, error: 'slow down' }; } },
  });
  await c2.send({ to: 'a@example.org', subject: 's' });
  assert.equal(calls, 3);
});

test('4xx is not retried', async () => {
  let calls = 0;
  const { core: c } = core({
    provider: { name: 'x', send: async () => { calls += 1; return { providerMessageId: null, status: 'failed', providerStatus: 422, error: 'bad address' }; } },
  });
  const result = await c.send({ to: 'a@example.org', subject: 's' });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
});

test('a thrown exception is never retried', async () => {
  let calls = 0;
  const { db, core: c } = core({
    provider: { name: 'x', send: async () => { calls += 1; throw new Error('socket hang up'); } },
  });
  const result = await c.send({ to: 'a@example.org', subject: 's' });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /socket hang up/);
  assert.equal(db.state.sentRows.length, 1);
});

test('onceKey: first send claims, second skips without provider contact or audit row', async () => {
  let calls = 0;
  const db = fakeDb();
  const { core: c } = core({
    db,
    provider: { name: 'x', send: async () => { calls += 1; return { providerMessageId: 'id', status: 'sent', providerStatus: 200 }; } },
  });
  const first = await c.send({ to: 'a@example.org', subject: 's', onceKey: 'welcome:uid-1' });
  const second = await c.send({ to: 'a@example.org', subject: 's', onceKey: 'welcome:uid-1' });
  assert.equal(first.skipped, undefined);
  assert.deepEqual(second, { providerMessageId: null, status: 'sent', skipped: true, retries: 0 });
  assert.equal(calls, 1);
  assert.equal(db.state.sentRows.length, 1);
  assert.equal(db.state.claims.size, 1);
});

test('claim is not rolled back on a failed send', async () => {
  const db = fakeDb();
  const { core: c } = core({
    db,
    provider: { name: 'x', send: async () => ({ providerMessageId: null, status: 'failed', providerStatus: 400, error: 'nope' }) },
  });
  await c.send({ to: 'a@example.org', subject: 's', onceKey: 'k' });
  assert.equal(db.state.claims.size, 1);
  const again = await c.send({ to: 'a@example.org', subject: 's', onceKey: 'k' });
  assert.equal(again.skipped, true);
});

test('storeRendered:false suppresses body storage (auth mail)', async () => {
  const db = fakeDb();
  const { core: c } = core({
    db,
    provider: { name: 'x', send: async () => ({ providerMessageId: 'id', status: 'sent', providerStatus: 200 }) },
  });
  await c.send({ to: 'a@example.org', subject: 's', html: '<p>code 123</p>', text: 'code 123', storeRendered: false });
  const row = db.state.sentRows[0];
  assert.equal(row.bodyStored, false);
  assert.equal(row.html, null);
  assert.equal(row.text, null);
});

test('stored bodies are truncated at 100KB with bodyTruncated', async () => {
  const db = fakeDb();
  const { core: c } = core({
    db,
    provider: { name: 'x', send: async () => ({ providerMessageId: 'id', status: 'sent', providerStatus: 200 }) },
  });
  await c.send({ to: 'a@example.org', subject: 's', html: 'x'.repeat(200 * 1024), text: 'ok' });
  const row = db.state.sentRows[0];
  assert.equal(row.bodyTruncated, true);
  assert.ok(Buffer.byteLength(row.html, 'utf8') <= internals.BODY_STORE_LIMIT);
  assert.equal(row.text, 'ok');
});

test('claimIdForOnceKey is a stable sha256 hex', () => {
  assert.match(internals.claimIdForOnceKey('welcome:u1'), /^[0-9a-f]{64}$/);
  assert.equal(internals.claimIdForOnceKey('a'), internals.claimIdForOnceKey('a'));
  assert.notEqual(internals.claimIdForOnceKey('a'), internals.claimIdForOnceKey('b'));
});

// --- delivery webhook --------------------------------------------------------

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

test('delivery webhook: 401 when the adapter cannot verify', async () => {
  const handler = createDeliveryWebhookHandler({ db: fakeDb(), provider: { name: 'console' } });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('delivery webhook: 401 on failed verification, never falls back', async () => {
  const handler = createDeliveryWebhookHandler({
    db: fakeDb(),
    provider: { name: 'postmark', verifyDeliveryWebhook: () => false, parseDeliveryEvent: () => [] },
  });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('delivery webhook patches the matching sent_emails row', async () => {
  const db = fakeDb();
  db.state.sentRows.push({ providerMessageId: 'pm-1', status: 'sent' });
  const handler = createDeliveryWebhookHandler({
    db,
    provider: {
      name: 'postmark',
      verifyDeliveryWebhook: () => true,
      parseDeliveryEvent: () => [
        { providerMessageId: 'pm-1', type: 'bounced', recipient: 'a@example.org', occurredAt: '2027-01-01T00:00:00Z', reason: 'mailbox full' },
        { providerMessageId: 'pm-unknown', type: 'delivered', recipient: 'b@example.org', occurredAt: '2027-01-01T00:00:00Z' },
      ],
    },
  });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { processed: 2, patched: 1 });
  assert.equal(db.state.sentRows[0].deliveryStatus, 'bounced');
  assert.equal(db.state.sentRows[0].bounceReason, 'mailbox full');
});

test('a send with no recipient still writes an audit row', async () => {
  const db = fakeDb();
  const { core: c } = core({ db, provider: { name: 'x', send: async () => { throw new Error('unreachable'); } } });
  const result = await c.send({ subject: 's', source: 'welcome-flow' });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'no recipient');
  assert.equal(db.state.sentRows.length, 1);
  assert.equal(db.state.sentRows[0].to, null);
  assert.equal(db.state.sentRows[0].source, 'welcome-flow');
});

test('the configured Tier B message stream reaches the adapter; per-message wins', async () => {
  const seen = [];
  const provider = { name: 'postmark', send: async (m) => { seen.push(m.messageStream); return { providerMessageId: 'id', status: 'sent', providerStatus: 200 }; } };
  const c = createEmailCore({
    db: fakeDb(),
    provider,
    getConfig: async () => ({ ...CONFIG, providers: { email: { provider: 'postmark', messageStream: 'client-a' } } }),
    sleep: async () => {},
    log: { error() {}, warn() {}, info() {} },
  });
  await c.send({ to: 'a@example.org', subject: 's' });
  await c.send({ to: 'a@example.org', subject: 's', messageStream: 'override-stream' });
  assert.deepEqual(seen, ['client-a', 'override-stream']);
});

test('non-template mail gets the configured legal footer; rendered mail does not double it', async () => {
  const seen = [];
  const provider = { name: 'x', send: async (m) => { seen.push(m); return { providerMessageId: 'id', status: 'sent', providerStatus: 200 }; } };
  const c = createEmailCore({
    db: fakeDb(),
    provider,
    getConfig: async () => ({
      event: {
        sender: { email: 's@example.org', name: 'S' },
        legal: { postalAddressHtml: 'Example Org<br>1 Main St' },
      },
    }),
    sleep: async () => {},
    log: { error() {}, warn() {}, info() {} },
  });
  await c.send({ to: 'a@example.org', subject: 's', html: '<p>alert</p>', text: 'alert' });
  assert.ok(seen[0].html.includes('Example Org<br>1 Main St'));
  assert.ok(seen[0].text.includes('Example Org\n1 Main St'));
  await c.send({ to: 'a@example.org', subject: 's', html: '<p>Example Org<br>1 Main St</p>', text: 'x', hasLegalFooter: true });
  assert.equal(seen[1].html.match(/Example Org/g).length, 1);
});

test('an EmailAddress recipient keeps its display name for the adapter', async () => {
  const seen = [];
  const db = fakeDb();
  const { core: c } = core({
    db,
    provider: { name: 'x', send: async (m) => { seen.push(m.to); return { providerMessageId: 'id', status: 'sent', providerStatus: 200 }; } },
  });
  await c.send({ to: { email: 'a@example.org', name: 'Ada' }, subject: 's' });
  assert.deepEqual(seen[0], { email: 'a@example.org', name: 'Ada' });
  assert.equal(db.state.sentRows[0].to, 'a@example.org');
});

test('delivery webhook compares timestamps as instants, not strings', async () => {
  const db = fakeDb();
  db.state.sentRows.push({
    providerMessageId: 'pm-1',
    status: 'sent',
    deliveryStatus: 'delivered',
    deliveryUpdatedAt: '2027-01-01T10:00:00Z',
  });
  const handler = createDeliveryWebhookHandler({
    db,
    provider: {
      name: 'postmark',
      verifyDeliveryWebhook: () => true,
      // 09:30-01:00 is 10:30Z — newer than the stored 10:00Z despite
      // sorting lexically before it.
      parseDeliveryEvent: () => [
        { providerMessageId: 'pm-1', type: 'bounced', recipient: 'a@example.org', occurredAt: '2027-01-01T09:30:00-01:00', reason: 'late bounce' },
      ],
    },
  });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.deepEqual(res.body, { processed: 1, patched: 1 });
  assert.equal(db.state.sentRows[0].deliveryStatus, 'bounced');
});

test('delivery webhook ignores an event older than the stored one', async () => {
  const db = fakeDb();
  db.state.sentRows.push({
    providerMessageId: 'pm-1',
    status: 'sent',
    deliveryStatus: 'bounced',
    deliveryUpdatedAt: '2027-01-02T00:00:00Z',
    bounceReason: 'mailbox full',
  });
  const handler = createDeliveryWebhookHandler({
    db,
    provider: {
      name: 'postmark',
      verifyDeliveryWebhook: () => true,
      parseDeliveryEvent: () => [
        { providerMessageId: 'pm-1', type: 'delivered', recipient: 'a@example.org', occurredAt: '2027-01-01T00:00:00Z' },
      ],
    },
  });
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.deepEqual(res.body, { processed: 1, patched: 0 });
  assert.equal(db.state.sentRows[0].deliveryStatus, 'bounced');
  assert.equal(db.state.sentRows[0].bounceReason, 'mailbox full');
});

test('delivery webhook rejects non-POST', async () => {
  const handler = createDeliveryWebhookHandler({ db: fakeDb(), provider: { name: 'x' } });
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});
