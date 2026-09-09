// The shell: the header the active theme names (design brief §2.1) and the
// branding slot (issue #24 review follow-up).
//
// config/theme.logos holds two shapes and they do not resolve the same way:
// a seeded flat path also ships in the bundle and is served Hosting-relative,
// while an asset picked in the admin Branding tab exists ONLY in the bucket —
// serving that Hosting-relative (what the shell did before the media library)
// 404s the header logo. A value that is not a usable path, or an object that
// has since been deleted, must degrade to the wordmark.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
  { id: 'home', label: 'Home page', path: '/', order: 0, visible: true, systemPage: true },
  { id: 'schedule', label: 'Schedule', path: '/schedule', order: 1, visible: true, systemPage: true },
  { id: 'travel', label: 'Travel and venue', path: '/travel', order: 4, visible: true, systemPage: false },
  { id: 'faq', label: 'Frequently asked questions', path: '/faq', order: 5, visible: true, systemPage: false },
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
  const navLabels = (root) => [...root.querySelectorAll('nav a')].map((a) => a.textContent);

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
    expect(navLabels(container)).toContain('Travel and venue');
    expect(navLabels(container)).not.toContain('Draft page');
  });

  it('reads the labels and the order from the page documents', () => {
    const { container } = renderShell({});
    // The page documents in their own order, then the account control the
    // shell adds at the end of the list (M7 issue 2).
    expect(navLabels(container)).toEqual([
      'Home page',
      'Schedule',
      'Travel and venue',
      'Frequently asked questions',
      'Sign in',
    ]);
    expect([...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))).toEqual([
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
    expect(navLabels(container)).toContain('Travel and venue');
  });

  it('marks the page in view, and only that one, on a content page', () => {
    const { container } = renderShell({}, { path: '/travel' });
    const current = [...container.querySelectorAll('nav a[aria-current="page"]')];
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe('Travel and venue');
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
    for (const link of container.querySelectorAll('nav a')) {
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
    root.querySelector('nav a[href="/signin"], nav a[href="/profile"]');

  it('offers sign-in to a visitor who is not signed in', () => {
    const { container } = renderShell({});
    const link = accountLink(container);
    expect(link).toHaveAttribute('href', '/signin');
    expect(link.textContent).toBe('Sign in');
    // One control, not two: a signed-out reader is never offered a profile.
    expect(container.querySelectorAll('nav a[href="/profile"]')).toHaveLength(0);
  });

  it('offers the profile to a reader who is signed in', () => {
    const { container } = renderShell({}, { user: { uid: 'u1' } });
    const link = accountLink(container);
    expect(link).toHaveAttribute('href', '/profile');
    expect(link.textContent).toBe('Your profile');
    expect(container.querySelectorAll('nav a[href="/signin"]')).toHaveLength(0);
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

  it('does not offer the profile until the handshake has actually answered', () => {
    // A user object present WHILE loading is still true is not an answer.
    const { container } = renderShell({}, { user: { uid: 'u1' }, loading: true });
    expect(accountLink(container)).toHaveAttribute('href', '/signin');
  });

  it('sits at the end of the navigation, after every page', () => {
    const { container } = renderShell({});
    const links = [...container.querySelectorAll('nav a')];
    expect(links.at(-1)).toBe(accountLink(container));
  });

  it('is reachable in both nav placements, as the same one control', () => {
    for (const navPlacement of ['top', 'side']) {
      const { container } = renderShell({}, { path: '/schedule', themeDoc: { navPlacement } });
      expect(container.querySelectorAll('nav a[href="/signin"]')).toHaveLength(1);
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

  it('marks the profile page in view for a signed-in reader', () => {
    const { container } = renderShell({}, { path: '/profile', user: { uid: 'u1' } });
    expect(accountLink(container)).toHaveAttribute('aria-current', 'page');
  });

  it('stays marked on a route below the profile', () => {
    // /profile owns no children today. When it does, the control has to go
    // on saying where the reader is — the same rule SYSTEM_PAGES applies to
    // every section that owns a subtree (lib/siteNavigation.js).
    const { container } = renderShell({}, { path: '/profile/settings', user: { uid: 'u1' } });
    expect(accountLink(container)).toHaveAttribute('aria-current', 'page');
  });

  it('does not claim a route that merely starts with the sign-in path', () => {
    const { container } = renderShell({}, { path: '/signin/help' });
    expect(accountLink(container)).not.toHaveAttribute('aria-current');
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
    const labels = (root) => [...root.querySelectorAll('nav a')].map((a) => a.textContent);
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
