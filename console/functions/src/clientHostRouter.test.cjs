'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const test = require('node:test');
const { gzipSync } = require('node:zlib');
const { resolveEventPublicBase } = require('./clientHostRecords.cjs');
const { createClientHostRouter } = require('./clientHostRouter.cjs');

const origin = 'https://client.example.test';
const conference = 'https://conference-fixture.web.app';
const workshops = 'https://workshops-fixture.web.app';

function route(mount, hostingOrigin, state = 'published') {
  const host = new URL(origin).hostname;
  const site = new URL(hostingOrigin).hostname.split('.')[0];
  const identity = { appId: site, projectId: site, site, domain: host };
  const record = { ...identity, host, mount, publicBase: `${origin}${mount}/`, hostingOrigin, state };
  return state === 'published' ? { ...resolveEventPublicBase(record, identity), hostingOrigin, state } : record;
}

function setup(upstream = () => new Response('Hosting response'), handleHostRequest) {
  const routes = [
    route('/conference', conference),
    route('/events/workshops', workshops),
    route('/old-event', 'https://retired-fixture.web.app', 'retired'),
  ];
  const calls = [];
  const warnings = [];
  const router = createClientHostRouter({
    loadHost: (hostname) => hostname === new URL(origin).hostname ? { routes } : null,
    handleHostRequest,
    fetchUpstream: (url, options) => {
      calls.push({ url, ...options });
      return upstream(url, options);
    },
    log: { warn: (_message, fields) => warnings.push(fields) },
  });
  const request = (path, init) => {
    const rawUrl = path.startsWith('https:') ? path : `${origin}${path}`;
    return router(new Request(origin, init), rawUrl);
  };
  return { request, routes, calls, warnings };
}

test('canonicalizes a bare mount and leaves each stripped path to its own Hosting rules', async () => {
  const { request, calls } = setup();
  const bare = await request('/conference?lang=es&view=grid');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get('location'), '/conference/?lang=es&view=grid');
  assert.equal(bare.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);

  for (const [path, expected] of [
    ['/conference/', `${conference}/`],
    ['/conference/conference/schedule/a', `${conference}/conference/schedule/a`],
    ['/conference/admin/updates', `${conference}/admin/updates`],
    ['/conference/updates/one?lang=es', `${conference}/updates/one?lang=es`],
    ['/conference/assets/lazy.js', `${conference}/assets/lazy.js`],
    ['/conference/manifest.webmanifest', `${conference}/manifest.webmanifest`],
    ['/events/workshops/travel/map', `${workshops}/travel/map`],
  ]) {
    const result = await request(path);
    assert.equal(await result.text(), 'Hosting response');
    assert.equal(calls.at(-1).url, expected);
    assert.equal(calls.at(-1).redirect, 'manual');
    assert.equal(calls.at(-1).cache, 'no-store');
  }
});

test('a host fallback can keep its own paths and never receives a retired mount', async () => {
  const { request, calls } = setup(undefined, (_request, url) =>
    ['/__/', '/status'].includes(url.pathname) ? new Response('Host response') : null);
  for (const path of ['/__/', '/status']) assert.equal(await (await request(path)).text(), 'Host response');
  for (const path of ['/conference-old/', '/Conference/', '/events/workshops-old/', '/old-event/',
    '/conference/__/auth/handler', 'https://unregistered.example.test/conference/']) {
    assert.equal((await request(path, { headers: { host: 'client.example.test' } })).status, 404, path);
  }
  assert.equal(calls.length, 0);
});

test('ambiguous input is refused before parsing or any upstream fetch', async () => {
  const { request, calls } = setup();
  for (const path of ['//conference/', '/other/../conference/', '/conference/./admin',
    '/conference/%2e%2e/other', '/conference/%2fadmin', '/conference/%5Cadmin', '/conference//admin',
    '/conference\\admin', '/conference/%', '/conference/%00', '/conference/%252fadmin', '/%63onference/']) {
    assert.equal((await request(path)).status, 400, path);
  }
  assert.equal(calls.length, 0);
});

test('unsubscribe preserves opaque query, body and content type, with POST allowed at the exact path', async () => {
  const { request, calls } = setup(async (_url, options) => {
    if (options.method === 'POST') assert.equal(await new Response(options.body).text(), 'List-Unsubscribe=One-Click');
    return new Response('confirmation', { headers: { 'cache-control': 'no-store' } });
  });
  const query = '?rid=fixture%2Btest&sig=fixture%26value&sig=duplicate';
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    cookie: 'sibling=fixture',
    'x-forwarded-host': 'wrong.example.test',
  };
  for (const [path, upstream] of [['/conference', conference], ['/events/workshops', workshops]]) {
    assert.equal((await request(`${path}/unsubscribe${query}`, { headers })).headers.get('cache-control'), 'no-store');
    assert.equal(calls.at(-1).url, `${upstream}/unsubscribe${query}`);
    const result = await request(`${path}/unsubscribe${query}`, {
      method: 'POST', headers, body: 'List-Unsubscribe=One-Click',
    });
    assert.equal(result.status, 200);
    assert.equal(calls.at(-1).url, `${upstream}/unsubscribe${query}`);
    assert.equal(calls.at(-1).headers.get('content-type'), headers['content-type']);
    assert.equal(calls.at(-1).headers.has('cookie'), false);
    assert.equal(calls.at(-1).headers.has('x-forwarded-host'), false);
  }
  for (const [method, path] of [['PUT', '/unsubscribe'], ['OPTIONS', '/'], ['POST', '/unsubscribe/'],
    ['POST', '/nested/unsubscribe'], ['POST', '/admin'], ['POST', '/webhook']]) {
    const result = await request(`/conference${path}`, { method });
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), path === '/unsubscribe' ? 'GET, HEAD, POST' : 'GET, HEAD');
  }
  assert.equal(calls.length, 4);
});

test('HEAD and conditional asset reads preserve upstream security and cache headers', async () => {
  const headerEntries = {
    'cache-control': 'private, no-store',
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-robots-tag': 'noindex',
    'service-worker-allowed': '/',
    'set-cookie': 'foreign=fixture; Path=/',
    'clear-site-data': '"storage"',
    'strict-transport-security': 'max-age=31556926; includeSubDomains; preload',
  };
  const { request, calls } = setup((_url, options) => new Response(null, {
    status: options.headers.has('if-none-match') ? 304 : 200, headers: headerEntries,
  }));
  const result = await request('/conference/admin', { method: 'HEAD' });
  assert.equal(result.status, 200);
  assert.equal(result.body, null);
  assert.equal(calls[0].method, 'HEAD');
  for (const name of ['cache-control', 'content-security-policy', 'x-frame-options', 'x-robots-tag']) {
    assert.equal(result.headers.get(name), headerEntries[name]);
  }
  assert.equal(result.headers.get('service-worker-allowed'), '/conference/');
  assert.equal(result.headers.has('set-cookie'), false);
  assert.equal(result.headers.has('clear-site-data'), false);
  assert.equal(result.headers.has('strict-transport-security'), false);
  assert.equal((await request('/conference/assets/app.js', { headers: { 'if-none-match': '"tag"' } })).status, 304);
});

test('a compression-capable Hosting server receives an identity request and returns a usable asset', async () => {
  const asset = 'export const conference = true;';
  const server = createServer((request, response) => {
    const identity = request.headers['accept-encoding'] === 'identity';
    const body = identity ? Buffer.from(asset) : gzipSync(asset);
    response.writeHead(200, {
      'content-length': body.length,
      ...(!identity && { 'content-encoding': 'gzip' }),
    });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const { request } = setup((_url, options) => fetch(`http://127.0.0.1:${server.address().port}/asset.js`, options));
    const response = await request('/conference/assets/app.js');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(asset)));
    assert.equal(await response.text(), asset);
  } finally {
    server.close();
  }
});

test('same-event redirects resolve only on the fixed origin and translate the final Location', async () => {
  const { request, calls } = setup((url) => {
    if (url === `${conference}/old`) return new Response(null, { status: 301, headers: { location: 'next' } });
    if (url === `${conference}/next`) return new Response(null, {
      status: 308, headers: { location: `${origin}/conference/program?lang=es` },
    });
    return new Response('program');
  });
  const response = await request('/conference/old');
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), '/conference/program?lang=es');
  assert.deepEqual(calls.map(({ url }) => url), [`${conference}/old`, `${conference}/next`, `${conference}/program?lang=es`]);
});

test('bad redirects, origin-to-public loops and failed upstreams do not reach a sibling', async () => {
  for (const location of ['https://other.example.test/path', '//other.example.test/path',
    `${origin}/`, `${origin}/events/workshops/`, `${workshops}/schedule`,
    '/events/workshops/', '/__/auth/handler', '/next/../old', `${origin}/conference/old`]) {
    const { request, calls } = setup(() => new Response(null, { status: 302, headers: { location } }));
    assert.equal((await request('/conference/old')).status, 503, location);
    assert.deepEqual(calls.map(({ url }) => url), [`${conference}/old`]);
  }
  const loop = setup((url) => new Response(null, {
    status: 302, headers: { location: url.endsWith('/one') ? '/two' : '/one' },
  }));
  assert.equal((await loop.request('/conference/one')).status, 503);
  assert.deepEqual(loop.calls.map(({ url }) => url), [`${conference}/one`, `${conference}/two`]);

  const failed = setup((url) => {
    if (url === `${conference}/throw`) throw new Error('synthetic network failure');
    return url.startsWith(conference) ? new Response('upstream detail', { status: 502 }) : new Response('sibling');
  });
  assert.equal((await failed.request('/conference/throw?sig=fixture-private')).status, 503);
  const retry = await failed.request('/conference/');
  assert.equal(retry.status, 503);
  assert.match(await retry.text(), /Try again/);
  assert.deepEqual(failed.warnings, [
    { reason: 'hosting-fetch', host: 'client.example.test', mount: '/conference', upstreamStatus: undefined },
    { reason: 'hosting-status', host: 'client.example.test', mount: '/conference', upstreamStatus: 502 },
  ]);
  assert.equal(await (await failed.request('/events/workshops/')).text(), 'sibling');
});
