'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyPage,
  classifyPages,
  buildSessionRoutes,
  buildSpeakerRoutes,
  buildUpdateRoutes,
  buildSitemapXml,
  buildRobotsTxt,
  buildWebManifest,
  buildSiteArtifacts,
  internals: { normalizedBaseUrl },
} = require('./site-manifest.cjs');

const PUBLIC_URL = 'https://example.org';

/** A default-shaped `config/features` doc: the §2.2 four on, the rest off. */
const FEATURES = Object.freeze({
  schedule: true,
  speakers: true,
  sponsors: true,
  attendeeDirectory: true,
  sessionBookmarks: false,
  sessionReactions: false,
  sessionMaterials: false,
  badges: false,
  liveUpdates: false,
  feedbackInbox: false,
  schedulePdf: false,
  icsExport: false,
  updates: false,
  autoApproveTicketHolders: false,
  publicAttendeeProfiles: false,
  webmcpPublic: false,
  webmcpAdmin: false,
});

function page(overrides) {
  return {
    id: 'travel', label: 'Travel', path: '/travel', order: 4, visible: true, systemPage: false,
    ...overrides,
  };
}

const PAGES = [
  page({ id: 'home', label: 'Home', path: '/', order: 0, systemPage: true }),
  page({ id: 'schedule', label: 'Schedule', path: '/schedule', order: 1, systemPage: true }),
  page({ id: 'speakers', label: 'Speakers', path: '/speakers', order: 2, systemPage: true }),
  page({ id: 'sponsors', label: 'Sponsors', path: '/sponsors', order: 3, systemPage: true }),
  page({ id: 'travel', label: 'Travel and venue', path: '/travel', order: 4 }),
  page({ id: 'faq', label: 'FAQ', path: '/faq', order: 5 }),
  // A system page whose own feature flag is off by default.
  page({ id: 'updates', label: 'Updates', path: '/updates', order: 11, systemPage: true }),
  // The authenticated attendee route: visible, its own feature
  // (attendeeDirectory) is on, but publicAttendeeProfiles is off.
  page({ id: 'attendees', label: 'Attendees', path: '/attendees', order: 10, systemPage: true }),
  // A hidden page: visible: false.
  page({ id: 'secret', label: 'Draft page', path: '/secret', order: 20, visible: false }),
];

// --- classifyPage / classifyPages ------------------------------------------

test('a visible page with no feature gate is public', () => {
  const c = classifyPage({ page: page({ id: 'travel', path: '/travel' }), features: FEATURES });
  assert.equal(c.publishable, true);
  assert.equal(c.access, 'public');
});

test('a hidden page (visible: false) is never publishable', () => {
  const c = classifyPage({ page: page({ id: 'secret', path: '/secret', visible: false }), features: FEATURES });
  assert.equal(c.publishable, false);
  assert.equal(c.visible, false);
});

test('visible is read strictly === true — an absent field is not published', () => {
  const noVisibleField = { id: 'mid-write', path: '/mid-write' };
  const c = classifyPage({ page: noVisibleField, features: FEATURES });
  assert.equal(c.publishable, false);
  assert.equal(c.visible, false);
});

test('a system page whose own feature flag is off is not publishable', () => {
  const c = classifyPage({
    page: page({ id: 'updates', path: '/updates', systemPage: true }),
    features: { ...FEATURES, updates: false },
  });
  assert.equal(c.featureOn, false);
  assert.equal(c.publishable, false);
});

test('a system page whose own feature flag is on is publishable', () => {
  const c = classifyPage({
    page: page({ id: 'updates', path: '/updates', systemPage: true }),
    features: { ...FEATURES, updates: true },
  });
  assert.equal(c.featureOn, true);
  assert.equal(c.publishable, true);
});

test('the attendee directory is authenticated while publicAttendeeProfiles is off (the default)', () => {
  const c = classifyPage({
    page: page({ id: 'attendees', path: '/attendees', systemPage: true }),
    features: { ...FEATURES, publicAttendeeProfiles: false },
  });
  assert.equal(c.access, 'authenticated');
  assert.equal(c.publishable, false);
});

test('the attendee directory is public once publicAttendeeProfiles is turned on', () => {
  const c = classifyPage({
    page: page({ id: 'attendees', path: '/attendees', systemPage: true }),
    features: { ...FEATURES, publicAttendeeProfiles: true },
  });
  assert.equal(c.access, 'public');
  assert.equal(c.publishable, true);
});

test('classifyPages splits public pages from excluded pages and appends the static private routes', () => {
  const { public: publicRoutes, excluded } = classifyPages({ pages: PAGES, features: FEATURES });
  const publicIds = publicRoutes.map((r) => r.id).sort();
  assert.deepEqual(publicIds, ['faq', 'home', 'schedule', 'speakers', 'sponsors', 'travel']);

  const excludedIds = excluded.map((r) => r.id);
  assert.ok(excludedIds.includes('updates'));
  assert.ok(excludedIds.includes('attendees'));
  assert.ok(excludedIds.includes('secret'));

  // Every static private route from apps/web/src/App.jsx is present, each
  // carrying no cmsPages id.
  const staticPaths = ['/admin', '/signin', '/profile', '/schedule/mine', '/speaker/profile', '/speaker/accept', '/ticket/claim'];
  for (const path of staticPaths) {
    assert.ok(excluded.some((r) => r.path === path && r.id === null), `${path} must be a static excluded route`);
  }
});

test('only routes with their own subtree of further pages carry hasChildren', () => {
  const { excluded } = classifyPages({ pages: PAGES, features: FEATURES });
  const byPath = Object.fromEntries(excluded.map((r) => [r.path, r]));
  assert.equal(byPath['/admin'].hasChildren, true);
  assert.equal(byPath['/updates'].hasChildren, true);
  assert.equal(byPath['/attendees'].hasChildren, true);
  assert.equal(byPath['/profile'].hasChildren, false);
  assert.equal(byPath['/signin'].hasChildren, false);
});

// --- buildSitemapXml --------------------------------------------------------

test('the sitemap lists only public routes as absolute URLs', () => {
  const xml = buildSitemapXml({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(xml, /<loc>https:\/\/example\.org\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.org\/travel<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.org\/schedule<\/loc>/);
});

test('a hidden page never appears in the sitemap', () => {
  const xml = buildSitemapXml({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.doesNotMatch(xml, /\/secret</);
});

test('a system page whose flag is off never appears in the sitemap', () => {
  const xml = buildSitemapXml({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.doesNotMatch(xml, /\/updates</);
});

test('the authenticated attendee route never appears in the sitemap', () => {
  const xml = buildSitemapXml({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.doesNotMatch(xml, /\/attendees</);
});

test('a trailing slash on the configured public URL is not doubled', () => {
  const xml = buildSitemapXml({ publicUrl: `${PUBLIC_URL}/`, pages: PAGES, features: FEATURES });
  assert.match(xml, /<loc>https:\/\/example\.org\/<\/loc>/);
  assert.doesNotMatch(xml, /example\.org\/\//);
});

test('an XML-sensitive character in a path segment is percent-encoded, never left as a raw XML special', () => {
  const withAmp = [...PAGES, page({ id: 'q-and-a', path: '/q&a' })];
  const xml = buildSitemapXml({ publicUrl: PUBLIC_URL, pages: withAmp, features: FEATURES });
  // encodeURIComponent handles '&' itself (-> %26), so escapeXml never sees
  // a raw '&' to turn into '&amp;' — percent-encoding runs first.
  assert.match(xml, /<loc>https:\/\/example\.org\/q%26a<\/loc>/);
  assert.doesNotMatch(xml, /q&a</);
  assert.doesNotMatch(xml, /q&amp;a/);
});

test('a route segment with a space is percent-encoded before it is XML-escaped', () => {
  const sessions = [{ id: 'opening session', visible: true }];
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES, sessions,
  });
  assert.match(xml, /<loc>https:\/\/example\.org\/schedule\/opening%20session<\/loc>/);
  assert.doesNotMatch(xml, /opening session</);
});

test('a route segment with a non-ASCII character is percent-encoded', () => {
  const speakers = [{ slug: 'josé-garcía' }];
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES, speakers,
  });
  assert.match(xml, /<loc>https:\/\/example\.org\/speakers\/jos%C3%A9-garc%C3%ADa<\/loc>/);
});

// --- normalizedBaseUrl: EVENT_PUBLIC_URL is trimmed for validation only ------

test('surrounding whitespace on the configured public URL is stripped', () => {
  assert.equal(normalizedBaseUrl('  https://example.org  '), 'https://example.org');
  assert.equal(normalizedBaseUrl('\thttps://example.org/\n'), 'https://example.org');
});

test('a padded public URL still produces a correct sitemap base', () => {
  const xml = buildSitemapXml({ publicUrl: '  https://example.org/  ', pages: PAGES, features: FEATURES });
  assert.match(xml, /<loc>https:\/\/example\.org\/<\/loc>/);
  assert.doesNotMatch(xml, / +https/);
});

test('a public URL carrying a path is preserved, query and hash are dropped', () => {
  assert.equal(normalizedBaseUrl('https://example.org/site/?x=1#y'), 'https://example.org/site');
});

test('a value that is not a parseable URL still gets trimmed and trailing-slash-stripped', () => {
  assert.equal(normalizedBaseUrl('  not a url/  '), 'not a url');
});

test('an empty or non-string public URL normalizes to an empty base', () => {
  assert.equal(normalizedBaseUrl(''), '');
  assert.equal(normalizedBaseUrl('   '), '');
  assert.equal(normalizedBaseUrl(undefined), '');
  assert.equal(normalizedBaseUrl(null), '');
});

// --- buildRobotsTxt ----------------------------------------------------------

test('robots.txt names the hidden page, the flag-off system page, and the attendee route, exact-path anchored', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(robots, /^Disallow: \/secret\$$/m);
  assert.match(robots, /^Disallow: \/updates\$$/m);
  assert.match(robots, /^Disallow: \/attendees\$$/m);
  assert.match(robots, /^Disallow: \/admin\$$/m);
});

test('robots.txt names every non-token static private route, exact-path anchored', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  for (const path of ['/signin', '/profile', '/schedule/mine', '/speaker/profile']) {
    assert.match(robots, new RegExp(`^Disallow: ${path.replace(/\//g, '\\/')}\\$$`, 'm'), path);
  }
});

test('a token-bearing route is disallowed as an unanchored prefix, not an anchored exact path', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(robots, /^Disallow: \/speaker\/accept$/m);
  assert.match(robots, /^Disallow: \/ticket\/claim$/m);
  // Never the anchored form — it would refuse to match the real,
  // token-bearing URL these rules exist to keep out of a search index.
  assert.doesNotMatch(robots, /^Disallow: \/speaker\/accept\$$/m);
  assert.doesNotMatch(robots, /^Disallow: \/ticket\/claim\$$/m);
});

test('the unanchored token-route rule matches the real query-bearing URL it is meant to block', () => {
  // functions/src/speakers/inviteTokens.cjs builds exactly this shape.
  const realUrl = '/speaker/accept?token=abc123XYZ';
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  const rule = robots.split('\n').find((line) => line.startsWith('Disallow: /speaker/accept'));
  assert.ok(rule, 'a /speaker/accept disallow rule must exist');
  const value = rule.slice('Disallow: '.length);
  // robots.txt disallow matching is a plain prefix test over path+query
  // (Google's spec) unless the rule ends in $ — this asserts the actual
  // matching behavior the unanchored fix depends on.
  assert.ok(realUrl.startsWith(value), `${JSON.stringify(value)} must be a prefix of ${realUrl}`);
});

test('a route with children also gets a subtree wildcard rule', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(robots, /^Disallow: \/admin\/\*$/m);
  assert.match(robots, /^Disallow: \/updates\/\*$/m);
  assert.match(robots, /^Disallow: \/attendees\/\*$/m);
});

test('a childless excluded route gets no subtree wildcard rule', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.doesNotMatch(robots, /^Disallow: \/secret\/\*$/m);
  assert.doesNotMatch(robots, /^Disallow: \/signin\/\*$/m);
});

test('a hidden home page is disallowed as the exact root, never as a bare prefix that blocks the whole site', () => {
  const withHiddenHome = PAGES.map((p) => (p.id === 'home' ? { ...p, visible: false } : p));
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: withHiddenHome, features: FEATURES });
  assert.match(robots, /^Disallow: \/\$$/m);
  // Never the unanchored form — that would read as "disallow everything".
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
});

test('robots.txt allows the site by default and names its sitemap', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/example\.org\/sitemap\.xml$/m);
});

test('robots.txt never disallows a public route', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.doesNotMatch(robots, /^Disallow: \/travel\$$/m);
  assert.doesNotMatch(robots, /^Disallow: \/schedule\$$/m);
  assert.doesNotMatch(robots, /^Disallow: \/\$$/m);
});

test('an anchored disallow rule does not also block a look-alike sibling path', () => {
  // The whole point of the $ anchor: /travel must not shadow /travel-guide.
  const withGuide = [...PAGES, page({ id: 'travel-guide', path: '/travel-guide', visible: false })];
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: withGuide, features: FEATURES });
  assert.match(robots, /^Disallow: \/travel-guide\$$/m);
  // /travel itself stays public and undisallowed.
  assert.doesNotMatch(robots, /^Disallow: \/travel\$$/m);
});

// --- buildSessionRoutes / buildSpeakerRoutes / buildUpdateRoutes ------------
//
// Each is gated on `parentPublic` alone — whether the parent cmsPages page
// (schedule/speakers/updates) is itself classified public, which already
// folds in the feature flag (classifyPage's `publishable`). See the
// "parent page classification" section below for the visible:false case
// this is specifically about.

test('buildSessionRoutes lists a published session and drops a draft one', () => {
  const sessions = [
    { id: 'keynote', visible: true },
    { id: 'draft-session', visible: false },
  ];
  const routes = buildSessionRoutes({ sessions, parentPublic: true });
  assert.deepEqual(routes, [{ id: 'keynote', path: '/schedule/keynote' }]);
});

test('buildSessionRoutes lists nothing while the parent page is not public', () => {
  const sessions = [{ id: 'keynote', visible: true }];
  const routes = buildSessionRoutes({ sessions, parentPublic: false });
  assert.deepEqual(routes, []);
});

test('buildSessionRoutes drops the reserved id "mine" — App.jsx routes /schedule/mine to the personal schedule', () => {
  const sessions = [
    { id: 'keynote', visible: true },
    { id: 'mine', visible: true },
  ];
  const routes = buildSessionRoutes({ sessions, parentPublic: true });
  assert.deepEqual(routes, [{ id: 'keynote', path: '/schedule/keynote' }]);
});

test('buildSpeakerRoutes lists an approved speaker by slug', () => {
  const speakers = [{ slug: 'rae-okonkwo' }];
  const routes = buildSpeakerRoutes({ speakers, parentPublic: true });
  assert.deepEqual(routes, [{ id: 'rae-okonkwo', path: '/speakers/rae-okonkwo' }]);
});

test('buildSpeakerRoutes lists nothing while the parent page is not public', () => {
  const speakers = [{ slug: 'rae-okonkwo' }];
  const routes = buildSpeakerRoutes({ speakers, parentPublic: false });
  assert.deepEqual(routes, []);
});

test('buildSpeakerRoutes drops a projection entry with no slug rather than emit a broken URL', () => {
  const speakers = [{ slug: 'rae-okonkwo' }, { firstName: 'No Slug' }];
  const routes = buildSpeakerRoutes({ speakers, parentPublic: true });
  assert.deepEqual(routes, [{ id: 'rae-okonkwo', path: '/speakers/rae-okonkwo' }]);
});

test('buildUpdateRoutes lists a published update and drops a draft one', () => {
  const updates = [
    { id: 'week-one', visible: true },
    { id: 'draft-update', visible: false },
  ];
  const routes = buildUpdateRoutes({ updates, parentPublic: true });
  assert.deepEqual(routes, [{ id: 'week-one', path: '/updates/week-one' }]);
});

test('buildUpdateRoutes lists nothing while the parent page is not public', () => {
  const updates = [{ id: 'week-one', visible: true }];
  const routes = buildUpdateRoutes({ updates, parentPublic: false });
  assert.deepEqual(routes, []);
});

test('the sitemap includes published session, speaker, and update detail routes', () => {
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL,
    pages: PAGES,
    features: { ...FEATURES, updates: true },
    sessions: [{ id: 'keynote', visible: true }, { id: 'draft', visible: false }],
    speakers: [{ slug: 'rae-okonkwo' }],
    updates: [{ id: 'week-one', visible: true }, { id: 'draft-update', visible: false }],
  });
  assert.match(xml, /<loc>https:\/\/example\.org\/schedule\/keynote<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.org\/speakers\/rae-okonkwo<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.org\/updates\/week-one<\/loc>/);
  assert.doesNotMatch(xml, /\/schedule\/draft</);
  assert.doesNotMatch(xml, /\/updates\/draft-update</);
});

test('the sitemap never lists a session whose id is the reserved "mine"', () => {
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL,
    pages: PAGES,
    features: FEATURES,
    sessions: [{ id: 'keynote', visible: true }, { id: 'mine', visible: true }],
  });
  assert.match(xml, /\/schedule\/keynote</);
  assert.doesNotMatch(xml, /\/schedule\/mine</);
});

// --- parent page classification gates the detail families -------------------

test('a session detail route is excluded once its parent schedule page is hidden, even with the feature on', () => {
  const hiddenSchedule = PAGES.map((p) => (p.id === 'schedule' ? { ...p, visible: false } : p));
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL,
    pages: hiddenSchedule,
    features: FEATURES,
    sessions: [{ id: 'keynote', visible: true }],
  });
  assert.doesNotMatch(xml, /\/schedule\/keynote</);
  // robots.txt agrees: the whole /schedule subtree is disallowed, so the
  // sitemap must never contradict that by listing a page under it.
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: hiddenSchedule, features: FEATURES });
  assert.match(robots, /^Disallow: \/schedule\/\*$/m);
});

test('a speaker detail route is excluded once its parent speakers page is hidden, even with the feature on', () => {
  const hiddenSpeakers = PAGES.map((p) => (p.id === 'speakers' ? { ...p, visible: false } : p));
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL,
    pages: hiddenSpeakers,
    features: FEATURES,
    speakers: [{ slug: 'rae-okonkwo' }],
  });
  assert.doesNotMatch(xml, /\/speakers\/rae-okonkwo</);
});

test('an update detail route is excluded once its parent updates page is hidden, even with the feature on', () => {
  const hiddenUpdates = PAGES.map((p) => (p.id === 'updates' ? { ...p, visible: false } : p));
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL,
    pages: hiddenUpdates,
    features: { ...FEATURES, updates: true },
    updates: [{ id: 'week-one', visible: true }],
  });
  assert.doesNotMatch(xml, /\/updates\/week-one</);
});

test('a session detail route is still listed once the schedule page is visible and its feature is on', () => {
  const xml = buildSitemapXml({
    publicUrl: PUBLIC_URL,
    pages: PAGES,
    features: FEATURES,
    sessions: [{ id: 'keynote', visible: true }],
  });
  assert.match(xml, /\/schedule\/keynote</);
});

// --- buildWebManifest ---------------------------------------------------------

test('the manifest carries the event name, short name, and tagline', () => {
  const manifest = buildWebManifest({
    event: { name: 'Harborlight Summit', shortName: 'HARBOR', tagline: 'A three-day event.' },
    theme: {},
  });
  assert.equal(manifest.name, 'Harborlight Summit');
  assert.equal(manifest.short_name, 'HARBOR');
  assert.equal(manifest.description, 'A three-day event.');
  assert.equal(manifest.display, 'standalone');
});

test('start_url and scope are manifest-relative, not origin-root — the manifest resolves them against its own URL', () => {
  const manifest = buildWebManifest({ event: { name: 'x', shortName: 'x' }, theme: {} });
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  // Never origin-root: that breaks the moment the manifest is not served
  // from the domain root, which the demo (/eventrunner/demo/) never is.
  assert.notEqual(manifest.start_url, '/');
  assert.notEqual(manifest.scope, '/');
});

test('the manifest icons reuse the committed branding slots, as manifest-relative paths', () => {
  const manifest = buildWebManifest({ event: { name: 'x', shortName: 'x' }, theme: {} });
  assert.ok(manifest.icons.some((icon) => icon.src === 'branding/mark.svg'));
  assert.ok(manifest.icons.some((icon) => icon.src === 'branding/favicon.svg'));
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/svg+xml');
    assert.equal(icon.src.startsWith('/'), false, `${icon.src} must not be origin-root-relative`);
  }
});

test('theme_color and background_color are set only when the event has configured them', () => {
  const unconfigured = buildWebManifest({ event: { name: 'x', shortName: 'x' }, theme: {} });
  assert.equal('theme_color' in unconfigured, false);
  assert.equal('background_color' in unconfigured, false);

  const configured = buildWebManifest({
    event: { name: 'x', shortName: 'x' },
    theme: { colors: { primary: 'rgb(20, 40, 60)', surface: 'rgb(250, 250, 250)' } },
  });
  assert.equal(configured.theme_color, 'rgb(20, 40, 60)');
  assert.equal(configured.background_color, 'rgb(250, 250, 250)');
});

test('a missing event name and short name still produce a valid, event-neutral manifest', () => {
  const manifest = buildWebManifest({ event: {}, theme: {} });
  assert.equal(manifest.name, 'Event site');
  assert.equal(manifest.short_name, 'Event');
  assert.equal('description' in manifest, false);
});

// --- the checked-in fallback manifest (apps/web/public/manifest.webmanifest) -

test('the checked-in fallback manifest matches the neutral shape buildWebManifest produces', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fallbackPath = path.join(__dirname, '..', '..', 'apps', 'web', 'public', 'manifest.webmanifest');
  const fallback = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  const neutral = buildWebManifest({ event: {}, theme: {} });
  assert.deepEqual(fallback, neutral);
});

// --- buildSiteArtifacts -------------------------------------------------------

test('buildSiteArtifacts produces all three files from one read', () => {
  const { sitemapXml, robotsTxt, manifest } = buildSiteArtifacts({
    event: { name: 'Harborlight Summit', shortName: 'HARBOR' },
    features: FEATURES,
    theme: {},
    pages: PAGES,
    publicUrl: PUBLIC_URL,
  });
  assert.match(sitemapXml, /<urlset/);
  assert.match(robotsTxt, /User-agent: \*/);
  assert.equal(manifest.name, 'Harborlight Summit');
});
