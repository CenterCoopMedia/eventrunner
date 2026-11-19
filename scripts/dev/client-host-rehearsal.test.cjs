'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { HOST, checkBrowser, probeCors, probeEdge, probeUnsubscribe } = require('./client-host-rehearsal.cjs');

test('a staged mount routes without discovery and keeps the visible sibling listed', async () => {
  const robot = 'User-agent: *\nDisallow: /conference/admin\nDisallow: /events/workshop$\nDisallow: /events/workshop/\n'
    + `Sitemap: ${HOST}/conference/sitemap.xml\n`;
  const fixtures = new Map([
    ['/.well-known/eventrunner-route-map', Response.json({ version: 4, exportedAt: '2026-11-18T23:03:00Z' }, {
      headers: { 'cache-control': 'no-store' },
    })],
    ['/', new Response('<a href="/conference/">Rehearsal Conference</a>')],
    ['/robots.txt', new Response(robot)],
    ['/conference?check=rehearsal', new Response(null, {
      status: 308, headers: { location: '/conference/?check=rehearsal' },
    })],
    ['/events/workshop?check=rehearsal', new Response(null, {
      status: 308, headers: { location: '/events/workshop/?check=rehearsal' },
    })],
  ]);
  const fetchImpl = async (input, { redirect }) => {
    const url = new URL(input);
    assert.equal(url.origin, HOST);
    assert.equal(redirect, 'manual');
    return fixtures.get(url.pathname + url.search)?.clone() || new Response(null, { status: 404 });
  };
  assert.deepEqual(await probeEdge(fetchImpl, 'staged-b', '4'), {
    phase: 'staged-b', version: 4, exportedAt: '2026-11-18T23:03:00Z',
  });
  await assert.rejects(probeEdge(fetchImpl, 'staged-b', '3'), /Map revision mismatch/);
  await assert.rejects(probeEdge(fetchImpl, 'both', '4'), /wrong public listing/);
});

test('OTP preflights stay on each event function and reject an unrelated origin', async () => {
  const allowed = new Set([HOST, 'https://fresh-nov11-ae21.eventrunner.org', 'https://er-fresh-nov11-ae21.web.app']);
  const seen = new Set();
  await probeCors(async (input, { method, headers }) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://us-central1-er-fresh-nov11-ae21.cloudfunctions.net');
    assert.equal(method, 'OPTIONS');
    assert.equal(headers['Access-Control-Request-Method'], 'POST');
    assert.equal(headers['Access-Control-Request-Headers'], 'content-type,x-firebase-appcheck');
    seen.add(`${url.pathname} ${headers.Origin}`);
    return new Response(null, { status: 204, headers: allowed.has(headers.Origin) ? {
      'Access-Control-Allow-Origin': headers.Origin,
      'Access-Control-Allow-Headers': 'Content-Type, X-Firebase-AppCheck',
    } : {} });
  }, 'b');
  assert.equal(seen.size, 8);
});

test('unsubscribe rejects another event, preserves one-click data, and can invalidate a signature', async () => {
  const link = `${HOST}/conference/unsubscribe?s=fixture01&r=${'c'.repeat(64)}&t=${'a'.repeat(43)}`;
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  await assert.rejects(probeUnsubscribe(() => assert.fail('unexpected request'), 'b', 'mounted', 'one-click', link),
    /outside the selected fixture/);
  await probeUnsubscribe(async (url, options) => {
    assert.equal(url.href, link);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(options.body, 'List-Unsubscribe=One-Click');
    return new Response('You are unsubscribed', { headers });
  }, 'a', 'mounted', 'one-click', link);
  await probeUnsubscribe(async (url, options) => {
    assert.equal(options.method, undefined);
    assert.equal(url.searchParams.get('t'), 'b' + 'a'.repeat(42));
    return new Response('This link is not valid', { status: 400, headers });
  }, 'a', 'mounted', 'invalid', link);
});

function browserFixture({ escapedAsset = false } = {}) {
  const base = `${HOST}/events/workshop/`;
  const update = base + 'updates/rehearsal-update';
  let address;
  let listener;
  let navigate;
  let replacedHistory = false;
  const observations = [];
  const mainFrame = { url: () => address };
  const page = {
    observations,
    on(event, callback) {
      assert.equal(event, 'response');
      listener = callback;
    },
    url: () => address,
    mainFrame: () => mainFrame,
    waitForEvent(event, { predicate }) {
      assert.equal(event, 'framenavigated');
      return new Promise((resolve) => {
        navigate = (frame) => {
          if (predicate(frame)) resolve(frame);
        };
      });
    },
    async goto(url) {
      address = url;
      observations.push(url);
      if (url === update) {
        navigate?.(mainFrame);
        navigate?.({ url: () => update });
        setImmediate(() => {
          replacedHistory = true;
          navigate?.(mainFrame);
        });
      }
      if (url === base + 'signin') assert(replacedHistory, 'sign-in started before the update replaced its history');
      if (url === base + 'rehearsal-details') {
        listener({ url: () => base + 'assets/index-abcd.js', ok: () => true });
        listener({ url: () => (escapedAsset ? HOST + '/' : base) + 'assets/ContentPage-hash.js', ok: () => true });
      }
      return {
        ok: () => true,
        headers: () => ({ 'x-robots-tag': 'noindex' }),
        text: async () => (url === update || url.endsWith('/rehearsal-details'))
          ? `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}">` : 'Generic page',
      };
    },
    async reload() { observations.push('reload'); },
    getByRole(role, { name, exact }) {
      assert(exact);
      observations.push(role + ' ' + name);
      return {
        waitFor: async ({ state }) => assert.equal(state, 'visible'),
        getAttribute: async () => '/events/workshop/',
        click: async () => { address = base; },
      };
    },
    locator(selector) {
      assert.equal(selector, 'link[rel="manifest"]');
      return { getAttribute: async () => '/events/workshop/manifest.webmanifest' };
    },
    request: {
      async get(url, { maxRedirects }) {
        assert.equal(maxRedirects, 0);
        assert(url.startsWith(base));
        return {
          ok: () => true,
          json: async () => ({ start_url: './', scope: './', icons: [{ src: 'icon-192.png' }, { src: 'icon-512.png' }] }),
          headers: () => ({ 'content-type': 'image/png' }),
        };
      },
    },
    async waitForURL(url) { assert.equal(address, url); },
  };
  return page;
}

test('browser check boots and reloads by accessible heading and clicks the published index link', async () => {
  const page = browserFixture();
  await checkBrowser(page, 'b', 'mounted', 'rehearsal-update', 'Rehearsal update');
  assert(page.observations.includes('reload'));
  assert(page.observations.includes('heading Rehearsal details'));
  assert(page.observations.includes('heading Sign in'));
  assert(page.observations.includes('link Rehearsal Workshop'));
  await assert.rejects(checkBrowser(browserFixture({ escapedAsset: true }), 'b', 'mounted', 'rehearsal-update', 'Rehearsal update'),
    /lazy asset escaped/);
});

test('origin fault fixtures affect only the exact event A origin and paths', async () => {
  const { faultUpstream } = await import('./client-host-rehearsal-faults.mjs');
  const origin = 'https://er-rehearsal-nov4.web.app';
  const passthrough = [];
  const probe = faultUpstream(async (input) => {
    passthrough.push(input);
    return new Response();
  });
  const unavailable = await probe(`${origin}/rehearsal-origin-unavailable`);
  assert.equal(unavailable.status, 503);
  const loopUrl = `${origin}/rehearsal-origin-loop`;
  const loop = await probe(loopUrl);
  assert.equal(loop.status, 302);
  assert.equal(loop.headers.get('location'), loopUrl);
  const sibling = 'https://er-fresh-nov11-ae21.web.app/rehearsal-origin-loop';
  await probe(sibling);
  await probe(`${loopUrl}/`);
  assert.deepEqual(passthrough, [sibling, `${loopUrl}/`]);
});
