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
    ROUTE_CACHE_CONTROL,
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
  assert.equal(data.startDate, '2026-10-14T09:00');
  assert.equal(data.endDate, '2026-10-15T16:00');
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

test('routeMeta: the social image comes from the theme slot, falling back to the event seo path', async () => {
  const withSlot = await getRoute(routeHandler(), '/travel');
  assert.ok(withSlot.sent.includes('<meta property="og:image" content="https://example.org/branding/og-default.svg">'));
  assert.ok(withSlot.sent.includes('<meta name="twitter:card" content="summary_large_image">'));

  const noSlot = await getRoute(routeHandler({ theme: { logos: {} } }), '/travel');
  assert.ok(noSlot.sent.includes('<meta property="og:image" content="https://example.org/branding/og-default.svg">'));

  const noImage = await getRoute(
    routeHandler({ theme: { logos: {} }, event: { ...SITE_EVENT, seo: { description: 'A line.' } } }),
    '/travel',
  );
  assert.ok(!noImage.sent.includes('og:image'));
  assert.ok(noImage.sent.includes('<meta name="twitter:card" content="summary">'));
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
      imageUrl: null,
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
  // Browsers revalidate; a shared cache holds it for the same window the
  // function's own template and config caches use.
  assert.ok(/max-age=0/.test(ROUTE_CACHE_CONTROL));
  assert.ok(/s-maxage=300/.test(ROUTE_CACHE_CONTROL));
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

test('routeMeta: no configured public URL -> 500, and no template is fetched from nowhere', async () => {
  let called = false;
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig({ tierA: {} }),
    fetchTemplateFn: async () => { called = true; return TEMPLATE; },
  });
  const res = await getRoute(handler, '/travel');
  assert.equal(res.statusCode, 500);
  assert.equal(called, false);
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

test('routeMeta: a template that cannot be fetched at all is a 500, never fabricated HTML', async () => {
  const handler = createRouteMetaHandler({
    db: makeFakeDb(SITE_DOCS),
    getConfig: async () => siteConfig(),
    fetchTemplateFn: async () => { throw new Error('self-fetch failed'); },
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
