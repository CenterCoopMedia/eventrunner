'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createListSystemErrorsHandler,
  createResolveSystemErrorsHandler,
  internals,
} = require('./systemErrorsAdmin.cjs');

/**
 * Minimal in-memory Firestore fake: doc get/update, `==` queries with
 * COMPOSITE orderBy/limit/startAfter (system_errors admin surface orders
 * by createdAt+__name__ for a deterministic pagination tiebreaker, and by
 * __name__ alone for the bounded kind-sweep — unlike systemErrors.test.cjs's
 * fake, which needs neither), and transactions with Firestore's
 * conflict-abort-and-retry semantics collapsed into "read the freshest
 * data" (good enough for this module — it never inspects the number of
 * transaction attempts, only the final written state).
 *
 * `__name__` is a real field name here (mirroring Firestore's own special
 * FieldPath.documentId()): orderBy/startAfter treat it as the doc's id
 * rather than a stored data field.
 */
function makeFakeDb(seed = {}) {
  const store = new Map(); // "collection/id" -> data
  for (const [path, data] of Object.entries(seed)) {
    store.set(path, { ...data });
  }
  const key = (c, id) => `${c}/${id}`;
  let genCounter = 0;

  function docRef(c, id) {
    return {
      id,
      __c: c,
      async get() {
        const data = store.get(key(c, id));
        return { exists: data !== undefined, data: () => (data ? { ...data } : undefined), ref: docRef(c, id), id };
      },
      async set(data) {
        store.set(key(c, id), { ...data });
      },
      async update(patch) {
        if (!store.has(key(c, id))) throw new Error(`NOT_FOUND: ${key(c, id)}`);
        Object.assign(store.get(key(c, id)), patch);
      },
    };
  }

  function query(c, filters) {
    return {
      where(field, op, value) {
        if (op !== '==') throw new Error(`fake supports only '==', got ${op}`);
        return query(c, [...filters, { field, value }]);
      },
      orderBy(field, direction = 'asc') {
        return queryOrdered(c, filters, [{ field, direction }]);
      },
      async get() {
        const docs = [...store.entries()]
          .filter(([path]) => path.startsWith(`${c}/`))
          .filter(([, data]) => filters.every((f) => data[f.field] === f.value))
          .map(([path, data]) => ({ id: path.slice(c.length + 1), data: () => ({ ...data }) }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }

  function fieldValue(row, field) {
    return field === '__name__' ? row.id : row.data[field];
  }
  const orderVal = (v) => (v instanceof Date ? v.getTime() : v);

  function queryOrdered(c, filters, orders, limitN, startAfterValues) {
    return {
      orderBy(field, direction = 'asc') {
        return queryOrdered(c, filters, [...orders, { field, direction }], limitN, startAfterValues);
      },
      limit(n) {
        return queryOrdered(c, filters, orders, n, startAfterValues);
      },
      startAfter(...values) {
        return queryOrdered(c, filters, orders, limitN, values);
      },
      async get() {
        let rows = [...store.entries()]
          .filter(([path]) => path.startsWith(`${c}/`))
          .filter(([, data]) => filters.every((f) => data[f.field] === f.value))
          .map(([path, data]) => ({ id: path.slice(c.length + 1), data }));
        rows.sort((a, b) => {
          for (const order of orders) {
            const dir = order.direction === 'desc' ? -1 : 1;
            const av = orderVal(fieldValue(a, order.field));
            const bv = orderVal(fieldValue(b, order.field));
            if (av < bv) return -dir;
            if (av > bv) return dir;
          }
          return 0;
        });
        if (startAfterValues && startAfterValues.length > 0) {
          rows = rows.filter((row) => {
            for (let i = 0; i < orders.length; i += 1) {
              const order = orders[i];
              const dir = order.direction === 'desc' ? -1 : 1;
              const rv = orderVal(fieldValue(row, order.field));
              const sv = orderVal(startAfterValues[i]);
              if (rv === sv) continue; // tied on this field — the next field decides
              return dir === 1 ? rv > sv : rv < sv;
            }
            return false; // equal on every ordered field — excluded, like real Firestore
          });
        }
        if (typeof limitN === 'number') rows = rows.slice(0, limitN);
        const docs = rows.map(({ id, data }) => ({ id, data: () => ({ ...data }) }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }

  return {
    store,
    collection(c) {
      return {
        doc: (id) => docRef(c, id ?? `gen-${(genCounter += 1)}`),
        where: (field, op, value) => query(c, []).where(field, op, value),
        orderBy: (field, direction) => queryOrdered(c, [], [{ field, direction: direction ?? 'asc' }]),
        async get() {
          return query(c, []).get();
        },
      };
    },
    async runTransaction(fn) {
      return fn({
        get: async (ref) => ref.get(),
        update: (ref, patch) => {
          if (!store.has(key(ref.__c, ref.id))) throw new Error(`NOT_FOUND: ${key(ref.__c, ref.id)}`);
          Object.assign(store.get(key(ref.__c, ref.id)), patch);
        },
      });
    },
  };
}

const ADMIN = { uid: 'admin1', email: 'admin@example.org', email_verified: true };
const USER = { uid: 'user1', email: 'user@example.org', email_verified: true };

function fakeAuth() {
  return {
    async verifyIdToken(t) {
      if (t === 'admin-token') return ADMIN;
      if (t === 'user-token') return USER;
      throw new Error('auth/argument-error');
    },
  };
}
const getConfig = async () => ({ bootstrap: { adminEmails: ['admin@example.org'] } });

function req({ method = 'POST', token = 'admin-token', body = {} } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}
function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

function listHandler(db) {
  return createListSystemErrorsHandler({ db, auth: fakeAuth(), getConfig });
}
function resolveHandler(db, now = Date.now) {
  return createResolveSystemErrorsHandler({ db, auth: fakeAuth(), getConfig, now });
}

// --- gate ------------------------------------------------------------------

test('listSystemErrors / resolveSystemErrors: 401 without token, 403 for non-admin, 405 for GET', async () => {
  const db = makeFakeDb();
  for (const handler of [listHandler(db), resolveHandler(db)]) {
    let res = fakeRes();
    await handler(req({ token: null }), res);
    assert.equal(res.statusCode, 401);

    res = fakeRes();
    await handler(req({ token: 'user-token' }), res);
    assert.equal(res.statusCode, 403);

    res = fakeRes();
    await handler(req({ method: 'GET' }), res);
    assert.equal(res.statusCode, 405);
  }
});

// --- listSystemErrors --------------------------------------------------------

function seedRows() {
  return makeFakeDb({
    'system_errors/e-open-1': {
      kind: 'client-error', message: 'TypeError: boom', resolved: false,
      alertedAt: null, createdAt: new Date(1000), lastSeenAt: null,
    },
    'system_errors/e-open-2': {
      kind: 'template-override-invalid', errors: ['bad token'], resolved: false,
      alertedAt: new Date(2000), createdAt: new Date(2000), lastSeenAt: new Date(2000),
    },
    'system_errors/e-resolved-1': {
      kind: 'client-error', message: 'old, fixed', resolved: true,
      alertedAt: null, createdAt: new Date(500), resolvedAt: new Date(1500), resolvedBy: 'admin@example.org',
    },
  });
}

test('listSystemErrors: unresolved-only by default, newest-created first, tolerates rows with no lastSeenAt', async () => {
  const db = seedRows();
  const res = fakeRes();
  await listHandler(db)(req({ body: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows.map((r) => r.id), ['e-open-2', 'e-open-1']);
  const openRow = res.body.rows.find((r) => r.id === 'e-open-1');
  assert.equal(openRow.lastSeenAt, null);
  assert.equal(openRow.message, 'TypeError: boom');
});

test('listSystemErrors: includeResolved widens the set (recently-resolved rows visible too)', async () => {
  const db = seedRows();
  const res = fakeRes();
  await listHandler(db)(req({ body: { includeResolved: true } }), res);
  assert.deepEqual(res.body.rows.map((r) => r.id).sort(), ['e-open-1', 'e-open-2', 'e-resolved-1'].sort());
});

test('listSystemErrors paginates with a { createdAt, id } cursor', async () => {
  const db = seedRows();
  let res = fakeRes();
  await listHandler(db)(req({ body: { includeResolved: true, limit: 2 } }), res);
  assert.equal(res.body.rows.length, 2);
  assert.deepEqual(res.body.rows.map((r) => r.id), ['e-open-2', 'e-open-1']);
  assert.deepEqual(res.body.nextCursor, { createdAt: 1000, id: 'e-open-1' });

  const nextCursor = res.body.nextCursor;
  res = fakeRes();
  await listHandler(db)(req({ body: { includeResolved: true, limit: 2, cursor: nextCursor } }), res);
  assert.deepEqual(res.body.rows.map((r) => r.id), ['e-resolved-1']);
  assert.equal(res.body.nextCursor, null);
});

test('listSystemErrors: an exact-limit page has no phantom next page', async () => {
  const db = seedRows();
  const res = fakeRes();
  await listHandler(db)(req({ body: { includeResolved: true, limit: 3 } }), res);
  assert.equal(res.body.rows.length, 3);
  assert.equal(res.body.nextCursor, null);
});

test('listSystemErrors: 400 on a malformed cursor (bare number, missing id, non-object)', async () => {
  const db = seedRows();
  for (const cursor of ['nope', 1000, { createdAt: 1000 }, { id: 'x' }, { createdAt: 'x', id: 'y' }]) {
    const res = fakeRes();
    await listHandler(db)(req({ body: { cursor } }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(cursor));
  }
});

test('listSystemErrors: two rows with the SAME createdAt straddling a page boundary are not skipped (id tiebreaker)', async () => {
  // Codex review finding, P2: a createdAt-only cursor would drop whichever
  // of these two rows sorts second at the tied timestamp.
  const db = makeFakeDb({
    'system_errors/tie-a': { kind: 'client-error', resolved: false, createdAt: new Date(1000) },
    'system_errors/tie-b': { kind: 'client-error', resolved: false, createdAt: new Date(1000) },
    'system_errors/older': { kind: 'client-error', resolved: false, createdAt: new Date(500) },
  });
  let res = fakeRes();
  await listHandler(db)(req({ body: { limit: 1 } }), res);
  assert.equal(res.body.rows.length, 1);
  const firstId = res.body.rows[0].id;
  assert.ok(['tie-a', 'tie-b'].includes(firstId));
  assert.ok(res.body.nextCursor);

  const seenIds = [firstId];
  let cursor = res.body.nextCursor;
  // Two more pages of 1 row each should recover BOTH tied rows plus the
  // older one — nothing skipped, nothing duplicated.
  for (let i = 0; i < 2; i += 1) {
    res = fakeRes();
    await listHandler(db)(req({ body: { limit: 1, cursor } }), res);
    assert.equal(res.body.rows.length, 1);
    seenIds.push(res.body.rows[0].id);
    cursor = res.body.nextCursor;
  }
  assert.equal(cursor, null);
  assert.deepEqual(seenIds.sort(), ['older', 'tie-a', 'tie-b']);
});

test('listSystemErrors shapes an infra query failure as a core/errors 500', async () => {
  const throwingDb = {
    collection() {
      return {
        where() { return this; },
        orderBy() { return this; },
        startAfter() { return this; },
        limit() { return this; },
        async get() { throw new Error('FAILED_PRECONDITION: index required'); },
      };
    },
  };
  const res = fakeRes();
  await createListSystemErrorsHandler({ db: throwingDb, auth: fakeAuth(), getConfig, log: { error() {} } })(
    req({ body: {} }), res,
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'internal');
});

// --- resolveSystemErrors: single row -----------------------------------------

test('resolveSystemErrors: resolves an open row and stamps resolvedAt/resolvedBy', async () => {
  const db = seedRows();
  const res = fakeRes();
  await resolveHandler(db, () => 9000)(req({ body: { id: 'e-open-1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'e-open-1', resolved: true });
  const row = db.store.get('system_errors/e-open-1');
  assert.equal(row.resolved, true);
  assert.deepEqual(row.resolvedAt, new Date(9000));
  assert.equal(row.resolvedBy, 'admin@example.org');
});

test('resolveSystemErrors: resolving an already-resolved row is a no-op success', async () => {
  const db = seedRows();
  const before = { ...db.store.get('system_errors/e-resolved-1') };
  const res = fakeRes();
  await resolveHandler(db)(req({ body: { id: 'e-resolved-1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'e-resolved-1', resolved: true, alreadyResolved: true });
  assert.deepEqual(db.store.get('system_errors/e-resolved-1'), before);
});

test('resolveSystemErrors: 404 for a missing row', async () => {
  const db = seedRows();
  const res = fakeRes();
  await resolveHandler(db)(req({ body: { id: 'does-not-exist' } }), res);
  assert.equal(res.statusCode, 404);
});

test('resolveSystemErrors: 400 without id or kind', async () => {
  const db = seedRows();
  const res = fakeRes();
  await resolveHandler(db)(req({ body: {} }), res);
  assert.equal(res.statusCode, 400);
});

test('resolveSystemErrors: a reopen racing the resolve is not clobbered (expectedLastSeenAt mismatch is a no-op)', async () => {
  const db = seedRows();
  // The admin's view is stale: they loaded the list when lastSeenAt was 2000,
  // but the row was reopened (auth/otp.cjs's reopenSystemError) to 5000 in
  // between — simulate that landing before the resolve request arrives.
  db.store.get('system_errors/e-open-2').lastSeenAt = new Date(5000);
  db.store.get('system_errors/e-open-2').resolved = false;

  const res = fakeRes();
  await resolveHandler(db, () => 9000)(
    req({ body: { id: 'e-open-2', expectedLastSeenAt: new Date(2000).getTime() } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 'e-open-2', resolved: false, reopened: true });
  // The row is untouched: still unresolved, and the fresh lastSeenAt survives.
  const row = db.store.get('system_errors/e-open-2');
  assert.equal(row.resolved, false);
  assert.deepEqual(row.lastSeenAt, new Date(5000));
  assert.equal(row.resolvedAt, undefined);
});

test('resolveSystemErrors: expectedLastSeenAt matching the stored value resolves normally', async () => {
  const db = seedRows();
  const res = fakeRes();
  await resolveHandler(db, () => 9000)(
    req({ body: { id: 'e-open-2', expectedLastSeenAt: new Date(2000).getTime() } }),
    res,
  );
  assert.deepEqual(res.body, { id: 'e-open-2', resolved: true });
  assert.equal(db.store.get('system_errors/e-open-2').resolved, true);
});

test('resolveSystemErrors: omitting expectedLastSeenAt always resolves (no staleness check requested)', async () => {
  const db = seedRows();
  db.store.get('system_errors/e-open-2').lastSeenAt = new Date(5000);
  const res = fakeRes();
  await resolveHandler(db)(req({ body: { id: 'e-open-2' } }), res);
  assert.deepEqual(res.body, { id: 'e-open-2', resolved: true });
});

test('resolveSystemErrors: a row with no lastSeenAt at all resolves fine when expectedLastSeenAt is also omitted', async () => {
  const db = seedRows();
  const res = fakeRes();
  await resolveHandler(db)(req({ body: { id: 'e-open-1' } }), res);
  assert.deepEqual(res.body, { id: 'e-open-1', resolved: true });
});

// --- resolveSystemErrors: whole fault class ----------------------------------

test('resolveSystemErrors: resolving by kind resolves every currently-unresolved row of that class (single page)', async () => {
  const db = makeFakeDb({
    'system_errors/a': { kind: 'template-override-invalid', resolved: false, createdAt: new Date(1) },
    'system_errors/b': { kind: 'template-override-invalid', resolved: false, createdAt: new Date(2) },
    'system_errors/c': { kind: 'client-error', resolved: false, createdAt: new Date(3) },
    'system_errors/d': { kind: 'template-override-invalid', resolved: true, createdAt: new Date(4) },
  });
  const res = fakeRes();
  await resolveHandler(db, () => 9000)(req({ body: { kind: 'template-override-invalid' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.kind, 'template-override-invalid');
  assert.equal(res.body.done, true);
  assert.equal(res.body.cursor, null);
  assert.deepEqual(res.body.results.map((r) => r.id).sort(), ['a', 'b']);
  assert.equal(db.store.get('system_errors/a').resolved, true);
  assert.equal(db.store.get('system_errors/b').resolved, true);
  assert.equal(db.store.get('system_errors/c').resolved, false); // different kind, untouched
  assert.equal(db.store.get('system_errors/d').resolvedAt, undefined); // was already resolved before this call
});

test('resolveSystemErrors: a whole-class sweep bigger than the page size is bounded and resumable', async () => {
  // Codex review finding, P2: an unbounded sweep is an unbounded number of
  // sequential transactions in one request. Seed more rows than
  // KIND_SWEEP_PAGE_SIZE and confirm one call resolves at most a page,
  // reporting done:false with a cursor to continue.
  const seed = {};
  const total = internals.KIND_SWEEP_PAGE_SIZE + 5;
  for (let i = 0; i < total; i += 1) {
    const id = `row-${String(i).padStart(4, '0')}`;
    seed[`system_errors/${id}`] = { kind: 'burst', resolved: false, createdAt: new Date(i) };
  }
  const db = makeFakeDb(seed);

  const first = fakeRes();
  await resolveHandler(db, () => 9000)(req({ body: { kind: 'burst' } }), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.done, false);
  assert.equal(first.body.results.length, internals.KIND_SWEEP_PAGE_SIZE);
  assert.ok(first.body.cursor);
  const resolvedAfterFirst = [...db.store.entries()].filter(
    ([path, data]) => path.startsWith('system_errors/') && data.resolved === true,
  ).length;
  assert.equal(resolvedAfterFirst, internals.KIND_SWEEP_PAGE_SIZE);

  const second = fakeRes();
  await resolveHandler(db, () => 9500)(req({ body: { kind: 'burst', cursor: first.body.cursor } }), second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.done, true);
  assert.equal(second.body.cursor, null);
  assert.equal(second.body.results.length, 5);

  const allResolved = [...db.store.entries()].every(
    ([path, data]) => !path.startsWith('system_errors/') || data.resolved === true,
  );
  assert.ok(allResolved, 'every row of the class is resolved after continuing the sweep');
});

test('resolveSystemErrors: 400 on a malformed kind-sweep cursor', async () => {
  const db = makeFakeDb({ 'system_errors/a': { kind: 'x', resolved: false, createdAt: new Date(1) } });
  const res = fakeRes();
  await resolveHandler(db)(req({ body: { kind: 'x', cursor: 42 } }), res);
  assert.equal(res.statusCode, 400);
});

// --- audit logging ------------------------------------------------------------

test('resolveSystemErrors writes an admin_logs entry for a single-row resolve', async () => {
  const db = seedRows();
  const res = fakeRes();
  await resolveHandler(db, () => 9000)(req({ body: { id: 'e-open-1' } }), res);
  const logs = [...db.store.entries()].filter(([path]) => path.startsWith('admin_logs/'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].action, 'resolveSystemErrors');
  assert.equal(logs[0][1].docPath, 'system_errors/e-open-1');
  assert.equal(logs[0][1].email, 'admin@example.org');
});

test('resolveSystemErrors writes one admin_logs entry for a whole-class resolve', async () => {
  const db = makeFakeDb({
    'system_errors/a': { kind: 'template-override-invalid', resolved: false, createdAt: new Date(1) },
  });
  const res = fakeRes();
  await resolveHandler(db, () => 9000)(req({ body: { kind: 'template-override-invalid' } }), res);
  assert.equal(res.statusCode, 200);
  const logs = [...db.store.entries()].filter(([path]) => path.startsWith('admin_logs/'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].docPath, 'system_errors:kind:template-override-invalid');
});

// --- internals -----------------------------------------------------------

test('toMillis handles Date, Firestore Timestamp-like, number, string, and absence', () => {
  assert.equal(internals.toMillis(new Date(1000)), 1000);
  assert.equal(internals.toMillis({ toMillis: () => 2000 }), 2000);
  assert.equal(internals.toMillis(3000), 3000);
  assert.equal(internals.toMillis(null), null);
  assert.equal(internals.toMillis(undefined), null);
});

test('the (resolved ASC, createdAt DESC) composite index is declared for deploy', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const declared = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8'),
  );
  const match = (declared.indexes || []).find(
    (ix) =>
      ix.collectionGroup === 'system_errors' &&
      Array.isArray(ix.fields) &&
      ix.fields.length === 2 &&
      ix.fields[0].fieldPath === 'resolved' &&
      ix.fields[0].order === 'ASCENDING' &&
      ix.fields[1].fieldPath === 'createdAt' &&
      ix.fields[1].order === 'DESCENDING',
  );
  assert.ok(match, 'firestore.indexes.json must declare (resolved ASC, createdAt DESC) on system_errors');
});
