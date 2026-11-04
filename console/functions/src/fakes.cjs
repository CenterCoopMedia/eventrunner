'use strict';

/**
 * TEST-ONLY in-memory Firestore for the console function tests (no
 * emulator, house rule). It follows functions/src/cms/firestoreFake.cjs,
 * with what the console needs and that fake lacks: documents addressed by
 * full path, subcollections (`organizations/{id}/members`), and
 * collection-group queries.
 *
 * Supported: db.collection(path), db.doc(path), db.collectionGroup(id),
 * ref.collection(id), ref.parent(.parent), get/set/create/update/delete,
 * `==` queries with orderBy and limit, runTransaction (writes buffered and
 * applied at the end, so a body that throws changes nothing) and batch.
 * Test helpers: db.read(path), db.paths(prefix), db.writes.
 *
 * firebase.json leaves `src/fake*.cjs` out of the deploy.
 */

const { randomBytes } = require('node:crypto');

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

const newId = () => randomBytes(10).toString('hex');
const comparable = (v) => (v instanceof Date ? v.getTime() : v);
const COMPARE = Object.freeze({
  '==': (a, b) => a === b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
});

function makeFakeDb(seed = {}) {
  /** @type {Map<string, object>} full document path -> data */
  const store = new Map(Object.entries(seed).map(([p, d]) => [p, clone(d)]));
  const writes = [];

  function applyWrite(op) {
    if (op.type === 'delete') store.delete(op.path);
    else if (op.type === 'create') {
      if (store.has(op.path)) throw new Error(`ALREADY_EXISTS: ${op.path}`);
      store.set(op.path, clone(op.data));
    } else if (op.type === 'update') {
      if (!store.has(op.path)) throw new Error(`NOT_FOUND: ${op.path}`);
      store.set(op.path, { ...store.get(op.path), ...clone(op.data) });
    } else if (op.merge) store.set(op.path, { ...(store.get(op.path) || {}), ...clone(op.data) });
    else store.set(op.path, clone(op.data));
    writes.push({ type: op.type, path: op.path });
  }

  function snapshot(path) {
    const data = store.get(path);
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : clone(data)),
      ref: docRef(path),
    };
  }

  function collectionRef(path) {
    const segments = path.split('/');
    return {
      _kind: 'query',
      id: segments[segments.length - 1],
      path,
      get parent() {
        return segments.length > 1 ? docRef(segments.slice(0, -1).join('/')) : null;
      },
      doc(id = newId()) {
        return docRef(`${path}/${id}`);
      },
      async add(data) {
        const ref = docRef(`${path}/${newId()}`);
        applyWrite({ type: 'create', path: ref.path, data });
        return ref;
      },
      ...queryMethods({ matches: (docPath) => parentOf(docPath) === path }),
    };
  }

  function parentOf(docPath) {
    return docPath.split('/').slice(0, -1).join('/');
  }

  function docRef(path) {
    const segments = path.split('/');
    return {
      _kind: 'doc',
      id: segments[segments.length - 1],
      path,
      get parent() {
        return collectionRef(segments.slice(0, -1).join('/'));
      },
      collection(id) {
        return collectionRef(`${path}/${id}`);
      },
      async get() {
        return snapshot(path);
      },
      async set(data, opts = {}) {
        applyWrite({ type: 'set', path, data, merge: opts.merge === true });
      },
      async create(data) {
        applyWrite({ type: 'create', path, data });
      },
      async update(data) {
        applyWrite({ type: 'update', path, data });
      },
      async delete() {
        applyWrite({ type: 'delete', path });
      },
    };
  }

  function queryMethods({ matches, filters = [], order = null, limitN }) {
    const next = (patch) => queryMethods({ matches, filters, order, limitN, ...patch });
    return {
      _kind: 'query',
      where(field, op, value) {
        if (!(op in COMPARE)) throw new Error(`fake supports only ${Object.keys(COMPARE).join(', ')}, got ${op}`);
        return { ...next({ filters: [...filters, { field, op, value }] }), _kind: 'query' };
      },
      orderBy(field, direction = 'asc') {
        return { ...next({ order: { field, direction } }), _kind: 'query' };
      },
      limit(n) {
        return { ...next({ limitN: n }), _kind: 'query' };
      },
      async get() {
        let rows = [...store.entries()]
          .filter(([path, data]) => matches(path) && filters.every((f) => f.field in data && COMPARE[f.op](comparable(data[f.field]), comparable(f.value))));
        if (order) {
          const dir = order.direction === 'desc' ? -1 : 1;
          rows.sort(([, a], [, b]) => {
            const av = comparable(a[order.field]);
            const bv = comparable(b[order.field]);
            return av < bv ? -dir : av > bv ? dir : 0;
          });
        }
        if (typeof limitN === 'number') rows = rows.slice(0, limitN);
        const docs = rows.map(([path]) => snapshot(path));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  function bufferedWriter(ops) {
    return {
      set(ref, data, opts = {}) {
        ops.push({ type: 'set', path: ref.path, data: clone(data), merge: opts.merge === true });
      },
      create(ref, data) {
        ops.push({ type: 'create', path: ref.path, data: clone(data) });
      },
      update(ref, data) {
        ops.push({ type: 'update', path: ref.path, data: clone(data) });
      },
      delete(ref) {
        ops.push({ type: 'delete', path: ref.path });
      },
    };
  }

  function commit(ops) {
    for (const op of ops) {
      if (op.type === 'create' && store.has(op.path)) throw new Error(`ALREADY_EXISTS: ${op.path}`);
      if (op.type === 'update' && !store.has(op.path)) throw new Error(`NOT_FOUND: ${op.path}`);
    }
    for (const op of ops) applyWrite(op);
  }

  return {
    writes,
    collection: collectionRef,
    doc: docRef,
    collectionGroup(id) {
      return queryMethods({ matches: (path) => path.split('/').slice(-2, -1)[0] === id });
    },
    async runTransaction(fn) {
      const ops = [];
      const tx = {
        ...bufferedWriter(ops),
        async get(target) {
          return target._kind === 'query' ? target.get() : snapshot(target.path);
        },
        async getAll(...refs) {
          return refs.map((ref) => snapshot(ref.path));
        },
      };
      const result = await fn(tx);
      commit(ops);
      return result;
    },
    batch() {
      const ops = [];
      return { ...bufferedWriter(ops), async commit() { commit(ops); } };
    },
    read(path) {
      return clone(store.get(path));
    },
    paths(prefix = '') {
      return [...store.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
  };
}

/**
 * A fake firebase-admin Auth: `tokens` maps a bearer string to the decoded
 * ID token it stands for. Any other string fails, like a bad token.
 */
function makeFakeAuth(tokens = {}) {
  return {
    calls: [],
    async verifyIdToken(token, checkRevoked) {
      this.calls.push({ token, checkRevoked });
      if (!Object.prototype.hasOwnProperty.call(tokens, token)) throw new Error('auth/argument-error');
      return { ...tokens[token] };
    },
  };
}

/** A request shaped like the Express object onRequest hands a handler. */
function makeReq({ method = 'POST', body = {}, token, origin } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return { method, body, headers, get: (name) => headers[name.toLowerCase()] };
}

/** A response that records what the handler sent. */
function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
  };
  return res;
}

module.exports = { makeFakeDb, makeFakeAuth, makeReq, makeRes };
