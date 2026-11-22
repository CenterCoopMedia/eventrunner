'use strict';

const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { MAX_BYTES } = require('./offline-public.cjs');

const runtime = readFileSync(path.join(__dirname, 'offline-worker.js'), 'utf8');
const base = 'https://agenda.example.test/summit/';
const shell = '<html><head></head><body>Public program</body></html>';
const prefix = 'eventrunner-public:test-project:/summit/:';

function cacheStorage() {
  const entries = new Map();
  const key = (value) => value.url || String(value);
  return {
    keys: async () => [...entries.keys()],
    delete: async (name) => entries.delete(name),
    async open(name) {
      if (!entries.has(name)) entries.set(name, new Map());
      const files = entries.get(name);
      return { put: async (url, response) => files.set(key(url), response.clone()) };
    },
    async match(url, { cacheName }) {
      return entries.get(cacheName)?.get(key(url))?.clone();
    },
  };
}

function worker({ id, caches, failFile, enabled = () => true, open = [], savedAt = '2026-11-22T15:00:00Z' }) {
  const handlers = new Map();
  const chunk = `assets/route-${id[0]}.js`;
  const files = { 'app-shell.html': shell, [chunk]: `export default '${id[0]}';` };
  const assets = Object.entries(files).map(([file, data]) => ({
    file, size: Buffer.byteLength(data), hash: createHash('sha256').update(data).digest('hex'),
  }));
  const build = { project: 'test-project', base: '/summit/', id, routes: ['/', '/schedule'],
    generatedAt: '2026-11-22T14:00:00.000Z', assets,
    bytes: assets.reduce((bytes, asset) => bytes + asset.size, 0), maxBytes: MAX_BYTES };
  const calls = [];
  let skipped = false;
  let unregistered = false;
  vm.runInNewContext(runtime, {
    BUILD: build, caches, URL, Headers, Response, AbortSignal, crypto: webcrypto, TextDecoder,
    Date: class extends Date { constructor() { super(savedAt); } },
    clients: { matchAll: async () => open },
    self: {
      registration: { scope: base, update: async () => {}, unregister: async () => { unregistered = true; } },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { skipped = true; },
    },
    fetch: async (request, options) => {
      const url = new URL(request.url || request);
      const file = url.pathname.slice('/summit/'.length);
      calls.push({ file, options });
      if (file === 'offline-policy.json') return Response.json({ enabled: enabled() });
      return file === failFile || !Object.hasOwn(files, file)
        ? new Response('Unavailable', { status: 503 })
        : new Response(files[file], { headers: { 'X-Frame-Options': 'DENY' } });
    },
  });
  function event(type, fields = {}) {
    let response;
    const pending = [];
    handlers.get(type)({
      ...fields, waitUntil: (promise) => pending.push(promise), respondWith: (promise) => { response = promise; },
    });
    return { response, done: Promise.all(pending) };
  }
  return {
    calls, chunk, event, skipped: () => skipped, unregistered: () => unregistered,
    request(file, mode = 'navigate', extra = {}) {
      return event('fetch', { request: { url: new URL(file, base).href, method: 'GET', mode,
        headers: new Headers(), ...extra } });
    },
  };
}

test('an interrupted update leaves the active shell and its chunks, and activation is explicit', async () => {
  const caches = cacheStorage();
  const oldId = 'a'.repeat(64);
  const nextId = 'b'.repeat(64);
  const old = worker({ caches, id: oldId });
  await old.event('install').done;
  const next = worker({ caches, id: nextId, failFile: 'assets/route-b.js' });
  await assert.rejects(next.event('install').done, /Offline asset unavailable/);
  assert.deepEqual(await caches.keys(), [prefix + oldId]);
  const navigation = old.request('schedule?lang=es');
  const response = await navigation.response;
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.match(await response.text(), new RegExp(`eventrunner-saved-build.*${oldId}`));
  await navigation.done;
  assert.match(await (await old.request(old.chunk, 'cors').response).text(), /'a'/);

  const originalTab = { id: 'original-tab', url: `${base}schedule` };
  const open = [originalTab];
  const complete = worker({ caches, id: nextId, open, savedAt: '2026-11-22T15:01:00Z' });
  await complete.event('install').done;
  assert.equal(complete.skipped(), false);
  const beforeUpdate = old.request('schedule');
  assert.match(await (await beforeUpdate.response).text(), new RegExp(oldId));
  await beforeUpdate.done;
  await complete.event('message', { source: originalTab, data: { type: 'public-offline-use-update' } }).done;
  assert.equal(complete.skipped(), true);
  const afterUpdate = complete.request('schedule');
  assert.match(await (await afterUpdate.response).text(), new RegExp(nextId));
  await afterUpdate.done;
  await complete.event('message', {
    source: originalTab, data: { type: 'public-offline-document', id: oldId },
  }).done;
  assert.match(await (await complete.request(old.chunk, 'cors').response).text(), /'a'/);
  open.splice(0, 1, { id: 'reloaded-tab', url: `${base}schedule` });
  await complete.event('message', {
    source: open[0], data: { type: 'public-offline-document', id: nextId },
  }).done;
  assert.deepEqual(await caches.keys(), [prefix + nextId]);
});

test('network-only traffic bypasses the worker and a confirmed disable removes just the event cache', async () => {
  let enabled = true;
  const caches = cacheStorage();
  const unrelated = await caches.open('unrelated');
  await unrelated.put(base, new Response('keep'));
  const active = worker({ caches, id: 'c'.repeat(64), enabled: () => enabled });
  await active.event('install').done;
  for (const route of [
    'admin', 'tickets/mine', 'ticket/claim', 'profile', 'speaker/accept', 'attendees/user',
    'schedule/mine', 'schedule/user/user', 'pitch', 'registration', 'signin', 'unsubscribe',
    'dashboard', 'low-bandwidth', 'specimen', 'unknown', 'schedule?preview=1', 'schedule?eventrunner-live=1',
    '/outside/schedule',
  ]) {
    const navigation = active.request(route);
    assert.equal(navigation.response, undefined, route);
    await navigation.done;
  }
  assert.equal(active.request('schedule', 'navigate', { method: 'POST' }).response, undefined);
  assert.equal(active.request('materials/a.pdf?signature=fixture', 'cors').response, undefined);
  assert.ok(active.calls.every(({ options }) => options.credentials === 'omit'));
  enabled = false;
  await active.event('message', {
    source: { id: 'tab', url: base }, data: { type: 'public-offline-check' },
  }).done;
  assert.equal(active.unregistered(), true);
  assert.deepEqual(await caches.keys(), ['unrelated']);
  assert.equal(active.request('schedule').response, undefined);
});
