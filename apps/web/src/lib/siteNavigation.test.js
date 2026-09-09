// The navigation is built from page documents, so most of what is asserted
// here is what happens to data an operator can actually produce: a hidden
// page, a page with no order, a system page whose feature is off, and the
// hand-edited shapes the validator would refuse today but Firestore still
// holds.
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_FEATURE_KEYS } from 'shared/config';
import { RESERVED_PATH_SEGMENTS, firstPathSegment } from 'shared/routing';
import { SYSTEM_PAGE_FEATURES, buildNavItems } from './siteNavigation.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const APP_JSX = nodePath.join(here, '..', 'App.jsx');

/**
 * Every route App.jsx statically mounts, as an absolute path.
 *
 * Read out of the source rather than imported, because the list lives in JSX
 * that only React can evaluate — and reading it is the whole point: three
 * lists kept by hand (the routes, SYSTEM_PAGE_FEATURES, and
 * RESERVED_PATH_SEGMENTS) are exactly what drifts, silently, the next time
 * someone adds a route.
 *
 * `<Route index>` is the home page and carries no `path`, so '/' is added
 * here. `admin/*` is a subtree: the splat is dropped and the prefix stands.
 * The bare `*` is the catch-all, which is not a mounted route at all — it is
 * what ContentPage renders when none of these matched.
 */
function mountedRoutes() {
  const source = fs.readFileSync(APP_JSX, 'utf8');
  const declared = [...source.matchAll(/path="([^"]+)"/g)].map((match) => match[1]);
  const routes = declared
    .filter((route) => route !== '*')
    .map((route) => `/${route.replace(/\/\*$/, '')}`);
  return ['/', ...routes];
}

const HOME = { id: 'home', label: 'Home page', path: '/', order: 0, visible: true, systemPage: true };
const SCHEDULE = { id: 'schedule', label: 'Schedule', path: '/schedule', order: 1, visible: true, systemPage: true };
const TRAVEL = { id: 'travel', label: 'Travel and venue', path: '/travel', order: 4, visible: true, systemPage: false };

const ALL_ON = Object.freeze({
  schedule: true,
  speakers: true,
  sponsors: true,
  attendeeDirectory: true,
  updates: true,
});

const labels = (items) => items.map((item) => item.label);
const paths = (items) => items.map((item) => item.to);

describe('the system page routes', () => {
  it('names a feature for every system route except the home page', () => {
    expect(SYSTEM_PAGE_FEATURES['/']).toBeNull();
    for (const [routePath, feature] of Object.entries(SYSTEM_PAGE_FEATURES)) {
      if (routePath === '/') continue;
      expect(typeof feature).toBe('string');
    }
  });

  // A typo'd flag name would read as `undefined`, which is falsy, which
  // would hide the page for every deployment with no way to tell why. Pin
  // the map to the flags config/features actually accepts.
  it('gates only on flags config/features knows', () => {
    for (const feature of Object.values(SYSTEM_PAGE_FEATURES)) {
      if (feature === null) continue;
      expect(KNOWN_FEATURE_KEYS).toContain(feature);
    }
  });

  // Every key here becomes an <a href>. A key App.jsx does not mount is a
  // link into the catch-all, and the catch-all 404s a system page — the same
  // dead end buildNavItems drops hand-edited data to avoid, arrived at
  // through code instead of through data.
  it('names only routes App.jsx actually mounts', () => {
    const mounted = mountedRoutes();
    expect(mounted).toContain('/');
    for (const routePath of Object.keys(SYSTEM_PAGE_FEATURES)) {
      expect(mounted).toContain(routePath);
    }
  });

  // The other direction, one list further out: a statically mounted route
  // owns its first segment outright, so a generic page must never be able to
  // claim it. RESERVED_PATH_SEGMENTS is what enforces that — on write in
  // functions/src/cms/pages.cjs, and in both renderers — and nothing but
  // this test notices a new route landing without its segment being added.
  it('leaves no mounted route segment out of RESERVED_PATH_SEGMENTS', () => {
    const segments = [...new Set(mountedRoutes().map(firstPathSegment))].filter(Boolean);
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(RESERVED_PATH_SEGMENTS).toContain(segment);
    }
  });
});

describe('buildNavItems', () => {
  it('lists a seeded content page and not a hidden one', () => {
    const items = buildNavItems(
      [HOME, TRAVEL, { ...TRAVEL, id: 'draft', label: 'Draft page', path: '/draft', order: 5, visible: false }],
      ALL_ON,
    );
    expect(labels(items)).toEqual(['Home page', 'Travel and venue']);
  });

  it('orders by the page order field, not by document order', () => {
    const items = buildNavItems([TRAVEL, HOME, SCHEDULE], ALL_ON);
    expect(paths(items)).toEqual(['/', '/schedule', '/travel']);
  });

  it('reads a page with no order as first, then breaks ties by label', () => {
    const items = buildNavItems(
      [
        { id: 'b', label: 'Beta', path: '/beta', visible: true },
        { id: 'a', label: 'Alpha', path: '/alpha', visible: true },
        HOME,
      ],
      ALL_ON,
    );
    expect(paths(items)).toEqual(['/alpha', '/beta', '/']);
  });

  it('drops a system page whose feature is off and keeps content pages', () => {
    const items = buildNavItems([HOME, SCHEDULE, TRAVEL], { ...ALL_ON, schedule: false });
    expect(paths(items)).toEqual(['/', '/travel']);
  });

  it('treats a missing features map as every feature off', () => {
    expect(paths(buildNavItems([HOME, SCHEDULE, TRAVEL], undefined))).toEqual(['/', '/travel']);
  });

  it('ends the match on the home page only', () => {
    const items = buildNavItems([HOME, SCHEDULE], ALL_ON);
    expect(items.find((item) => item.to === '/').end).toBe(true);
    expect(items.find((item) => item.to === '/schedule').end).toBe(false);
  });

  it('drops a system page whose path is not a route the app mounts', () => {
    // Hand-edited data: systemPage true with a path no <Route> owns. The
    // catch-all renders NotFound for it, so a link would be a dead end.
    const items = buildNavItems([HOME, { ...SCHEDULE, id: 'ghost', path: '/ghost' }], ALL_ON);
    expect(paths(items)).toEqual(['/']);
  });

  it('drops a content page parked on a reserved segment', () => {
    // Pre-#52 or hand-edited: ContentPage 404s these, so the nav must not
    // offer them (apps/web/src/pages/ContentPage.jsx).
    const items = buildNavItems([HOME, { ...TRAVEL, id: 'old', path: '/p/faq' }], ALL_ON);
    expect(paths(items)).toEqual(['/']);
  });

  it('drops a page with no usable label or path', () => {
    const items = buildNavItems(
      [
        HOME,
        { id: 'nolabel', label: '   ', path: '/nolabel', visible: true },
        { id: 'nopath', label: 'No path', path: '', visible: true },
        { id: 'relative', label: 'Relative', path: 'travel', visible: true },
        null,
      ],
      ALL_ON,
    );
    expect(paths(items)).toEqual(['/']);
  });

  it('keeps one item per path when two documents claim the same route', () => {
    const items = buildNavItems(
      [HOME, { ...TRAVEL, id: 'copy', label: 'Copy', order: 9 }, TRAVEL],
      ALL_ON,
    );
    // One link, and it is the first of the two in reading order.
    expect(paths(items)).toEqual(['/', '/travel']);
    expect(labels(items)).toEqual(['Home page', 'Travel and venue']);
  });

  it('returns an empty list for no pages at all', () => {
    expect(buildNavItems([], ALL_ON)).toEqual([]);
    expect(buildNavItems(undefined, ALL_ON)).toEqual([]);
  });

  it('lists every seeded public page a fresh deployment ships', () => {
    const seeded = [
      HOME,
      SCHEDULE,
      { id: 'speakers', label: 'Speakers', path: '/speakers', order: 2, visible: true, systemPage: true },
      { id: 'sponsors', label: 'Sponsors', path: '/sponsors', order: 3, visible: true, systemPage: true },
      TRAVEL,
      { id: 'faq', label: 'Frequently asked questions', path: '/faq', order: 5, visible: true, systemPage: false },
      { id: 'conduct', label: 'Code of conduct', path: '/conduct', order: 6, visible: true, systemPage: false },
      { id: 'contact', label: 'Contact', path: '/contact', order: 7, visible: true, systemPage: false },
      { id: 'privacy', label: 'Privacy policy', path: '/privacy', order: 8, visible: true, systemPage: false },
      { id: 'terms', label: 'Terms of service', path: '/terms', order: 9, visible: true, systemPage: false },
      { id: 'attendees', label: 'Attendees', path: '/attendees', order: 10, visible: true, systemPage: true },
      { id: 'updates', label: 'Updates', path: '/updates', order: 11, visible: true, systemPage: true },
    ];
    // The seed ships `features.updates` off, so the seeded Updates page is
    // present as a document and absent from the navigation.
    const items = buildNavItems(seeded, ALL_ON);
    expect(paths(items)).toContain('/travel');
    expect(paths(items)).toContain('/faq');
    expect(paths(items)).toContain('/conduct');
    expect(paths(items)).toContain('/contact');
    expect(paths(items)).toContain('/privacy');
    expect(paths(items)).toContain('/terms');
    expect(paths(buildNavItems(seeded, { ...ALL_ON, updates: false }))).not.toContain('/updates');
  });
});
