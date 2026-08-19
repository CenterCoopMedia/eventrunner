'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEventConfig, getTierA, internals } = require('./config.cjs');

function fakeDb(docs) {
  let reads = 0;
  return {
    get reads() { return reads; },
    collection: (name) => ({
      doc: (id) => ({ __id: id, __collection: name }),
    }),
    async getAll(...refs) {
      reads += 1;
      return refs.map((ref) => ({
        exists: ref.__id in docs,
        data: () => docs[ref.__id],
      }));
    },
  };
}

const ENV = {
  EVENT_SLUG: 'demo',
  EVENT_FIREBASE_PROJECT_ID: 'demo-project',
  EVENT_PUBLIC_URL: 'https://demo.example.org',
  EVENT_STORAGE_BUCKET: 'demo.appspot.com',
  EVENT_ALLOWED_ORIGINS: 'https://demo.example.org, https://admin.example.org',
  EVENT_EMAIL_PROVIDER: 'console',
  EVENT_TICKETING_PROVIDER: 'none',
  EVENT_OPERATOR_NOTIFIER: 'none',
};

test.beforeEach(() => internals.resetConfigCacheForTest());

test('getTierA parses and defaults', () => {
  const tierA = getTierA(ENV);
  assert.equal(tierA.slug, 'demo');
  assert.equal(tierA.region, 'us-central1');
  assert.deepEqual(tierA.allowedOrigins, ['https://demo.example.org', 'https://admin.example.org']);
  assert.equal(tierA.ticketingEventId, null);
});

test('loads all six config docs, missing docs become null (features {})', async () => {
  const db = fakeDb({ event: { name: 'E' }, providers: { email: { provider: 'console' } } });
  const config = await getEventConfig({ db, env: ENV });
  assert.equal(config.event.name, 'E');
  assert.deepEqual(config.features, {});
  assert.equal(config.theme, null);
  assert.equal(config.bootstrap, null);
  assert.equal(config.tierA.slug, 'demo');
});

test('caches per container with a 5-minute TTL', async () => {
  const db = fakeDb({ event: { name: 'E' } });
  let clock = 0;
  const now = () => clock;
  await getEventConfig({ db, env: ENV, now });
  await getEventConfig({ db, env: ENV, now });
  assert.equal(db.reads, 1);
  clock = internals.CACHE_TTL_MS + 1;
  await getEventConfig({ db, env: ENV, now });
  assert.equal(db.reads, 2);
});

test('forceRefresh bypasses the cache', async () => {
  const db = fakeDb({});
  const now = () => 0;
  await getEventConfig({ db, env: ENV, now });
  await getEventConfig({ db, env: ENV, now, forceRefresh: true });
  assert.equal(db.reads, 2);
});
