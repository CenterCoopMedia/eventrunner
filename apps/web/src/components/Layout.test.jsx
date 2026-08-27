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

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({
    eventConfig,
    features: {},
    theme,
  }),
}));
// The shell reads the current URL's page document for the two layout
// variants it owns: which nameplate treatment the page takes, and where its
// navigation sits (brief §6.1). A route with no document keeps the shell's
// own rule, which is what these tests render unless they set one.
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ getPage: (key) => (page && page.path === key ? page : null) }),
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

function renderShell(
  logos,
  { path = '/', event = FIXTURE_EVENT, pageDoc = null, themeDoc = null, header } = {},
) {
  theme = { logos, header, ...themeDoc };
  eventConfig = event;
  page = pageDoc;
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
