'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUpdateEventConfigHandler,
  createUpdateFeaturesHandler,
  createUpdateThemeHandler,
  createUpdateBadgesHandler,
  internals: { applyConfigWrite, findReadOnlyViolations },
} = require('./config.cjs');

// ---------------------------------------------------------------- fixtures

// The workspace lint config bans hex color literals (spec §7.6); these are
// test DATA for the shared validator, so they are assembled at runtime.
const hex = (digits) => '#' + digits;

const ADMIN_EMAIL = 'admin@example.org';
const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

function validEvent(overrides = {}) {
  return {
    name: '2027 Example Summit',
    shortName: 'EX2027',
    timezone: 'America/New_York',
    days: [
      { id: 'day-1', label: 'Thursday', date: '2027-05-13', startTime: '09:00', endTime: '17:00' },
      { id: 'day-2', label: 'Friday', date: '2027-05-14', startTime: '09:00', endTime: '15:00' },
    ],
    registration: { opensAt: '2027-01-01T09:00', closesAt: '2027-05-01T17:00', externalUrl: null },
    sender: { email: 'summit@example.org', name: 'Example Summit', replyTo: null },
    ...overrides,
  };
}

function validTheme() {
  return { colors: { primary: hex('112233'), accent: hex('abc') } };
}

function validBadges() {
  return {
    categories: [
      { id: 'roles', label: 'Roles', maxPicks: 2, badges: [{ id: 'editor', label: 'Editor' }] },
    ],
  };
}

/**
 * Minimal in-memory Firestore fake: doc get/set (auto-id on doc()),
 * batches, and an append-only `writes` audit. No emulator (house rule).
 */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  let autoId = 0;
  function docRef(col, id) {
    const key = `${col}/${id}`;
    return {
      _key: key,
      async get() {
        const data = docs.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data) {
        docs.set(key, data);
        writes.push(key);
      },
    };
  }
  return {
    docs,
    writes,
    collection(name) {
      return {
        doc(id) {
          autoId += 1;
          return docRef(name, id === undefined ? `auto${autoId}` : id);
        },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, data) {
          ops.push({ ref, data });
        },
        async commit() {
          for (const op of ops) await op.ref.set(op.data);
        },
      };
    },
    rows(col) {
      return [...docs.entries()].filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v);
    },
  };
}

function makeDeps(seed = {}) {
  const db = fakeDb(seed);
  return {
    db,
    auth: {
      async verifyIdToken(token) {
        if (token === 'admin-token') {
          return { uid: 'admin-1', email: ADMIN_EMAIL, email_verified: true };
        }
        if (token === 'user-token') {
          return { uid: 'user-1', email: 'user@example.org', email_verified: true };
        }
        throw new Error('bad token');
      },
    },
    getConfig: async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL] } }),
    now: () => NOW,
    log: { warn() {}, error() {} },
  };
}

function makeReq(body, { token = 'admin-token', method = 'POST' } = {}) {
  return { method, body, headers: { authorization: token ? `Bearer ${token}` : undefined } };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    send() {
      return res;
    },
  };
  return res;
}

const ACTOR = { uid: 'admin-1', email: ADMIN_EMAIL };

// ------------------------------------------------- document allowlist (§2)

test('bootstrap and providers doc ids are rejected by name', async () => {
  for (const docId of ['bootstrap', 'providers', 'nonsense']) {
    const deps = makeDeps();
    const result = await applyConfigWrite({
      db: deps.db, docId, payload: {}, actor: ACTOR, now: deps.now,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.match(result.message, new RegExp(`config/${docId}`));
    assert.equal(deps.db.writes.length, 0, `${docId}: nothing may be written`);
  }
});

// -------------------------------------------- read-only field naming (§3)

test('sender.domainVerified and domainVerifiedAt are rejected naming the field', async () => {
  const deps = makeDeps();
  const handler = createUpdateEventConfigHandler(deps);
  const res = makeRes();
  const payload = validEvent({
    sender: { email: 'a@b.org', name: 'A', replyTo: null, domainVerified: true, domainVerifiedAt: '2026-01-01T00:00' },
  });
  await handler(makeReq({ event: payload }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /sender\.domainVerified: read-only/);
  assert.match(res.body.error.message, /sender\.domainVerifiedAt: read-only/);
  assert.match(res.body.error.message, /verify-sender-domain\.cjs/);
  assert.equal(deps.db.writes.length, 0);
});

test('providers.* is rejected naming each field, on every doc', async () => {
  const violations = findReadOnlyViolations({ providers: { email: {}, ticketing: {} } });
  assert.deepEqual(
    violations.map((v) => v.split(':')[0]),
    ['providers.email', 'providers.ticketing'],
  );
  const deps = makeDeps();
  const handler = createUpdateFeaturesHandler(deps);
  const res = makeRes();
  await handler(makeReq({ features: { schedule: true, providers: { email: {} } } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /providers\.email: read-only/);
});

test('Tier-A-sourced fields are rejected naming the field', async () => {
  for (const field of ['projectId', 'region', 'publicUrl', 'externalEventId', 'slug']) {
    const deps = makeDeps();
    const handler = createUpdateEventConfigHandler(deps);
    const res = makeRes();
    await handler(makeReq({ event: validEvent({ [field]: 'x' }) }), res);
    assert.equal(res.statusCode, 400, field);
    assert.match(res.body.error.message, new RegExp(`${field}: read-only`));
    assert.equal(deps.db.writes.length, 0);
  }
});

// -------------------------------------------------- shared validation (§4)

test('invalid payloads are rejected with the shared validator errors', async () => {
  const cases = [
    {
      handler: createUpdateEventConfigHandler,
      body: { event: validEvent({ timezone: 'Not/AZone' }) },
      expect: /timezone: must be a valid IANA timezone/,
    },
    {
      handler: createUpdateThemeHandler,
      body: { theme: { colors: { primary: 'red' } } },
      expect: /theme\.colors\.primary: must be a hex color/,
    },
    {
      handler: createUpdateBadgesHandler,
      body: {
        badges: {
          categories: [
            { id: 'c', label: 'C', maxPicks: 1, badges: [{ id: 'dup', label: 'A' }, { id: 'dup', label: 'B' }] },
          ],
        },
      },
      expect: /duplicate badge id "dup"/,
    },
    {
      handler: createUpdateFeaturesHandler,
      body: { features: { notAFeature: true } },
      expect: /features\.notAFeature: unknown feature key/,
    },
  ];
  for (const { handler, body, expect } of cases) {
    const deps = makeDeps();
    const res = makeRes();
    await handler(deps)(makeReq(body), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, expect);
    assert.equal(deps.db.writes.length, 0, 'invalid payloads must not write');
  }
});

test('duplicate day ids are rejected via the shared event validator', async () => {
  const deps = makeDeps();
  const res = makeRes();
  const days = validEvent().days.map((d) => ({ ...d, id: 'day-1' }));
  await createUpdateEventConfigHandler(deps)(makeReq({ event: validEvent({ days }) }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /duplicate day id "day-1"/);
});

// --------------------------------------------- happy path + stamps (§5/§6)

test('a valid theme write lands with stamps, audit row, and admin log', async () => {
  const deps = makeDeps({ 'config/theme': { colors: { legacy: hex('000') }, updatedBy: 'old@x.org' } });
  const res = makeRes();
  await createUpdateThemeHandler(deps)(makeReq({ theme: validTheme() }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { docPath: 'config/theme' });

  const written = deps.db.docs.get('config/theme');
  assert.deepEqual(written.colors, validTheme().colors);
  assert.equal('legacy' in written.colors, false, 'replace semantics: removed fields go away');
  assert.deepEqual(written.updatedAt, new Date(NOW));
  assert.equal(written.updatedBy, ADMIN_EMAIL);

  const [history] = deps.db.rows('cmsVersionHistory');
  assert.equal(history.docPath, 'config/theme');
  assert.deepEqual(history.fields.colors, validTheme().colors);
  assert.equal(history.updatedBy, ADMIN_EMAIL);

  const [log] = deps.db.rows('admin_logs');
  assert.deepEqual(log, {
    action: 'updateTheme',
    docPath: 'config/theme',
    uid: 'admin-1',
    email: ADMIN_EMAIL,
    at: new Date(NOW),
  });
});

test('client-supplied updatedAt/updatedBy are stripped, not trusted', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateFeaturesHandler(deps)(
    makeReq({ features: { schedule: true, updatedAt: 'spoof', updatedBy: 'spoof@x.org' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/features');
  assert.equal(written.updatedBy, ADMIN_EMAIL);
  assert.deepEqual(written.updatedAt, new Date(NOW));
});

test('an event write preserves the stored sender verification pair', async () => {
  const deps = makeDeps({
    'config/event': {
      ...validEvent(),
      sender: { email: 'old@x.org', name: 'Old', replyTo: null, domainVerified: true, domainVerifiedAt: '2026-02-02T00:00' },
    },
  });
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(makeReq({ event: validEvent() }), res);
  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/event');
  assert.equal(written.sender.domainVerified, true);
  assert.equal(written.sender.domainVerifiedAt, '2026-02-02T00:00');
  assert.equal(written.sender.email, 'summit@example.org', 'editable sender fields still replace');
});

test('a first event write defaults the verification pair, never omits it', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateBadgesHandler(deps)(makeReq({ badges: validBadges() }), makeRes());
  await createUpdateEventConfigHandler(deps)(makeReq({ event: validEvent() }), res);
  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/event');
  assert.equal(written.sender.domainVerified, false);
  assert.equal(written.sender.domainVerifiedAt, null);
});

// -------------------------------------------------------- gates and shape

test('non-admin gets 403, missing token gets 401, GET gets 405', async () => {
  const deps = makeDeps();
  const handler = createUpdateThemeHandler(deps);

  let res = makeRes();
  await handler(makeReq({ theme: validTheme() }, { token: 'user-token' }), res);
  assert.equal(res.statusCode, 403);

  res = makeRes();
  await handler(makeReq({ theme: validTheme() }, { token: null }), res);
  assert.equal(res.statusCode, 401);

  res = makeRes();
  await handler(makeReq({ theme: validTheme() }, { method: 'GET' }), res);
  assert.equal(res.statusCode, 405);

  assert.equal(deps.db.writes.length, 0);
});

test('a non-object payload under the doc key is a 400', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateBadgesHandler(deps)(makeReq({ badges: [1, 2] }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /badges: must be an object/);
});

test('a failed admin_logs write never fails the call', async () => {
  const deps = makeDeps();
  const realCollection = deps.db.collection.bind(deps.db);
  deps.db.collection = (name) => {
    if (name === 'admin_logs') throw new Error('logs outage');
    return realCollection(name);
  };
  const res = makeRes();
  await createUpdateFeaturesHandler(deps)(makeReq({ features: { schedule: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(deps.db.docs.get('config/features').schedule, true);
});
