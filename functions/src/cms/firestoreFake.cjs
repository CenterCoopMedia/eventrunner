'use strict';

/**
 * TEST-ONLY in-memory Firestore fake for the cms test files (no emulator,
 * house rule). Not a deployable module: nothing under src/ requires it
 * outside *.test.cjs, and the test glob (`src/(asterisks)/*.test.cjs`) does
 * not execute it directly.
 *
 * Supports exactly what the cms modules use — doc get/set/update/delete,
 * create (fails ALREADY_EXISTS like the Admin SDK), `==` queries with
 * orderBy/limit/startAfter, getAll, batches with per-update
 * { lastUpdateTime } preconditions (snapshots expose a monotonically
 * bumped `updateTime`; a stale precondition fails the whole batch with
 * FAILED_PRECONDITION, applying nothing, like real Firestore) — plus
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
  /** 'col/id' → monotonically increasing write counter (fake updateTime). */
  const updateTimes = new Map();
  const writes = [];
  let commitCount = 0;
  let writeClock = 0;

  function colMap(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }

  for (const [path, data] of Object.entries(seed)) {
    const slash = path.indexOf('/');
    colMap(path.slice(0, slash)).set(path.slice(slash + 1), clone(data));
    writeClock += 1;
    updateTimes.set(path, writeClock);
  }

  function applyWrite(op) {
    const docs = colMap(op.col);
    const key = `${op.col}/${op.id}`;
    if (op.type === 'delete') {
      docs.delete(op.id);
      updateTimes.delete(key);
    } else if (op.type === 'create') {
      if (docs.has(op.id)) throw new Error(`ALREADY_EXISTS: document ${key} already exists`);
      docs.set(op.id, clone(op.data));
    } else if (op.type === 'update') {
      if (!docs.has(op.id)) throw new Error(`NOT_FOUND: no document ${key}`);
      docs.set(op.id, mergeDeep(docs.get(op.id), op.data));
    } else if (op.merge) {
      docs.set(op.id, mergeDeep(docs.get(op.id) || {}, op.data));
    } else {
      docs.set(op.id, clone(op.data));
    }
    if (op.type !== 'delete') {
      writeClock += 1;
      updateTimes.set(key, writeClock);
    }
    writes.push({ type: op.type, path: key });
  }

  function snapshot(col, id) {
    const data = colMap(col).get(id);
    const exists = data !== undefined;
    return {
      id,
      exists,
      updateTime: exists ? updateTimes.get(`${col}/${id}`) : undefined,
      data: () => (exists ? clone(data) : undefined),
      ref: docRef(col, id),
    };
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
      async create(data) {
        applyWrite({ type: 'create', col, id, data });
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
      // Marks this object as a Query for `tx.get()`, which accepts either a
      // DocumentReference or a Query in the Admin SDK (the ticketing
      // entitlement recomputation reads its ticket set inside the
      // transaction that writes the account).
      _kind: 'query',
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
        // Unfiltered read of the whole collection — real Firestore's
        // CollectionReference supports `.get()` directly (it IS an
        // unfiltered Query), so the fake must too. Used by the speaker
        // seam and by media/usage.cjs, which walks the content corpus.
        get() {
          return query(name, [], null, undefined, undefined).get();
        },
      };
    },
    async getAll(...refs) {
      return refs.map((ref) => snapshot(ref._col, ref.id));
    },
    /**
     * Optimistic transaction with a real READ SET, because that is the
     * property the session-save seam depends on: reading `speakers/{id}`
     * inside the transaction that writes the draft is what makes a
     * concurrent deleteSpeaker abort and retry us instead of leaving a
     * dangling reference.
     *
     * Writes are buffered and applied on commit, so a body that throws
     * changes nothing. Every document read records the version it saw
     * (undefined for an absent document — Firestore tracks non-existence
     * too, which is what makes a deterministic reservation doc a lock);
     * at commit, any version that moved aborts and re-runs the body.
     *
     * `db.beforeCommit` is a one-shot test hook fired after the body and
     * before the conflict check, so a test can interleave a competing
     * write at exactly the moment that matters.
     *
     * Query reads are NOT tracked (a documented limitation of this fake,
     * not of Firestore): the modules under test rely on document reads
     * for conflict detection, and every test that needs interleaving uses
     * one.
     */
    async runTransaction(fn, { maxAttempts = 5 } = {}) {
      for (let attempt = 1; ; attempt += 1) {
        const readVersions = new Map();
        const ops = [];
        const trackRead = (col, id) => {
          readVersions.set(`${col}/${id}`, updateTimes.get(`${col}/${id}`));
          return snapshot(col, id);
        };
        const tx = {
          async get(target) {
            if (target && target._kind === 'query') return target.get();
            return trackRead(target._col, target.id);
          },
          async getAll(...refs) {
            return refs.map((ref) => trackRead(ref._col, ref.id));
          },
          create(ref, data) {
            ops.push({ type: 'create', col: ref._col, id: ref.id, data: clone(data) });
          },
          set(ref, data, opts = {}) {
            ops.push({ type: 'set', col: ref._col, id: ref.id, data: clone(data), merge: opts.merge === true });
          },
          update(ref, data) {
            ops.push({ type: 'update', col: ref._col, id: ref.id, data: clone(data) });
          },
          delete(ref) {
            ops.push({ type: 'delete', col: ref._col, id: ref.id });
          },
        };

        const result = await fn(tx);

        if (typeof db.beforeCommit === 'function') {
          const hook = db.beforeCommit;
          db.beforeCommit = null;
          await hook();
        }

        let conflicted = false;
        for (const [key, version] of readVersions) {
          if (updateTimes.get(key) !== version) {
            conflicted = true;
            break;
          }
        }
        if (conflicted) {
          if (attempt >= maxAttempts) throw new Error('ABORTED: too much contention');
          continue;
        }
        for (const op of ops) applyWrite(op);
        return result;
      }
    },
    /** One-shot hook fired between a transaction body and its commit. */
    beforeCommit: null,
    batch() {
      const ops = [];
      return {
        set(ref, data, opts = {}) {
          ops.push({ type: 'set', col: ref._col, id: ref.id, data: clone(data), merge: opts.merge === true });
        },
        update(ref, data, precondition) {
          ops.push({ type: 'update', col: ref._col, id: ref.id, data: clone(data), precondition });
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
          // Atomicity: validate updates and preconditions before applying
          // anything — a stale precondition fails the WHOLE batch.
          for (const op of ops) {
            if (op.type === 'update' && !colMap(op.col).has(op.id)) {
              throw new Error(`NOT_FOUND: no document ${op.col}/${op.id}`);
            }
            if (op.type === 'update' && op.precondition?.lastUpdateTime !== undefined) {
              const current = updateTimes.get(`${op.col}/${op.id}`);
              if (current !== op.precondition.lastUpdateTime) {
                throw new Error(`FAILED_PRECONDITION: document ${op.col}/${op.id} changed since it was read`);
              }
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
