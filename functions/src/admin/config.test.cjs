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
const { resolveLegacyColors, THEME_COLOR_KEYS } = require('shared/theme');

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
 * optimistic-retry transactions, and append-only `writes` / `commits`
 * audits. `commits` records the key group each transaction landed
 * atomically, so tests can pin "these writes shared one commit" — a
 * non-atomic rewrite (sequential ref.set calls) produces no group holding
 * both keys and fails those assertions. No emulator (house rule).
 */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const versions = new Map(); // key -> write count, for conflict detection
  const writes = [];
  const commits = [];
  let autoId = 0;
  const versionOf = (key) => versions.get(key) || 0;
  function applySet(key, data) {
    docs.set(key, data);
    versions.set(key, versionOf(key) + 1);
    writes.push(key);
  }
  function docRef(col, id) {
    const key = `${col}/${id}`;
    return {
      _key: key,
      async get() {
        const data = docs.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data) {
        applySet(key, data);
      },
    };
  }
  function queryRef(col, field, value, max = Infinity) {
    return {
      _query: { col, field, value, max },
      limit(limitValue) {
        return queryRef(col, field, value, limitValue);
      },
    };
  }
  const db = {
    docs,
    writes,
    commits,
    // Test hook, fired after a transactional read: lets a test land a
    // concurrent write between the read and the commit attempt.
    onTransactionRead: null,
    collection(name) {
      return {
        doc(id) {
          autoId += 1;
          return docRef(name, id === undefined ? `auto${autoId}` : id);
        },
        where(field, operator, value) {
          if (operator !== '==') throw new Error(`unsupported operator ${operator}`);
          return queryRef(name, field, value);
        },
      };
    },
    // Same optimistic model as real Firestore: buffered writes commit only
    // if nothing read inside the transaction changed underneath it;
    // otherwise the body re-runs against fresh data.
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const reads = new Map();
        const ops = [];
        const tx = {
          async get(ref) {
            if (ref._query) {
              const { col, field, value, max } = ref._query;
              const matches = [...docs.entries()]
                .filter(([key, data]) => key.startsWith(`${col}/`) && data?.[field] === value)
                .slice(0, max);
              for (const [key] of matches) reads.set(key, versionOf(key));
              return {
                docs: matches.map(([key, data]) => ({
                  id: key.slice(col.length + 1),
                  data: () => data,
                })),
              };
            }
            reads.set(ref._key, versionOf(ref._key));
            const snap = await ref.get();
            if (db.onTransactionRead) await db.onTransactionRead(ref._key);
            return snap;
          },
          set(ref, data) {
            ops.push({ key: ref._key, data });
          },
        };
        const result = await fn(tx);
        if ([...reads].some(([key, v]) => versionOf(key) !== v)) continue;
        for (const op of ops) applySet(op.key, op.data);
        commits.push(ops.map((op) => op.key));
        return result;
      }
      throw new Error('transaction contention');
    },
    rows(col) {
      return [...docs.entries()].filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v);
    },
  };
  return db;
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

test('the Tier A rejected-fields list covers every getTierA() key', () => {
  const { getTierA } = require('../core/config.cjs');
  const { TIER_A_FIELDS } = require('./config.cjs').internals;
  for (const key of Object.keys(getTierA({}))) {
    assert.ok(TIER_A_FIELDS.includes(key), `${key} must be rejected as read-only`);
  }
  // Including the ones a stale hand-written list missed:
  for (const key of ['allowedOrigins', 'ticketingEventId', 'operatorNotifier']) {
    const violations = findReadOnlyViolations({ [key]: 'x' });
    assert.equal(violations.length, 1, key);
    assert.match(violations[0], new RegExp(`^${key}: read-only`));
  }
});

test('Tier-A-sourced fields are rejected naming the field', async () => {
  for (const field of ['projectId', 'region', 'publicUrl', 'externalEventId', 'slug',
    'allowedOrigins', 'ticketingEventId', 'operatorNotifier']) {
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
  // Publish MATERIALIZES the resolved legacy colors map (design brief §5.2),
  // so what lands is the resolver's answer, not the payload verbatim: three
  // digit hex arrives expanded to six, which is the form email and PDF read.
  assert.deepEqual(written.colors, { primary: hex('112233'), accent: hex('aabbcc') });
  assert.equal('legacy' in written.colors, false, 'replace semantics: removed fields go away');
  assert.deepEqual(written.updatedAt, new Date(NOW));
  assert.equal(written.updatedBy, ADMIN_EMAIL);

  const [history] = deps.db.rows('cmsVersionHistory');
  assert.equal(history.docPath, 'config/theme');
  assert.deepEqual(history.fields.colors, written.colors);
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

test('a preset-only theme publishes with a full colors map', async () => {
  // Design brief §5.2. email/render.cjs and schedule/pdf.cjs render outside a
  // browser and read config/theme.colors directly. A client who runs a preset
  // with no overrides stores no colors, so publish resolves the preset down
  // to the legacy map and writes it in — otherwise those two consumers would
  // render from nothing.
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateThemeHandler(deps)(makeReq({ theme: { preset: 'zine', colors: {} } }), res);

  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/theme');
  assert.deepEqual(written.colors, resolveLegacyColors({ preset: 'zine' }));
  assert.deepEqual(Object.keys(written.colors).sort(), [...THEME_COLOR_KEYS].sort());
  for (const value of Object.values(written.colors)) assert.match(value, /^#[0-9a-f]{6}$/);
  assert.equal(written.preset, 'zine');
});

test('switching presets re-materializes the palette, never keeping the old one', async () => {
  // For a preset document `colors` is an output. A stale map from the
  // previous preset must not pin the new one.
  const deps = makeDeps({ 'config/theme': { preset: 'zine', colors: resolveLegacyColors({ preset: 'zine' }) } });
  const res = makeRes();
  await createUpdateThemeHandler(deps)(
    makeReq({ theme: { preset: 'atlas', colors: resolveLegacyColors({ preset: 'zine' }) } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    deps.db.docs.get('config/theme').colors,
    resolveLegacyColors({ preset: 'atlas' }),
  );
});

test('a contrast failure on a defined pair is a publish error, not a warning', async () => {
  // Design brief §5.2: the rejection names the pair, the mode, and the
  // measured ratio. A draft may hold a failing value; a published document
  // may not.
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateThemeHandler(deps)(
    makeReq({ theme: { colors: { ink: hex('999999'), surface: hex('aaaaaa'), surfaceAlt: hex('b0b0b0') } } }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /ink on surface in light mode is 1\.\d\d:1, below the 4\.5:1 bar/);
  assert.equal(deps.db.docs.has('config/theme'), false, 'nothing was written');
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

test('the config doc and its cmsVersionHistory row land in ONE atomic commit', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateThemeHandler(deps)(makeReq({ theme: validTheme() }), res);
  assert.equal(res.statusCode, 200);

  const group = deps.db.commits.find((keys) => keys.includes('config/theme'));
  assert.ok(group, 'config/theme must be written through an atomic commit, not a bare set');
  assert.ok(
    group.some((key) => key.startsWith('cmsVersionHistory/')),
    'the audit row must share the config doc\'s commit — a crash between two sequential sets would leave a config change with no history',
  );
  assert.ok(
    !group.some((key) => key.startsWith('admin_logs/')),
    'admin_logs stays best-effort OUTSIDE the atomic commit',
  );
});

test('a verify-sender-domain write landing mid-save is not clobbered (transactional carry-forward)', async () => {
  const deps = makeDeps({
    'config/event': { ...validEvent(), sender: { email: 'old@x.org', name: 'Old', domainVerified: false, domainVerifiedAt: null } },
  });
  // Simulate verify-sender-domain.cjs committing between the admin save's
  // carry-forward read and its commit: the transaction must retry and
  // carry the fresh pair forward, never revert it to the stale read.
  deps.db.onTransactionRead = async (key) => {
    if (key !== 'config/event') return;
    deps.db.onTransactionRead = null;
    const stored = deps.db.docs.get('config/event');
    await deps.db.collection('config').doc('event').set({
      ...stored,
      sender: { ...stored.sender, domainVerified: true, domainVerifiedAt: '2026-08-19T00:00' },
    });
  };
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(makeReq({ event: validEvent() }), res);
  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/event');
  assert.equal(written.sender.domainVerified, true, 'concurrent verification must survive the save');
  assert.equal(written.sender.domainVerifiedAt, '2026-08-19T00:00');
  assert.equal(written.sender.email, 'summit@example.org', 'the admin\'s editable sender fields still land');
});

// ------------------------------------- event merge semantics (finding 7/8)

const STORED_EXTRAS = {
  tagline: 'Collaborate!',
  venue: {
    name: 'Alexander Library', addressLine1: '169 College Ave', addressLine2: null,
    city: 'New Brunswick', region: 'NJ', postalCode: '08901', country: 'US', mapUrl: null,
  },
  legal: {
    operatorName: 'Center for Cooperative Media',
    postalAddressHtml: '<p>1 Normal Ave</p>',
    supportEmail: 'support@example.org',
    conductEmail: 'conduct@example.org',
    reviewRequired: true,
  },
};

test('a partial event save deep-merges over the stored doc — venue/legal/sender survive', async () => {
  const deps = makeDeps({
    'config/event': {
      ...validEvent(),
      ...STORED_EXTRAS,
      sender: { email: 'summit@example.org', name: 'Example Summit', replyTo: null, domainVerified: true, domainVerifiedAt: '2026-02-02T00:00' },
      updatedAt: 'old-stamp', updatedBy: 'old@x.org',
    },
  });
  const res = makeRes();
  // The payload touches ONLY the name: everything else must survive.
  await createUpdateEventConfigHandler(deps)(makeReq({ event: { name: 'Renamed Summit' } }), res);
  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/event');
  assert.equal(written.name, 'Renamed Summit');
  assert.equal(written.shortName, 'EX2027');
  assert.deepEqual(written.venue, STORED_EXTRAS.venue);
  assert.deepEqual(written.legal, STORED_EXTRAS.legal);
  assert.equal(written.sender.email, 'summit@example.org');
  assert.equal(written.sender.domainVerified, true, 'verification pair still carried');
  assert.equal(written.tagline, 'Collaborate!');
  assert.equal(written.updatedBy, ADMIN_EMAIL, 'stamps are fresh, not merged-in stale ones');
  assert.deepEqual(written.updatedAt, new Date(NOW));
});

test('a nested partial merges within the section instead of replacing it', async () => {
  const deps = makeDeps({ 'config/event': { ...validEvent(), ...STORED_EXTRAS } });
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(
    makeReq({ event: { legal: { reviewRequired: false } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const written = deps.db.docs.get('config/event');
  assert.equal(written.legal.reviewRequired, false);
  assert.equal(written.legal.operatorName, 'Center for Cooperative Media', 'sibling legal fields survive');
});

test('the shared validator runs on the MERGED result, not the partial payload', async () => {
  // A partial payload that would corrupt the doc must be rejected even
  // though it is "valid as far as it goes" — validation sees the result.
  const deps = makeDeps({ 'config/event': validEvent() });
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(makeReq({ event: { timezone: 'Not/AZone' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /timezone: must be a valid IANA timezone/);
  assert.equal(deps.db.docs.get('config/event').timezone, 'America/New_York', 'stored doc untouched');
});

test('a partial payload onto an empty store is rejected — the merged doc must be complete', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(makeReq({ event: { name: 'Only a name' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /shortName: must be a nonempty string/);
  assert.equal(deps.db.docs.get('config/event'), undefined);
});

test('unknown top-level config/event keys are rejected by name', async () => {
  const deps = makeDeps({ 'config/event': validEvent() });
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(makeReq({ event: { name: 'Ok', bogusKey: 1 } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /bogusKey: unknown config\/event field/);
  assert.equal(deps.db.writes.length, 0);
});

// The event's concurrent tracks (design brief §4.6) are an operator's to
// set, and the shared validator is what judges them.
test('tracks are editable on config/event, and a bad letter is rejected by name', async () => {
  const deps = makeDeps({ 'config/event': validEvent() });
  const ok = makeRes();
  await createUpdateEventConfigHandler(deps)(
    makeReq({ event: { tracks: [{ letter: 'A', name: 'Practice' }] } }),
    ok,
  );
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(deps.db.docs.get('config/event').tracks, [{ letter: 'A', name: 'Practice' }]);

  const bad = makeRes();
  await createUpdateEventConfigHandler(deps)(
    makeReq({ event: { tracks: [{ letter: 'AA', name: 'Two letters' }] } }),
    bad,
  );
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /tracks\[0\]\.letter: must be a single capital letter/);
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

test('removing a referenced venue place is rejected across live and draft sessions', async () => {
  const event = validEvent({
    venue: {
      places: [
        { id: 'main-hall', name: 'Main hall' },
        { id: 'studio', name: 'Studio' },
      ],
      movements: [],
    },
  });
  const deps = makeDeps({
    'config/event': event,
    'cmsSchedule/keynote': { title: 'Opening keynote', placeId: 'main-hall' },
    'cmsSchedule_drafts/workshop': { title: 'Draft workshop', placeId: 'main-hall' },
  });
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(
    makeReq({ event: { venue: { places: [{ id: 'studio', name: 'Studio' }], movements: [] } } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /venue\.places: cannot remove "main-hall"/);
  assert.match(res.body.error.message, /Opening keynote/);
  assert.match(res.body.error.message, /Draft workshop/);
  assert.equal(deps.db.docs.get('config/event').venue.places.length, 2);
});

test('an unused venue place can be removed', async () => {
  const event = validEvent({
    venue: {
      places: [
        { id: 'main-hall', name: 'Main hall' },
        { id: 'studio', name: 'Studio' },
      ],
      movements: [],
    },
  });
  const deps = makeDeps({ 'config/event': event });
  const res = makeRes();
  await createUpdateEventConfigHandler(deps)(
    makeReq({ event: { venue: { places: [{ id: 'studio', name: 'Studio' }], movements: [] } } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(deps.db.docs.get('config/event').venue.places, [
    { id: 'studio', name: 'Studio' },
  ]);
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
