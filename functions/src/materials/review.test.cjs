'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  setMaterialReviewStatus,
  internals: { MaterialNotFoundError, InvalidReviewStatusError },
} = require('./review.cjs');

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  function docRef(col, id) {
    const key = `${col}/${id}`;
    return {
      _key: key,
      async get() {
        const data = docs.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async update(patch) {
        docs.set(key, { ...docs.get(key), ...patch });
      },
    };
  }
  return {
    docs,
    collection: (name) => ({ doc: (id) => docRef(name, id) }),
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        update: (ref, patch) => docs.set(ref._key, { ...docs.get(ref._key), ...patch }),
      });
    },
  };
}

const now = () => Date.UTC(2026, 9, 15, 12, 0, 0);

test('setMaterialReviewStatus: admin approves a pending material', async () => {
  const db = fakeDb({ 'session_materials/m1': { reviewStatus: 'pending', filename: 'Deck' } });
  const { material } = await setMaterialReviewStatus({ db, materialId: 'm1', reviewStatus: 'approved', now });
  assert.equal(material.reviewStatus, 'approved');
});

test('setMaterialReviewStatus: rejects an invalid status value', async () => {
  const db = fakeDb({ 'session_materials/m1': { reviewStatus: 'pending' } });
  await assert.rejects(
    setMaterialReviewStatus({ db, materialId: 'm1', reviewStatus: 'maybe', now }),
    InvalidReviewStatusError,
  );
});

test('setMaterialReviewStatus: an unknown material rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    setMaterialReviewStatus({ db, materialId: 'nope', reviewStatus: 'approved', now }),
    MaterialNotFoundError,
  );
});
