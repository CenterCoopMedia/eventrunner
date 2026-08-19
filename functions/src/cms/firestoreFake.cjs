'use strict';

/**
 * TEST-ONLY in-memory Firestore fake for the cms test files (no emulator,
 * house rule). Not a deployable module: nothing under src/ requires it
 * outside *.test.cjs, and the test glob (`src/(asterisks)/*.test.cjs`) does
 * not execute it directly.
 *
 * Supports exactly what the cms modules use — doc get/set/update/delete,
 * `==` queries with orderBy/limit/startAfter, getAll, and batches — plus
 * two affordances the publish tests need:
 *
 *   db.writes      — an append-only audit of every applied write
 *                    ({ type, path }), so a test can assert that editing
 *                    NEVER touched a live collection.
 *   db.failAtCommit — 1-indexed batch-commit counter; that commit throws
 *                    (applying nothing — batches are atomic) and the
 *                    trigger clears, so a re-run succeeds. Doc-level
 *                    set/update/delete do not count.
 */

const { randomBytes } = require('node:crypto');

/** Structured clone that keeps Date instances as Dates. */
function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** Firestore-style deep merge: maps merge, everything else replaces. */
function mergeDeep(base, patch) {
  const out = isPlainObject(base) ? clone(base) : {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeDeep(out[k], v) : clone(v);
  }
  return out;
}

function orderValue(v) {
  if (v instanceof Date) return v.getTime();
  return v;
}

/**
 * @param {Record<string, object>} seed map of 'collection/docId' → data
 */
function makeFakeDb(seed = {}) {
  /** @type {Map<string, Map<string, object>>} */
  const store = new Map();
  const writes = [];
  let commitCount = 0;

  function colMap(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }

  for (const [path, data] of Object.entries(seed)) {
    const slash = path.indexOf('/');
    colMap(path.slice(0, slash)).set(path.slice(slash + 1), clone(data));
  }

  function applyWrite(op) {
    const docs = colMap(op.col);
    if (op.type === 'delete') {
      docs.delete(op.id);
    } else if (op.type === 'update') {
      if (!docs.has(op.id)) throw new Error(`NOT_FOUND: no document ${op.col}/${op.id}`);
      docs.set(op.id, mergeDeep(docs.get(op.id), op.data));
    } else if (op.merge) {
      docs.set(op.id, mergeDeep(docs.get(op.id) || {}, op.data));
    } else {
      docs.set(op.id, clone(op.data));
    }
    writes.push({ type: op.type, path: `${op.col}/${op.id}` });
  }

  function snapshot(col, id) {
    const data = colMap(col).get(id);
    const exists = data !== undefined;
    return { id, exists, data: () => (exists ? clone(data) : undefined), ref: docRef(col, id) };
  }

  function docRef(col, id) {
    return {
      id,
      path: `${col}/${id}`,
      _col: col,
      async get() {
        return snapshot(col, id);
      },
      async set(data, opts = {}) {
        applyWrite({ type: 'set', col, id, data, merge: opts.merge === true });
      },
      async update(data) {
        applyWrite({ type: 'update', col, id, data });
      },
      async delete() {
        applyWrite({ type: 'delete', col, id });
      },
    };
  }

  function query(col, filters, order, limitN, startAfterValue) {
    return {
      where(field, op, value) {
        if (op !== '==') throw new Error(`fake supports only '==', got ${op}`);
        return query(col, [...filters, { field, value }], order, limitN, startAfterValue);
      },
      orderBy(field, direction = 'asc') {
        return query(col, filters, { field, direction }, limitN, startAfterValue);
      },
      limit(n) {
        return query(col, filters, order, n, startAfterValue);
      },
      startAfter(value) {
        return query(col, filters, order, limitN, value);
      },
      async get() {
        let rows = [...colMap(col).entries()]
          .map(([id, data]) => ({ id, data }))
          .filter(({ data }) => filters.every((f) => data[f.field] === f.value));
        if (order) {
          const dir = order.direction === 'desc' ? -1 : 1;
          rows.sort((a, b) => {
            const av = orderValue(a.data[order.field]);
            const bv = orderValue(b.data[order.field]);
            return av < bv ? -dir : av > bv ? dir : 0;
          });
          if (startAfterValue !== undefined) {
            const sv = orderValue(startAfterValue);
            rows = rows.filter(({ data }) => {
              const v = orderValue(data[order.field]);
              return order.direction === 'desc' ? v < sv : v > sv;
            });
          }
        }
        if (typeof limitN === 'number') rows = rows.slice(0, limitN);
        const docs = rows.map(({ id }) => snapshot(col, id));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  const db = {
    writes,
    /** 1-indexed batch commit that throws once, then clears. */
    failAtCommit: null,
    get commitCount() {
      return commitCount;
    },
    collection(name) {
      return {
        doc(id) {
          return docRef(name, id === undefined ? randomBytes(10).toString('hex') : id);
        },
        where(field, op, value) {
          return query(name, [], null, undefined, undefined).where(field, op, value);
        },
        orderBy(field, direction) {
          return query(name, [], null, undefined, undefined).orderBy(field, direction);
        },
      };
    },
    async getAll(...refs) {
      return refs.map((ref) => snapshot(ref._col, ref.id));
    },
    batch() {
      const ops = [];
      return {
        set(ref, data, opts = {}) {
          ops.push({ type: 'set', col: ref._col, id: ref.id, data: clone(data), merge: opts.merge === true });
        },
        update(ref, data) {
          ops.push({ type: 'update', col: ref._col, id: ref.id, data: clone(data) });
        },
        delete(ref) {
          ops.push({ type: 'delete', col: ref._col, id: ref.id });
        },
        async commit() {
          commitCount += 1;
          if (db.failAtCommit === commitCount) {
            db.failAtCommit = null;
            throw new Error('injected batch commit failure');
          }
          // Atomicity: validate updates before applying anything.
          for (const op of ops) {
            if (op.type === 'update' && !colMap(op.col).has(op.id)) {
              throw new Error(`NOT_FOUND: no document ${op.col}/${op.id}`);
            }
          }
          for (const op of ops) applyWrite(op);
        },
      };
    },
    /** Test helper: raw data for one doc, or undefined. */
    read(col, id) {
      const data = colMap(col).get(id);
      return data === undefined ? undefined : clone(data);
    },
    /** Test helper: all ids in a collection. */
    ids(col) {
      return [...colMap(col).keys()];
    },
  };
  return db;
}

module.exports = { makeFakeDb };
