// The shell: the header the active theme names (design brief §2.1) and the
// branding slot (issue #24 review follow-up).
//
// config/theme.logos holds two shapes and they do not resolve the same way:
// a seeded flat path also ships in the bundle and is served Hosting-relative,
// while an asset picked in the admin Branding tab exists ONLY in the bucket —
// serving that Hosting-relative (what the shell did before the media library)
// 404s the header logo. A value that is not a usable path, or an object that
// has since been deleted, must degrade to the wordmark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FOCUS_RING_ATTRIBUTE } from '../lib/scrollToTop.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// jsdom applies no CSS, so a rule the shell depends on is asserted against
// the stylesheet itself (the device components/editorial/stamp.test.js uses).
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');

let theme;
let eventConfig;
let page;
let features;
let pages;
let authUser;
let authLoading;

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({
    eventConfig,
    features,
    theme,
  }),
}));
// The shell reads the current URL's page document for the two layout
// variants it owns: which nameplate treatment the page takes, and where its
// navigation sits (brief §6.1). A route with no document keeps the shell's
// own rule, which is what these tests render unless they set one.
// The shell also reads the whole page list: the navigation IS that list
// (lib/siteNavigation.js), so a test that wants nav items supplies pages.
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    pages,
    getPage: (key) => (page && page.path === key ? page : null),
  }),
}));
// The account control at the end of the nav is the one item that depends on
// who is reading (M7 issue 2), so the shell reads the auth state too.
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: authUser, loading: authLoading }),
}));

const { default: Layout } = await import('./Layout.jsx');

const FIXTURE_EVENT = {
  name: '[Fixture] Example Conference 2027',
  shortName: 'EX2027',
  timezone: 'America/New_York',
  days: [{ id: 'd1', date: '2027-04-12' }, { id: 'd2', date: '2027-04-14' }],
  venue: { name: '[Fixture] Hall', city: 'Fixtureville', region: 'FX' },
  legal: {},
};

// The pages a seeded deployment ships, trimmed to what the shell reads.
const FIXTURE_PAGES = [
  { id: 'home', label: 'Home', path: '/', order: 0, visible: true, systemPage: true },
  { id: 'schedule', label: 'Schedule', path: '/schedule', order: 1, visible: true, systemPage: true },
  { id: 'travel', label: 'Travel', path: '/travel', order: 4, visible: true, systemPage: false },
  { id: 'faq', label: 'FAQ', path: '/faq', order: 5, visible: true, systemPage: false },
];

const FIXTURE_FEATURES = { schedule: true };

function renderShell(
  logos,
  {
    path = '/',
    event = FIXTURE_EVENT,
    pageDoc = null,
    themeDoc = null,
    header,
    pageDocs = FIXTURE_PAGES,
    featureFlags = FIXTURE_FEATURES,
    user = null,
    loading = false,
  } = {},
) {
  theme = { logos, header, ...themeDoc };
  eventConfig = event;
  page = pageDoc;
  pages = pageDocs;
  features = featureFlags;
  authUser = user;
  authLoading = loading;
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Layout />
    </MemoryRouter>,
  );
}

describe('Layout branding mark', () => {
  it('serves a seeded flat path from the bundle', () => {
    const { container } = renderShell({ mark: 'branding/mark.svg' });
    expect(container.querySelector('header img')).toHaveAttribute('src', '/branding/mark.svg');
  });

  it('serves an uploaded asset from Storage', () => {
    const { container } = renderShell({ mark: 'branding/abc123/mark.png' });
    const src = container.querySelector('header img').getAttribute('src');
    expect(src).toContain('firebasestorage.googleapis.com');
    expect(src).toContain(encodeURIComponent('branding/abc123/mark.png'));
  });

  it('renders no logo at all for a malformed runtime value', () => {
    const { container } = renderShell(
      { mark: { url: 'branding/mark.svg' } },
      { path: '/schedule' },
    );
    expect(container.querySelector('header img')).toBeNull();
    expect(container.querySelector('header').textContent).toContain(
      '[Fixture] Example Conference 2027',
    );
  });

  it('degrades to the wordmark when the object is gone from the bucket', () => {
    const { container } = renderShell(
      { mark: 'branding/abc123/deleted.png' },
      { path: '/schedule' },
    );
    fireEvent.error(container.querySelector('header img'));
    expect(container.querySelector('header img')).toBeNull();
    expect(container.querySelector('header').textContent).toContain(
      '[Fixture] Example Conference 2027',
    );
  });
});

describe('Layout header', () => {
  it('takes the base header when the theme names none', () => {
    const { container } = renderShell({});
    const header = container.querySelector('header');
    expect(header.querySelector('.nameplate')).toBeNull();
    expect(header.textContent).toContain('[Fixture] Example Conference 2027');
    expect(header.textContent).toContain('April 12–14, 2027');
    expect(header.textContent).toContain('Fixtureville, FX');
  });

  it('takes the header the theme names, on every page alike', () => {
    for (const path of ['/', '/schedule']) {
      const { container } = renderShell({}, { path, header: 'masthead' });
      expect(container.querySelector('header .nameplate')).not.toBeNull();
    }
  });

  it('prefers the short name only for the event bar', () => {
    const { container: bar } = renderShell({}, { header: 'compact' });
    expect(bar.querySelector('header').textContent).toContain('EX2027');

    const { container: standard } = renderShell({});
    expect(standard.querySelector('header').textContent).toContain(
      '[Fixture] Example Conference 2027',
    );
  });

  it('puts no image behind the event name, whichever header renders', () => {
    for (const header of ['standard', 'masthead', 'compact', 'minimal']) {
      const { container } = renderShell({ mark: 'branding/mark.svg' }, { header });
      expect(container.querySelector('[style*="background-image"]')).toBeNull();
    }
  });

  it('leaves every page its own h1: the header identity is not a heading', () => {
    for (const path of ['/', '/schedule']) {
      const { container } = renderShell({}, { path });
      expect(container.querySelector('header h1')).toBeNull();
    }
  });

  it('marks the active nav item with weight and a rule, never a pill', () => {
    const { container } = renderShell({}, { path: '/' });
    const active = container.querySelector('nav a[aria-current="page"]');
    expect(active).toHaveClass('font-semibold', 'border-b-rule-strong');
    expect(container.querySelector('nav .rounded-full')).toBeNull();
  });

  it('renders the shell with no dateline when config/event carries no days', () => {
    const { container } = renderShell({}, { event: { shortName: 'EX2027', legal: {} } });
    expect(container.querySelector('header').textContent).toContain('EX2027');
  });
});

describe('Layout navigation (built from page documents)', () => {
  // Scoped to the main nav by its landmark label: the footer carries the
  // same page list (M7 issue 3), so a bare `nav a` would count both.
  const MAIN_NAV = 'nav[aria-label="Main"] a';
  const navLabels = (root) => [...root.querySelectorAll(MAIN_NAV)].map((a) => a.textContent);

  it('lists a seeded content page and leaves a hidden one out', () => {
    const { container } = renderShell(
      {},
      {
        pageDocs: [
          ...FIXTURE_PAGES,
          { id: 'draft', label: 'Draft page', path: '/draft', order: 6, visible: false },
        ],
      },
    );
    expect(navLabels(container)).toContain('Travel');
    expect(navLabels(container)).not.toContain('Draft page');
  });

  it('reads the labels and the order from the page documents', () => {
    const { container } = renderShell({});
    // The page documents in their own order, then the account control the
    // shell adds at the end of the list (M7 issue 2).
    expect(navLabels(container)).toEqual([
      'Home',
      'Schedule',
      'Travel',
      'FAQ',
      'Sign in',
    ]);
    expect([...container.querySelectorAll(MAIN_NAV)].map((a) => a.getAttribute('href'))).toEqual([
      '/',
      '/schedule',
      '/travel',
      '/faq',
      '/signin',
    ]);
  });

  it('still gates a system page on its feature flag', () => {
    const { container } = renderShell({}, { featureFlags: {} });
    expect(navLabels(container)).not.toContain('Schedule');
    expect(navLabels(container)).toContain('Travel');
  });

  it('marks the page in view, and only that one, on a content page', () => {
    const { container } = renderShell({}, { path: '/travel' });
    const current = [...container.querySelectorAll('nav a[aria-current="page"]')];
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe('Travel');
    expect(current[0]).toHaveClass('font-semibold', 'border-b-rule-strong');
  });

  it('keeps a system page marked on the routes below it', () => {
    const { container } = renderShell({}, { path: '/schedule/session-1' });
    const current = container.querySelector('nav a[aria-current="page"]');
    expect(current.textContent).toBe('Schedule');
  });

  // The keyboard path is the anchor itself: a real href, in document order,
  // with no tabindex overriding it. Focus is drawn by the global
  // :focus-visible rule in index.css, so there is nothing per-item to assert
  // beyond the element still being a link.
  it('gives every item a keyboard path at the full touch target size', () => {
    const { container } = renderShell({});
    for (const link of container.querySelectorAll(MAIN_NAV)) {
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href');
      expect(link.hasAttribute('tabindex')).toBe(false);
      expect(link.className).toContain('touch-target');
    }
  });

  // The nav used to disappear entirely when no page was navigable, so that a
  // deployment with every page hidden did not ship an empty landmark. The
  // account control is always in the list now, so the landmark is never
  // empty — and a visitor of a site with no visible pages can still sign in.
  it('keeps the account control when no page document is navigable', () => {
    const { container } = renderShell({}, { pageDocs: [] });
    expect(navLabels(container)).toEqual(['Sign in']);
    // The identity still links home, so the site is never a dead end.
    expect(container.querySelector('header a[href="/"]')).not.toBeNull();
  });
});

// THE ACCOUNT CONTROL (M7 issue 2). One control at the end of the
// navigation, with two destinations and no third: sign in when nobody is
// signed in, and the reader's own profile when somebody is. It is a nav
// item, so it inherits the nav's placement, its landmark, and its keyboard
// path rather than being a second control the shell has to place twice.
describe('Layout account control', () => {
  const accountLink = (root) =>
    root.querySelector(
      'nav[aria-label="Main"] a[href="/signin"], nav[aria-label="Main"] a[href="/dashboard"]',
    );

  it('offers sign-in to a visitor who is not signed in', () => {
    const { container } = renderShell({});
    const link = accountLink(container);
    expect(link).toHaveAttribute('href', '/signin');
    expect(link.textContent).toBe('Sign in');
    // One control, not two: a signed-out reader is never offered a dashboard.
    expect(container.querySelectorAll('nav[aria-label="Main"] a[href="/dashboard"]')).toHaveLength(0);
  });

  it('offers the dashboard to a reader who is signed in', () => {
    const { container } = renderShell({}, { user: { uid: 'u1' } });
    const link = accountLink(container);
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link.textContent).toBe('Dashboard');
    expect(container.querySelectorAll('nav[aria-label="Main"] a[href="/signin"]')).toHaveLength(0);
  });

  it('offers sign-in while the auth handshake is still in flight', () => {
    // `loading` is the tick before onAuthStateChanged has answered. The
    // control is offered rather than withheld, and Login.jsx's own
    // already-signed-in branch catches a reader who clicks during it.
    const { container } = renderShell({}, { user: null, loading: true });
    const link = accountLink(container);
    expect(link).toHaveAttribute('href', '/signin');
    expect(link.textContent).toBe('Sign in');
  });

  it('does not offer the dashboard until the handshake has actually answered', () => {
    // A user object present WHILE loading is still true is not an answer.
    const { container } = renderShell({}, { user: { uid: 'u1' }, loading: true });
    expect(accountLink(container)).toHaveAttribute('href', '/signin');
  });

  it('sits at the end of the navigation, after every page', () => {
    const { container } = renderShell({});
    const links = [...container.querySelectorAll('nav[aria-label="Main"] a')];
    expect(links.at(-1)).toBe(accountLink(container));
  });

  it('is reachable in both nav placements, as the same one control', () => {
    for (const navPlacement of ['top', 'side']) {
      const { container } = renderShell({}, { path: '/schedule', themeDoc: { navPlacement } });
      expect(container.querySelectorAll('nav[aria-label="Main"] a[href="/signin"]')).toHaveLength(1);
    }
  });

  it('keeps the keyboard path and the touch target size', () => {
    const { container } = renderShell({});
    const link = accountLink(container);
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('tabindex')).toBe(false);
    expect(link.className).toContain('touch-target');
  });

  it('marks the page in view with weight and a rule, never color alone', () => {
    const { container } = renderShell({}, { path: '/signin' });
    const link = accountLink(container);
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveClass('font-semibold', 'underline');
    // The heavier weight is the ONLY font weight in the string, so it does
    // not depend on which of two competing utilities the stylesheet happens
    // to emit last — jsdom applies no CSS and could never catch that.
    expect(link).not.toHaveClass('font-medium');
    expect(link.className.split(/\s+/).filter((c) => /^font-(?:medium|semibold|bold)$/.test(c)))
      .toEqual(['font-semibold']);

    // ...and carries neither marker anywhere else.
    const { container: elsewhere } = renderShell({}, { path: '/travel' });
    const away = accountLink(elsewhere);
    expect(away).not.toHaveAttribute('aria-current');
    expect(away).not.toHaveClass('font-semibold', 'underline');
  });

  it('marks the dashboard in view for a signed-in reader', () => {
    const { container } = renderShell({}, { path: '/dashboard', user: { uid: 'u1' } });
    expect(accountLink(container)).toHaveAttribute('aria-current', 'page');
  });

  it('stays marked on a route below the dashboard', () => {
    // The dashboard owns no children today. When it does, the control has
    // to go on saying where the reader is — the same rule SYSTEM_PAGES
    // applies to every section that owns a subtree (lib/siteNavigation.js).
    const { container } = renderShell({}, { path: '/dashboard/settings', user: { uid: 'u1' } });
    expect(accountLink(container)).toHaveAttribute('aria-current', 'page');
  });

  it('does not claim a route that merely starts with the sign-in path', () => {
    const { container } = renderShell({}, { path: '/signin/help' });
    expect(accountLink(container)).not.toHaveAttribute('aria-current');
  });
});

// THE FOOTER (M7 issue 3). The same page list the navigation carries, the
// organization that operates the event, how to reach it, and whatever social
// accounts the event has recorded — every one of them read from data, none of
// them written here.
describe('Layout footer', () => {
  const footer = (root) => root.querySelector('footer');
  // Both footer lists are navigation landmarks, told apart by their label —
  // the same way a reader's landmark list tells them apart.
  const PAGE_NAV = 'nav[aria-label="Site pages"]';
  const SOCIAL_NAV = 'nav[aria-label="Social accounts"]';
  const socialNav = (root) => footer(root).querySelector(SOCIAL_NAV);
  const socialLinks = (root) => socialNav(root).querySelectorAll('a');
  const footerLinks = (root) =>
    [...footer(root).querySelectorAll(`${PAGE_NAV} a`)].map((a) => ({
      label: a.textContent,
      href: a.getAttribute('href'),
    }));

  it('lists the same pages the navigation lists, in the same order', () => {
    const { container } = renderShell({});
    expect(footerLinks(container)).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Schedule', href: '/schedule' },
      { label: 'Travel', href: '/travel' },
      { label: 'FAQ', href: '/faq' },
    ]);
  });

  it('applies the navigation’s own gates rather than a second set', () => {
    const { container } = renderShell(
      {},
      {
        featureFlags: {},
        pageDocs: [
          ...FIXTURE_PAGES,
          { id: 'draft', label: 'Draft page', path: '/draft', order: 6, visible: false },
        ],
      },
    );
    const labels = footerLinks(container).map((link) => link.label);
    // Hidden by the editor, and a system page whose feature is switched off.
    expect(labels).not.toContain('Draft page');
    expect(labels).not.toContain('Schedule');
    expect(labels).toContain('Travel');
  });

  it('renders no page list at all when no page is navigable', () => {
    const { container } = renderShell({}, { pageDocs: [] });
    expect(footer(container).querySelector(PAGE_NAV)).toBeNull();
  });

  it('names the operator and links the support address from config/event', () => {
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          legal: { operatorName: '[Fixture] Example Trust', supportEmail: 'help@example.org' },
        },
      },
    );
    expect(footer(container).textContent).toContain('[Fixture] Example Trust');
    expect(footer(container).querySelector('a[href="mailto:help@example.org"]')).not.toBeNull();
  });

  it('renders the social accounts config/event records, and nothing else', () => {
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', url: 'https://example.org/@fixture' },
              { platform: 'Bluesky', url: 'https://example.net/fixture' },
            ],
          },
        },
      },
    );
    const links = [...socialLinks(container)];
    expect(links.map((a) => a.textContent)).toEqual(['Mastodon', 'Bluesky']);
    expect(links[0]).toHaveAttribute('href', 'https://example.org/@fixture');
    // No target: the account opens in the tab the reader is already in, so
    // there is no opener to sever — rel="noreferrer" is here to withhold
    // the referrer, which is the whole of what it does on a same-tab link.
    expect(links[0]).not.toHaveAttribute('target');
    expect(links[0]).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders no social block when the event sets no handles', () => {
    // The common case: config/event carries `social.handles: []` on a fresh
    // deployment, and a runtime document can drop the field entirely.
    for (const social of [undefined, {}, { handles: [] }, { handles: 'nope' }]) {
      const { container } = renderShell({}, { event: { ...FIXTURE_EVENT, social } });
      expect(socialNav(container)).toBeNull();
    }
  });

  it('drops a handle it cannot turn into a safe link', () => {
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', url: 'https://example.org/@fixture' },
              { platform: 'Bad', url: 'javascript:alert(1)' },
              { platform: 'No address' },
              { url: 'https://example.org/unnamed' },
              'not an object',
            ],
          },
        },
      },
    );
    expect([...socialLinks(container)].map((a) => a.textContent)).toEqual(['Mastodon']);
  });

  it('trims a platform name and caps how long it can be', () => {
    // config/event is an unvalidated fail-soft overlay (§2.4): a runtime
    // document can carry a platform name of any length, and a footer that
    // renders it verbatim hands one bad write the whole bottom of the site.
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: '  Mastodon  ', url: 'https://example.org/@fixture' },
              { platform: 'M'.repeat(400), url: 'https://example.net/fixture' },
            ],
          },
        },
      },
    );
    const labels = [...socialLinks(container)].map((a) => a.textContent);
    expect(labels[0]).toBe('Mastodon');
    expect(labels[1]).toHaveLength(40);
    expect(labels[1]).toBe('M'.repeat(40));
  });

  it('drops a platform name that is only whitespace', () => {
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: { handles: [{ platform: '   ', url: 'https://example.org/@fixture' }] },
        },
      },
    );
    expect(socialNav(container)).toBeNull();
  });

  it('renders one link for a handle recorded twice', () => {
    // Two identical entries are one account said twice; a repeated link is
    // noise a reader has to resolve (the rule buildNavItems already applies
    // to a duplicated route).
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', url: 'https://example.org/@fixture' },
              { platform: 'Mastodon', url: 'https://example.org/@fixture' },
            ],
          },
        },
      },
    );
    expect([...socialLinks(container)]).toHaveLength(1);
  });

  it('renders one link for two spellings of one address', () => {
    // A URL is a string in the document but an address to a reader, and
    // `https://example.org` and `https://example.org/` are the same address.
    // The dedupe therefore runs on the canonical href, not on the raw text
    // an operator happened to type.
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', handle: '@fixture', url: 'https://example.org' },
              { platform: 'Mastodon', handle: '@fixture', url: 'https://example.org/' },
            ],
          },
        },
      },
    );
    const links = [...socialLinks(container)];
    expect(links).toHaveLength(1);
    // And the href is the canonical form, so the check and the link agree.
    expect(links[0]).toHaveAttribute('href', 'https://example.org/');
  });

  it('names the handle beside the platform, so two accounts read apart', () => {
    // config/event records `{ platform, handle, url }` (ADR 0001 §config).
    // An event with two accounts on one service is the case that needs the
    // handle: without it both links read “Mastodon” and a reader cannot tell
    // which is which.
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', handle: '@summit', url: 'https://example.org/@summit' },
              { platform: 'Mastodon', handle: '@newsroom', url: 'https://example.org/@newsroom' },
              // No handle recorded: the platform name stands alone.
              { platform: 'Bluesky', url: 'https://example.net/fixture' },
            ],
          },
        },
      },
    );
    expect([...socialLinks(container)].map((a) => a.textContent)).toEqual([
      'Mastodon @summit',
      'Mastodon @newsroom',
      'Bluesky',
    ]);
  });

  it('trims a handle and caps how long it can be', () => {
    // Same fail-soft rule the platform name gets (§2.4): a runtime document
    // can carry a handle of any length, and a handle that is only whitespace
    // is not a handle.
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', handle: '  @fixture  ', url: 'https://example.org/a' },
              { platform: 'Bluesky', handle: '   ', url: 'https://example.org/b' },
              { platform: 'Long', handle: 'h'.repeat(400), url: 'https://example.org/c' },
              { platform: 'Wrong type', handle: 42, url: 'https://example.org/d' },
            ],
          },
        },
      },
    );
    const labels = [...socialLinks(container)].map((a) => a.textContent);
    expect(labels[0]).toBe('Mastodon @fixture');
    expect(labels[1]).toBe('Bluesky');
    expect(labels[2]).toBe(`Long ${'h'.repeat(40)}`);
    expect(labels[3]).toBe('Wrong type');
  });

  it('keeps two accounts that share one address', () => {
    // One profile page can be reached under two names, and two names can
    // point at one page. Neither half of the pair is a key on its own.
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          social: {
            handles: [
              { platform: 'Mastodon', url: 'https://example.org/@fixture' },
              { platform: 'Fediverse', url: 'https://example.org/@fixture' },
            ],
          },
        },
      },
    );
    expect([...socialLinks(container)].map((a) => a.textContent)).toEqual([
      'Mastodon',
      'Fediverse',
    ]);
  });

  it('gives every footer link a keyboard path at the full touch target size', () => {
    const { container } = renderShell(
      {},
      {
        event: {
          ...FIXTURE_EVENT,
          legal: { operatorName: '[Fixture] Example Trust', supportEmail: 'help@example.org' },
          social: { handles: [{ platform: 'Mastodon', url: 'https://example.org/@fixture' }] },
        },
      },
    );
    for (const link of footer(container).querySelectorAll('a')) {
      expect(link).toHaveAttribute('href');
      expect(link.hasAttribute('tabindex')).toBe(false);
      expect(link.className).toContain('touch-target');
    }
  });
});

// BACK TO TOP (M7 issue 6). The shell names the top of the page and the
// footer, and mounts the control between them; BackToTop.test.jsx covers
// what the control itself does.
describe('Layout back-to-top', () => {
  const backToTop = (root) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Back to top');

  function renderScrolled() {
    window.innerHeight = 800;
    window.scrollY = 2000;
    window.scrollTo = vi.fn();
    return renderShell({});
  }

  it('names the top of the page as a focus target, outside the tab order', () => {
    const { container } = renderShell({});
    const banner = container.querySelector('header#site-top');
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute('tabindex', '-1');
  });

  it('keeps the skip link first, ahead of the banner it names', () => {
    const { container } = renderShell({});
    const skip = container.querySelector('a.skip-link');
    const banner = container.querySelector('header#site-top');
    expect(skip.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('names the footer, so the control can withdraw over it', () => {
    const { container } = renderShell({});
    expect(container.querySelector('footer#site-footer')).not.toBeNull();
  });

  it('offers no control to a reader who has not scrolled', () => {
    const { container } = renderShell({});
    expect(backToTop(container)).toBeUndefined();
  });

  it('puts the control ahead of the footer, so a reader tabbing forward reaches it', () => {
    // Sequential order is the whole point. Behind the footer, the control
    // was unreachable by keyboard: tabbing to a footer link scrolls the
    // footer into view, and the control withdraws for the footer.
    try {
      const { container } = renderScrolled();
      const button = backToTop(container);
      expect(button).not.toBeUndefined();
      const footer = container.querySelector('footer#site-footer');
      expect(button.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    } finally {
      window.scrollY = 0;
    }
  });

  it('moves focus to the shell’s own banner when a reader uses it', () => {
    try {
      const { container } = renderScrolled();
      fireEvent.click(backToTop(container));
      const banner = container.querySelector('header#site-top');
      expect(document.activeElement).toBe(banner);
      expect(banner).toHaveAttribute(FOCUS_RING_ATTRIBUTE);
    } finally {
      window.scrollY = 0;
    }
  });

  // THE RING MUST NOT OVERSHOOT. tabindex="-1" makes the banner take focus
  // from a click anywhere inside it, so a rule keyed to bare :focus would
  // outline the whole header the moment a reader clicked the nameplate.
  it('does not mark the banner when a reader clicks inside the header', () => {
    const { container } = renderShell({});
    const banner = container.querySelector('header#site-top');
    fireEvent.click(banner.querySelector('a[href="/"]'));
    fireEvent.click(banner);
    expect(banner).not.toHaveAttribute(FOCUS_RING_ATTRIBUTE);
  });

  it('draws the ring on that mark rather than on the banner’s own focus', () => {
    // A property of the stylesheet, which jsdom does not apply.
    expect(indexCss).toMatch(/\[data-focus-ring\]:focus\s*\{[^}]*outline[^}]*\}/);
    expect(indexCss).not.toMatch(/#site-top:focus\s*\{/);
  });
});

describe('Layout on the stage', () => {
  // ONE FRAME, FOUR LANDMARKS. The header, the page, the footer and the
  // side rail all sit on the same stage, or the site is four widths wearing
  // one identity. jsdom measures no box, so what is asserted here is that
  // every one of them carries the class the stylesheet gives the frame —
  // and that none of them still states a width of its own beside it.
  const framed = (container) => [
    container.querySelector('header'),
    container.querySelector('#main-content'),
    container.querySelector('footer'),
  ];

  it('sets the header, the page and the footer on one stage', () => {
    const { container } = renderShell({});
    for (const landmark of framed(container)) {
      expect(landmark).not.toBeNull();
      const framedNode = landmark.classList.contains('stage') ? landmark : landmark.firstElementChild;
      expect(framedNode.classList.contains('stage'), landmark.tagName).toBe(true);
    }
  });

  it('keeps the rail on the same stage as the page it serves', () => {
    const { container } = renderShell({}, {
      pageDoc: { id: 'home', path: '/', layout: { navPlacement: 'side' } },
    });
    const main = container.querySelector('#main-content');
    expect(main.parentElement.classList.contains('stage')).toBe(true);
    expect(main.parentElement.querySelector('nav[aria-label="Main"]')).not.toBeNull();
  });

  it('states no second width beside the stage', () => {
    const { container } = renderShell({});
    for (const node of container.querySelectorAll('.stage')) {
      expect([...node.classList].filter((name) => /^max-w-/.test(name))).toEqual([]);
    }
  });

  it('runs the footer page list in columns that wrap', () => {
    const { container } = renderShell({});
    const list = container.querySelector('nav[aria-label="Site pages"] ul');
    expect(list.classList.contains('footer-links')).toBe(true);
    expect(indexCss).toMatch(/\.footer-links \{[^}]*repeat\(auto-fill, minmax\(/);
  });
});

describe('Layout variants (brief §6.1)', () => {
  it('takes the treatment the page states, over the shell’s own rule', () => {
    // An inner page that asks for the full masthead gets it...
    const { container: full } = renderShell(
      {},
      { path: '/schedule', pageDoc: { path: '/schedule', layout: { header: 'nameplate' } } },
    );
    expect(full.querySelector('.nameplate')).not.toHaveClass('nameplate--compact');
    expect(full.querySelector('.nameplate').textContent).toContain(
      '[Fixture] Example Conference 2027',
    );

    // ...and the home page that asks for the running header gets that.
    const { container: compact } = renderShell(
      {},
      { path: '/', pageDoc: { path: '/', layout: { header: 'nameplate-compact' } } },
    );
    expect(compact.querySelector('.nameplate')).toHaveClass('nameplate--compact');
  });

  it('keeps the page’s one h1 wherever the treatment moves', () => {
    // The masthead carries the <h1> on the home page because the event is
    // that page's subject — not because of which treatment it renders.
    const { container } = renderShell(
      {},
      { path: '/schedule', pageDoc: { path: '/schedule', layout: { header: 'nameplate' } } },
    );
    expect(container.querySelector('header h1')).toBeNull();
  });

  it('ignores a header value the schema does not define', () => {
    const { container } = renderShell(
      {},
      {
        path: '/schedule',
        header: 'masthead',
        pageDoc: { path: '/schedule', layout: { header: 'none' } },
      },
    );
    // There is no `none`. A page value outside the two the schema defines is
    // not an instruction to render no header: the theme's own answer stands,
    // the same way an unrecognized theme value falls to the base rather than
    // to nothing (shared/theme resolveHeader).
    expect(container.querySelector('.nameplate')).not.toBeNull();
    expect(container.querySelector('.nameplate')).not.toHaveClass('nameplate--compact');
  });

  it('moves the nav to the leading edge without changing what it is', () => {
    const { container: top } = renderShell({}, { path: '/schedule' });
    const { container: side } = renderShell(
      {},
      { path: '/schedule', themeDoc: { navPlacement: 'side' } },
    );

    // Same landmark, same items, same order — the rail is a placement, not
    // a different navigation (§8.1).
    const labels = (root) =>
      [...root.querySelectorAll('nav[aria-label="Main"] a')].map((a) => a.textContent);
    expect(labels(side)).toEqual(labels(top));
    expect(side.querySelector('nav')).toHaveAttribute('aria-label', 'Main');

    // The nav still precedes the content it navigates, so reading order and
    // the skip link both hold.
    const nav = side.querySelector('nav');
    const main = side.querySelector('main');
    expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // At narrow viewports the rail is the top nav again: every rail rule is
    // a `lg:` rule, and the hairline under it is the base state.
    expect(nav.className).toContain('border-b-hairline');
    expect(nav.className).toContain('lg:border-e-hairline');
    expect(top.querySelector('nav').className).not.toContain('lg:');
  });

  // THE SITE SETS IT FOR EVERY PAGE THAT DOES NOT SAY OTHERWISE (this
  // review). One choice is the normal case: a reader who meets a top nav on
  // the home page and a rail on the schedule by accident has been handed
  // two sites.
  it('takes the placement from config/theme on a page that states none', () => {
    const { container } = renderShell(
      {},
      { path: '/schedule', themeDoc: { navPlacement: 'side' } },
    );
    expect(container.querySelector('nav').className).toContain('lg:border-e-hairline');
  });

  // AND A PAGE MAY OVERRULE IT ON PURPOSE. The page-level value is an
  // exception an operator made in the editor's Advanced disclosure, and an
  // exception the site setting could overrule would not be an exception —
  // it would be a value the editor accepts and the shell ignores.
  it('lets a page overrule the site setting in either direction', () => {
    const { container: railed } = renderShell(
      {},
      {
        path: '/schedule',
        themeDoc: { navPlacement: 'top' },
        pageDoc: { path: '/schedule', layout: { navPlacement: 'side' } },
      },
    );
    expect(railed.querySelector('nav').className).toContain('lg:border-e-hairline');

    const { container: topped } = renderShell(
      {},
      {
        path: '/schedule',
        themeDoc: { navPlacement: 'side' },
        pageDoc: { path: '/schedule', layout: { navPlacement: 'top' } },
      },
    );
    expect(topped.querySelector('nav').className).not.toContain('lg:');
  });

  it('still honours a page that stored a placement before the setting existed', () => {
    // Deployments made before the site setting landed set it per page.
    // Refusing to read it would silently restyle their pages on upgrade,
    // which is the one thing a layout change may not do.
    const { container } = renderShell(
      {},
      { path: '/schedule', pageDoc: { path: '/schedule', layout: { navPlacement: 'side' } } },
    );
    expect(container.querySelector('nav').className).toContain('lg:border-e-hairline');
  });

  it('puts the nav across the top when neither the site nor the page says', () => {
    const { container } = renderShell({}, { path: '/schedule' });
    expect(container.querySelector('nav').className).not.toContain('lg:');
  });
});

// M7 issue 8: the event's configured registration action is a control in the
// header. It is mounted here and nowhere else in the shell, so the shell's
// own tests hold both halves of the rule — a configured destination puts one
// control in the header, and no destination puts none. A header never
// carries a register control that goes nowhere.
describe('Layout registration action (M7 issue 8)', () => {
  const withAction = (registration) => ({ ...FIXTURE_EVENT, registration });

  it('renders the configured action in the header, under the label the client set', () => {
    const { container } = renderShell(
      {},
      {
        event: withAction({
          externalUrl: 'https://register.example.org/tickets',
          actionLabel: 'Get a ticket',
        }),
      },
    );
    const link = container.querySelector('header a[href="https://register.example.org/tickets"]');
    expect(link).not.toBeNull();
    // The link's words are the client's label; the hidden half tells a
    // screen reader that the tab will change (issue 236).
    expect(link.textContent).toBe('Get a ticket (opens in a new tab)');
  });

  it('keeps its own distance from the navigation in the one row treatment', () => {
    // `minimal` puts the identity, the navigation and this control in ONE
    // flex row, and the shell's sign-in control goes at the END of that
    // navigation — so a register control with no separation of its own
    // would sit one gap from a sign-in link and the two would read as one
    // pair. It is a sibling of the nav, never inside it, and it takes the
    // trailing edge of the row.
    const { container } = renderShell(
      {},
      {
        header: 'minimal',
        event: withAction({ externalUrl: 'https://register.example.org/tickets' }),
      },
    );
    const link = container.querySelector('header a[href="https://register.example.org/tickets"]');
    expect(link.closest('nav')).toBeNull();
    expect(link.parentElement.className).toContain('ms-auto');
    const row = container.querySelector('header nav').parentElement;
    expect(row.className).toContain('flex');
    expect(row).toContainElement(link);
  });

  it('renders no control at all when no destination is configured', () => {
    for (const registration of [undefined, {}, { externalUrl: null }, { actionLabel: 'Register' }]) {
      const { container, unmount } = renderShell({}, { event: withAction(registration) });
      const header = container.querySelector('header');
      expect(header.textContent).not.toContain('Register');
      expect(header.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
      unmount();
    }
  });
});
