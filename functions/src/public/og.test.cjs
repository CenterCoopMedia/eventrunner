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
    lastKnownTemplate,
    TEMPLATE_REVALIDATE_FLOOR_MS,
    TEMPLATE_FETCH_TIMEOUT_MS,
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

test('buildOgHtml: a $-pattern in a post title is inserted literally, not read as a replacement', () => {
  const html = buildOgHtml({
    template: TEMPLATE,
    meta: { title: 'Lot $& lot $1', description: 'D', url: 'https://example.org', siteName: 'S' },
  });
  assert.ok(html.includes('<title>Lot $&amp; lot $1</title>'));
  assert.ok(!html.includes('Default SPA title'));
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

test('fetchTemplate: past the floor it re-fetches; forceRefresh skips the floor immediately', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, text: async () => `v${calls}` }; };

  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 0 });
  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 30 * 1000 }); // past the floor
  assert.equal(calls, 2);

  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 30 * 1000, forceRefresh: true });
  assert.equal(calls, 3);
});

// -------------------------------------------- conditional revalidation

const etagRes = (etag, body) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag : null) },
  text: async () => body,
});

test('fetchTemplate: a burst inside the floor makes exactly one request', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return etagRes('"v1"', 'FIRST'); };
  const at = (t) => fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => t });

  assert.equal(await at(0), 'FIRST');
  for (const t of [1, 100, 5000, TEMPLATE_REVALIDATE_FLOOR_MS - 1]) {
    assert.equal(await at(t), 'FIRST');
  }
  assert.equal(calls, 1);
});

test('fetchTemplate: revalidates with If-None-Match, and a 304 keeps the body and restarts the floor', async () => {
  resetTemplateCacheForTest();
  const sent = [];
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    sent.push(init?.headers?.['If-None-Match'] ?? null);
    return calls === 1
      ? etagRes('"v1"', 'FIRST')
      : { ok: false, status: 304, headers: { get: () => null }, text: async () => '' };
  };
  const at = (t) => fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => t });

  assert.equal(await at(0), 'FIRST');
  assert.equal(await at(TEMPLATE_REVALIDATE_FLOOR_MS + 1), 'FIRST'); // 304, body reused
  assert.deepEqual(sent, [null, '"v1"']);
  assert.equal(calls, 2);

  // The 304 restarted the floor, so a request right after it asks nothing.
  assert.equal(await at(TEMPLATE_REVALIDATE_FLOOR_MS + 2), 'FIRST');
  assert.equal(calls, 2);
});

test('fetchTemplate: a 200 replaces the held template — this is how a deploy is noticed', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? etagRes('"v1"', 'OLD BUILD') : etagRes('"v2"', 'NEW BUILD');
  };
  const at = (t) => fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => t });

  assert.equal(await at(0), 'OLD BUILD');
  assert.equal(await at(TEMPLATE_REVALIDATE_FLOOR_MS + 1), 'NEW BUILD');
  // The new ETag is the one sent from here on.
  let lastSent = null;
  const capture = async (url, init) => { lastSent = init?.headers?.['If-None-Match'] ?? null; return etagRes('"v2"', 'NEW BUILD'); };
  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl: capture, now: () => 60 * 1000 });
  assert.equal(lastSent, '"v2"');
});

test('fetchTemplate: a non-ok response serves the held template rather than failing the site', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? etagRes('"v1"', 'HELD') : { ok: false, status: 503, headers: { get: () => null }, text: async () => '' };
  };
  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 0 });
  const served = await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 60 * 1000 });
  assert.equal(served, 'HELD');
});

test('fetchTemplate: a network failure serves the held template too', async () => {
  resetTemplateCacheForTest();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return etagRes('"v1"', 'HELD');
    throw new Error('ECONNRESET');
  };
  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 0 });
  assert.equal(await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl, now: () => 60 * 1000 }), 'HELD');
});

test('fetchTemplate: with nothing ever fetched, a non-ok response and a network failure both throw', async () => {
  resetTemplateCacheForTest();
  await assert.rejects(() => fetchTemplate({
    publicUrl: 'https://example.org',
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  }));
  resetTemplateCacheForTest();
  await assert.rejects(() => fetchTemplate({
    publicUrl: 'https://example.org',
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  }));
});

test('lastKnownTemplate: reports what the container holds, and nothing after a reset', async () => {
  resetTemplateCacheForTest();
  assert.equal(lastKnownTemplate(), null);
  await fetchTemplate({ publicUrl: 'https://example.org', fetchImpl: async () => etagRes('"v1"', 'HELD') });
  assert.equal(lastKnownTemplate(), 'HELD');
  resetTemplateCacheForTest();
  assert.equal(lastKnownTemplate(), null);
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

/** getConfig fixture with the feature on and a public URL set (the common case). */
function enabledConfig(overrides = {}) {
  return {
    event: EVENT,
    features: { updates: true },
    tierA: { publicUrl: 'https://example.org' },
    ...overrides,
  };
}

test('createUpdatesMetaHandler: 405 on non-GET', async () => {
  const db = makeFakeDb();
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => enabledConfig(),
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
    getConfig: async () => enabledConfig(),
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
    getConfig: async () => enabledConfig(),
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
    getConfig: async () => enabledConfig(),
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
    getConfig: async () => enabledConfig(),
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
    getConfig: async () => enabledConfig({ tierA: {} }),
    fetchTemplateFn: async () => { called = true; return TEMPLATE; },
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/x', query: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(called, false);
});

// ------------------------------------------------------ features.updates gate

test('createUpdatesMetaHandler: disabled config/features.updates -> not-found, same as buildSchedulePdf\'s pattern', async () => {
  const db = makeFakeDb({ 'cmsUpdates/post-1': { title: 'Big news', body: 'Details here.', visible: true } });
  let templateFetched = false;
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => enabledConfig({ features: { updates: false } }),
    fetchTemplateFn: async () => { templateFetched = true; return TEMPLATE; },
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/post-1', query: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(templateFetched, false); // never even reaches the self-fetch
});

test('createUpdatesMetaHandler: a missing features doc (undefined, not false) also does not serve', async () => {
  const db = makeFakeDb();
  const handler = createUpdatesMetaHandler({
    db,
    getConfig: async () => ({ event: EVENT, tierA: { publicUrl: 'https://example.org' } }), // no `features` at all
    fetchTemplateFn,
  });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates', query: {} }, res);
  assert.equal(res.statusCode, 404);
});

// ---------------------------------------------------- strict visible === true

test('createUpdatesMetaHandler: a doc with visible OMITTED (never explicitly published) is treated as unpublished', async () => {
  // The Admin SDK bypasses firestore.rules — a doc missing the field
  // entirely (e.g. hand-seeded, or mid-write) must not read as live.
  const db = makeFakeDb({ 'cmsUpdates/no-flag': { title: 'No visible field at all', body: 'x' } });
  const handler = createUpdatesMetaHandler({ db, getConfig: async () => enabledConfig(), fetchTemplateFn });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/no-flag', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.sent.includes('No visible field at all'));
  assert.ok(res.sent.includes(EVENT.name)); // fell back to event-level meta
});

test('createUpdatesMetaHandler: visible: true (not just truthy) is required', async () => {
  const db = makeFakeDb({ 'cmsUpdates/truthy': { title: 'Truthy but not true', body: 'x', visible: 1 } });
  const handler = createUpdatesMetaHandler({ db, getConfig: async () => enabledConfig(), fetchTemplateFn });
  const res = fakeRes();
  await handler({ method: 'GET', path: '/updates/truthy', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.sent.includes('Truthy but not true'));
});

// ============================================================== routeMeta
//
// The per-route metadata function (M7 issue 4). These assert against the
// HTML the handler RETURNS, never against a rendered app: the whole point
// of the function is that no client code runs for the reader that matters
// here.

const {
  createRouteMetaHandler,
  internals: {
    requestedRoutePath,
    resolveRouteSubject,
    resolveRouteMeta,
    buildRouteHtml,
    buildEventJsonLd,
    brandingObjectUrl,
    resolveCardImage,
    imageTypeFor,
    zoneOffset,
    ROUTE_CACHE_CONTROL,
    DEFAULT_CARD_IMAGE,
  },
} = require('./og.cjs');

const SITE_EVENT = {
  name: '[Fixture] Harborlight Media Summit',
  tagline: 'A synthetic gathering',
  timezone: 'America/New_York',
  days: [
    { id: 'day-1', label: 'Day one', date: '2026-10-14', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', label: 'Day two', date: '2026-10-15', startTime: '09:00', endTime: '16:00' },
  ],
  venue: {
    name: '[Fixture] Harborlight Hall',
    addressLine1: '1 Harborlight Way',
    addressLine2: null,
    city: 'Millhaven',
    region: 'MH',
    postalCode: '58211',
    country: 'US',
  },
  seo: {
    description: 'Schedule, speaker, and travel information for a synthetic event.',
    defaultOgImagePath: 'branding/og-default.svg',
    organizerName: '[Fixture] Harborlight Cooperative',
    organizerUrl: 'https://example.org',
  },
};

function siteConfig(overrides = {}) {
  return {
    event: SITE_EVENT,
    features: { schedule: true, speakers: true, sponsors: true },
    theme: { logos: { ogDefault: 'branding/og-default.svg' } },
    tierA: { publicUrl: 'https://example.org', storageBucket: 'fixture-bucket.appspot.com' },
    ...overrides,
  };
}

const SITE_DOCS = {
  'cmsPages/home': { id: 'home', label: 'Home page', path: '/', order: 0, visible: true, systemPage: true },
  'cmsPages/schedule': { id: 'schedule', label: 'Schedule', path: '/schedule', order: 1, visible: true, systemPage: true },
  'cmsPages/speakers': { id: 'speakers', label: 'Speakers', path: '/speakers', order: 2, visible: true, systemPage: true },
  'cmsPages/sponsors': { id: 'sponsors', label: 'Sponsors', path: '/sponsors', order: 3, visible: true, systemPage: true },
  'cmsPages/travel': { id: 'travel', label: 'Travel and venue', path: '/travel', order: 4, visible: true, systemPage: false },
  'cmsPages/hidden': { id: 'hidden', label: 'Unfinished page', path: '/hidden', order: 5, visible: false, systemPage: false },
  // Two names for one page: a short nav `label` and the full `title` the
  // page is headed by. The served tags follow the heading.
  'cmsPages/faq': { id: 'faq', label: 'FAQ', title: 'Frequently asked questions', path: '/faq', order: 6, visible: true, systemPage: false },
  'speakers_public/sp-1': {
    slug: 'rae-okonkwo',
    displayName: 'Rae Okonkwo',
    firstName: 'Rae',
    lastName: 'Okonkwo',
    bio: 'Runs the audience desk at a cooperative newsroom.',
    jobTitle: 'Audience editor',
    organization: '[Fixture] Riverside Weekly',
  },
  'cmsSchedule/s-101': {
    title: 'Opening remarks',
    description: 'How the three days fit together.',
    visible: true,
    dayId: 'day-1',
  },
};

function routeHandler(configOverrides = {}, docs = SITE_DOCS) {
  return createRouteMetaHandler({
    db: makeFakeDb(docs),
    getConfig: async () => siteConfig(configOverrides),
    fetchTemplateFn,
  });
}

async function getRoute(handler, path) {
  const res = fakeRes();
  await handler({ method: 'GET', path, query: {} }, res);
  return res;
}

// ------------------------------------------------------ requestedRoutePath

test('requestedRoutePath: normalizes the trailing slash, the query, and repeated separators', () => {
  assert.equal(requestedRoutePath({ path: '/' }), '/');
  assert.equal(requestedRoutePath({ path: '/travel' }), '/travel');
  assert.equal(requestedRoutePath({ path: '/travel/' }), '/travel');
  assert.equal(requestedRoutePath({ path: '//travel//' }), '/travel');
  assert.equal(requestedRoutePath({ path: '/speakers/rae-okonkwo?utm=x' }), '/speakers/rae-okonkwo');
  assert.equal(requestedRoutePath({ url: '/travel?from=mail' }), '/travel');
  assert.equal(requestedRoutePath({}), '/');
  // Case survives: a session id may carry capitals, and a page path is
  // matched exactly against the stored value.
  assert.equal(requestedRoutePath({ path: '/schedule/S-101' }), '/schedule/S-101');
});

// ----------------------------------------------------------- page routes

test('routeMeta: a content page route returns that page\'s own title, canonical, and card tags', async () => {
  const res = await getRoute(routeHandler(), '/travel');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(res.sent.includes('<title>Travel and venue · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('<link rel="canonical" href="https://example.org/travel">'));
  assert.ok(res.sent.includes('<meta property="og:title" content="Travel and venue · [Fixture] Harborlight Media Summit">'));
  assert.ok(res.sent.includes('<meta property="og:url" content="https://example.org/travel">'));
  assert.ok(res.sent.includes('<meta name="description" content="Schedule, speaker, and travel information for a synthetic event.">'));
  assert.ok(!res.sent.includes('noindex'));
  // The template it self-fetched is served whole, hashed assets and all.
  assert.ok(res.sent.includes('/assets/index-abc123.js'));
  assert.equal((res.sent.match(/<title>/g) || []).length, 1);
});

test('routeMeta: a page that states a title is titled by it, not by its short nav label', async () => {
  // The <h1> the reader lands on and the tab the app sets after boot both
  // read the page's heading (shared/page pageHeading). A served title of
  // "FAQ" would visibly change to "Frequently asked questions" the moment
  // the app booted, which is exactly the flicker these tags exist to stop.
  const res = await getRoute(routeHandler(), '/faq');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>Frequently asked questions · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('<meta property="og:title" content="Frequently asked questions · [Fixture] Harborlight Media Summit">'));
  assert.ok(!res.sent.includes('>FAQ ·'));
});

test('routeMeta: the schedule route carries the schedule page tags, not the home page ones', async () => {
  const res = await getRoute(routeHandler(), '/schedule');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>Schedule · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('<meta property="og:url" content="https://example.org/schedule">'));
  assert.ok(!res.sent.includes('Travel and venue'));
});

test('routeMeta: the home route is titled with the event alone, never with the page label', async () => {
  const res = await getRoute(routeHandler(), '/');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>[Fixture] Harborlight Media Summit</title>'));
  assert.ok(!res.sent.includes('Home page'));
  assert.ok(res.sent.includes('<link rel="canonical" href="https://example.org/">'));
});

test('routeMeta: a session detail route is described by its own session', async () => {
  const res = await getRoute(routeHandler(), '/schedule/s-101');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>Opening remarks · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('How the three days fit together.'));
  assert.ok(res.sent.includes('<meta property="og:url" content="https://example.org/schedule/s-101">'));
});

test('routeMeta: an invisible session is not described, and its route is not offered for indexing', async () => {
  const docs = { ...SITE_DOCS, 'cmsSchedule/s-102': { title: 'Draft session', description: 'x', visible: false } };
  const res = await getRoute(routeHandler({}, docs), '/schedule/s-102');
  assert.equal(res.statusCode, 200);
  assert.ok(!res.sent.includes('Draft session'));
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
});

// -------------------------------------------------------- speaker routes

test('routeMeta: a speaker route returns that speaker\'s own tags', async () => {
  const res = await getRoute(routeHandler(), '/speakers/rae-okonkwo');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>Rae Okonkwo · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('Runs the audience desk at a cooperative newsroom.'));
  assert.ok(res.sent.includes('<meta property="og:url" content="https://example.org/speakers/rae-okonkwo">'));
  assert.ok(res.sent.includes('<meta property="og:type" content="profile">'));
});

test('routeMeta: a speaker slug nobody holds is a shell, never the directory page under a person\'s URL', async () => {
  const res = await getRoute(routeHandler(), '/speakers/nobody-here');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>[Fixture] Harborlight Media Summit</title>'));
  assert.ok(!res.sent.includes('<title>Speakers'));
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
});

// -------------------------------------------------------- unknown routes

test('routeMeta: a route with no page doc still returns the plain shell', async () => {
  const res = await getRoute(routeHandler(), '/no-such-page');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(res.sent.includes('<title>[Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('/assets/index-abc123.js')); // the shell itself is intact
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
  assert.ok(!res.sent.includes('rel="canonical"')); // claims no canonical it cannot name
});

test('routeMeta: a hidden page is never described, and its route reads as unindexable', async () => {
  const res = await getRoute(routeHandler(), '/hidden');
  assert.equal(res.statusCode, 200);
  assert.ok(!res.sent.includes('Unfinished page'));
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
});

test('routeMeta: a page whose feature flag is off is not described', async () => {
  const res = await getRoute(
    routeHandler({ features: { schedule: true, speakers: true, sponsors: false } }),
    '/sponsors',
  );
  assert.equal(res.statusCode, 200);
  assert.ok(!res.sent.includes('<title>Sponsors'));
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
});

test('routeMeta: a page doc with `visible` omitted is treated as unpublished', async () => {
  const docs = { ...SITE_DOCS, 'cmsPages/no-flag': { id: 'no-flag', label: 'No visible field', path: '/no-flag' } };
  const res = await getRoute(routeHandler({}, docs), '/no-flag');
  assert.ok(!res.sent.includes('No visible field'));
});

// --------------------------------------------------------- structured data

test('buildEventJsonLd: describes the event from config/event, and omits what is not configured', () => {
  const data = buildEventJsonLd({
    event: SITE_EVENT,
    url: 'https://example.org',
    imageUrl: 'https://example.org/branding/og-default.svg',
  });
  assert.equal(data['@type'], 'Event');
  assert.equal(data.name, SITE_EVENT.name);
  // Offsets, not bare wall clocks: October in America/New_York is -04:00,
  // and a figure without one names 24 different instants.
  assert.equal(data.startDate, '2026-10-14T09:00-04:00');
  assert.equal(data.endDate, '2026-10-15T16:00-04:00');
  assert.equal(data.location['@type'], 'Place');
  assert.equal(data.location.address.postalCode, '58211');
  assert.equal(data.organizer.name, '[Fixture] Harborlight Cooperative');
  assert.equal(data.image, 'https://example.org/branding/og-default.svg');

  const bare = buildEventJsonLd({ event: { name: 'A' }, url: 'https://example.org', imageUrl: null });
  assert.equal('startDate' in bare, false);
  assert.equal('location' in bare, false);
  assert.equal('image' in bare, false);
  assert.equal(buildEventJsonLd({ event: null, url: 'https://example.org' }), null);
});

test('routeMeta: the served HTML carries a parseable Event block that cannot close its own script tag', async () => {
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig({
      event: { ...SITE_EVENT, name: 'Summit </script><script>alert(1)</script>' },
    }),
    fetchTemplateFn,
  });
  const res = await getRoute(handler, '/travel');
  const match = res.sent.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'an Event block is present');
  const parsed = JSON.parse(match[1]);
  assert.equal(parsed['@type'], 'Event');
  assert.ok(!match[1].includes('</script>'));
  assert.ok(!res.sent.includes('<script>alert(1)</script>'));
});

test('zoneOffset: reads the offset in force on that day, on both sides of a daylight change', () => {
  assert.equal(zoneOffset('2026-10-14', '09:00', 'America/New_York'), '-04:00');
  assert.equal(zoneOffset('2026-01-14', '09:00', 'America/New_York'), '-05:00');
  assert.equal(zoneOffset('2026-06-01', '09:00', 'Asia/Kolkata'), '+05:30');
  assert.equal(zoneOffset('2026-06-01', '09:00', 'UTC'), '+00:00');
  // Unusable inputs resolve to nothing, and the caller emits a bare wall
  // clock rather than an invented offset.
  assert.equal(zoneOffset('2026-06-01', '09:00', 'Not/AZone'), null);
  assert.equal(zoneOffset('2026-06-01', '09:00', ''), null);
});

test('buildEventJsonLd: a day whose event names no timezone keeps the bare wall clock', () => {
  const data = buildEventJsonLd({
    event: {
      name: 'A',
      days: [{ id: 'd1', date: '2026-10-14', startTime: '09:00', endTime: '17:00' }],
    },
    url: 'https://example.org',
  });
  assert.equal(data.startDate, '2026-10-14T09:00');
  assert.equal(data.endDate, '2026-10-14T17:00');
});

test('buildEventJsonLd: a day with no times at all stays a plain date', () => {
  const data = buildEventJsonLd({
    event: { name: 'A', timezone: 'America/New_York', days: [{ id: 'd1', date: '2026-10-14' }] },
    url: 'https://example.org',
  });
  assert.equal(data.startDate, '2026-10-14');
  assert.equal(data.endDate, '2026-10-14');
});

// --------------------------------------------------------------- social image

test('brandingObjectUrl: a flat branding path resolves against the site, an uploaded one against the bucket', () => {
  assert.equal(
    brandingObjectUrl('branding/og-default.svg', { base: 'https://example.org', bucket: 'b' }),
    'https://example.org/branding/og-default.svg',
  );
  assert.ok(
    brandingObjectUrl('branding/abc123/card.png', { base: 'https://example.org', bucket: 'b' })
      .startsWith('https://firebasestorage.googleapis.com/v0/b/b/o/'),
  );
  assert.equal(brandingObjectUrl('branding/abc123/card.png', { base: 'https://example.org', bucket: null }), null);
  assert.equal(brandingObjectUrl('/branding/x.svg', { base: 'https://example.org', bucket: 'b' }), null);
  assert.equal(brandingObjectUrl('', { base: 'https://example.org', bucket: 'b' }), null);
  assert.equal(brandingObjectUrl(null, { base: 'https://example.org', bucket: 'b' }), null);
});

test('imageTypeFor: names the type a crawler will meet, and nothing for a shape it will not decode', () => {
  assert.equal(imageTypeFor('branding/card.png'), 'image/png');
  assert.equal(imageTypeFor('branding/abc/card.JPG'), 'image/jpeg');
  assert.equal(imageTypeFor('branding/card.jpeg'), 'image/jpeg');
  assert.equal(imageTypeFor('branding/card.webp'), 'image/webp');
  // The one that matters: the seeded placeholder is an SVG, which the card
  // crawlers do not reliably render.
  assert.equal(imageTypeFor('branding/og-default.svg'), null);
  assert.equal(imageTypeFor('branding/card'), null);
  assert.equal(imageTypeFor(null), null);
});

test('resolveCardImage: an operator PNG wins; an SVG anywhere falls through to the bundled raster', () => {
  const base = 'https://example.org';
  const bucket = 'fixture-bucket.appspot.com';

  const uploaded = resolveCardImage({
    config: {
      theme: { logos: { ogDefault: 'branding/abc123/card.png' } },
      tierA: { storageBucket: bucket },
    },
    base,
  });
  assert.ok(uploaded.url.startsWith('https://firebasestorage.googleapis.com/'));
  assert.equal(uploaded.type, 'image/png');
  // Nothing measured it, so nothing states a size for it.
  assert.equal(uploaded.width, null);
  assert.equal(uploaded.height, null);

  // Both configured values are the seeded SVG: neither is usable, and the
  // bundled raster is what a deployment that never touched the slot gets.
  const seeded = resolveCardImage({
    config: {
      theme: { logos: { ogDefault: 'branding/og-default.svg' } },
      event: { seo: { defaultOgImagePath: 'branding/og-default.svg' } },
      tierA: { storageBucket: bucket },
    },
    base,
  });
  assert.deepEqual(seeded, {
    url: 'https://example.org/branding/og-default.png',
    type: 'image/png',
    width: 1200,
    height: 630,
  });
  assert.equal(seeded.url.endsWith(DEFAULT_CARD_IMAGE.path), true);

  const bare = resolveCardImage({ config: {}, base });
  assert.equal(bare.url, 'https://example.org/branding/og-default.png');
});

test('routeMeta: the card names the raster default, with its type and its size', async () => {
  const res = await getRoute(routeHandler(), '/travel');
  assert.ok(res.sent.includes('<meta property="og:image" content="https://example.org/branding/og-default.png">'));
  assert.ok(res.sent.includes('<meta property="og:image:type" content="image/png">'));
  assert.ok(res.sent.includes('<meta property="og:image:width" content="1200">'));
  assert.ok(res.sent.includes('<meta property="og:image:height" content="630">'));
  assert.ok(res.sent.includes('<meta name="twitter:card" content="summary_large_image">'));
  // The SVG placeholder is never offered to a crawler.
  assert.ok(!res.sent.includes('og-default.svg'));
});

test('routeMeta: an uploaded card is used as it is, with no size invented for it', async () => {
  const res = await getRoute(
    routeHandler({ theme: { logos: { ogDefault: 'branding/abc123/card.png' } } }),
    '/travel',
  );
  assert.ok(res.sent.includes('firebasestorage.googleapis.com'));
  assert.ok(res.sent.includes('<meta property="og:image:type" content="image/png">'));
  assert.ok(!res.sent.includes('og:image:width'));
});

// ---------------------------------------------------------------- escaping

test('buildRouteHtml: escapes injected values, and a $-pattern in a title is inserted literally', () => {
  const html = buildRouteHtml({
    template: TEMPLATE,
    meta: {
      title: 'Say "hi" <b>$& $` now</b>',
      description: 'A & B',
      url: 'https://example.org/x',
      siteName: 'S & S',
      ogType: 'website',
      image: null,
      noindex: false,
      jsonLd: null,
    },
  });
  assert.ok(html.includes('<title>Say &quot;hi&quot; &lt;b&gt;$&amp; $` now&lt;/b&gt;</title>'));
  assert.ok(html.includes('content="A &amp; B"'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('/assets/index-abc123.js'));
});

// ----------------------------------------------------------------- headers

test('routeMeta: sets a cache header so the edge, not the function, answers repeat traffic', async () => {
  const res = await getRoute(routeHandler(), '/travel');
  assert.equal(res.headers['Cache-Control'], ROUTE_CACHE_CONTROL);
  // The browser always revalidates, because the shell names hashed asset
  // files; the shared cache holds it for the config cache's own window.
  assert.ok(/max-age=0/.test(ROUTE_CACHE_CONTROL));
  assert.ok(/s-maxage=300/.test(ROUTE_CACHE_CONTROL));
  // must-revalidate, so a cache under pressure may not answer from a copy
  // it was told is stale: that copy names asset files a deploy has removed.
  assert.ok(/must-revalidate/.test(ROUTE_CACHE_CONTROL));
  // And nothing may be served stale while it refreshes, for the same reason.
  assert.ok(!/stale-while-revalidate/.test(ROUTE_CACHE_CONTROL));
});

// -------------------------------------------------------------- resilience

test('routeMeta: 405 on a method that is not GET or HEAD', async () => {
  const res = fakeRes();
  await routeHandler()({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});

test('routeMeta: HEAD is answered like GET — link checkers ask for pages that way', async () => {
  const res = fakeRes();
  await routeHandler()({ method: 'HEAD', path: '/travel', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], ROUTE_CACHE_CONTROL);
});

test('routeMeta: no configured public URL and nothing ever fetched -> 500, and nothing is fetched from nowhere', async () => {
  let called = false;
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig({ tierA: {} }),
    fetchTemplateFn: async () => { called = true; return TEMPLATE; },
    lastTemplateFn: () => null,
    log: { error: () => {} },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 500);
  assert.equal(called, false);
});

test('routeMeta: no configured public URL, but a template was held -> the shell, not a 500', async () => {
  const errors = [];
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig({ tierA: {} }),
    fetchTemplateFn: async () => { throw new Error('never called'); },
    lastTemplateFn: () => TEMPLATE,
    log: { error: (...args) => errors.push(args) },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('/assets/index-abc123.js'));
  assert.ok(!res.sent.includes('noindex')); // a misconfiguration is not a missing page
  assert.equal(errors.length, 1);
});

test('routeMeta: a config read that fails serves the shell, and never a 500, while a template is held', async () => {
  const errors = [];
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => { throw new Error('firestore is unavailable'); },
    fetchTemplateFn: async () => { throw new Error('never called'); },
    lastTemplateFn: () => TEMPLATE,
    log: { error: (...args) => errors.push(args) },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('/assets/index-abc123.js'));
  assert.ok(!res.sent.includes('noindex'));
  assert.equal(errors.length, 1);
});

test('routeMeta: a config read that fails with nothing ever fetched is the one 500', async () => {
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => { throw new Error('firestore is unavailable'); },
    fetchTemplateFn: async () => TEMPLATE,
    lastTemplateFn: () => null,
    log: { error: () => {} },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 500);
});

test('routeMeta: a hosting fetch that fails falls back to the held template rather than 500ing the site', async () => {
  const errors = [];
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig(),
    fetchTemplateFn: async () => { throw new Error('self-fetch failed'); },
    lastTemplateFn: () => TEMPLATE,
    log: { error: (...args) => errors.push(args) },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 200);
  // The config still resolved, so the page keeps its own tags.
  assert.ok(res.sent.includes('<title>Travel and venue · [Fixture] Harborlight Media Summit</title>'));
  assert.equal(errors.length, 1);
});

test('routeMeta: a lookup failure still serves the shell — the whole site sits behind this route', async () => {
  const db = makeFakeDb(SITE_DOCS);
  db.collection = () => { throw new Error('firestore is unavailable'); };
  const errors = [];
  const handler = createRouteMetaHandler({
    db,
    getConfig: async () => siteConfig(),
    fetchTemplateFn,
    log: { error: (...args) => errors.push(args) },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('/assets/index-abc123.js'));
  assert.ok(res.sent.includes('[Fixture] Harborlight Media Summit'));
  // A read that failed is not a route that does not exist: an outage must
  // not hand every page a noindex.
  assert.ok(!res.sent.includes('noindex'));
  assert.equal(errors.length, 1);
});

test('routeMeta: a template that cannot be fetched, with none ever held, is a 500 and never fabricated HTML', async () => {
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig(),
    fetchTemplateFn: async () => { throw new Error('self-fetch failed'); },
    lastTemplateFn: () => null,
    log: { error: () => {} },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 500);
});

// -------------------------------------------------------------- the seams

test('resolveRouteSubject: reads live docs only, and strictly by visibility', async () => {
  const db = makeFakeDb(SITE_DOCS);
  const config = siteConfig();
  assert.equal((await resolveRouteSubject({ db, config, path: '/travel' })).kind, 'page');
  assert.equal((await resolveRouteSubject({ db, config, path: '/speakers/rae-okonkwo' })).kind, 'speaker');
  assert.equal((await resolveRouteSubject({ db, config, path: '/schedule/s-101' })).kind, 'session');
  assert.equal(await resolveRouteSubject({ db, config, path: '/hidden' }), null);
  assert.equal(await resolveRouteSubject({ db, config, path: '/travel/deeper/still' }), null);
});

test('resolveRouteSubject: a page saved at a nested path is matched on its whole path', async () => {
  const db = makeFakeDb({
    ...SITE_DOCS,
    'cmsPages/team': { id: 'team', label: 'Who runs it', path: '/about/team', order: 6, visible: true, systemPage: false },
  });
  const subject = await resolveRouteSubject({ db, config: siteConfig(), path: '/about/team' });
  assert.equal(subject.kind, 'page');
  assert.equal(subject.doc.label, 'Who runs it');
});

test('resolveRouteMeta: the shell falls back to the event, never to an empty title', () => {
  const meta = resolveRouteMeta({
    config: siteConfig({ event: { name: '  ' } }),
    subject: null,
    path: '/nope',
    base: 'https://example.org',
  });
  assert.equal(meta.title, 'Event site');
  assert.equal(meta.noindex, true);
  assert.equal(meta.url, null);
});

// ------------------------------------------------------- the fetch deadline

test('fetchTemplate: a stalled hosting connection aborts and serves the held copy', async () => {
  resetTemplateCacheForTest();
  await fetchTemplate({
    publicUrl: 'https://example.org',
    fetchImpl: async () => etagRes('"v1"', 'HELD'),
    now: () => 0,
  });

  // Never resolves on its own: the only way out is the abort signal, which
  // is exactly the failure a hosting connection that hangs produces. The
  // keep-alive timer is a test artifact — AbortSignal.timeout's own timer
  // is unref'd, so with nothing else pending this runner would call the
  // event loop drained before the deadline arrives. A real request is what
  // holds the loop open in production.
  let sawSignal = null;
  const stalled = (url, init) => {
    sawSignal = init.signal;
    return new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 1000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(init.signal.reason);
      });
    });
  };

  const startedAt = Date.now();
  const served = await fetchTemplate({
    publicUrl: 'https://example.org',
    fetchImpl: stalled,
    now: () => 60 * 1000,
    timeoutMs: 25,
  });
  assert.equal(served, 'HELD');
  assert.ok(sawSignal, 'the fetch is given a signal to abort on');
  // The reader waited on the deadline, not on the function's own timeout.
  assert.ok(Date.now() - startedAt < 2000);
});

test('fetchTemplate: a stall with nothing ever fetched throws rather than hanging', async () => {
  resetTemplateCacheForTest();
  const stalled = (url, init) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => {}, 1000);
    init.signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(init.signal.reason);
    });
  });
  await assert.rejects(() => fetchTemplate({
    publicUrl: 'https://example.org',
    fetchImpl: stalled,
    timeoutMs: 25,
  }));
});

test('fetchTemplate: the deadline defaults to the named constant, not to nothing', async () => {
  resetTemplateCacheForTest();
  let timedOut = null;
  await fetchTemplate({
    publicUrl: 'https://example.org',
    fetchImpl: async (url, init) => {
      timedOut = init.signal;
      return etagRes('"v1"', 'HELD');
    },
  });
  assert.ok(timedOut instanceof AbortSignal);
  assert.equal(timedOut.aborted, false);
  assert.equal(typeof TEMPLATE_FETCH_TIMEOUT_MS, 'number');
  assert.ok(TEMPLATE_FETCH_TIMEOUT_MS > 0 && TEMPLATE_FETCH_TIMEOUT_MS <= 10 * 1000);
});

// -------------------------------------------- system pages, resolved by id

test('routeMeta: a system page whose stored path drifted is still described at its real route', async () => {
  // A pre-guard or hand-edited document: the route App.jsx mounts is
  // /schedule, and only the document disagrees. Resolving by path would
  // find nothing and call a working built-in route a missing page.
  const docs = {
    ...SITE_DOCS,
    'cmsPages/schedule': {
      id: 'schedule', label: 'Programme', path: '/p/schedule', order: 1, visible: true, systemPage: true,
    },
  };
  const res = await getRoute(routeHandler({}, docs), '/schedule');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>Programme · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes('<link rel="canonical" href="https://example.org/schedule">'));
  assert.ok(!res.sent.includes('noindex'));
});

test('routeMeta: the drifted path itself is not a page — nothing is served at the address it claims', async () => {
  const docs = {
    ...SITE_DOCS,
    'cmsPages/sponsors': {
      id: 'sponsors', label: 'Our supporters', path: '/supporters', order: 3, visible: true, systemPage: true,
    },
  };
  const res = await getRoute(routeHandler({}, docs), '/supporters');
  assert.equal(res.statusCode, 200);
  // App.jsx mounts sponsors at /sponsors and the catch-all refuses a system
  // page, so /supporters is a 404 in the app; titling it would be a lie.
  assert.ok(!res.sent.includes('Our supporters'));
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
});

test('routeMeta: a system route with no document at all still reads as unindexable, not as a page', async () => {
  const docs = { ...SITE_DOCS };
  delete docs['cmsPages/sponsors'];
  const res = await getRoute(routeHandler({}, docs), '/sponsors');
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<meta name="robots" content="noindex">'));
});

test('resolveRouteSubject: reads a system page by its id and a generic page by its path', async () => {
  const db = makeFakeDb({
    ...SITE_DOCS,
    'cmsPages/schedule': {
      id: 'schedule', label: 'Programme', path: '/p/schedule', order: 1, visible: true, systemPage: true,
    },
  });
  const config = siteConfig();
  const system = await resolveRouteSubject({ db, config, path: '/schedule' });
  assert.equal(system.kind, 'page');
  assert.equal(system.doc.label, 'Programme');
  const generic = await resolveRouteSubject({ db, config, path: '/travel' });
  assert.equal(generic.doc.label, 'Travel and venue');
});

// ------------------------------------------------------------ page depth

test('routeMeta: a page saved at a deep path is described, however deep it is', async () => {
  // validatePageDoc accepts a nested route at any depth, so there is no
  // depth for this function to refuse.
  const deep = '/about/team/editors/desk/audience/local/weekly';
  assert.equal(deep.split('/').length - 1, 7);
  const docs = {
    ...SITE_DOCS,
    'cmsPages/weekly': {
      id: 'weekly', label: 'The weekly desk', path: deep, order: 9, visible: true, systemPage: false,
    },
  };
  const res = await getRoute(routeHandler({}, docs), deep);
  assert.equal(res.statusCode, 200);
  assert.ok(res.sent.includes('<title>The weekly desk · [Fixture] Harborlight Media Summit</title>'));
  assert.ok(res.sent.includes(`<link rel="canonical" href="https://example.org${deep}">`));
});

test('resolveRouteSubject: a path the system could never have stored is refused before any query', async () => {
  const db = makeFakeDb(SITE_DOCS);
  const config = siteConfig();
  for (const path of ['/Travel', '/tra vel', '/-travel', '/travel-']) {
    assert.equal(await resolveRouteSubject({ db, config, path }), null, path);
  }
});
