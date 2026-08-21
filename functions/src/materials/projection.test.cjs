'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSyncSessionMaterialPublic,
  internals: { projectMaterial },
} = require('./projection.cjs');

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
    };
  }
  return {
    docs,
    collection: (name) => ({ doc: (id) => docRef(name, id) }),
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        set: (ref, data) => docs.set(ref._key, data),
        delete: (ref) => docs.delete(ref._key),
      });
    },
  };
}

// -------------------------------------------------------------- projectMaterial

test('pinning (projection-level): a directly-written URL-shaped filename never reaches session_materials_public', async () => {
  const db = fakeDb({
    'session_materials/m1': {
      sessionId: 's1',
      type: 'link',
      url: 'https://example.org/secret',
      // Simulates an Admin SDK / console write that bypassed store.cjs's
      // scrub entirely — the URL-shaped label landed directly on filename.
      filename: 'https://example.org/secret',
      reviewStatus: 'approved',
    },
  });
  const sync = createSyncSessionMaterialPublic({ db });
  await sync({ materialId: 'm1' });
  const projected = db.docs.get('session_materials_public/m1');
  assert.equal(projected.filename, 'External link');
});

test('projectMaterial: a pending material is never projected', () => {
  assert.equal(projectMaterial({ sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'pending' }), null);
});

test('projectMaterial: a rejected material is never projected', () => {
  assert.equal(projectMaterial({ sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'rejected' }), null);
});

test('projectMaterial: an approved link material is projected with its scrubbed filename', () => {
  const payload = projectMaterial({ sessionId: 's1', type: 'link', filename: 'Opening slides', reviewStatus: 'approved' });
  assert.deepEqual(payload, { sessionId: 's1', type: 'link', filename: 'Opening slides', reviewStatus: 'approved' });
});

test('projectMaterial: an approved file material is never scrubbed, even when URL-shaped', () => {
  const payload = projectMaterial({ sessionId: 's1', type: 'file', filename: 'slides.pdf', reviewStatus: 'approved' });
  assert.equal(payload.filename, 'slides.pdf');
});

// -------------------------------------------------------- createSyncSessionMaterialPublic

test('syncSessionMaterialPublic: a newly-approved material gets a public row', async () => {
  const db = fakeDb({
    'session_materials/m1': { sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'approved' },
  });
  const sync = createSyncSessionMaterialPublic({ db });
  const result = await sync({ materialId: 'm1' });
  assert.equal(result.action, 'written');
  assert.deepEqual(db.docs.get('session_materials_public/m1'), {
    sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'approved',
  });
});

test('syncSessionMaterialPublic: moving a material to rejected deletes its public row', async () => {
  const db = fakeDb({
    'session_materials/m1': { sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'rejected' },
    'session_materials_public/m1': { sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'approved' },
  });
  const sync = createSyncSessionMaterialPublic({ db });
  const result = await sync({ materialId: 'm1' });
  assert.equal(result.action, 'deleted');
  assert.equal(db.docs.has('session_materials_public/m1'), false);
});

test('syncSessionMaterialPublic: deleting the source material deletes its public row', async () => {
  const db = fakeDb({
    'session_materials_public/m1': { sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'approved' },
  });
  const sync = createSyncSessionMaterialPublic({ db });
  const result = await sync({ materialId: 'm1' });
  assert.equal(result.action, 'deleted');
  assert.equal(db.docs.has('session_materials_public/m1'), false);
});

test('syncSessionMaterialPublic: a no-op write (e.g. a retried delivery) writes nothing', async () => {
  const db = fakeDb({
    'session_materials/m1': { sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'approved' },
    'session_materials_public/m1': { sessionId: 's1', type: 'link', filename: 'Deck', reviewStatus: 'approved' },
  });
  const sync = createSyncSessionMaterialPublic({ db });
  const result = await sync({ materialId: 'm1' });
  assert.equal(result.action, 'unchanged');
});

test('syncSessionMaterialPublic: an already-absent material with no public row is a no-op', async () => {
  const db = fakeDb();
  const sync = createSyncSessionMaterialPublic({ db });
  const result = await sync({ materialId: 'ghost' });
  assert.equal(result.action, 'unchanged');
});
