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
import { isPublicPage } from 'shared/page';
import { SYSTEM_PAGES, buildNavItems } from './siteNavigation.js';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const APP_JSX = nodePath.join(here, '..', 'App.jsx');

/**
 * Every route App.jsx statically mounts, as an absolute path.
 *
 * Read out of the source rather than imported, because the list lives in JSX
 * that only React can evaluate — and reading it is the whole point: three
 * lists kept by hand (the routes, SYSTEM_PAGES, and RESERVED_PATH_SEGMENTS)
 * are exactly what drifts, silently, the next time someone adds a route.
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

const HOME = { id: 'home', label: 'Home', path: '/', order: 0, visible: true, systemPage: true };
const SCHEDULE = { id: 'schedule', label: 'Schedule', path: '/schedule', order: 1, visible: true, systemPage: true };
const TRAVEL = { id: 'travel', label: 'Travel', path: '/travel', order: 4, visible: true, systemPage: false };

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
  it('is keyed by the seeded document id, never by an editable path', () => {
    // The whole point of keying by id: the key is the document's identity,
    // which nothing in the editor can change, while `path` on a system page
    // is a copy of a fact that lives in App.jsx.
    for (const [id, system] of Object.entries(SYSTEM_PAGES)) {
      expect(id).toMatch(/^[a-z]+$/);
      expect(system.to.startsWith('/')).toBe(true);
      expect(typeof system.children).toBe('boolean');
    }
  });

  it('names a feature for every system page except the home page', () => {
    expect(SYSTEM_PAGES.home.feature).toBeNull();
    for (const [id, system] of Object.entries(SYSTEM_PAGES)) {
      if (id === 'home') continue;
      expect(typeof system.feature).toBe('string');
    }
  });

  // A typo'd flag name would read as `undefined`, which is falsy, which
  // would hide the page for every deployment with no way to tell why. Pin
  // the map to the flags config/features actually accepts.
  it('gates only on flags config/features knows', () => {
    for (const system of Object.values(SYSTEM_PAGES)) {
      if (system.feature === null) continue;
      expect(KNOWN_FEATURE_KEYS).toContain(system.feature);
    }
  });

  // Every route here becomes an <a href>. A route App.jsx does not mount is
  // a link into the catch-all, and the catch-all 404s a system page — the
  // same dead end buildNavItems drops hand-edited data to avoid, arrived at
  // through code instead of through data.
  it('names only routes App.jsx actually mounts', () => {
    const mounted = mountedRoutes();
    expect(mounted).toContain('/');
    for (const system of Object.values(SYSTEM_PAGES)) {
      expect(mounted).toContain(system.to);
    }
  });

  // `children` decides whether the item keeps prefix matching, so a wrong
  // answer either loses the marker inside a section or marks two items at
  // once. Read the child routes out of App.jsx rather than trusting the map.
  it('marks a route as having children only when App.jsx mounts some', () => {
    const mounted = mountedRoutes();
    for (const system of Object.values(SYSTEM_PAGES)) {
      const hasChildren = mounted.some(
        (route) => route !== system.to && route.startsWith(`${system.to}/`),
      );
      expect(system.children).toBe(hasChildren);
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
    expect(labels(items)).toEqual(['Home', 'Travel']);
  });

  it('links exactly the pages the shared predicate calls public', () => {
    // One rule, three readers: this list, the sitemap
    // (scripts/lib/site-manifest.cjs), and the route metadata the server
    // writes for a link unfurler (functions/src/public/og.cjs). A page
    // linked here but absent from the sitemap, or described in a card and
    // then 404ing, is those three disagreeing.
    const pages = [
      HOME,
      SCHEDULE,
      TRAVEL,
      { ...TRAVEL, id: 'draft', label: 'Draft', path: '/draft', order: 5, visible: false },
      { id: 'updates', label: 'Updates', path: '/updates', order: 6, visible: true, systemPage: true },
    ];
    const features = { ...ALL_ON, updates: false };
    const linked = new Set(paths(buildNavItems(pages, features)));
    for (const page of pages) {
      const expected = isPublicPage(page, features);
      expect(linked.has(page.path)).toBe(expected);
    }
  });

  it('drops a page that never stated whether it is visible', () => {
    // The shared contract is `visible === true`, not `!== false`: a
    // document mid-write or hand-written straight into Firestore must not
    // read as published anywhere — and the sitemap and the server already
    // read it that way, so the navigation was the odd one out.
    const stateless = { id: 'about', label: 'About', path: '/about', order: 1 };
    expect(isPublicPage(stateless, ALL_ON)).toBe(false);
    expect(paths(buildNavItems([HOME, stateless], ALL_ON))).toEqual(['/']);
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

  // Prefix matching belongs only to a route that owns children, because
  // that is the only case where the reader is genuinely still inside the
  // section. Everywhere else it marks two items at once, which tells a
  // screen reader the reader is in two places.
  it('keeps prefix matching for a section with child routes', () => {
    const items = buildNavItems([HOME, SCHEDULE], ALL_ON);
    expect(items.find((item) => item.to === '/').end).toBe(true);
    expect(items.find((item) => item.to === '/schedule').end).toBe(false);
  });

  it('matches a generic page exactly, so a nested pair never both mark', () => {
    const items = buildNavItems(
      [
        { id: 'about', label: 'About', path: '/about', order: 1, visible: true, systemPage: false },
        { id: 'team', label: 'Team', path: '/about/team', order: 2, visible: true, systemPage: false },
      ],
      ALL_ON,
    );
    expect(paths(items)).toEqual(['/about', '/about/team']);
    expect(items.every((item) => item.end)).toBe(true);
  });

  it('matches a system page with no child routes exactly too', () => {
    const sponsors = { id: 'sponsors', label: 'Sponsors', path: '/sponsors', order: 3, visible: true, systemPage: true };
    const [item] = buildNavItems([sponsors], ALL_ON);
    expect(item.end).toBe(true);
  });

  // The defect this replaced: SYSTEM_PAGE_FEATURES was keyed by path, so a
  // system page whose Path an operator had edited fell out of the
  // navigation while App.jsx went on mounting /schedule.
  it('links a system page to its mounted route whatever its stored path says', () => {
    const items = buildNavItems([HOME, { ...SCHEDULE, path: '/agenda' }], ALL_ON);
    expect(paths(items)).toEqual(['/', '/schedule']);
    // And the label is still the operator's.
    expect(labels(items)).toEqual(['Home', 'Schedule']);
  });

  it('takes the label a renamed system page carries', () => {
    const items = buildNavItems([{ ...SCHEDULE, label: 'Programme' }], ALL_ON);
    expect(labels(items)).toEqual(['Programme']);
  });

  it('drops a system page whose id names no mounted route', () => {
    // Hand-written data: systemPage true with an id nothing answers to.
    const items = buildNavItems([HOME, { ...SCHEDULE, id: 'ghost', path: '/ghost' }], ALL_ON);
    expect(paths(items)).toEqual(['/']);
  });

  it('drops a content page parked on a reserved segment', () => {
    // Pre-#52 or hand-edited: ContentPage 404s these, so the nav must not
    // offer them (apps/web/src/pages/ContentPage.jsx).
    const items = buildNavItems([HOME, { ...TRAVEL, id: 'old', path: '/p/faq' }], ALL_ON);
    expect(paths(items)).toEqual(['/']);
  });

  // A value that is not a path is not a cosmetic problem: rendered into an
  // href it takes the reader off the site, from inside the site's own
  // navigation. Neither shape can be saved through the editor; both can sit
  // in Firestore.
  it('drops a page whose path points at another origin', () => {
    const items = buildNavItems(
      [
        HOME,
        { id: 'protorel', label: 'Protocol relative', path: '//example.org', visible: true },
        { id: 'protorel2', label: 'Protocol relative deep', path: '//example.org/travel', visible: true },
        { id: 'absolute', label: 'Absolute', path: 'https://example.org', visible: true },
        { id: 'scheme', label: 'Scheme', path: 'javascript:alert(1)', visible: true },
      ],
      ALL_ON,
    );
    expect(paths(items)).toEqual(['/']);
  });

  it('drops a page with no usable label or path', () => {
    const items = buildNavItems(
      [
        HOME,
        { id: 'nolabel', label: '   ', path: '/nolabel', visible: true },
        { id: 'nopath', label: 'No path', path: '', visible: true },
        { id: 'relative', label: 'Relative', path: 'travel', visible: true },
        { id: 'trailing', label: 'Trailing', path: '/travel/', visible: true },
        { id: 'spaced', label: 'Spaced', path: '/tra vel', visible: true },
        { id: 'shouty', label: 'Shouty', path: '/Travel', visible: true },
        // '/' belongs to the home route; a generic page there would link to
        // the home page, not to itself.
        { id: 'root', label: 'Root', path: '/', visible: true, systemPage: false },
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
    expect(labels(items)).toEqual(['Home', 'Travel']);
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
      { id: 'faq', label: 'FAQ', path: '/faq', order: 5, visible: true, systemPage: false },
      { id: 'conduct', label: 'Conduct', path: '/conduct', order: 6, visible: true, systemPage: false },
      { id: 'contact', label: 'Contact', path: '/contact', order: 7, visible: true, systemPage: false },
      { id: 'privacy', label: 'Privacy', path: '/privacy', order: 8, visible: true, systemPage: false },
      { id: 'terms', label: 'Terms', path: '/terms', order: 9, visible: true, systemPage: false },
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
