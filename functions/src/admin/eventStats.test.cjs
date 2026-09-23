'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGetEventStatsHandler, internals } = require('./eventStats.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { seedDemo } = require('../../../scripts/seed-demo-event.cjs');

// requireAdmin reads config/bootstrap live from the db it is handed and
// fails closed on an absent document, so every fixture carries it.
const BOOTSTRAP = {
  'config/bootstrap': { adminEmails: ['admin@example.org'], staffEmails: ['staff@example.org'] },
};

const TOKENS = {
  'operator-token': { uid: 'op1', email: 'admin@example.org', email_verified: true },
  'staff-token': { uid: 'st1', email: 'staff@example.org', email_verified: true },
  'stranger-token': { uid: 'u1', email: 'stranger@example.org', email_verified: true },
  'unverified-token': { uid: 'op2', email: 'admin@example.org', email_verified: false },
};

const auth = {
  async verifyIdToken(token) {
    if (TOKENS[token]) return TOKENS[token];
    throw new Error('auth/argument-error');
  },
};
const getConfig = async () => ({ bootstrap: BOOTSTRAP['config/bootstrap'] });
const NOW = Date.parse('2026-10-01T13:14:00Z');
const silentLog = { error() {}, warn() {} };

function req({ method = 'POST', token = 'operator-token' } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} };
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

async function call(db, options) {
  const res = fakeRes();
  await createGetEventStatsHandler({ db, auth, getConfig, now: () => NOW, log: silentLog })(req(options), res);
  return res;
}

/**
 * The db, with every `count()` recorded by the collection and filter it ran
 * on. `reject` names one of those labels; its `count().get()` throws.
 */
function instrument(db, { reject = null } = {}) {
  const counted = [];
  const wrap = (target, label) => new Proxy(target, {
    get(object, prop) {
      if (prop === 'where') {
        return (field, op, value) => wrap(object.where(field, op, value), `${label} ${field}==${value}`);
      }
      if (prop === 'count') {
        return () => {
          counted.push(label);
          if (label === reject) return { get: async () => { throw new Error('UNAVAILABLE'); } };
          return object.count();
        };
      }
      const value = object[prop];
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
  const wrapped = new Proxy(db, {
    get(object, prop) {
      if (prop === 'collection') return (name) => wrap(object.collection(name), name);
      const value = object[prop];
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
  return { db: wrapped, counted };
}

/** Every leaf key path of a plain object, dotted, sorted. */
function leafPaths(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key)).sort();
}

/** Run the demo seed with its progress output swallowed. */
async function seeded() {
  const db = makeFakeDb(BOOTSTRAP);
  const log = console.log;
  console.log = () => {};
  try {
    await seedDemo({ db, store: require('../cms/store.cjs'), args: {}, now: () => Date.parse('2026-01-01T00:00:00Z') });
  } finally {
    console.log = log;
  }
  return db;
}

/** `n` documents in a collection, each with `data`. */
async function addDocs(db, collection, prefix, n, data) {
  for (let i = 0; i < n; i += 1) {
    await db.collection(collection).doc(`${prefix}-${i}`).set({ ...data });
  }
}

test('getEventStats answers 405 to anything but POST', async () => {
  const res = await call(makeFakeDb(BOOTSTRAP), { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('getEventStats refuses a caller with no token, a non-admin, and an unverified address, before any count', async () => {
  for (const [token, status] of [[null, 401], ['stranger-token', 403], ['unverified-token', 403], ['forged', 401]]) {
    const { db, counted } = instrument(makeFakeDb(BOOTSTRAP));
    const res = await call(db, { token });
    assert.equal(res.statusCode, status, `token ${token}`);
    assert.equal(res.body.readAt, undefined);
    assert.equal(res.body.registrations, undefined);
    assert.deepEqual(counted, [], `no aggregate ran for token ${token}`);
  }
});

test('getEventStats admits staff as well as operators', async () => {
  for (const token of ['staff-token', 'operator-token']) {
    const res = await call(makeFakeDb(BOOTSTRAP), { token });
    assert.equal(res.statusCode, 200, token);
    assert.equal(res.body.readAt, new Date(NOW).toISOString());
  }
});

test('getEventStats runs thirty count() aggregates and reads no document body', async () => {
  const { db, counted } = instrument(await seeded());
  const res = await call(db);
  assert.equal(res.statusCode, 200);
  assert.equal(counted.length, 30);
  assert.equal(new Set(counted).size, 30);
  // Whole collections and one == filter each: single-field indexes serve them.
  for (const label of counted) assert.ok(label.split(' ').length <= 2, label);
});

test('getEventStats returns the counts for the seeded demo event', async () => {
  const db = await seeded();
  // Accounts: 1 pending, 2 ticketed, 3 approved, 4 revoked; 6 profiles complete.
  await addDocs(db, 'users', 'pending', 1, { registrationStatus: 'pending', profileComplete: false });
  await addDocs(db, 'users', 'ticketed', 2, { registrationStatus: 'ticketed', profileComplete: true });
  await addDocs(db, 'users', 'approved', 3, { registrationStatus: 'approved', profileComplete: true });
  await addDocs(db, 'users', 'revoked-done', 1, { registrationStatus: 'revoked', profileComplete: true });
  await addDocs(db, 'users', 'revoked', 3, { registrationStatus: 'revoked', profileComplete: false });
  // Ticket records: 5 valid, 6 refunded, 7 cancelled, 8 waiting for details.
  await addDocs(db, 'tickets', 'valid', 5, { status: 'valid' });
  await addDocs(db, 'tickets', 'refunded', 6, { status: 'refunded' });
  await addDocs(db, 'tickets', 'cancelled', 7, { status: 'cancelled' });
  await addDocs(db, 'tickets', 'pending-info', 8, { status: 'pending_info' });
  // Speakers beyond the seed's approved twelve.
  await addDocs(db, 'speakers', 'draft', 1, { status: 'draft' });
  await addDocs(db, 'speakers', 'invited', 2, { status: 'invited' });
  await addDocs(db, 'speakers', 'accepted', 3, { status: 'accepted' });
  await addDocs(db, 'speakers', 'removed', 4, { status: 'removed' });
  // One resolved error and two unresolved.
  await addDocs(db, 'system_errors', 'resolved', 1, { resolved: true });
  await addDocs(db, 'system_errors', 'open', 2, { resolved: false });
  // One session with unpublished changes, and one taken off the site.
  const [changed, hidden] = db.ids('cmsSchedule_drafts');
  await db.collection('cmsSchedule_drafts').doc(changed).update({ status: 'dirty' });
  await db.collection('cmsSchedule').doc(hidden).update({ visible: false });

  const res = await call(db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    readAt: '2026-10-01T13:14:00.000Z',
    registrations: {
      total: 10,
      byStatus: { pending: 1, ticketed: 2, approved: 3, revoked: 4 },
      profileComplete: 6,
    },
    tickets: { total: 26, byStatus: { valid: 5, refunded: 6, cancelled: 7, pending_info: 8 } },
    speakers: { total: 22, byStatus: { draft: 1, invited: 2, accepted: 3, approved: 12, removed: 4 } },
    content: {
      cmsContent: { published: 100, drafts: 0 },
      cmsSchedule: { published: 31, drafts: 1 },
      cmsOrganizations: { published: 6, drafts: 0 },
      cmsTimeline: { published: 0, drafts: 0 },
      cmsUpdates: { published: 6, drafts: 0 },
      cmsPages: { published: 15, drafts: 0 },
    },
    errors: { unresolved: 2 },
    funnel: [
      { id: 'accounts', count: 10 },
      { id: 'ticketed-or-approved', count: 5 },
      { id: 'approved', count: 3 },
    ],
  });
});

test('the funnel nests: an account approved straight from pending counts in both later stages', async () => {
  const db = makeFakeDb(BOOTSTRAP);
  // Pending, then approved by an admin with no ticket (a press or volunteer
  // grant): its stored status is simply 'approved'.
  await db.collection('users').doc('press').set({ registrationStatus: 'approved' });
  await db.collection('users').doc('buyer').set({ registrationStatus: 'ticketed' });
  await db.collection('users').doc('new').set({ registrationStatus: 'pending' });
  await db.collection('users').doc('gone').set({ registrationStatus: 'revoked' });
  const res = await call(db);
  assert.deepEqual(res.body.funnel, [
    { id: 'accounts', count: 4 },
    { id: 'ticketed-or-approved', count: 2 },
    { id: 'approved', count: 1 },
  ]);
  const [accounts, later, approved] = res.body.funnel.map((stage) => stage.count);
  assert.ok(accounts >= later && later >= approved);
});

test('getEventStats answers zero for every figure on an empty deployment', async () => {
  const res = await call(makeFakeDb(BOOTSTRAP));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.funnel.map((stage) => stage.count), [0, 0, 0]);
  for (const path of leafPaths(res.body)) {
    if (path === 'readAt' || path === 'funnel') continue;
    const value = path.split('.').reduce((node, key) => node[key], res.body);
    assert.equal(value, 0, path);
  }
});

test('getEventStats answers exactly these key paths, integers and a timestamp only', async () => {
  const res = await call(makeFakeDb(BOOTSTRAP));
  // The funnel is the one list: three stages, each an id and an integer.
  assert.deepEqual(res.body.funnel.map((stage) => Object.keys(stage).sort()), [
    ['count', 'id'], ['count', 'id'], ['count', 'id'],
  ]);
  assert.deepEqual(res.body.funnel.map((stage) => stage.id), ['accounts', 'ticketed-or-approved', 'approved']);
  assert.deepEqual(leafPaths(res.body), [
    'content.cmsContent.drafts', 'content.cmsContent.published',
    'content.cmsOrganizations.drafts', 'content.cmsOrganizations.published',
    'content.cmsPages.drafts', 'content.cmsPages.published',
    'content.cmsSchedule.drafts', 'content.cmsSchedule.published',
    'content.cmsTimeline.drafts', 'content.cmsTimeline.published',
    'content.cmsUpdates.drafts', 'content.cmsUpdates.published',
    'errors.unresolved',
    'funnel',
    'readAt',
    'registrations.byStatus.approved', 'registrations.byStatus.pending',
    'registrations.byStatus.revoked', 'registrations.byStatus.ticketed',
    'registrations.profileComplete', 'registrations.total',
    'speakers.byStatus.accepted', 'speakers.byStatus.approved', 'speakers.byStatus.draft',
    'speakers.byStatus.invited', 'speakers.byStatus.removed', 'speakers.total',
    'tickets.byStatus.cancelled', 'tickets.byStatus.pending_info',
    'tickets.byStatus.refunded', 'tickets.byStatus.valid', 'tickets.total',
  ]);
});

test('getEventStats answers 500 with no figures when one aggregate fails', async () => {
  const errors = [];
  const { db } = instrument(makeFakeDb(BOOTSTRAP), { reject: 'tickets status==refunded' });
  const res = fakeRes();
  await createGetEventStatsHandler({
    db, auth, getConfig, now: () => NOW, log: { error: (...args) => errors.push(args), warn() {} },
  })(req(), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: { code: 'internal', message: 'The event figures are not available right now. Try again.' },
  });
  assert.equal(errors.length, 1);
});

test('getEventStats answers 500 when config/bootstrap cannot be read, and counts nothing', async () => {
  const { db, counted } = instrument(makeFakeDb(BOOTSTRAP));
  const broken = new Proxy(db, {
    get(object, prop) {
      if (prop === 'collection') {
        return (name) => (name === 'config'
          ? { doc: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) }
          : object.collection(name));
      }
      return object[prop];
    },
  });
  const res = await call(broken);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(counted, []);
});

test('countOf refuses an answer that is not a whole number', () => {
  assert.equal(internals.countOf({ data: () => ({ count: 4 }) }), 4);
  for (const bad of [-1, 1.5, '3', null, undefined]) {
    assert.throws(() => internals.countOf({ data: () => ({ count: bad }) }));
  }
});
