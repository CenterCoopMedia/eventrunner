'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createClientHostWorker } = require('../client-host-worker.mjs');

const host = 'client.example.test';
const origin = `https://${host}`;
const bucket = 'client-routes-fixture';
const conference = {
  mount: '/conference', publicTitle: 'Conference <2026> & friends', hostingOrigin: 'https://conference-fixture.web.app',
};
const archive = {
  mount: '/events/workshops', publicTitle: 'Workshops archive', hostingOrigin: 'https://workshops-fixture.web.app',
};

function fixture() {
  let map = { host, version: 3, exportedAt: '2026-11-18T18:15:00.000Z', routes: [conference, archive] };
  const upstreams = [];
  const route = createClientHostWorker({
    bucket,
    fetchMap: (url, options) => {
      assert.equal(options.cache, 'no-store');
      return url === `https://storage.googleapis.com/${bucket}/${host}.json`
        ? Response.json(map) : new Response(null, { status: 404 });
    },
    fetchUpstream: (url) => {
      upstreams.push(url);
      return new Response('event origin');
    },
    hostFallback: { fetch: () => new Response('host-owned file') },
    log: { warn: () => {} },
  });
  return {
    request: (path, init) => {
      const url = path.startsWith('https:') ? path : `${origin}${path}`;
      return route(new Request(url, init), url);
    },
    replaceMap: (routes) => { map = { ...map, routes, version: map.version + 1 }; },
    upstreams,
  };
}

test('the public host root links only approved titles and serves an empty state when no event is published', async () => {
  const { request, replaceMap, upstreams } = fixture();
  const result = await request('/?project=unrelated', { headers: { 'x-forwarded-host': 'wrong.example.test' } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.match(result.headers.get('content-type'), /^text\/html/);
  const html = await result.text();
  assert.match(html, /href="\/conference\/">Conference &lt;2026&gt; &amp; friends<\/a>/);
  assert.match(html, /href="\/events\/workshops\/">Workshops archive<\/a>/);
  assert.doesNotMatch(html, /\.web\.app|<form|registration|signin/);
  assert.equal((await request('/', { method: 'HEAD' })).body, null);
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  assert.equal(upstreams.length, 0);

  replaceMap([archive]);
  assert.equal((await request('/conference/updates/retired')).status, 404);
  assert.equal(await (await request('/events/workshops/')).text(), 'event origin');
  assert.equal(upstreams[0], `${archive.hostingOrigin}/`);
  replaceMap([]);
  assert.match(await (await request('/')).text(), /No public events are listed/);
  assert.equal((await request('https://unregistered.example.test/')).status, 404);
  assert.equal(await (await request('/__/')).text(), 'host-owned file');
  assert.equal((await request('/unrelated/')).status, 404);
});

test('the route map status reports the version and export time of the map currently read by the Worker', async () => {
  const { request, replaceMap } = fixture();
  const path = '/.well-known/eventrunner-route-map';
  assert.deepEqual(await (await request(path)).json(), { version: 3, exportedAt: '2026-11-18T18:15:00.000Z' });
  replaceMap([archive]);
  assert.equal((await (await request(path)).json()).version, 4);
});

test('missing or invalid route-map input fails closed before an event request', async () => {
  const { request, replaceMap, upstreams } = fixture();
  for (const entry of [
    { ...archive, mount: '/conference/workshops' },
    { ...archive, hostingOrigin: 'https://arbitrary.example.test' },
    { ...archive, mount: '/api/workshops' },
  ]) {
    replaceMap([conference, entry]);
    assert.equal((await request('/conference/')).status, 503);
  }
  assert.equal(upstreams.length, 0);
  let reads = 0;
  const unconfigured = createClientHostWorker({
    fetchMap: () => { reads += 1; }, log: { warn: () => {} },
  });
  const home = new Request(origin);
  assert.equal((await unconfigured(home, home.url)).status, 503);
  assert.equal(reads, 0);
});
