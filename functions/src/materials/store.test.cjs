'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addSessionMaterialLink,
  uploadSessionMaterial,
  updateSessionMaterial,
  deleteSessionMaterial,
  deleteMaterialsForSession,
  internals: {
    SessionNotFoundError,
    MaterialNotFoundError,
    NotAuthorizedError,
    InvalidUrlError,
    MaterialCapExceededError,
    MAX_MATERIALS_PER_SESSION,
  },
} = require('./store.cjs');

/** Minimal in-memory Firestore fake, same shape as bookmarks.test.cjs's. */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, v]));
  let counter = 0;
  function docRef(col, id) {
    const key = `${col}/${id}`;
    return {
      id,
      _key: key,
      async get() {
        const data = docs.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data) {
        docs.set(key, data);
      },
      async update(patch) {
        docs.set(key, { ...docs.get(key), ...patch });
      },
      async delete() {
        docs.delete(key);
      },
    };
  }
  return {
    docs,
    collection(name) {
      return {
        doc: (id) => docRef(name, id ?? `auto-${++counter}`),
        where(field, _op, value) {
          return {
            async get() {
              const rows = [...docs.entries()]
                .filter(([k]) => k.startsWith(`${name}/`))
                .filter(([, v]) => v?.[field] === value)
                .map(([k, v]) => ({ id: k.split('/')[1], ref: docRef(name, k.split('/')[1]), data: () => v }));
              return { empty: rows.length === 0, docs: rows };
            },
          };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        delete(ref) {
          ops.push(() => docs.delete(ref._key));
        },
        async commit() {
          for (const op of ops) op();
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          docs.set(ref._key, data);
        },
        update(ref, patch) {
          docs.set(ref._key, { ...docs.get(ref._key), ...patch });
        },
        delete(ref) {
          docs.delete(ref._key);
        },
      };
      return fn(tx);
    },
  };
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const now = () => NOW;

function seedSession(id, overrides = {}) {
  return { [`cmsSchedule/${id}`]: { title: 'Fixture session', speakerIds: [], ...overrides } };
}

const ADMIN = { uid: 'admin-1', isAdmin: true, speakerId: null };
const speaker = (speakerId, uid = 'speaker-uid') => ({ uid, isAdmin: false, speakerId });

// --------------------------------------------------------- addSessionMaterialLink

test('addSessionMaterialLink: admin can add a link and materialCount increments in the same write', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id, material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/deck',
    label: 'Slide deck',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'Slide deck');
  assert.equal(material.reviewStatus, 'pending');
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 1);
  assert.equal(db.docs.get(`session_materials/${id}`).sessionId, 's1');
});

test('addSessionMaterialLink: a speaker of the session may add a link', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/deck',
    label: 'Deck',
    actor: speaker('spk-1'),
    now,
  });
  assert.equal(material.submittedBySpeakerId, 'spk-1');
});

test('addSessionMaterialLink: a speaker NOT on the session is rejected', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  await assert.rejects(
    addSessionMaterialLink({
      db,
      sessionId: 's1',
      url: 'https://example.org/deck',
      label: 'Deck',
      actor: speaker('spk-2'),
      now,
    }),
    NotAuthorizedError,
  );
});

test('addSessionMaterialLink: an unknown session rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    addSessionMaterialLink({ db, sessionId: 'missing', url: 'https://x.org', label: '', actor: ADMIN, now }),
    SessionNotFoundError,
  );
});

test('addSessionMaterialLink: materialCount increments across multiple materials on the same session', async () => {
  const db = fakeDb(seedSession('s1'));
  await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://a.org', label: 'A', actor: ADMIN, now });
  await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://b.org', label: 'B', actor: ADMIN, now });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 2);
});

// ------------------------------------------------- the four named §4.4 scrub tests

test('pinning: a URL-shaped label renders "External link"', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/embargoed-actual-url',
    label: 'https://example.org/embargoed-actual-url',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'External link');
});

test('pinning: an empty label renders "External link"', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/embargoed',
    label: '   ',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'External link');
});

test('pinning: a real label is preserved', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db,
    sessionId: 's1',
    url: 'https://example.org/embargoed',
    label: 'Opening keynote slides',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'Opening keynote slides');
});

// ------------------------------------------------------------ uploadSessionMaterial

test('uploadSessionMaterial: file materials are never scrubbed even when URL-shaped', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await uploadSessionMaterial({
    db,
    sessionId: 's1',
    storagePath: 'session-materials/s1/slides.pdf',
    filename: 'slides.pdf',
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'slides.pdf');
  assert.equal(material.type, 'file');
});

// ------------------------------------------------------------ updateSessionMaterial

test('updateSessionMaterial: admin can update filename with re-scrub applied', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  const { material } = await updateSessionMaterial({
    db,
    materialId: id,
    patch: { filename: 'https://leaked.example.org' },
    actor: ADMIN,
    now,
  });
  assert.equal(material.filename, 'External link');
});

test('updateSessionMaterial: the submitting speaker may edit their own pending material', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  const { material } = await updateSessionMaterial({
    db, materialId: id, patch: { filename: 'Updated deck' }, actor: speaker('spk-1'), now,
  });
  assert.equal(material.filename, 'Updated deck');
});

test('updateSessionMaterial: a speaker may not edit a material once it is no longer pending', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  db.docs.set(`session_materials/${id}`, { ...db.docs.get(`session_materials/${id}`), reviewStatus: 'approved' });
  await assert.rejects(
    updateSessionMaterial({ db, materialId: id, patch: { filename: 'Sneaky' }, actor: speaker('spk-1'), now }),
    NotAuthorizedError,
  );
});

test('updateSessionMaterial: a different speaker cannot edit someone else\'s material', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1', 'spk-2'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  await assert.rejects(
    updateSessionMaterial({ db, materialId: id, patch: { filename: 'Hijack' }, actor: speaker('spk-2'), now }),
    NotAuthorizedError,
  );
});

test('updateSessionMaterial: an unknown material rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    updateSessionMaterial({ db, materialId: 'nope', patch: {}, actor: ADMIN, now }),
    MaterialNotFoundError,
  );
});

// ------------------------------------------------------------ deleteSessionMaterial

test('deleteSessionMaterial: admin delete decrements materialCount in the same transaction', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 1);
  await deleteSessionMaterial({ db, materialId: id, actor: ADMIN });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 0);
  assert.equal(db.docs.has(`session_materials/${id}`), false);
});

test('deleteSessionMaterial: materialCount never goes negative', async () => {
  const db = fakeDb(seedSession('s1', { materialCount: 0 }));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  db.docs.set('cmsSchedule/s1', { ...db.docs.get('cmsSchedule/s1'), materialCount: 0 });
  await deleteSessionMaterial({ db, materialId: id, actor: ADMIN });
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, 0);
});

test('deleteSessionMaterial: the submitting speaker may withdraw their own material at any review status', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  db.docs.set(`session_materials/${id}`, { ...db.docs.get(`session_materials/${id}`), reviewStatus: 'approved' });
  await deleteSessionMaterial({ db, materialId: id, actor: speaker('spk-1') });
  assert.equal(db.docs.has(`session_materials/${id}`), false);
});

test('deleteSessionMaterial: a non-owning speaker cannot delete', async () => {
  const db = fakeDb(seedSession('s1', { speakerIds: ['spk-1', 'spk-2'] }));
  const { id } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: speaker('spk-1'), now,
  });
  await assert.rejects(
    deleteSessionMaterial({ db, materialId: id, actor: speaker('spk-2') }),
    NotAuthorizedError,
  );
});

test('deleteSessionMaterial: an unknown material rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    deleteSessionMaterial({ db, materialId: 'nope', actor: ADMIN }),
    MaterialNotFoundError,
  );
});

// --------------------------------------------------- unsafe URL rejection (P1)

for (const unsafe of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not-a-url', '']) {
  test(`addSessionMaterialLink: rejects an unsafe/invalid url (${JSON.stringify(unsafe)})`, async () => {
    const db = fakeDb(seedSession('s1'));
    await assert.rejects(
      addSessionMaterialLink({ db, sessionId: 's1', url: unsafe, label: 'Deck', actor: ADMIN, now }),
      InvalidUrlError,
    );
    // Nothing was written and materialCount was never touched.
    assert.equal(db.docs.get('cmsSchedule/s1').materialCount, undefined);
  });
}

test('addSessionMaterialLink: an http/https url is accepted', async () => {
  const db = fakeDb(seedSession('s1'));
  const { material } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'http://example.org/deck', label: 'Deck', actor: ADMIN, now,
  });
  assert.equal(material.url, 'http://example.org/deck');
});

test('updateSessionMaterial: rejects an unsafe url patch, leaving the stored url untouched', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'Deck', actor: ADMIN, now });
  await assert.rejects(
    updateSessionMaterial({ db, materialId: id, patch: { url: 'javascript:alert(1)' }, actor: ADMIN, now }),
    InvalidUrlError,
  );
  assert.equal(db.docs.get(`session_materials/${id}`).url, 'https://x.org');
});

// ------------------------------------------------------- per-session cap (P2)

test(`addSessionMaterialLink: rejects the ${MAX_MATERIALS_PER_SESSION + 1}th material for a session`, async () => {
  const db = fakeDb(seedSession('s1', { materialCount: MAX_MATERIALS_PER_SESSION }));
  await assert.rejects(
    addSessionMaterialLink({ db, sessionId: 's1', url: 'https://x.org', label: 'One too many', actor: ADMIN, now }),
    MaterialCapExceededError,
  );
});

test('addSessionMaterialLink: the exact cap boundary is still accepted', async () => {
  const db = fakeDb(seedSession('s1', { materialCount: MAX_MATERIALS_PER_SESSION - 1 }));
  const { material } = await addSessionMaterialLink({
    db, sessionId: 's1', url: 'https://x.org', label: 'Last one', actor: ADMIN, now,
  });
  assert.equal(material.filename, 'Last one');
  assert.equal(db.docs.get('cmsSchedule/s1').materialCount, MAX_MATERIALS_PER_SESSION);
});

test('uploadSessionMaterial: the cap applies to file materials too', async () => {
  const db = fakeDb(seedSession('s1', { materialCount: MAX_MATERIALS_PER_SESSION }));
  await assert.rejects(
    uploadSessionMaterial({
      db, sessionId: 's1', storagePath: 'session-materials/s1/x.pdf', filename: 'x.pdf', actor: ADMIN, now,
    }),
    MaterialCapExceededError,
  );
});

// ------------------------------------------------- deleteMaterialsForSession (cascade)

test('deleteMaterialsForSession: removes every material AND its public projection for the session', async () => {
  const db = fakeDb(seedSession('s1'));
  const { id: id1 } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://a.org', label: 'A', actor: ADMIN, now });
  const { id: id2 } = await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://b.org', label: 'B', actor: ADMIN, now });
  db.docs.set(`session_materials_public/${id1}`, { sessionId: 's1', type: 'link', filename: 'A', reviewStatus: 'approved' });
  db.docs.set(`session_materials_public/${id2}`, { sessionId: 's1', type: 'link', filename: 'B', reviewStatus: 'approved' });

  const result = await deleteMaterialsForSession({ db, sessionId: 's1' });

  assert.equal(result.deleted, 2);
  assert.equal(db.docs.has(`session_materials/${id1}`), false);
  assert.equal(db.docs.has(`session_materials/${id2}`), false);
  assert.equal(db.docs.has(`session_materials_public/${id1}`), false);
  assert.equal(db.docs.has(`session_materials_public/${id2}`), false);
});

test('deleteMaterialsForSession: never touches another session\'s materials', async () => {
  const db = fakeDb({ ...seedSession('s1'), ...seedSession('s2') });
  const { id: keep } = await addSessionMaterialLink({ db, sessionId: 's2', url: 'https://c.org', label: 'C', actor: ADMIN, now });
  await addSessionMaterialLink({ db, sessionId: 's1', url: 'https://a.org', label: 'A', actor: ADMIN, now });

  await deleteMaterialsForSession({ db, sessionId: 's1' });

  assert.equal(db.docs.has(`session_materials/${keep}`), true);
});

test('deleteMaterialsForSession: a session with no materials is a no-op', async () => {
  const db = fakeDb();
  const result = await deleteMaterialsForSession({ db, sessionId: 'empty' });
  assert.equal(result.deleted, 0);
});
