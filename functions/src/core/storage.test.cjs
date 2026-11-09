'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const APP = require.resolve('firebase-admin/app');
const STORAGE = require.resolve('firebase-admin/storage');
const SELF = require.resolve('./storage.cjs');

// A fresh copy of core/storage.cjs over fake firebase-admin modules, so a
// test can say which apps are registered before getBucket runs.
function loadWith(t, apps) {
  const calls = { initializeApp: 0, bucket: [] };
  const saved = [APP, STORAGE, SELF].map((path) => [path, require.cache[path]]);
  t.after(() => {
    for (const [path, entry] of saved) {
      if (entry) require.cache[path] = entry;
      else delete require.cache[path];
    }
  });
  const fake = (path, exports) => {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  };
  fake(APP, {
    getApps: () => apps,
    initializeApp: () => {
      calls.initializeApp += 1;
      apps.push({ name: '[DEFAULT]' });
    },
  });
  fake(STORAGE, {
    getStorage: () => {
      // The real getStorage() with no argument throws without the default app.
      if (!apps.some((app) => app.name === '[DEFAULT]')) {
        throw new Error('The default Firebase app does not exist.');
      }
      return { bucket: (name) => { calls.bucket.push(name); return { name }; } };
    },
  });
  delete require.cache[SELF];
  return { getBucket: require('./storage.cjs').getBucket, calls };
}

const ENV = { EVENT_STORAGE_BUCKET: ' event-bucket ' };

test('getBucket starts the default app when only a named app is registered', (t) => {
  // The Functions emulator registers its own named app before a background
  // trigger runs (see core/firestore.cjs).
  const { getBucket, calls } = loadWith(t, [{ name: 'emulator-app' }]);
  assert.deepEqual(getBucket(ENV), { name: 'event-bucket' });
  assert.equal(calls.initializeApp, 1);
});

test('getBucket reuses a default app that is already running', (t) => {
  const { getBucket, calls } = loadWith(t, [{ name: '[DEFAULT]' }]);
  getBucket(ENV);
  assert.equal(calls.initializeApp, 0);
  assert.deepEqual(calls.bucket, ['event-bucket']);
});

test('getBucket refuses to guess a bucket when EVENT_STORAGE_BUCKET is unset', (t) => {
  const { getBucket, calls } = loadWith(t, []);
  assert.throws(() => getBucket({}), /EVENT_STORAGE_BUCKET is not set/);
  assert.equal(calls.initializeApp, 0);
});

test('getBucket answers the same handle on a second call', (t) => {
  const { getBucket, calls } = loadWith(t, []);
  assert.equal(getBucket(ENV), getBucket(ENV));
  assert.equal(calls.initializeApp, 1);
  assert.deepEqual(calls.bucket, ['event-bucket']);
});
