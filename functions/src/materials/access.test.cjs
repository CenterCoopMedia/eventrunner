'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSessionMaterialUrl,
  listSessionMaterials,
  resolveMaterialAccess,
  internals: { MaterialNotFoundError, SessionNotFoundError, EmbargoedError },
} = require('./access.cjs');

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  return {
    docs,
    collection(name) {
      return {
        doc: (id) => ({
          async get() {
            const key = `${name}/${id}`;
            const data = docs.get(key);
            return { exists: data !== undefined, data: () => data };
          },
        }),
        where(field, op, value) {
          return {
            async get() {
              const rows = [...docs.entries()]
                .filter(([k]) => k.startsWith(`${name}/`))
                .filter(([, v]) => v[field] === value)
                .map(([k, v]) => ({ id: k.split('/')[1], data: () => v }));
              return { docs: rows };
            },
          };
        },
      };
    },
  };
}

const EVENT_CONFIG = {
  timezone: 'America/New_York',
  days: [{ id: 'day-1', date: '2026-10-15', startTime: '09:00', endTime: '17:00' }],
};
const getConfig = async () => ({ event: EVENT_CONFIG });

const PAST_NOW = () => new Date('2026-10-16T12:00:00Z');
const DURING_NOW = () => new Date('2026-10-15T12:00:00Z');

function seed() {
  return {
    'cmsSchedule/s1': { dayId: 'day-1', endTime: '11:00 AM', speakerIds: ['spk-1'] },
    'session_materials/m-approved': {
      sessionId: 's1', type: 'link', url: 'https://example.org/deck',
      filename: 'Deck', reviewStatus: 'approved', submittedBySpeakerId: 'spk-1',
    },
    'session_materials/m-pending': {
      sessionId: 's1', type: 'link', url: 'https://example.org/draft',
      filename: 'Draft', reviewStatus: 'pending', submittedBySpeakerId: 'spk-1',
    },
  };
}

test('getSessionMaterialUrl: admin can access anytime', async () => {
  const db = fakeDb(seed());
  const result = await getSessionMaterialUrl({
    db, materialId: 'm-pending', actor: { isAdmin: true, speakerId: null }, getConfig, now: DURING_NOW,
  });
  assert.equal(result.url, 'https://example.org/draft');
});

test('getSessionMaterialUrl: the session\'s own speaker can access before the session ends', async () => {
  const db = fakeDb(seed());
  const result = await getSessionMaterialUrl({
    db, materialId: 'm-pending', actor: { isAdmin: false, speakerId: 'spk-1' }, getConfig, now: DURING_NOW,
  });
  assert.equal(result.url, 'https://example.org/draft');
});

test('getSessionMaterialUrl: an approved material is embargoed until the session is past', async () => {
  const db = fakeDb(seed());
  await assert.rejects(
    getSessionMaterialUrl({
      db, materialId: 'm-approved', actor: { isAdmin: false, speakerId: null }, getConfig, now: DURING_NOW,
    }),
    EmbargoedError,
  );
});

test('getSessionMaterialUrl: an approved material releases once the session is past', async () => {
  const db = fakeDb(seed());
  const result = await getSessionMaterialUrl({
    db, materialId: 'm-approved', actor: { isAdmin: false, speakerId: null }, getConfig, now: PAST_NOW,
  });
  assert.equal(result.url, 'https://example.org/deck');
});

test('getSessionMaterialUrl: a pending material is never released to a non-speaker non-admin, even past the session', async () => {
  const db = fakeDb(seed());
  await assert.rejects(
    getSessionMaterialUrl({
      db, materialId: 'm-pending', actor: { isAdmin: false, speakerId: null }, getConfig, now: PAST_NOW,
    }),
    EmbargoedError,
  );
});

test('getSessionMaterialUrl: an unknown material rejects', async () => {
  const db = fakeDb(seed());
  await assert.rejects(
    getSessionMaterialUrl({ db, materialId: 'nope', actor: { isAdmin: true, speakerId: null }, getConfig, now: PAST_NOW }),
    MaterialNotFoundError,
  );
});

test('getSessionMaterialUrl: an unknown session rejects', async () => {
  const db = fakeDb({
    'session_materials/orphan': { sessionId: 'ghost', type: 'link', url: 'x', filename: 'x', reviewStatus: 'approved' },
  });
  await assert.rejects(
    getSessionMaterialUrl({ db, materialId: 'orphan', actor: { isAdmin: true, speakerId: null }, getConfig, now: PAST_NOW }),
    SessionNotFoundError,
  );
});

test('listSessionMaterials: admin sees everything for the session', async () => {
  const db = fakeDb(seed());
  const { materials } = await listSessionMaterials({ db, sessionId: 's1', actor: { isAdmin: true, speakerId: null } });
  assert.equal(materials.length, 2);
});

test('listSessionMaterials: the session speaker sees everything for their own session', async () => {
  const db = fakeDb(seed());
  const { materials } = await listSessionMaterials({ db, sessionId: 's1', actor: { isAdmin: false, speakerId: 'spk-1' } });
  assert.equal(materials.length, 2);
});

test('listSessionMaterials: an unrelated caller gets an empty list, not an error', async () => {
  const db = fakeDb(seed());
  const { materials } = await listSessionMaterials({ db, sessionId: 's1', actor: { isAdmin: false, speakerId: 'spk-9' } });
  assert.deepEqual(materials, []);
});

test('listSessionMaterials: an unknown session rejects', async () => {
  const db = fakeDb();
  await assert.rejects(
    listSessionMaterials({ db, sessionId: 'ghost', actor: { isAdmin: true, speakerId: null } }),
    SessionNotFoundError,
  );
});

// ------------------------------------------- file materials (P2 access fix)

function seedWithFile() {
  return {
    ...seed(),
    'session_materials/m-file-approved': {
      sessionId: 's1', type: 'file', storagePath: 'session-materials/s1/slides.pdf',
      filename: 'slides.pdf', reviewStatus: 'approved', submittedBySpeakerId: 'spk-1',
    },
  };
}

test('getSessionMaterialUrl: a file material never returns a url, even to an admin — no signed URL is minted', async () => {
  const db = fakeDb(seedWithFile());
  const result = await getSessionMaterialUrl({
    db, materialId: 'm-file-approved', actor: { isAdmin: true, speakerId: null }, getConfig, now: DURING_NOW,
  });
  assert.deepEqual(result, { type: 'file', filename: 'slides.pdf' });
  assert.equal('url' in result, false);
});

test('getSessionMaterialUrl: a file material still enforces the embargo before returning anything', async () => {
  const db = fakeDb(seedWithFile());
  await assert.rejects(
    getSessionMaterialUrl({
      db, materialId: 'm-file-approved', actor: { isAdmin: false, speakerId: null }, getConfig, now: DURING_NOW,
    }),
    EmbargoedError,
  );
});

test('resolveMaterialAccess: returns the material and session once the embargo gate passes, for reuse by downloadSessionMaterial', async () => {
  const db = fakeDb(seedWithFile());
  const { material, session } = await resolveMaterialAccess({
    db, materialId: 'm-file-approved', actor: { isAdmin: true, speakerId: null }, getConfig, now: DURING_NOW,
  });
  assert.equal(material.storagePath, 'session-materials/s1/slides.pdf');
  assert.equal(session.dayId, 'day-1');
});
