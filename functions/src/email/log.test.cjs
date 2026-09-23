'use strict';

// The outbound email log (issue #183): listSentEmails and getSentEmail over
// the server-only `sent_emails` collection. The done line crosses the send
// path, the store and the reader, so the first test below sends a real
// auth.otp render through the real email core into the same fake db the
// reader lists from; a hand-built fixture row would not catch the writer and
// the reader drifting apart.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { createListSentEmailsHandler, createGetSentEmailHandler, internals } = require('./log.cjs');
const { createEmailCore } = require('./send.cjs');
const { render } = require('./render.cjs');
const otpTemplate = require('./templates/auth.otp.cjs');

/**
 * In-memory Firestore fake: `add`, doc get/set, `==` filters, two
 * `orderBy` keys (`__name__` is the document id, as FieldPath.documentId()
 * is), `startAfter`, `limit`, and `select`, which drops every field it does
 * not name and records the list it was given. Every query records its
 * limit, so a test can state how many rows one request may read.
 */
function makeFakeDb(seed = {}) {
  const store = new Map(); // "collection/id" -> data
  for (const [path, data] of Object.entries(seed)) store.set(path, { ...data });
  const selects = [];
  const limits = [];
  let counter = 0;

  function docRef(c, id) {
    return {
      id,
      async get() {
        const data = store.get(`${c}/${id}`);
        return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
      },
      async set(data) {
        store.set(`${c}/${id}`, { ...data });
      },
    };
  }

  const orderVal = (v) => (v instanceof Date ? v.getTime() : v);
  const fieldOf = (row, field) => (field === '__name__' ? row.id : row.data[field]);

  function query(c, state) {
    const next = (patch) => query(c, { ...state, ...patch });
    return {
      where(field, op, value) {
        if (op !== '==') throw new Error(`fake supports only '==', got ${op}`);
        return next({ filters: [...state.filters, { field, value }] });
      },
      orderBy(field, direction = 'asc') {
        return next({ orders: [...state.orders, { field, direction }] });
      },
      startAfter(...values) {
        return next({ after: values });
      },
      limit(n) {
        return next({ limit: n });
      },
      select(...fields) {
        selects.push(fields);
        return next({ select: fields });
      },
      async get() {
        limits.push(state.limit);
        let rows = [...store.entries()]
          .filter(([path]) => path.startsWith(`${c}/`))
          .map(([path, data]) => ({ id: path.slice(c.length + 1), data }))
          .filter((row) => state.filters.every((f) => row.data[f.field] === f.value));
        rows.sort((a, b) => {
          for (const order of state.orders) {
            const dir = order.direction === 'desc' ? -1 : 1;
            const av = orderVal(fieldOf(a, order.field));
            const bv = orderVal(fieldOf(b, order.field));
            if (av < bv) return -dir;
            if (av > bv) return dir;
          }
          return 0;
        });
        if (state.after) {
          rows = rows.filter((row) => {
            for (let i = 0; i < state.orders.length; i += 1) {
              const dir = state.orders[i].direction === 'desc' ? -1 : 1;
              const rv = orderVal(fieldOf(row, state.orders[i].field));
              const sv = orderVal(state.after[i]);
              if (rv === sv) continue;
              return dir === 1 ? rv > sv : rv < sv;
            }
            return false;
          });
        }
        if (typeof state.limit === 'number') rows = rows.slice(0, state.limit);
        const docs = rows.map(({ id, data }) => {
          const picked = state.select
            ? Object.fromEntries(state.select.filter((f) => f in data).map((f) => [f, data[f]]))
            : { ...data };
          return { id, exists: true, data: () => ({ ...picked }) };
        });
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  const EMPTY = { filters: [], orders: [], after: null, limit: undefined, select: null };
  return {
    store,
    selects,
    limits,
    collection(c) {
      const base = query(c, EMPTY);
      return {
        ...base,
        doc: (id) => docRef(c, id ?? `auto-${(counter += 1)}`),
        async add(data) {
          counter += 1;
          const id = `auto-${String(counter).padStart(6, '0')}`;
          store.set(`${c}/${id}`, { ...data });
          return docRef(c, id);
        },
      };
    },
  };
}

const BOOTSTRAP = {
  'config/bootstrap': { adminEmails: ['admin@example.test'], staffEmails: ['staff@example.test'] },
};

const TOKENS = {
  'admin-token': { uid: 'admin-1', email: 'admin@example.test', email_verified: true },
  'staff-token': { uid: 'staff-1', email: 'staff@example.test', email_verified: true },
  'user-token': { uid: 'user-1', email: 'user@example.test', email_verified: true },
  'unverified-token': { uid: 'admin-2', email: 'admin@example.test', email_verified: false },
};
const auth = {
  async verifyIdToken(token) {
    if (TOKENS[token]) return TOKENS[token];
    throw new Error('auth/argument-error');
  },
};
// requireAdmin reads config/bootstrap live from the db; this cached copy is
// never consulted on that path and names nobody, so a test that passes only
// because of it would fail.
const getConfig = async () => ({ bootstrap: null });

function req({ method = 'POST', token = 'admin-token', body = {} } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}
function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}
const quietLog = { error() {}, warn() {}, info() {} };

async function list(db, body = {}, token = 'admin-token') {
  const res = fakeRes();
  await createListSentEmailsHandler({ db, auth, getConfig, log: quietLog })(req({ token, body }), res);
  return res;
}
async function get(db, body = {}, token = 'admin-token', now = () => 5000) {
  const res = fakeRes();
  await createGetSentEmailHandler({ db, auth, getConfig, now, log: quietLog })(req({ token, body }), res);
  return res;
}

/** A stored row as send.cjs writeAuditRow shapes it. */
function row(overrides = {}) {
  return {
    to: 'reader@example.test',
    from: 'desk@example.test',
    subject: 'Your speaker confirmation',
    templateId: 'speaker.confirmation',
    providerMessageId: 'pm-1',
    status: 'sent',
    providerStatus: 200,
    error: null,
    retries: 0,
    bodyStored: true,
    html: '<p>Hello.</p>',
    text: 'Hello.',
    bodyTruncated: false,
    source: 'speaker-confirmation',
    sentAt: new Date(1000),
    ...overrides,
  };
}

const adminLogs = (db) =>
  [...db.store.entries()].filter(([path]) => path.startsWith('admin_logs/')).map(([, data]) => data);

// --- the gate ---------------------------------------------------------------

test('both endpoints: 401 with no token, 403 for a non-admin and an unverified admin address, 405 for GET', async () => {
  const db = makeFakeDb({ ...BOOTSTRAP, 'sent_emails/m1': row() });
  for (const create of [createListSentEmailsHandler, createGetSentEmailHandler]) {
    const handler = create({ db, auth, getConfig, log: quietLog });
    const body = { id: 'm1' };

    let res = fakeRes();
    await handler(req({ token: null, body }), res);
    assert.equal(res.statusCode, 401);

    res = fakeRes();
    await handler(req({ token: 'user-token', body }), res);
    assert.equal(res.statusCode, 403);

    res = fakeRes();
    await handler(req({ token: 'unverified-token', body }), res);
    assert.equal(res.statusCode, 403);

    res = fakeRes();
    await handler(req({ method: 'GET', body }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'POST');
  }
  assert.equal(adminLogs(db).length, 0, 'a refused read leaves no audit row');
});

test('both endpoints admit a staff address: the tier is stated as staff, since an unstated tier means operator', async () => {
  const db = makeFakeDb({ ...BOOTSTRAP, 'sent_emails/m1': row() });
  const listed = await list(db, {}, 'staff-token');
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body.rows.map((r) => r.id), ['m1']);
  const fetched = await get(db, { id: 'm1' }, 'staff-token');
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.body.row.html, '<p>Hello.</p>');
});

test('an absent config/bootstrap admits nobody (the gate fails closed)', async () => {
  const db = makeFakeDb({ 'sent_emails/m1': row() });
  assert.equal((await list(db)).statusCode, 403);
  assert.equal((await get(db, { id: 'm1' })).statusCode, 403);
});

// --- the done line: a sent code email appears in the log ----------------------

test('a code email sent through the real email core appears in the log, with no subject and no body', async () => {
  const db = makeFakeDb(BOOTSTRAP);
  const provider = { async send() { return { providerMessageId: 'pm-otp', status: 'sent' }; } };
  const core = createEmailCore({ db, provider, getConfig: async () => ({}), sleep: async () => {}, log: quietLog });
  const rendered = render({
    template: otpTemplate,
    tokenValues: { code: '482913', expiry_minutes: '10' },
    config: {},
  });
  // The same message auth/otp.cjs builds for sendEmail.
  const result = await core.send({
    to: 'reader@example.test',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tag: 'auth.otp',
    source: 'auth-otp',
    storeRendered: rendered.storeRendered,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
  });
  assert.equal(result.status, 'sent');

  const listed = await list(db);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.rows.length, 1);
  const [logged] = listed.body.rows;
  assert.equal(logged.to, 'reader@example.test');
  assert.equal(logged.source, 'auth-otp');
  assert.equal(logged.templateId, 'auth.otp');
  assert.equal(logged.status, 'sent');
  assert.equal(logged.subject, null);
  assert.equal(logged.bodyStored, false);
  assert.equal(typeof logged.sentAt, 'number');
  assert.ok(!JSON.stringify(listed.body).includes('482913'), 'the code never leaves the log');

  // A search for the recipient finds it, without regard to case.
  const searched = await list(db, { q: 'Reader@Example.TEST' });
  assert.deepEqual(searched.body.rows.map((r) => r.id), [logged.id]);

  // And the preview has nothing to show: the body was never stored.
  const fetched = await get(db, { id: logged.id });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.body.row.html, null);
  assert.equal(fetched.body.row.text, null);
  assert.ok(!JSON.stringify(fetched.body).includes('482913'));
});

// --- listSentEmails -----------------------------------------------------------

test('listSentEmails: newest first, list fields only, and select names no body field', async () => {
  const db = makeFakeDb({
    ...BOOTSTRAP,
    'sent_emails/old': row({ sentAt: new Date(1000) }),
    'sent_emails/new': row({ sentAt: new Date(3000), deliveryStatus: 'bounced', deliveryUpdatedAt: '1970-01-01T00:00:04.000Z', bounceReason: 'Mailbox full' }),
    'sent_emails/mid': row({ sentAt: new Date(2000), status: 'failed', error: 'no recipient', to: null }),
  });
  const res = await list(db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((r) => r.id), ['new', 'mid', 'old']);
  assert.equal(res.body.nextCursor, null);
  assert.equal(res.body.scanned, 3);

  assert.deepEqual(res.body.rows[0], {
    id: 'new',
    sentAt: 3000,
    to: 'reader@example.test',
    from: 'desk@example.test',
    subject: 'Your speaker confirmation',
    templateId: 'speaker.confirmation',
    source: 'speaker-confirmation',
    status: 'sent',
    deliveryStatus: 'bounced',
    deliveryUpdatedAt: 4000,
    bounceReason: 'Mailbox full',
    error: null,
    retries: 0,
    bodyStored: true,
    bodyTruncated: false,
  });
  assert.equal(res.body.rows[1].to, null);
  assert.equal(res.body.rows[1].error, 'no recipient');

  assert.deepEqual(db.selects, [[...internals.LIST_FIELDS]]);
  assert.ok(!internals.LIST_FIELDS.includes('html'));
  assert.ok(!internals.LIST_FIELDS.includes('text'));
  assert.ok(!JSON.stringify(res.body).includes('Hello.'), 'no body leaves Firestore on a list');
});

test('listSentEmails writes no admin_logs row', async () => {
  const db = makeFakeDb({ ...BOOTSTRAP, 'sent_emails/m1': row() });
  await list(db);
  await list(db, { q: 'reader' });
  assert.equal(adminLogs(db).length, 0);
});

test('q matches the recipient or the subject without regard to case, and skips null fields without a throw', async () => {
  const db = makeFakeDb({
    ...BOOTSTRAP,
    'sent_emails/a': row({ to: 'Alex@Example.test', subject: 'Welcome', sentAt: new Date(4000) }),
    'sent_emails/b': row({ to: 'sam@example.test', subject: 'Your ALEX pass', sentAt: new Date(3000) }),
    'sent_emails/c': row({ to: null, subject: null, bodyStored: false, sentAt: new Date(2000) }),
    'sent_emails/d': row({ to: 'kim@example.test', subject: 'Other', sentAt: new Date(1000) }),
  });
  const res = await list(db, { q: '  alex ' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((r) => r.id), ['a', 'b']);
  assert.equal(res.body.scanned, 4);
  assert.equal(res.body.nextCursor, null);

  const bySubject = await list(db, { q: 'OTHER' });
  assert.deepEqual(bySubject.body.rows.map((r) => r.id), ['d']);
});

test('source, status, and both together filter the list', async () => {
  const db = makeFakeDb({
    ...BOOTSTRAP,
    'sent_emails/otp-ok': row({ source: 'auth-otp', status: 'sent', sentAt: new Date(4000) }),
    'sent_emails/otp-failed': row({ source: 'auth-otp', status: 'failed', sentAt: new Date(3000) }),
    'sent_emails/feedback-failed': row({ source: 'feedback', status: 'failed', sentAt: new Date(2000) }),
    'sent_emails/feedback-ok': row({ source: 'feedback', status: 'sent', sentAt: new Date(1000) }),
  });
  assert.deepEqual((await list(db, { source: 'auth-otp' })).body.rows.map((r) => r.id), ['otp-ok', 'otp-failed']);
  assert.deepEqual((await list(db, { status: 'failed' })).body.rows.map((r) => r.id), ['otp-failed', 'feedback-failed']);
  assert.deepEqual(
    (await list(db, { source: 'feedback', status: 'sent' })).body.rows.map((r) => r.id),
    ['feedback-ok'],
  );
});

test('listSentEmails: 400 naming the field for a bad q, source, status, limit or cursor, never echoing the value', async () => {
  const db = makeFakeDb({ ...BOOTSTRAP, 'sent_emails/m1': row() });
  const cases = [
    [{ q: 42 }, 'q'],
    [{ q: 'x'.repeat(201) }, 'q'],
    [{ source: 'Auth OTP' }, 'source'],
    [{ source: 'a'.repeat(65) }, 'source'],
    [{ source: 7 }, 'source'],
    [{ status: 'bounced' }, 'status'],
    [{ limit: 0 }, 'limit'],
    [{ limit: 51 }, 'limit'],
    [{ limit: 2.5 }, 'limit'],
    [{ limit: '10' }, 'limit'],
    [{ cursor: 'm1' }, 'cursor'],
    [{ cursor: { sentAt: Number.NaN, id: 'm1' } }, 'cursor'],
    [{ cursor: { sentAt: Infinity, id: 'm1' } }, 'cursor'],
    [{ cursor: { sentAt: '1000', id: 'm1' } }, 'cursor'],
    [{ cursor: { sentAt: 1000, id: 'a/b' } }, 'cursor'],
    [{ cursor: { sentAt: 1000, id: '..' } }, 'cursor'],
    [{ cursor: { sentAt: 1000, id: '__name__' } }, 'cursor'],
    [{ cursor: { sentAt: 1000, id: '' } }, 'cursor'],
  ];
  for (const [body, field] of cases) {
    const res = await list(db, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'bad-request');
    assert.match(res.body.error.message, new RegExp(`^${field} `), JSON.stringify(body));
  }
  // A search value is personal data; a refusal must not repeat it.
  const res = await list(db, { q: `private-${'y'.repeat(200)}@example.test` });
  assert.equal(res.statusCode, 400);
  assert.ok(!res.body.error.message.includes('private-'));
  // A whitespace-only search is no search.
  assert.equal((await list(db, { q: '   ' })).statusCode, 200);
  // Absent and null values are absent.
  assert.equal((await list(db, { q: null, source: null, status: null, cursor: null })).statusCode, 200);
});

test('limit defaults to 25, and without q one request reads limit + 1 rows', async () => {
  const seed = { ...BOOTSTRAP };
  for (let i = 0; i < 30; i += 1) seed[`sent_emails/m${String(i).padStart(2, '0')}`] = row({ sentAt: new Date(1000 + i) });
  const db = makeFakeDb(seed);
  const res = await list(db);
  assert.equal(res.body.rows.length, 25);
  assert.deepEqual(res.body.nextCursor, { sentAt: 1005, id: 'm05' });
  assert.deepEqual(db.limits, [26]);

  await list(db, { limit: 50 });
  assert.deepEqual(db.limits, [26, 51]);
});

test('two rows with the same sentAt across a page boundary: none skipped, none repeated', async () => {
  const same = new Date(5000);
  const db = makeFakeDb({
    ...BOOTSTRAP,
    'sent_emails/a': row({ sentAt: same }),
    'sent_emails/b': row({ sentAt: same }),
    'sent_emails/c': row({ sentAt: same }),
    'sent_emails/z': row({ sentAt: new Date(1000) }),
  });
  const seen = [];
  let cursor;
  for (let page = 0; page < 5; page += 1) {
    const res = await list(db, { limit: 2, ...(cursor ? { cursor } : {}) });
    assert.equal(res.statusCode, 200);
    seen.push(...res.body.rows.map((r) => r.id));
    cursor = res.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, ['c', 'b', 'a', 'z']);

  // The same holds for a search, whose cursor is the last row examined.
  const searched = [];
  cursor = undefined;
  for (let page = 0; page < 5; page += 1) {
    const res = await list(db, { q: 'reader', limit: 1, ...(cursor ? { cursor } : {}) });
    searched.push(...res.body.rows.map((r) => r.id));
    cursor = res.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(searched, ['c', 'b', 'a', 'z']);
});

test('a search reads at most 500 rows: 600 non-matching rows answer empty with a cursor, and the next call finishes the scan', async () => {
  const seed = { ...BOOTSTRAP };
  for (let i = 0; i < 600; i += 1) {
    seed[`sent_emails/m${String(i).padStart(3, '0')}`] = row({ to: `person${i}@example.test`, sentAt: new Date(10_000 + i) });
  }
  const db = makeFakeDb(seed);
  const first = await list(db, { q: 'nobody-matches' });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.rows, []);
  assert.equal(first.body.scanned, 500);
  assert.deepEqual(first.body.nextCursor, { sentAt: 10_100, id: 'm100' });
  assert.deepEqual(db.limits, [internals.SCAN_CAP]);
  assert.equal(internals.SCAN_CAP, 500);

  const second = await list(db, { q: 'nobody-matches', cursor: first.body.nextCursor });
  assert.deepEqual(second.body.rows, []);
  assert.equal(second.body.scanned, 100);
  assert.equal(second.body.nextCursor, null);
});

test('a search stops at limit matches, and its cursor is the last row it examined', async () => {
  const seed = { ...BOOTSTRAP };
  for (let i = 0; i < 10; i += 1) seed[`sent_emails/m${i}`] = row({ sentAt: new Date(1000 + i) });
  const db = makeFakeDb(seed);
  const res = await list(db, { q: 'reader', limit: 3 });
  assert.deepEqual(res.body.rows.map((r) => r.id), ['m9', 'm8', 'm7']);
  assert.equal(res.body.scanned, 3);
  assert.deepEqual(res.body.nextCursor, { sentAt: 1007, id: 'm7' });
});

test('a failed query answers 500 without detail', async () => {
  const db = makeFakeDb(BOOTSTRAP);
  const broken = {
    collection(name) {
      if (name !== 'sent_emails') return db.collection(name);
      const failing = { get: async () => { throw new Error('FAILED_PRECONDITION: index'); } };
      const chain = new Proxy({}, { get: (_t, key) => (key === 'get' ? failing.get : () => chain) });
      return chain;
    },
  };
  const res = fakeRes();
  await createListSentEmailsHandler({ db: broken, auth, getConfig, log: quietLog })(req({ body: {} }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'internal');
  assert.ok(!res.body.error.message.includes('FAILED_PRECONDITION'));
});

// --- getSentEmail -------------------------------------------------------------

test('getSentEmail returns the stored bodies and the provider fields', async () => {
  const db = makeFakeDb({
    ...BOOTSTRAP,
    'sent_emails/m1': row({ html: '<p>Hi.</p>', text: 'Hi.', bodyTruncated: true, providerStatus: 422 }),
  });
  const res = await get(db, { id: 'm1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.row, {
    id: 'm1',
    sentAt: 1000,
    to: 'reader@example.test',
    from: 'desk@example.test',
    subject: 'Your speaker confirmation',
    templateId: 'speaker.confirmation',
    source: 'speaker-confirmation',
    status: 'sent',
    deliveryStatus: null,
    deliveryUpdatedAt: null,
    bounceReason: null,
    error: null,
    retries: 0,
    bodyStored: true,
    bodyTruncated: true,
    html: '<p>Hi.</p>',
    text: 'Hi.',
    providerMessageId: 'pm-1',
    providerStatus: 422,
  });
});

test('getSentEmail writes one view-sent-email row naming the actor and the path, never the address or the subject', async () => {
  const db = makeFakeDb({ ...BOOTSTRAP, 'sent_emails/m1': row() });
  await get(db, { id: 'm1' }, 'staff-token', () => 7000);
  const logs = adminLogs(db);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    action: 'view-sent-email',
    docPath: 'sent_emails/m1',
    uid: 'staff-1',
    email: 'staff@example.test',
    at: new Date(7000),
  });
  const written = JSON.stringify(logs[0]);
  assert.ok(!written.includes('reader@example.test'));
  assert.ok(!written.includes('speaker confirmation'));
});

test('getSentEmail: 404 for a missing id, with no audit row', async () => {
  const db = makeFakeDb(BOOTSTRAP);
  const res = await get(db, { id: 'missing' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'not-found');
  assert.equal(adminLogs(db).length, 0);
});

test('getSentEmail: 400 for an id that is not a document id', async () => {
  const db = makeFakeDb({ ...BOOTSTRAP, 'sent_emails/m1': row() });
  for (const id of [undefined, null, '', 42, 'a/b', '.', '..', '__x__', 'x'.repeat(129)]) {
    const res = await get(db, { id });
    assert.equal(res.statusCode, 400, String(id));
    assert.match(res.body.error.message, /^id /);
  }
  assert.equal(adminLogs(db).length, 0);
});

test('isValidDocId accepts an auto id and refuses the shapes doc() and startAfter() throw on', () => {
  const { isValidDocId } = internals;
  assert.equal(isValidDocId('Xy3kQ9aB0cD1eF2gH3iJ'), true);
  assert.equal(isValidDocId('x'.repeat(128)), true);
  for (const bad of ['', '.', '..', 'a/b', '__id__', 'x'.repeat(129), null, 3]) {
    assert.equal(isValidDocId(bad), false, String(bad));
  }
});

// --- deploy surface -----------------------------------------------------------

test('firestore.indexes.json declares the three sent_emails indexes the filters need', () => {
  const declared = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8'));
  const shapes = (declared.indexes || [])
    .filter((ix) => ix.collectionGroup === 'sent_emails' && ix.queryScope === 'COLLECTION')
    .map((ix) => ix.fields.map((f) => `${f.fieldPath} ${f.order}`).join(', '));
  for (const expected of [
    'source ASCENDING, sentAt DESCENDING',
    'status ASCENDING, sentAt DESCENDING',
    'source ASCENDING, status ASCENDING, sentAt DESCENDING',
  ]) {
    assert.ok(shapes.includes(expected), `missing (${expected}) on sent_emails`);
  }
});

test('firestore.rules still closes sent_emails to every client (a drift alarm; the emulator test is the proof)', () => {
  const rules = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
  const lines = rules.split('\n').filter((line) => line.includes('sent_emails'));
  assert.deepEqual(lines.map((line) => line.trim()), [
    'match /sent_emails/{docId} { allow read, write: if false; }',
  ]);
});
