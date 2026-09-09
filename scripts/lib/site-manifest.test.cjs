'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyPage,
  classifyPages,
  buildSitemapXml,
  buildRobotsTxt,
  buildWebManifest,
  buildSiteArtifacts,
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
  // The static admin route carries no page id.
  assert.ok(excluded.some((r) => r.path === '/admin' && r.id === null && r.access === 'admin'));
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

test('a page label containing XML-sensitive characters cannot break the document', () => {
  const withAmp = [...PAGES, page({ id: 'q-and-a', path: '/q&a' })];
  const xml = buildSitemapXml({ publicUrl: PUBLIC_URL, pages: withAmp, features: FEATURES });
  assert.match(xml, /q&amp;a/);
  assert.doesNotMatch(xml, /q&a</);
});

// --- buildRobotsTxt ----------------------------------------------------------

test('robots.txt names the hidden page, the flag-off system page, and the attendee route as disallowed', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(robots, /^Disallow: \/secret$/m);
  assert.match(robots, /^Disallow: \/updates$/m);
  assert.match(robots, /^Disallow: \/attendees$/m);
  assert.match(robots, /^Disallow: \/admin$/m);
});

test('robots.txt allows the site by default and names its sitemap', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/example\.org\/sitemap\.xml$/m);
});

test('robots.txt never disallows a public route', () => {
  const robots = buildRobotsTxt({ publicUrl: PUBLIC_URL, pages: PAGES, features: FEATURES });
  assert.doesNotMatch(robots, /^Disallow: \/travel$/m);
  assert.doesNotMatch(robots, /^Disallow: \/schedule$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
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
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
});

test('the manifest icons reuse the committed branding slots', () => {
  const manifest = buildWebManifest({ event: { name: 'x', shortName: 'x' }, theme: {} });
  assert.ok(manifest.icons.some((icon) => icon.src === '/branding/mark.svg'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/branding/favicon.svg'));
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/svg+xml');
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
