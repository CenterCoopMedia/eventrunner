'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createScanMediaUsageHandler,
  scanUsage,
  internals: { stringLeaves, referencesPath, resolveScanPaths, MAX_PATHS_PER_SCAN },
} = require('./usage.cjs');

const ADMIN_EMAIL = 'admin@example.org';
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const HERO = 'cms-images/asset-1/hero.png';
const LOGO = 'branding/asset-2/logo.png';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const adminDeps = (db) => ({
  db,
  auth: { verifyIdToken: async () => ({ uid: 'admin-1', email: ADMIN_EMAIL, email_verified: true }) },
  getConfig: async () => ({ bootstrap: { adminEmails: [ADMIN_EMAIL] } }),
  now: () => NOW,
  log: { warn() {}, error() {} },
});

const post = (body) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body });

// ---------------------------------------------------------------- pure bits

test('stringLeaves names arrays by index so a warning can point at a slot', () => {
  const leaves = stringLeaves({
    title: 'Home',
    sections: [{ image: HERO }, { image: null }],
  });
  assert.deepEqual(
    leaves.map((leaf) => leaf.field),
    ['title', 'sections.0.image'],
  );
});

test('referencesPath matches raw paths and percent-encoded download URLs', () => {
  assert.equal(referencesPath(HERO, HERO), true);
  assert.equal(referencesPath(`/${HERO}`, HERO), true);
  assert.equal(
    referencesPath(
      `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(HERO)}?alt=media`,
      HERO,
    ),
    true,
  );
  assert.equal(referencesPath('cms-images/asset-9/other.png', HERO), false);
  assert.equal(referencesPath(null, HERO), false);
});

// ---------------------------------------------------------------- the scan

test('scanUsage finds references in live docs, drafts, and config', async () => {
  const db = makeFakeDb({
    'cmsContent/home-hero': { image: HERO, visible: true },
    'cmsPages_drafts/travel': { sections: [{ blocks: [{ src: `/${HERO}` }] }] },
    'config/theme': { logos: { primary: LOGO } },
    'config/event': { name: 'Example' },
    'cmsSchedule/session-1': { title: 'Opening' },
  });

  const usage = await scanUsage({ db, paths: [HERO, LOGO] });

  assert.deepEqual(usage[HERO], [
    { docPath: 'cmsContent/home-hero', field: 'image' },
    { docPath: 'cmsPages_drafts/travel', field: 'sections.0.blocks.0.src' },
  ]);
  assert.deepEqual(usage[LOGO], [{ docPath: 'config/theme', field: 'logos.primary' }]);
});

test('scanUsage reports an unused asset as an empty list, not a missing key', async () => {
  const db = makeFakeDb({ 'cmsContent/home': { body: 'no images here' } });
  const usage = await scanUsage({ db, paths: [HERO] });
  assert.deepEqual(usage, { [HERO]: [] });
});

test('scanUsage does not scan cmsVersionHistory — old revisions are not live uses', async () => {
  const db = makeFakeDb({ 'cmsVersionHistory/v1': { fields: { image: HERO } } });
  const usage = await scanUsage({ db, paths: [HERO] });
  assert.deepEqual(usage[HERO], []);
});

test('scanUsage propagates a read failure rather than reporting "unused"', async () => {
  const db = makeFakeDb({});
  const broken = {
    collection(name) {
      if (name === 'cmsContent') {
        return { async get() { throw new Error('transport failed'); } };
      }
      return db.collection(name);
    },
  };
  await assert.rejects(
    () => scanUsage({ db: broken, paths: [HERO] }),
    /media usage scan failed reading cmsContent/,
  );
});

// ------------------------------------------------------------ path resolve

test('resolveScanPaths defaults to every indexed asset path, deduplicated', async () => {
  const db = makeFakeDb({
    'media_assets/a1': { path: HERO },
    'media_assets/a2': { path: LOGO },
    'media_assets/a3': { path: HERO },
    'media_assets/a4': { size: 10 },
  });
  const resolved = await resolveScanPaths({ db, requested: undefined });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.paths.sort(), [LOGO, HERO].sort());
});

test('resolveScanPaths rejects a non-array and an oversize list', async () => {
  const db = makeFakeDb({});
  assert.equal((await resolveScanPaths({ db, requested: 'x' })).ok, false);
  const many = Array.from({ length: MAX_PATHS_PER_SCAN + 1 }, (_, i) => `cms-images/a/${i}.png`);
  const verdict = await resolveScanPaths({ db, requested: many });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /at most/);
});

// ------------------------------------------------------------- the handler

test('scanMediaUsage requires admin', async () => {
  const db = makeFakeDb({});
  const res = fakeRes();
  const handler = createScanMediaUsageHandler({
    ...adminDeps(db),
    getConfig: async () => ({ bootstrap: { adminEmails: ['someone-else@example.org'] } }),
  });
  await handler(post({ paths: [HERO] }), res);
  assert.equal(res.statusCode, 403);
});

test('scanMediaUsage answers the reference list for the requested paths', async () => {
  const db = makeFakeDb({ 'cmsContent/home': { image: HERO } });
  const res = fakeRes();
  await createScanMediaUsageHandler(adminDeps(db))(post({ paths: [HERO] }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.usage[HERO], [{ docPath: 'cmsContent/home', field: 'image' }]);
  assert.equal(res.body.scannedAt, new Date(NOW).toISOString());
});

test('scanMediaUsage rejects a malformed paths argument', async () => {
  const res = fakeRes();
  await createScanMediaUsageHandler(adminDeps(makeFakeDb({})))(post({ paths: [''] }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /paths/);
});

test('scanMediaUsage refuses non-POST', async () => {
  const res = fakeRes();
  await createScanMediaUsageHandler(adminDeps(makeFakeDb({})))({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});
