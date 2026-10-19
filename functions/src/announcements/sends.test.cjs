'use strict';

// Announcement email handlers (issues #202, #203, #490) end to end through
// the real email core and the real console and Postmark adapters.
//
// Every scenario uses the public Firestore API only, so it runs on two
// backends: an in-memory Firestore (always, under `npm test`) and the
// Firestore emulator when FIRESTORE_EMULATOR_HOST is set, for example:
//
//   npx firebase emulators:exec --only firestore --project demo-announce \
//     "node --test functions/src/announcements/sends.test.cjs"

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmailCore, createDeliveryWebhookHandler } = require('../email/send.cjs');
const { createConsoleProvider } = require('../email/providers/console.cjs');
const { createPostmarkProvider } = require('../email/providers/postmark.cjs');
const {
  createListAnnouncementSendsHandler,
  createPreviewAnnouncementEmailHandler,
  createSendAnnouncementTestHandler,
  createSendAnnouncementEmailHandler,
  internals: sendsInternals,
} = require('./sends.cjs');
const {
  createEmailUnsubscribeHandler,
  createRemoveEmailSuppressionHandler,
  suppressionIdFor,
  internals: suppressionInternals,
} = require('./suppression.cjs');

// --- In-memory Firestore ------------------------------------------------------

function alreadyExists() {
  const err = new Error('6 ALREADY_EXISTS: Document already exists');
  err.code = 6;
  return err;
}

function compare(a, b) {
  const va = a instanceof Date ? a.getTime() : a;
  const vb = b instanceof Date ? b.getTime() : b;
  if (va === vb) return 0;
  return va < vb ? -1 : 1;
}

function memoryFirestore() {
  const store = new Map(); // path -> data
  let autoId = 0;
  let lock = Promise.resolve();
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));

  function snapshot(path, ref) {
    const data = store.get(path);
    return { id: path.split('/').pop(), ref, exists: data !== undefined, data: () => clone(data) };
  }

  function docRef(collectionName, id) {
    const path = `${collectionName}/${id}`;
    const ref = {
      id,
      path,
      async get() { return snapshot(path, ref); },
      async create(data) {
        await Promise.resolve();
        if (store.has(path)) throw alreadyExists();
        store.set(path, clone(data));
      },
      async set(data) { store.set(path, clone(data)); },
      async update(patch) {
        if (!store.has(path)) throw new Error(`no document to update: ${path}`);
        store.set(path, { ...store.get(path), ...clone(patch) });
      },
      async delete() { store.delete(path); },
    };
    return ref;
  }

  function query(collectionName, spec = { filters: [], order: null, max: null }) {
    const next = (patch) => query(collectionName, { ...spec, ...patch });
    return {
      doc: (id) => docRef(collectionName, id ?? `auto${(autoId += 1)}`),
      async add(data) {
        const ref = docRef(collectionName, `auto${(autoId += 1)}`);
        await ref.set(data);
        return ref;
      },
      where: (field, op, value) => next({ filters: [...spec.filters, { field, op, value }] }),
      orderBy: (field, dir = 'asc') => next({ order: { field, dir } }),
      limit: (max) => next({ max }),
      select: () => next({}),
      async get() {
        const prefix = `${collectionName}/`;
        let docs = [];
        for (const path of store.keys()) {
          if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
          const data = store.get(path);
          const keep = spec.filters.every(({ field, op, value }) => {
            const v = data[field];
            if (op === '==') return v === value;
            if (op === 'in') return value.includes(v);
            if (op === '!=') return v !== undefined && v !== null && v !== value;
            throw new Error(`unsupported op ${op}`);
          });
          if (keep) docs.push(snapshot(path, docRef(collectionName, path.slice(prefix.length))));
        }
        if (spec.order) {
          const { field, dir } = spec.order;
          docs.sort((a, b) => compare(a.data()[field], b.data()[field]) * (dir === 'desc' ? -1 : 1));
        }
        if (spec.max != null) docs = docs.slice(0, spec.max);
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  return {
    collection: (name) => query(name),
    async getAll(...refs) { return Promise.all(refs.map((ref) => ref.get())); },
    async runTransaction(fn) {
      // Serial transactions: enough isolation for these handlers' read-then-write.
      const run = lock.then(async () => {
        const writes = [];
        const tx = {
          get: (target) => target.get(),
          set: (ref, data) => writes.push(() => ref.set(data)),
          update: (ref, patch) => writes.push(() => ref.update(patch)),
          delete: (ref) => writes.push(() => ref.delete()),
        };
        const result = await fn(tx);
        for (const write of writes) await write();
        return result;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
}

// --- Backends ---------------------------------------------------------------

const backends = [{ name: 'memory', make: async () => memoryFirestore() }];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const projectId = process.env.GCLOUD_PROJECT || 'demo-announce';
  backends.push({
    name: 'emulator',
    async make() {
      const { initializeApp, getApps } = require('firebase-admin/app');
      const { getFirestore } = require('firebase-admin/firestore');
      const app = getApps().find((a) => a.name === 'announce-test')
        || initializeApp({ projectId }, 'announce-test');
      const response = await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        { method: 'DELETE' },
      );
      assert.ok(response.ok, 'the emulator cleared its data');
      return getFirestore(app);
    },
  });
}

// --- Fixtures ---------------------------------------------------------------

const STAFF = 'staff@example.org';
const OPERATOR = 'operator@example.org';
const OUTSIDER = 'outsider@example.org';
const SITE = 'https://site.example.org';

const TOKENS = {
  staff: { uid: 'u-staff', email: STAFF, email_verified: true },
  operator: { uid: 'u-op', email: OPERATOR, email_verified: true },
  outsider: { uid: 'u-out', email: OUTSIDER, email_verified: true },
};
const auth = { async verifyIdToken(token) { if (TOKENS[token]) return TOKENS[token]; throw new Error('bad token'); } };

const PEOPLE = [
  { uid: 'a', email: 'Ada@Example.org', registrationStatus: 'approved', speakerId: null },
  { uid: 'b', email: 'ben@example.org', registrationStatus: 'ticketed', speakerId: null },
  { uid: 'c', email: 'cy@example.org', registrationStatus: 'pending', speakerId: null },
  { uid: 'd', email: 'dee@example.org', registrationStatus: 'revoked', speakerId: null },
  { uid: 'e', email: 'eve@example.org', registrationStatus: 'pending', speakerId: 'spk-1' },
  // A second account with Ada's address, in other case: one copy only.
  { uid: 'f', email: 'ada@example.org ', registrationStatus: 'approved', speakerId: null },
  { uid: 'g', email: 'not-an-address', registrationStatus: 'approved', speakerId: null },
];

async function seed(db, { people = PEOPLE, event = {} } = {}) {
  await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR], staffEmails: [STAFF] });
  await db.collection('config').doc('event').set({ historicalDemo: false, ...event });
  for (const person of people) {
    const { uid, ...data } = person;
    await db.collection('users').doc(uid).set(data);
  }
}

function makeConfig(db, providers = { email: { provider: 'console', messageStream: null } }) {
  return async () => {
    const event = (await db.collection('config').doc('event').get()).data();
    return {
      event: {
        ...event,
        name: 'Example Event',
        sender: { email: 'events@example.org', name: 'Example Event', replyTo: 'help@example.org' },
        legal: { postalAddressHtml: '1 Example Street' },
      },
      tierA: { publicUrl: SITE },
      providers,
    };
  };
}

function consoleProvider() {
  const mail = [];
  const provider = createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/tmp/unused' },
    log: { log() {} },
    appendFileSync: (_file, line) => mail.push(JSON.parse(line)),
  });
  let batches = 0;
  const counted = { ...provider, async sendBatch(messages) { batches += 1; return provider.sendBatch(messages); } };
  return { provider: counted, mail, batches: () => batches };
}

const QUIET = { error() {}, warn() {}, info() {}, log() {} };

async function harness({ backend, providerKind = 'console', postmarkStream, seedOptions } = {}) {
  const db = await backend.make();
  await seed(db, seedOptions);
  let provider;
  let mail = [];
  let batches = () => 0;
  let fetchCalls = [];
  let providers = { email: { provider: 'console', messageStream: null, announcementStream: 'announcements' } };
  if (providerKind === 'console') {
    ({ provider, mail, batches } = consoleProvider());
  } else if (providerKind === 'webhook') {
    provider = { name: 'webhook', async send() { throw new Error('not used'); } };
  } else {
    providers = { email: { provider: 'postmark', messageStream: 'outbound', announcementStream: postmarkStream?.id ?? null } };
    fetchCalls = [];
    const fetchImpl = async (url, init) => {
      fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes('/message-streams/')) {
        if (!postmarkStream?.body) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
        return { status: 200, headers: { get: () => null }, json: async () => postmarkStream.body };
      }
      if (url.endsWith('/email/batch')) {
        const body = JSON.parse(init.body);
        return { status: 200, headers: { get: () => null }, json: async () => body.map((_, i) => ({ ErrorCode: 0, MessageID: `pm-${fetchCalls.length}-${i}` })) };
      }
      return { status: 200, headers: { get: () => null }, json: async () => ({ ErrorCode: 0, MessageID: 'pm-single' }) };
    };
    provider = createPostmarkProvider({ env: { EMAIL_PROVIDER_API_KEY: 'token' }, fetchImpl });
  }
  const getConfig = makeConfig(db, providers);
  const emailCore = createEmailCore({ db, provider, getConfig, sleep: async () => {}, log: QUIET });
  let ids = 0;
  const deps = { db, auth, getConfig, provider, emailCore, log: QUIET, newId: () => `send-${(ids += 1)}-abcdef` };
  return {
    db,
    mail,
    batches,
    fetchCalls: () => fetchCalls,
    list: createListAnnouncementSendsHandler(deps),
    preview: createPreviewAnnouncementEmailHandler(deps),
    testSend: createSendAnnouncementTestHandler(deps),
    send: createSendAnnouncementEmailHandler(deps),
    unsubscribe: createEmailUnsubscribeHandler({ db, getConfig, log: QUIET }),
    restore: createRemoveEmailSuppressionHandler({ db, auth, getConfig, log: QUIET }),
  };
}

function call(handler, { token = 'staff', body = {}, method = 'POST', query = {}, ip = '203.0.113.9' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; },
    };
    Promise.resolve(handler({ method, headers, body, query }, res)).catch(reject);
  });
}

async function docsOf(db, name) {
  return (await db.collection(name).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

const DRAFT = { subject: 'Doors open at nine', message: 'Doors open at nine.\n\nBring your badge {{event_name}} <b>.', linkUrl: 'https://example.org/schedule', linkLabel: 'Read the schedule' };

async function previewAndSend(h, { audience = 'registered', draft = DRAFT, token = 'staff' } = {}) {
  const preview = await call(h.preview, { token, body: { draft, audience } });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const { sendId, receipt } = preview.body;
  const sent = await call(h.send, { token, body: { sendId, receipt, draft, audience } });
  return { preview, sent };
}

/** Unsubscribe query parameters from a captured message's header. */
function unsubscribeQuery(message) {
  const url = new URL(message.headers['List-Unsubscribe'].slice(1, -1));
  return Object.fromEntries(url.searchParams);
}

for (const backend of backends) {
  const t = (name, fn) => test(`[${backend.name}] ${name}`, fn);

  // --- Tiers -----------------------------------------------------------------

  t('every endpoint refuses a caller with no token or no admin tier, and admits staff and operators', async () => {
    const h = await harness({ backend });
    for (const handler of [h.list, h.preview, h.testSend, h.send, h.restore]) {
      assert.equal((await call(handler, { token: null })).status, 401);
      assert.equal((await call(handler, { token: 'outsider' })).status, 403);
    }
    assert.equal((await call(h.list, { token: 'staff' })).status, 200);
    assert.equal((await call(h.list, { token: 'operator' })).status, 200);
    const preview = await call(h.preview, { token: 'operator', body: { draft: DRAFT, audience: 'approved' } });
    assert.equal(preview.status, 200);
  });

  // --- Audience and preview ------------------------------------------------

  t('the preview counts each audience from private records and writes nothing', async () => {
    const h = await harness({ backend });
    const counts = {};
    for (const audience of ['registered', 'approved', 'speakers']) {
      const { body } = await call(h.preview, { body: { draft: DRAFT, audience } });
      counts[audience] = body.recipientCount;
      if (audience === 'registered') {
        assert.equal(body.unusableCount, 1);
        assert.equal(body.canSend, true);
        assert.match(body.receipt, /^[0-9a-f]{64}$/);
        assert.equal(body.from, 'Example Event <events@example.org>');
        // Staff text is escaped, not rendered as tokens or markup.
        assert.match(body.html, /Bring your badge \{\{event_name\}\} &lt;b&gt;\./);
        assert.match(body.text, /Bring your badge \{\{event_name\}\} <b>\./);
        // The preview carries only the inert test link.
        assert.match(body.html, /unsubscribe\?test=1/);
        assert.match(body.unsubscribeNote, /changes nothing/);
      }
    }
    assert.deepEqual(counts, { registered: 2, approved: 1, speakers: 1 });
    assert.equal((await docsOf(h.db, 'announcement_sends')).length, 0);
    assert.equal((await docsOf(h.db, 'email_claims')).length, 0);
    assert.equal((await docsOf(h.db, 'sent_emails')).length, 0);
    assert.equal((await docsOf(h.db, 'announcements')).length, 0, 'no website banner');
    assert.equal(h.mail.length, 0);
  });

  t('a draft or audience the server does not accept is refused with named fields', async () => {
    const h = await harness({ backend });
    const res = await call(h.preview, { body: { draft: { subject: '', message: 'x', linkUrl: 'javascript:alert(1)' }, audience: 'everyone' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /subject: must contain text/);
    assert.match(res.body.error.message, /linkUrl: must be an absolute http or https URL/);
    assert.match(res.body.error.message, /audience: must be one of the listed audiences/);
  });

  // --- Send ------------------------------------------------------------------

  t('a confirmed send reaches the console adapter as one batch, with an audit row per recipient', async () => {
    const h = await harness({ backend });
    const { sent } = await previewAndSend(h);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.send.status, 'sent');
    assert.deepEqual(sent.body.send.counts, { sent: 2, failed: 0, uncertain: 0, skipped: 0, suppressed: 0 });
    assert.equal(h.batches(), 1);
    assert.deepEqual(h.mail.map((m) => m.to).sort(), ['ada@example.org', 'ben@example.org']);

    const rows = await docsOf(h.db, 'sent_emails');
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.source === 'announcement' && row.status === 'sent'));

    // A separate stream, the one-click headers, and a link per recipient.
    for (const message of h.mail) {
      assert.equal(message.messageStream, 'announcements');
      assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      const link = message.headers['List-Unsubscribe'].slice(1, -1);
      assert.ok(link.startsWith(`${SITE}/unsubscribe?`));
      assert.ok(message.text.includes(link));
      assert.ok(message.html.includes(link.replace(/&/g, '&amp;')));
      assert.match(message.text, /1 Example Street/);
    }
    assert.notEqual(unsubscribeQuery(h.mail[0]).r, unsubscribeQuery(h.mail[1]).r);

    const logs = await docsOf(h.db, 'admin_logs');
    assert.deepEqual(logs.map((row) => row.action).sort(), ['completeAnnouncementEmail', 'startAnnouncementEmail']);
    assert.ok(logs.every((row) => row.email === STAFF));

    // The history shows the send with its counts and no recipient list.
    const history = await call(h.list);
    assert.equal(history.body.sends.length, 1);
    const row = history.body.sends[0];
    assert.equal(row.subject, DRAFT.subject);
    assert.equal(row.total, 2);
    assert.equal(row.createdBy, STAFF);
    assert.equal(row.recipients, undefined);
    assert.equal(row.unsubscribeKey, undefined);
    assert.deepEqual(history.body.channel, { canSend: true, blocker: null, mode: 'app' });
    assert.deepEqual(history.body.audiences.map((a) => a.id), ['registered', 'approved', 'speakers']);
  });

  t('submitting the same confirmed send again, even at once, sends no second copy', async () => {
    const h = await harness({ backend });
    const preview = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    const body = { sendId: preview.body.sendId, receipt: preview.body.receipt, draft: DRAFT, audience: 'registered' };
    const [first, second] = await Promise.all([call(h.send, { body }), call(h.send, { body })]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const third = await call(h.send, { body });
    assert.equal(third.body.send.status, 'sent');
    assert.equal(h.mail.length, 2);
    assert.equal((await docsOf(h.db, 'announcement_sends')).length, 1);
    assert.equal((await docsOf(h.db, 'sent_emails')).length, 2);
  });

  t('a large send goes in bounded chunks, and a retry after lost progress resumes with no duplicate', async () => {
    const people = Array.from({ length: sendsInternals.CHUNK_SIZE + 50 }, (_, n) => ({
      uid: `p${n}`, email: `person${n}@example.org`, registrationStatus: 'approved', speakerId: null,
    }));
    const h = await harness({ backend, seedOptions: { people } });
    const { preview, sent } = await previewAndSend(h, { audience: 'approved' });
    assert.equal(sent.body.send.status, 'sending');
    assert.equal(sent.body.send.processed, sendsInternals.CHUNK_SIZE);

    // The progress write of a chunk is lost, as if the call died after the
    // provider accepted the batch: the cursor goes back.
    const ref = h.db.collection('announcement_sends').doc(preview.body.sendId);
    await ref.update({ nextIndex: 0, counts: { sent: 0, failed: 0, uncertain: 0, skipped: 0, suppressed: 0 } });

    let state = (await call(h.send, { body: { sendId: preview.body.sendId } })).body.send;
    assert.equal(state.counts.skipped, sendsInternals.CHUNK_SIZE, 'claims skip every recipient already reached');
    while (state.status === 'sending') {
      state = (await call(h.send, { body: { sendId: preview.body.sendId } })).body.send;
    }
    assert.equal(state.status, 'sent');
    assert.equal(h.mail.length, people.length);
    assert.equal(new Set(h.mail.map((m) => m.to)).size, people.length);
    assert.equal((await docsOf(h.db, 'sent_emails')).length, people.length);
  });

  t('a change after the preview is refused before any record or claim', async () => {
    const h = await harness({ backend });
    const preview = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    // Someone new registers between the preview and the confirmation.
    await h.db.collection('users').doc('late').set({ email: 'late@example.org', registrationStatus: 'approved', speakerId: null });
    const stale = await call(h.send, { body: { sendId: preview.body.sendId, receipt: preview.body.receipt, draft: DRAFT, audience: 'registered' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'preview-stale');

    const fresh = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    const edited = await call(h.send, { body: { sendId: fresh.body.sendId, receipt: fresh.body.receipt, draft: { ...DRAFT, subject: 'Changed' }, audience: 'registered' } });
    assert.equal(edited.status, 409);
    assert.equal(edited.body.error.code, 'preview-stale');

    assert.equal((await docsOf(h.db, 'announcement_sends')).length, 0);
    assert.equal((await docsOf(h.db, 'email_claims')).length, 0);
    assert.equal(h.mail.length, 0);
  });

  t('a test send goes to the caller only, with the inert link', async () => {
    const h = await harness({ backend });
    const res = await call(h.testSend, { body: { draft: DRAFT } });
    assert.equal(res.status, 200);
    assert.equal(res.body.sentTo, STAFF);
    assert.equal(h.mail.length, 1);
    assert.equal(h.mail[0].to, STAFF);
    assert.equal(h.mail[0].subject, `Test: ${DRAFT.subject}`);
    assert.match(h.mail[0].text, /unsubscribe\?test=1/);
    const rows = await docsOf(h.db, 'sent_emails');
    assert.deepEqual(rows.map((row) => row.source), ['announcement-test']);
    assert.equal((await docsOf(h.db, 'announcement_sends')).length, 0);

    const page = await call(h.unsubscribe, { method: 'POST', token: null, query: { test: '1' } });
    assert.match(page.body, /Nothing changed/);
    assert.equal((await docsOf(h.db, 'email_suppressions')).length, 0);
  });

  // --- Unsubscribe -------------------------------------------------------------

  t('a one-click unsubscribe is recorded and every later send leaves the address out', async () => {
    const h = await harness({ backend });
    await previewAndSend(h);
    const ben = h.mail.find((m) => m.to === 'ben@example.org');
    const query = unsubscribeQuery(ben);

    // A GET shows the button and records nothing: a link scanner cannot opt a reader out.
    const page = await call(h.unsubscribe, { method: 'GET', token: null, query });
    assert.equal(page.status, 200);
    assert.match(page.body, /<form method="post"/);
    assert.equal((await docsOf(h.db, 'email_suppressions')).length, 0);

    const done = await call(h.unsubscribe, { method: 'POST', token: null, query, body: { 'List-Unsubscribe': 'One-Click' } });
    assert.equal(done.status, 200);
    assert.match(done.body, /You are unsubscribed/);
    const suppressions = await docsOf(h.db, 'email_suppressions');
    assert.deepEqual(suppressions.map((row) => [row.id, row.via]), [[suppressionIdFor('ben@example.org'), 'one-click']]);
    assert.ok(!JSON.stringify(suppressions).includes('ben@example.org'), 'the record holds no address');
    const log = (await docsOf(h.db, 'admin_logs')).find((row) => row.action === 'emailUnsubscribe');
    assert.ok(log);
    assert.ok(!JSON.stringify(log).includes('ben@'));

    // A repeat is harmless and writes no second log row.
    await call(h.unsubscribe, { method: 'POST', token: null, query });
    assert.equal((await docsOf(h.db, 'admin_logs')).filter((row) => row.action === 'emailUnsubscribe').length, 1);

    const preview = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    assert.equal(preview.body.recipientCount, 1);
    assert.equal(preview.body.suppressedCount, 1);
    h.mail.length = 0;
    await call(h.send, { body: { sendId: preview.body.sendId, receipt: preview.body.receipt, draft: DRAFT, audience: 'registered' } });
    assert.deepEqual(h.mail.map((m) => m.to), ['ada@example.org']);

    // The staff removal path restores the address.
    const restored = await call(h.restore, { body: { email: 'Ben@Example.org' } });
    assert.deepEqual(restored.body, { removed: true });
    assert.equal((await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } })).body.recipientCount, 2);
    assert.ok((await docsOf(h.db, 'admin_logs')).some((row) => row.action === 'removeEmailSuppression' && row.email === STAFF));
  });

  t('an unsubscribe opt-out recorded during a send holds for the rest of that send', async () => {
    const people = Array.from({ length: sendsInternals.CHUNK_SIZE + 1 }, (_, n) => ({
      uid: `p${n}`, email: `person${String(n).padStart(3, '0')}@example.org`, registrationStatus: 'approved', speakerId: null,
    }));
    const h = await harness({ backend, seedOptions: { people } });
    const { preview, sent } = await previewAndSend(h, { audience: 'approved' });
    assert.equal(sent.body.send.status, 'sending');
    const last = people[people.length - 1].email;
    await h.db.collection('email_suppressions').doc(suppressionIdFor(last)).set({ scope: 'announcements', via: 'link' });
    const done = await call(h.send, { body: { sendId: preview.body.sendId } });
    assert.equal(done.body.send.status, 'sent');
    assert.equal(done.body.send.counts.suppressed, 1);
    assert.ok(!h.mail.some((m) => m.to === last));
  });

  t('a forged, altered, or truncated link changes nothing', async () => {
    const h = await harness({ backend });
    await previewAndSend(h);
    const query = unsubscribeQuery(h.mail[0]);
    const other = suppressionIdFor('someone-else@example.org');
    for (const bad of [
      { ...query, r: other },
      { ...query, t: `${query.t.slice(0, -1)}${query.t.endsWith('A') ? 'B' : 'A'}` },
      { ...query, s: 'send-999-abcdef' },
      { s: query.s, r: query.r },
    ]) {
      const res = await call(h.unsubscribe, { method: 'POST', token: null, query: bad });
      assert.equal(res.status, 400);
    }
    assert.equal((await docsOf(h.db, 'email_suppressions')).length, 0);
  });

  t('the unsubscribe endpoint is rate limited per client address', async () => {
    const h = await harness({ backend });
    for (let n = 0; n < suppressionInternals.RATE_LIMIT_MAX; n += 1) {
      await call(h.unsubscribe, { method: 'GET', token: null, query: { s: 'send-1-abcdef', r: 'a'.repeat(64), t: 'b'.repeat(43) } });
    }
    const limited = await call(h.unsubscribe, { method: 'GET', token: null, query: { s: 'send-1-abcdef', r: 'a'.repeat(64), t: 'b'.repeat(43) } });
    assert.equal(limited.status, 429);
  });

  // --- Historical demo ---------------------------------------------------------

  t('the historical demo refuses sends, test sends, and opt-out writes', async () => {
    const h = await harness({ backend });
    await previewAndSend(h); // a real send first, so a link exists
    const query = unsubscribeQuery(h.mail[0]);
    h.mail.length = 0;
    await h.db.collection('config').doc('event').set({ historicalDemo: true });

    const preview = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    assert.equal(preview.body.canSend, false);
    assert.match(preview.body.blocker, /read-only/);
    const send = await call(h.send, { body: { sendId: 'send-77-abcdef', receipt: preview.body.receipt, draft: DRAFT, audience: 'registered' } });
    assert.equal(send.status, 403);
    assert.equal(send.body.error.code, 'read-only-demo');
    const testSend = await call(h.testSend, { body: { draft: DRAFT } });
    assert.equal(testSend.status, 403);
    const unsubscribe = await call(h.unsubscribe, { method: 'POST', token: null, query });
    assert.equal(unsubscribe.status, 403);

    assert.equal(h.mail.length, 0);
    assert.equal((await docsOf(h.db, 'announcement_sends')).length, 1);
    assert.equal((await docsOf(h.db, 'email_suppressions')).length, 0);
  });

  // --- Provider channel (issue #490) ---------------------------------------------

  t('the webhook relay is refused before any record, claim, or request', async () => {
    const h = await harness({ backend, providerKind: 'webhook' });
    const preview = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    assert.equal(preview.body.canSend, false);
    assert.match(preview.body.blocker, /webhook relay/);
    const send = await call(h.send, { body: { sendId: 'send-5-abcdef', receipt: 'a'.repeat(64), draft: DRAFT, audience: 'registered' } });
    assert.equal(send.status, 409);
    assert.equal(send.body.error.code, 'unsupported-provider');
    const testSend = await call(h.testSend, { body: { draft: DRAFT } });
    assert.equal(testSend.status, 409);
    assert.equal((await docsOf(h.db, 'announcement_sends')).length, 0);
    assert.equal((await docsOf(h.db, 'email_claims')).length, 0);
  });

  const STREAM = (overrides = {}) => ({
    id: 'announcements',
    body: {
      ID: 'announcements',
      MessageStreamType: 'Broadcasts',
      ArchivedAt: null,
      SubscriptionManagementConfiguration: { UnsubscribeHandlingType: 'Postmark' },
      ...overrides,
    },
  });

  for (const [label, stream, code] of [
    ['no announcement stream set', { id: null }, 'stream-missing'],
    ['a stream Postmark does not have', { id: 'announcements', body: null }, 'stream-not-found'],
    ['an archived stream', STREAM({ ArchivedAt: '2026-01-01T00:00:00Z' }), 'stream-archived'],
    ['a transactional stream', STREAM({ MessageStreamType: 'Transactional' }), 'stream-transactional'],
    ['a stream with no unsubscribe handling', STREAM({ SubscriptionManagementConfiguration: { UnsubscribeHandlingType: 'None' } }), 'stream-unsubscribe'],
    ['the transactional stream itself', { id: 'outbound', body: STREAM().body }, 'stream-transactional'],
  ]) {
    t(`postmark: ${label} is refused before any claim or send`, async () => {
      const h = await harness({ backend, providerKind: 'postmark', postmarkStream: stream });
      const send = await call(h.send, { body: { sendId: 'send-9-abcdef', receipt: 'a'.repeat(64), draft: DRAFT, audience: 'registered' } });
      assert.equal(send.status, 409);
      assert.equal(send.body.error.code, code);
      assert.equal(h.fetchCalls().filter((c) => c.url.includes('/email')).length, 0);
      assert.equal((await docsOf(h.db, 'email_claims')).length, 0);
      assert.equal((await docsOf(h.db, 'announcement_sends')).length, 0);
    });
  }

  t('postmark with Postmark unsubscribe handling: the batch carries the broadcast stream and no application link', async () => {
    const h = await harness({ backend, providerKind: 'postmark', postmarkStream: STREAM() });
    const preview = await call(h.preview, { body: { draft: DRAFT, audience: 'registered' } });
    assert.match(preview.body.unsubscribeNote, /Postmark adds an unsubscribe link/);
    assert.doesNotMatch(preview.body.html, /unsubscribe\?/);
    const sent = await call(h.send, { body: { sendId: preview.body.sendId, receipt: preview.body.receipt, draft: DRAFT, audience: 'registered' } });
    assert.equal(sent.body.send.status, 'sent');
    const batch = h.fetchCalls().filter((c) => c.url.endsWith('/email/batch'));
    assert.equal(batch.length, 1);
    assert.deepEqual(batch[0].body.map((entry) => entry.MessageStream), ['announcements', 'announcements']);
    assert.ok(batch[0].body.every((entry) => !entry.Headers && !entry.TextBody.includes('/unsubscribe?')));
  });

  t('postmark with Custom unsubscribe handling: the application link and headers ride on every entry', async () => {
    const h = await harness({
      backend,
      providerKind: 'postmark',
      postmarkStream: STREAM({ SubscriptionManagementConfiguration: { UnsubscribeHandlingType: 'Custom' } }),
    });
    const { sent } = await previewAndSend(h);
    assert.equal(sent.body.send.status, 'sent');
    const [batch] = h.fetchCalls().filter((c) => c.url.endsWith('/email/batch'));
    for (const entry of batch.body) {
      const names = entry.Headers.map((header) => header.Name);
      assert.deepEqual(names, ['List-Unsubscribe', 'List-Unsubscribe-Post']);
      assert.ok(entry.TextBody.includes(`${SITE}/unsubscribe?`));
    }
  });

  t('a Postmark opt-out on an announcement row becomes the suppression record; a transactional one does not', async () => {
    const h = await harness({ backend });
    await h.db.collection('sent_emails').doc('row-a').set({ providerMessageId: 'pm-a', source: 'announcement', to: 'ada@example.org' });
    await h.db.collection('sent_emails').doc('row-b').set({ providerMessageId: 'pm-b', source: 'auth-otp', to: 'ben@example.org' });
    const provider = createPostmarkProvider({ env: { EMAIL_PROVIDER_API_KEY: 'k', EMAIL_WEBHOOK_BASIC_AUTH: 'u:p' } });
    const webhook = createDeliveryWebhookHandler({ db: h.db, provider, log: QUIET });
    const headers = { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` };
    for (const [id, recipient] of [['pm-a', 'ada@example.org'], ['pm-b', 'ben@example.org']]) {
      const body = { RecordType: 'SubscriptionChange', MessageID: id, Recipient: recipient, SuppressSending: true, ChangedAt: '2026-10-01T00:00:00Z', SuppressionReason: 'ManualSuppression' };
      await new Promise((resolve) => {
        const res = { set() { return this; }, status() { return this; }, json: resolve };
        webhook({ method: 'POST', headers, body, rawBody: Buffer.from(JSON.stringify(body)) }, res);
      });
    }
    const ids = (await docsOf(h.db, 'email_suppressions')).map((row) => row.id);
    assert.deepEqual(ids, [suppressionIdFor('ada@example.org')]);
  });
}
