'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createClientHostWorker } = require('../client-host-worker.mjs');

const host = 'client.example.test';
const origin = `https://${host}`;
const conference = { mount: '/conference', publicTitle: 'Conference', hostingOrigin: 'https://conference-fixture.web.app' };
const archive = { mount: '/events/workshops', publicTitle: 'Workshops archive', hostingOrigin: 'https://workshops-fixture.web.app' };

function healthyFile(url, event) {
  if (new URL(url).pathname === '/sitemap.xml') return new Response(null, { headers: { 'content-type': 'text/xml' } });
  return new Response(['User-agent: *', `Disallow: ${event.mount}/admin$`, '',
    `Sitemap: ${origin}${event.mount}/sitemap.xml`, ''].join(event === conference ? '\r' : '\n'));
}

function fixture({ routes = [conference, archive], readLegacy = () => new Response(null, { status: 404 }),
  readEvent = healthyFile, mapUnavailable = false } = {}) {
  const upstreams = [];
  const warnings = [];
  const route = createClientHostWorker({
    bucket: 'client-routes-fixture',
    fetchMap: (url) => {
      assert.equal(url, `https://storage.googleapis.com/client-routes-fixture/${host}.json`);
      return mapUnavailable ? new Response(null, { status: 503 })
        : Response.json({ host, version: 3, exportedAt: '2026-11-18T18:15:00.000Z', routes });
    },
    hostFallback: { fetch: readLegacy },
    fetchUpstream: (url, options) => {
      upstreams.push({ url, options });
      const event = routes.find(({ hostingOrigin }) => hostingOrigin === new URL(url).origin);
      assert.ok(event);
      return readEvent(url, event);
    },
    log: { warn: (_message, fields) => warnings.push(fields) },
  });
  return {
    request: (method = 'GET') => {
      const req = new Request(`${origin}/robots.txt`, { method });
      return route(req, req.url);
    },
    upstreams,
    warnings,
  };
}

test('an unreadable route map returns 503 before contacting any event', async () => {
  const { request, upstreams } = fixture({ mapUnavailable: true });
  const result = await request();
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(upstreams, []);
});

test('an unreadable legacy crawler policy returns 503 instead of omitting its exclusions', async () => {
  for (const readLegacy of [() => new Response(null, { status: 503 }), () => { throw new Error('fixture network'); }]) {
    const { request, upstreams } = fixture({ readLegacy });
    const get = await request();
    const head = await request('HEAD');
    assert.equal(get.status, 503);
    assert.equal(head.status, 503);
    assert.equal(head.body, null);
    assert.deepEqual(upstreams, []);
  }
});

test('a missing legacy policy leaves both events’ valid rules in the composed file', async () => {
  const { request } = fixture();
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(await result.text(), ['User-agent: *', 'Disallow: /conference/admin$',
    'Disallow: /events/workshops/admin$', '', `Sitemap: ${origin}/conference/sitemap.xml`,
    `Sitemap: ${origin}/events/workshops/sitemap.xml`, ''].join('\n'));
});

test('an unreadable event policy returns 503 instead of omitting its exclusions', async () => {
  for (const missing of [() => new Response(null, { status: 503 }),
    () => new Response('<html>fixture shell</html>', { headers: { 'content-type': 'text/html' } })]) {
    const { request, warnings } = fixture({ readEvent: (url, event) =>
      event === archive ? missing() : healthyFile(url, event) });
    const result = await request();
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.ok(warnings.some(({ mount }) => mount === archive.mount));
  }
});

test('a missing event robots file contributes no exclusions or sitemap and leaves its sibling listed', async () => {
  const { request, upstreams } = fixture({ readEvent: (url, event) =>
    event === archive ? new Response(null, { status: 404 }) : healthyFile(url, event) });
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(await result.text(), ['User-agent: *', 'Disallow: /conference/admin$', '',
    `Sitemap: ${origin}/conference/sitemap.xml`, ''].join('\n'));
  assert.ok(upstreams.every(({ url }) => url !== `${archive.hostingOrigin}/sitemap.xml`));
});

test('a sitemap 4xx or 5xx omits only its URL and keeps the event’s verified exclusions', async () => {
  for (const status of [404, 503]) {
    const { request } = fixture({ readEvent: (url, event) => {
      if (event === archive && new URL(url).pathname === '/sitemap.xml') return new Response(null, { status });
      return healthyFile(url, event);
    } });
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(await result.text(), ['User-agent: *', 'Disallow: /conference/admin$',
      'Disallow: /events/workshops/admin$', '', `Sitemap: ${origin}/conference/sitemap.xml`, ''].join('\n'));
  }
});

test('a staged mount is excluded from crawling without publishing a sitemap', async () => {
  const { request, upstreams } = fixture({ routes: [conference, { ...archive, publicTitle: null }] });
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(await result.text(), ['User-agent: *', 'Disallow: /conference/admin$',
    'Disallow: /events/workshops$', 'Disallow: /events/workshops/', '',
    `Sitemap: ${origin}/conference/sitemap.xml`, ''].join('\n'));
  assert.equal(upstreams.length, 2);
  assert.ok(upstreams.every(({ url }) => new URL(url).origin === conference.hostingOrigin));
});

test('healthy composition keeps the host’s agent groups and every verified mount rule and sitemap', async () => {
  const legacy = ['User-agent: Archive.Bot2', 'User-agent: Googlebot/2.1', 'Disallow: /legacy',
    `Sitemap: ${origin}/legacy.xml`].join('\n');
  const { request, upstreams } = fixture({ readLegacy: () => new Response(legacy) });
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(await result.text(), [legacy, '', 'User-agent: *', 'User-agent: archive.bot2',
    'User-agent: googlebot/2.1', 'Disallow: /conference/admin$', 'Disallow: /events/workshops/admin$',
    '', `Sitemap: ${origin}/conference/sitemap.xml`, `Sitemap: ${origin}/events/workshops/sitemap.xml`, ''].join('\n'));
  assert.deepEqual(upstreams.map(({ url, options }) => `${options.method} ${url}`).sort(), [
    `GET ${conference.hostingOrigin}/robots.txt`, `GET ${archive.hostingOrigin}/robots.txt`,
    `HEAD ${conference.hostingOrigin}/sitemap.xml`, `HEAD ${archive.hostingOrigin}/sitemap.xml`,
  ]);
  assert.ok(upstreams.every(({ options }) => options.redirect === 'manual' && options.cache === 'no-store'));
});
