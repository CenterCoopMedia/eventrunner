'use strict';

/**
 * TEST-ONLY in-memory Firestore fake for the speakers test files (no
 * emulator, house rule). Not a deployable module: nothing under src/
 * requires it outside *.test.cjs.
 *
 * Supports exactly what the speakers modules use, and nothing more:
 *
 *   • doc get/set (with and without { merge })/delete and getAll;
 *   • `where('field','==',v)` and `where('speakerIds','array-contains',v)`
 *     queries with `.limit()`, readable both directly and through a
 *     transaction (`tx.get(query)` — the Admin SDK affordance the atomic
 *     unlink is built on);
 *   • runTransaction, which BUFFERS its writes and applies them on commit,
 *     so a test can prove that a transaction which throws part-way (the
 *     "too many references" refusal) changed nothing;
 *   • `db.writes`, an append-only audit of every applied write, so a test
 *     can assert the projection is one-way — that nothing ever writes
 *     `speakers` from `speakers_public`.
 */

const { randomBytes } = require('node:crypto');

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

function mergeDeep(base, patch) {
  const out = isPlainObject(base) ? clone(base) : {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeDeep(out[k], v) : clone(v);
  }
  return out;
}

function matches(data, filter) {
  const value = data?.[filter.field];
  if (filter.op === 'array-contains') {
    return Array.isArray(value) && value.includes(filter.value);
  }
  return value === filter.value;
}

/**
 * @param {Record<string, object>} seed map of 'collection/docId' → data
 */
function makeSpeakersDb(seed = {}) {
  /** @type {Map<string, Map<string, object>>} */
  const store = new Map();
  const writes = [];
  const reads = [];

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
    } else if (op.type === 'create') {
      if (docs.has(op.id)) throw new Error(`ALREADY_EXISTS: document ${op.col}/${op.id} already exists`);
      docs.set(op.id, clone(op.data));
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
    return {
      id,
      exists,
      data: () => (exists ? clone(data) : undefined),
      ref: docRef(col, id),
    };
  }

  function docRef(col, id) {
    return {
      id,
      path: `${col}/${id}`,
      _col: col,
      _kind: 'doc',
      async get() {
        reads.push(`${col}/${id}`);
        return snapshot(col, id);
      },
      async set(data, opts = {}) {
        applyWrite({ type: 'set', col, id, data, merge: opts.merge === true });
      },
      async delete() {
        applyWrite({ type: 'delete', col, id });
      },
    };
  }

  function runQuery(col, filters, limitN) {
    const rows = [...colMap(col).entries()]
      .filter(([, data]) => filters.every((f) => matches(data, f)))
      .map(([id]) => snapshot(col, id));
    const docs = typeof limitN === 'number' ? rows.slice(0, limitN) : rows;
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  function query(col, filters, limitN) {
    return {
      _kind: 'query',
      _col: col,
      _filters: filters,
      _limit: limitN,
      where(field, op, value) {
        return query(col, [...filters, { field, op, value }], limitN);
      },
      limit(n) {
        return query(col, filters, n);
      },
      async get() {
        reads.push(`${col}?${filters.map((f) => `${f.field}${f.op}${f.value}`).join('&')}`);
        return runQuery(col, filters, limitN);
      },
    };
  }

  const db = {
    writes,
    reads,
    /** Test hook: when set, the Nth transaction attempt throws on commit. */
    failAtCommit: null,
    collection(name) {
      return {
        // An omitted id mirrors the Admin SDK's auto-id (admin_logs rows).
        doc: (id) => docRef(name, id === undefined ? randomBytes(10).toString('hex') : id),
        where: (field, op, value) => query(name, [{ field, op, value }], undefined),
        // Unfiltered collection read — listSpeakerInvites with no speakerId
        // filter (functions/src/speakers/invites.cjs) is the one caller.
        get: () => query(name, [], undefined).get(),
      };
    },
    async getAll(...refs) {
      for (const ref of refs) reads.push(ref.path);
      return refs.map((ref) => snapshot(ref._col, ref.id));
    },
    async runTransaction(fn) {
      const ops = [];
      const tx = {
        async get(target) {
          if (target?._kind === 'query') return target.get();
          reads.push(target.path);
          return snapshot(target._col, target.id);
        },
        create(ref, data) {
          ops.push({ type: 'create', col: ref._col, id: ref.id, data: clone(data) });
        },
        set(ref, data, opts = {}) {
          ops.push({ type: 'set', col: ref._col, id: ref.id, data: clone(data), merge: opts.merge === true });
        },
        delete(ref) {
          ops.push({ type: 'delete', col: ref._col, id: ref.id });
        },
      };
      // The body may throw; buffered writes are then discarded, which is
      // what makes "nothing was changed" testable.
      const result = await fn(tx);
      if (db.failAtCommit) {
        db.failAtCommit = null;
        throw new Error('injected transaction commit failure');
      }
      for (const op of ops) applyWrite(op);
      return result;
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

module.exports = { makeSpeakersDb };
