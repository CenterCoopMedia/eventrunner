'use strict';

// Batch send (issue #201): the core's sendBatch over the real Postmark and
// console adapters, with a scripted fetch and an in-memory Firestore. Each
// case below is a row of the contract table on the issue.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmailCore, EmailBatchError } = require('./send.cjs');
const { createPostmarkProvider } = require('./providers/postmark.cjs');
const { createConsoleProvider } = require('./providers/console.cjs');

function alreadyExistsError() {
  const err = new Error('6 ALREADY_EXISTS: Document already exists');
  err.code = 6;
  return err;
}

function fakeDb() {
  const state = { claims: new Map(), sentRows: [], event: {} };
  return {
    state,
    collection(name) {
      if (name === 'config') {
        return { doc: () => ({ async get() { return { exists: state.event !== null, data: () => state.event }; } }) };
      }
      if (name === 'email_claims') {
        return {
          doc: (id) => ({
            async create(data) {
              // Yield first so concurrent creates interleave as Firestore's do.
              await Promise.resolve();
              if (state.claims.has(id)) throw alreadyExistsError();
              state.claims.set(id, data);
            },
            async get() { return { exists: state.claims.has(id), data: () => state.claims.get(id) }; },
            async update(patch) { state.claims.set(id, { ...state.claims.get(id), ...patch }); },
          }),
        };
      }
      if (name === 'sent_emails') {
        return { async add(row) { state.sentRows.push(row); return { id: `row-${state.sentRows.length}` }; } };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

const CONFIG = {
  event: {
    sender: { email: 'events@example.org', name: 'Example Event', replyTo: 'reply@example.org' },
    legal: { postalAddressHtml: '1 Example Street' },
  },
  providers: { email: { provider: 'postmark', messageStream: 'outbound' } },
};

function fakeResponse({ status = 200, jsonBody, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    async json() {
      if (jsonBody === undefined) throw new SyntaxError('not json');
      return jsonBody;
    },
  };
}

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error('fakeFetch: no scripted response left');
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}

function setup(responses, { db = fakeDb() } = {}) {
  const fetchImpl = fakeFetch(responses);
  const provider = createPostmarkProvider({ env: { EMAIL_PROVIDER_API_KEY: 'server-token' }, fetchImpl });
  const sleeps = [];
  const core = createEmailCore({
    db,
    provider,
    getConfig: async () => CONFIG,
    sleep: async (ms) => { sleeps.push(ms); },
    log: { error() {}, warn() {}, info() {} },
  });
  return { db, fetchImpl, core, sleeps };
}

const message = (n, extra = {}) => ({
  to: `person${n}@example.org`,
  subject: 'Doors open at nine',
  text: 'Doors open at nine.',
  html: '<p>Doors open at nine.</p>',
  onceKey: `announcement:send-1:${n}`,
  source: 'announcement',
  messageStream: 'announcements',
  ...extra,
});

const accepted = (id) => ({ ErrorCode: 0, Message: 'OK', MessageID: id, To: 'x' });

test('two fresh recipients: one batch request, two ordered results and two audit rows', async () => {
  const { db, fetchImpl, core } = setup([fakeResponse({ jsonBody: [accepted('m-1'), accepted('m-2')] })]);
  const results = await core.sendBatch([message(1), message(2)]);

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'https://api.postmarkapp.com/email/batch');
  assert.equal(fetchImpl.calls[0].init.headers['X-Postmark-Server-Token'], 'server-token');
  const body = fetchImpl.calls[0].body;
  assert.deepEqual(body.map((entry) => entry.To), ['person1@example.org', 'person2@example.org']);
  // The explicit announcement stream reaches every entry, not the
  // transactional default from config/providers.
  assert.deepEqual(body.map((entry) => entry.MessageStream), ['announcements', 'announcements']);
  // The core resolved the sender and the legal footer on each entry.
  assert.equal(body[0].From, 'Example Event <events@example.org>');
  assert.match(body[0].TextBody, /1 Example Street/);

  assert.deepEqual(results.map((r) => [r.status, r.providerMessageId]), [['sent', 'm-1'], ['sent', 'm-2']]);
  assert.equal(db.state.sentRows.length, 2);
  assert.deepEqual(db.state.sentRows.map((row) => row.to), ['person1@example.org', 'person2@example.org']);
  assert.ok(db.state.sentRows.every((row) => row.source === 'announcement' && row.status === 'sent'));
  assert.equal(db.state.claims.size, 2);
});

test('one accepted and one rejected inside HTTP 200: only the rejected entry fails, and it is not retried', async () => {
  const { db, fetchImpl, core } = setup([fakeResponse({
    jsonBody: [accepted('m-1'), { ErrorCode: 406, Message: 'Inactive recipient' }],
  })]);
  const results = await core.sendBatch([message(1), message(2)]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(results[0].status, 'sent');
  assert.equal(results[1].status, 'failed');
  assert.match(results[1].error, /406: Inactive recipient/);
  assert.deepEqual(db.state.sentRows.map((row) => row.status), ['sent', 'failed']);
});

test('a whole-request 503 retries the same set within the attempt cap, then one audit row each', async () => {
  const { db, fetchImpl, core, sleeps } = setup([
    fakeResponse({ status: 503, jsonBody: { ErrorCode: 100, Message: 'Maintenance' } }),
    fakeResponse({ jsonBody: [accepted('m-1'), accepted('m-2')] }),
  ]);
  const results = await core.sendBatch([message(1), message(2)]);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].body.length, 2);
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(results.map((r) => [r.status, r.retries]), [['sent', 1], ['sent', 1]]);
  assert.equal(db.state.sentRows.length, 2);
});

test('a 429 retries only with a provider retry hint', async () => {
  const noHint = setup([fakeResponse({ status: 429, jsonBody: { ErrorCode: 429, Message: 'Rate limit' } })]);
  const first = await noHint.core.sendBatch([message(1)]);
  assert.equal(noHint.fetchImpl.calls.length, 1);
  assert.equal(first[0].status, 'failed');

  const withHint = setup([
    fakeResponse({ status: 429, headers: { 'Retry-After': '3' }, jsonBody: { ErrorCode: 429, Message: 'Rate limit' } }),
    fakeResponse({ jsonBody: [accepted('m-1')] }),
  ]);
  const second = await withHint.core.sendBatch([message(1)]);
  assert.equal(withHint.fetchImpl.calls.length, 2);
  assert.deepEqual(withHint.sleeps, [3000]);
  assert.equal(second[0].status, 'sent');
});

test('the attempt cap holds: three 503 answers make three requests and stop', async () => {
  const { fetchImpl, core, db } = setup([
    fakeResponse({ status: 503 }), fakeResponse({ status: 503 }), fakeResponse({ status: 503 }),
  ]);
  const results = await core.sendBatch([message(1)]);
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].retries, 2);
  assert.equal(db.state.sentRows.length, 1);
});

test('a repeat of the batch reports the failure an earlier call recorded on the claim', async () => {
  const db = fakeDb();
  const first = setup([
    fakeResponse({ status: 503 }), fakeResponse({ status: 503 }), fakeResponse({ status: 503 }),
  ], { db });
  await first.core.sendBatch([message(1)]);
  assert.equal([...db.state.claims.values()][0].failure.providerStatus, 503);

  const again = setup([], { db });
  const [result] = await again.core.sendBatch([message(1)]);
  assert.equal(again.fetchImpl.calls.length, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.providerStatus, 503);
  assert.equal(db.state.sentRows.length, 1, 'a replay writes no audit row');
});

test('a repeat of the same batch sends nothing twice and writes no extra audit row', async () => {
  const db = fakeDb();
  const first = setup([fakeResponse({ jsonBody: [accepted('m-1'), accepted('m-2')] })], { db });
  await first.core.sendBatch([message(1), message(2)]);

  const again = setup([fakeResponse({ jsonBody: [accepted('m-3')] })], { db });
  const results = await again.core.sendBatch([message(1), message(2), message(3)]);
  assert.equal(again.fetchImpl.calls.length, 1);
  assert.deepEqual(again.fetchImpl.calls[0].body.map((entry) => entry.To), ['person3@example.org']);
  assert.deepEqual(results.map((r) => Boolean(r.skipped)), [true, true, false]);
  assert.equal(results[0].providerMessageId, null);
  assert.equal(db.state.sentRows.length, 3);
});

test('concurrent calls with the same keys: each key enters one send path', async () => {
  const db = fakeDb();
  const a = setup([fakeResponse({ jsonBody: [accepted('a-1'), accepted('a-2')] })], { db });
  const b = setup([fakeResponse({ jsonBody: [accepted('b-1'), accepted('b-2')] })], { db });
  const [ra, rb] = await Promise.all([
    a.core.sendBatch([message(1), message(2)]),
    b.core.sendBatch([message(1), message(2)]),
  ]);
  const sentTo = [...a.fetchImpl.calls, ...b.fetchImpl.calls].flatMap((call) => call.body.map((entry) => entry.To));
  assert.deepEqual(sentTo.sort(), ['person1@example.org', 'person2@example.org']);
  assert.equal([...ra, ...rb].filter((r) => r.skipped).length, 2);
  assert.equal(db.state.sentRows.length, 2);
});

test('a short 2xx answer leaves the missing entry uncertain and never replays it', async () => {
  const { fetchImpl, core, db } = setup([fakeResponse({ jsonBody: [accepted('m-1')] })]);
  const results = await core.sendBatch([message(1), message(2)]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(results[0].status, 'sent');
  assert.equal(results[1].status, 'failed');
  assert.equal(results[1].uncertain, true);
  assert.equal(db.state.claims.size, 2, 'the uncertain claim stays in place');
});

test('invalid JSON on a 2xx and a thrown fetch are uncertain, with no retry', async () => {
  const badJson = setup([fakeResponse({ status: 200 })]);
  const r1 = await badJson.core.sendBatch([message(1)]);
  assert.equal(badJson.fetchImpl.calls.length, 1);
  assert.equal(r1[0].uncertain, true);

  const timeout = setup([new Error('socket hang up')]);
  const r2 = await timeout.core.sendBatch([message(1), message(2)]);
  assert.equal(timeout.fetchImpl.calls.length, 1);
  assert.ok(r2.every((r) => r.uncertain === true && r.status === 'failed'));
  assert.equal(timeout.db.state.claims.size, 2);
  assert.equal(timeout.db.state.sentRows.length, 2);
});

test('more than 500 entries is refused before any claim or request', async () => {
  const { fetchImpl, core, db } = setup([]);
  const many = Array.from({ length: 501 }, (_, n) => message(n));
  await assert.rejects(core.sendBatch(many), (err) => err instanceof EmailBatchError && err.code === 'batch-too-large');
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(db.state.claims.size, 0);
  assert.equal(db.state.sentRows.length, 0);
});

test('an oversized resolved payload is refused before any claim', async () => {
  const { fetchImpl, core, db } = setup([]);
  const huge = 'x'.repeat(26 * 1024 * 1024);
  await assert.rejects(
    core.sendBatch([message(1, { html: huge }), message(2, { html: huge })]),
    (err) => err.code === 'batch-too-large',
  );
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(db.state.claims.size, 0);
});

test('a malformed batch is refused before any claim: no key, a repeated key, no recipient', async () => {
  const { core, db } = setup([]);
  await assert.rejects(core.sendBatch([message(1, { onceKey: undefined })]), (err) => err.code === 'invalid-batch');
  await assert.rejects(core.sendBatch([message(1), message(2, { onceKey: 'announcement:send-1:1' })]), (err) => err.code === 'invalid-batch');
  await assert.rejects(core.sendBatch([message(1, { to: '' })]), (err) => err.code === 'invalid-batch');
  await assert.rejects(core.sendBatch('nope'), (err) => err.code === 'invalid-batch');
  assert.equal(db.state.claims.size, 0);
});

test('an empty batch answers [] with no writes', async () => {
  const { core, db, fetchImpl } = setup([]);
  assert.deepEqual(await core.sendBatch([]), []);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(db.state.sentRows.length, 0);
});

test('a provider with no batch method is refused before any claim', async () => {
  const db = fakeDb();
  const core = createEmailCore({ db, provider: { name: 'webhook', send: async () => ({}) }, getConfig: async () => CONFIG });
  await assert.rejects(core.sendBatch([message(1)]), (err) => err.code === 'batch-unsupported');
  assert.equal(db.state.claims.size, 0);
});

test('the historical demo refuses the batch with no claim, request, or audit row', async () => {
  const db = fakeDb();
  db.state.event = { historicalDemo: true };
  const { core, fetchImpl } = setup([], { db });
  const results = await core.sendBatch([message(1), message(2)]);
  assert.deepEqual(results.map((r) => [r.status, r.error]), [['failed', 'read-only-demo'], ['failed', 'read-only-demo']]);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(db.state.claims.size, 0);
  assert.equal(db.state.sentRows.length, 0);
});

// --- Send identity and audit gaps (issue #497) ------------------------------

test('a message sendId reaches its audit row, and a message without one writes no sendId', async () => {
  const { db, fetchImpl, core } = setup([fakeResponse({ jsonBody: [accepted('m-1'), accepted('m-2')] })]);
  await core.sendBatch([message(1, { sendId: 'send-abc-123' }), message(2)]);
  assert.equal(db.state.sentRows[0].sendId, 'send-abc-123');
  assert.equal('sendId' in db.state.sentRows[1], false);
  // The provider never sees it.
  assert.equal(JSON.stringify(fetchImpl.calls[0].body).includes('send-abc-123'), false);
});

test('a failed audit write is reported on that result, and an accepted message stays sent', async () => {
  const db = fakeDb();
  const base = db.collection.bind(db);
  let writes = 0;
  db.collection = (name) => {
    if (name !== 'sent_emails') return base(name);
    return {
      async add(row) {
        writes += 1;
        if (writes === 1) throw new Error('UNAVAILABLE: audit store down');
        db.state.sentRows.push(row);
        return { id: `row-${writes}` };
      },
    };
  };
  const { core, fetchImpl } = setup([fakeResponse({ jsonBody: [accepted('m-1'), accepted('m-2')] })], { db });
  const results = await core.sendBatch([message(1), message(2)]);
  assert.deepEqual(results.map((r) => r.status), ['sent', 'sent']);
  assert.deepEqual(results.map((r) => r.auditFailed === true), [true, false]);
  assert.equal(fetchImpl.calls.length, 1, 'no resend after the audit failure');
  assert.equal(db.state.sentRows.length, 1);
});

test('a replay reports an audit gap the first call left on the claim, and a recorded row reports none', async () => {
  const db = fakeDb();
  const base = db.collection.bind(db);
  let writes = 0;
  db.collection = (name) => {
    if (name !== 'sent_emails') return base(name);
    return {
      async add(row) {
        writes += 1;
        if (writes === 1) throw new Error('UNAVAILABLE: audit store down');
        db.state.sentRows.push(row);
        return { id: `row-${writes}` };
      },
    };
  };
  const { core, fetchImpl } = setup([fakeResponse({ jsonBody: [accepted('m-1'), accepted('m-2')] })], { db });
  await core.sendBatch([message(1), message(2)]);
  // The caller lost the first answer and sends the same batch again.
  const replay = await core.sendBatch([message(1), message(2)]);
  assert.deepEqual(replay.map((r) => [r.status, r.skipped, r.auditFailed === true]), [['sent', true, true], ['sent', true, false]]);
  assert.equal(fetchImpl.calls.length, 1, 'the replay sends nothing');
});

test('single send still uses its prior stream: an OTP keeps the transactional default', async () => {
  const { core, fetchImpl } = setup([fakeResponse({ jsonBody: { MessageID: 'otp-1', ErrorCode: 0 } })]);
  await core.send({ to: 'a@example.org', subject: 'Your code', text: '123456', tag: 'auth.otp', source: 'auth-otp' });
  assert.equal(fetchImpl.calls[0].url, 'https://api.postmarkapp.com/email');
  assert.equal(fetchImpl.calls[0].body.MessageStream, 'outbound');
});

test('console batch: one captured line per message, headers included, one result each', async () => {
  const lines = [];
  const provider = createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/tmp/never-written' },
    log: { log() {} },
    appendFileSync: (_file, line) => lines.push(JSON.parse(line)),
  });
  const db = fakeDb();
  const core = createEmailCore({ db, provider, getConfig: async () => CONFIG, log: { error() {} } });
  const results = await core.sendBatch([
    message(1, { headers: { 'List-Unsubscribe': '<https://example.org/u?1>' } }),
    message(2),
  ]);
  assert.deepEqual(results.map((r) => r.status), ['sent', 'sent']);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].headers['List-Unsubscribe'], '<https://example.org/u?1>');
  assert.equal(lines[0].messageStream, 'announcements');
  assert.equal(db.state.sentRows.length, 2);
});

// --- Message streams (issue #490) -------------------------------------------

test('getMessageStream reads type, archive state, and unsubscribe handling with the server token', async () => {
  const fetchImpl = fakeFetch([fakeResponse({
    jsonBody: {
      ID: 'announcements',
      MessageStreamType: 'Broadcasts',
      ArchivedAt: null,
      SubscriptionManagementConfiguration: { UnsubscribeHandlingType: 'Postmark' },
    },
  }), fakeResponse({ status: 404, jsonBody: { ErrorCode: 1226, Message: 'not found' } })]);
  const provider = createPostmarkProvider({ env: { EMAIL_PROVIDER_API_KEY: 'server-token' }, fetchImpl });
  assert.deepEqual(await provider.getMessageStream('announcements'), {
    found: true, id: 'announcements', type: 'Broadcasts', archived: false, unsubscribeHandling: 'Postmark',
  });
  assert.equal(fetchImpl.calls[0].url, 'https://api.postmarkapp.com/message-streams/announcements');
  assert.equal(fetchImpl.calls[0].init.headers['X-Postmark-Server-Token'], 'server-token');
  assert.deepEqual(await provider.getMessageStream('missing'), { found: false, status: 404 });
});

test('a batch with an attachment the provider cannot carry is refused before any claim', async () => {
  const db = fakeDb();
  const provider = { name: 'webhook', sendBatch: async () => { throw new Error('must not send'); } };
  const core = createEmailCore({ db, provider, getConfig: async () => CONFIG, log: { error() {}, warn() {}, info() {} } });
  const attachments = [{ filename: 'INV-0001.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-').toString('base64') }];
  await assert.rejects(
    core.sendBatch([{ to: 'a@example.org', subject: 's', text: 'x', onceKey: 'k-1', attachments }]),
    (err) => err instanceof EmailBatchError && err.code === 'attachments-unsupported',
  );
  assert.equal(db.state.claims.size, 0);
  assert.equal(db.state.sentRows.length, 0);
});
