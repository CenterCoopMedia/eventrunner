'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUpdatesMetaHandler,
  internals: {
    escapeHtml,
    excerpt,
    resolveMeta,
    buildOgHtml,
    fetchTemplate,
    requestedUpdateId,
    resetTemplateCacheForTest,
  },
} = require('./og.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

const TEMPLATE = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '<meta charset="utf-8">',
  '<title>Default SPA title</title>',
  '<script type="module" src="/assets/index-abc123.js"></script>',
  '</head>',
  '<body><div id="root"></div></body>',
  '</html>',
].join('\n');

const EVENT = { name: '[Fixture] Harborlight Media Summit', tagline: 'A synthetic gathering' };

// ------------------------------------------------------------ escapeHtml

test('escapeHtml: escapes &, <, >, ", \' — & first so escaping order cannot double-decode', () => {
  assert.equal(escapeHtml(`Tom & Jerry <script>"x"'y'`), 'Tom &amp; Jerry &lt;script&gt;&quot;x&quot;&#39;y&#39;');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(123), '');
});

// ---------------------------------------------------------------- excerpt

test('excerpt: passes short text through, trims long text at a word boundary with an ellipsis', () => {
  assert.equal(excerpt('short body'), 'short body');
  assert.equal(excerpt(''), '');
  assert.equal(excerpt(null), '');
  const long = 'word '.repeat(60).trim();
  const result = excerpt(long, 50);
  assert.ok(result.length <= 51);
  assert.ok(result.endsWith('…'));
  assert.ok(!result.includes('  '));
});

// -------------------------------------------------------------- resolveMeta

test('resolveMeta: an existing update produces per-post title/description', () => {
  const meta = resolveMeta({
    event: EVENT,
    update: { title: 'Parking has moved', body: 'Please use lot B starting Thursday.' },
    canonicalUrl: 'https://example.org/updates/abc',
  });
  assert.equal(meta.title, 'Parking has moved · [Fixture] Harborlight Media Summit');
  assert.equal(meta.description, 'Please use lot B starting Thursday.');
  assert.equal(meta.url, 'https://example.org/updates/abc');
  assert.equal(meta.siteName, '[Fixture] Harborlight Media Summit');
});

test('resolveMeta: missing-doc fallback uses event-level meta, never throws or prints "undefined"', () => {
  const meta = resolveMeta({ event: EVENT, update: null, canonicalUrl: 'https://example.org/updates/gone' });
  assert.equal(meta.title, EVENT.name);
  assert.equal(meta.description, EVENT.tagline);
});

test('resolveMeta: a config-less deployment still resolves (no event doc yet)', () => {
  const meta = resolveMeta({ event: null, update: null, canonicalUrl: 'https://example.org' });
  assert.equal(meta.title, 'Event updates');
  assert.equal(meta.description, '');
});

test('resolveMeta: an update with an empty title falls back too (never emits an empty <title>)', () => {
  const meta = resolveMeta({ event: EVENT, update: { title: '   ', body: 'x' }, canonicalUrl: 'https://example.org' });
  assert.equal(meta.title, EVENT.name);
});

// -------------------------------------------------------------- buildOgHtml

test('buildOgHtml: replaces <title> and injects OG/Twitter tags before </head>', () => {
  const html = buildOgHtml({
    template: TEMPLATE,
    meta: { title: 'Post title', description: 'Post body', url: 'https://example.org/updates/x', siteName: 'Summit' },
  });
  assert.ok(html.includes('<title>Post title</title>'));
  assert.equal((html.match(/<title>/g) || []).length, 1); // never doubled
  assert.ok(!html.includes('Default SPA title'));
  assert.ok(html.includes('<meta property="og:title" content="Post title">'));
  assert.ok(html.includes('<meta property="og:description" content="Post body">'));
  assert.ok(html.includes('<meta property="og:url" content="https://example.org/updates/x">'));
  assert.ok(html.includes('<meta property="og:site_name" content="Summit">'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary">'));
  // The rest of the template (the actual asset script tag) survives untouched.
  assert.ok(html.includes('/assets/index-abc123.js'));
  assert.ok(html.indexOf('og:title') < html.indexOf('</head>'));
});

test('buildOgHtml: escapes meta content — a title with quotes/angle-brackets cannot break out of the tag', () => {
  const html = buildOgHtml({
    template: TEMPLATE,
    meta: { title: `Say "hi" <b>now</b>`, description: 'A & B', url: 'https://example.org', siteName: 'S & S' },
  });
  assert.ok(html.includes('<title>Say &quot;hi&quot; &lt;b&gt;now&lt;/b&gt;</title>'));
  assert.ok(html.includes('content="A &amp; B"'));
  assert.ok(html.includes('content="S &amp; S"'));
  assert.ok(!html.includes('<b>now</b>'));
});

test('buildOgHtml: a template with no </head> still appends the tags rather than throwing', () => {
  const html = buildOgHtml({
    template: '<html><body>no head here</body></html>',
    meta: { title: 'T', description: 'D', url: 'https://example.org', siteName: 'S' },
  });
  assert.ok(html.includes('og:title'));
});

// -------------------------------------------------------------- fetchTemplate

test('fetchTemplate: self-fetches index.html from the public URL and caches per container', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.equal(url, 'https://example.org/index.html');
    return { ok: true, text: async () => TEMPLATE };
  };
  const first = await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 1000 });
  const second = await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 1500 });
  assert.equal(first, TEMPLATE);
  assert.equal(second, TEMPLATE);
  assert.equal(calls, 1); // second call served from cache
});

test('fetchTemplate: TTL expiry re-fetches; forceRefresh bypasses the cache immediately', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, text: async () => `v${calls}` }; };

  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 0 });
  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 10 * 60 * 1000 }); // past TTL
  assert.equal(calls, 2);

  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 10 * 60 * 1000, forceRefresh: true });
  assert.equal(calls, 3);
});

test('fetchTemplate: a non-ok self-fetch response throws rather than serving fabricated HTML', async () => {
  resetTemplateCacheForTest();
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(() => fetchTemplate({ publicUrl: 'https://example.org', fetchImpl }));
});

// ---------------------------------------------------------- requestedUpdateId

test('requestedUpdateId: reads /updates/:id from the path or ?id= from the query', () => {
  assert.equal(requestedUpdateId({ path: '/updates/abc123' }), 'abc123');
  assert.equal(requestedUpdateId({ path: '/updates/abc%20123' }), 'abc 123');
  assert.equal(requestedUpdateId({ path: '/updates', query: { id: 'from-query' } }), 'from-query');
  assert.equal(requestedUpdateId({ path: '/updates' }), null);
  assert.equal(requestedUpdateId({ path: '/' }), null);
});

// ---------------------------------------------------------------- handler

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    sent: null,
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    send(payload) { res.sent = payload; return res; },
    json(payload) { res.sent = payload; return res; },
  };
  return res;
}

const fetchTemplateFn = async () => TEMPLATE;

test('createUpdatesMetaHandler: 405 on non-GET', async () => {
  const db = makeFakeDb();
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: { publicUrl: 'https://example.org' } }),
    fetchTemplateFn,
  });
  const res = fakeRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});

test('createUpdatesMetaHandler: an existing, visible update unfurls with its own title', async () => {
  const db = makeFakeDb({ 'cmsUpdates/post-1': { title: 'Big news', body: 'Details here.', visible: true } });
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: { publicUrl: 'https://example.org' } }),
    fetchTemplateFn,
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/post-1', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(res.sent.includes('Big news'));
  assert.ok(res.sent.includes('Details here'));
});

test('createUpdatesMetaHandler: missing-doc fallback serves event-level meta, not a 404', async () => {
  const db = makeFakeDb();
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: { publicUrl: 'https://example.org' } }),
    fetchTemplateFn,
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/does-not-exist', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes(EVENT.name));
});

test('createUpdatesMetaHandler: a hidden (unpublished) update falls back too, never leaking a draft', async () => {
  const db = makeFakeDb({ 'cmsUpdates/draft-1': { title: 'Secret draft', body: 'shh', visible: false } });
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: { publicUrl: 'https://example.org' } }),
    fetchTemplateFn,
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/draft-1', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.sent.includes('Secret draft'));
  assert.ok(res.sent.includes(EVENT.name));
});

test('createUpdatesMetaHandler: the list route (/updates, no id) serves event-level meta', async () => {
  const db = makeFakeDb();
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: { publicUrl: 'https://example.org' } }),
    fetchTemplateFn,
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes(EVENT.name));
});

test('createUpdatesMetaHandler: no configured public URL -> 500, never fetches a template from nowhere', async () => {
  const db = makeFakeDb();
  let called = false;
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: {} }),
    fetchTemplateFn: async () => { called = true; return TEMPLATE; },
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/x', query: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(called, false);
});
