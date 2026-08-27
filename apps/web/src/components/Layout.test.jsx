// The shell: the masthead nameplate (design brief §2.1, §5.1) and the
// branding slot (issue #24 review follow-up).
//
// config/theme.logos holds two shapes and they do not resolve the same way:
// a seeded flat path also ships in the bundle and is served Hosting-relative,
// while an asset picked in the admin Branding tab exists ONLY in the bucket —
// serving that Hosting-relative (what the shell did before the media library)
// 404s the header logo. A value that is not a usable path, or an object that
// has since been deleted, must degrade to the wordmark.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let theme;
let eventConfig;

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({
    eventConfig,
    features: {},
    theme,
  }),
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

function renderShell(logos, { path = '/', event = FIXTURE_EVENT } = {}) {
  theme = { logos };
  eventConfig = event;
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
    // Rendered at an inner route, where the compact masthead sets the short
    // name — that short name is the wordmark the shell must fall back to.
    const { container } = renderShell(
      { mark: { url: 'branding/mark.svg' } },
      { path: '/schedule' },
    );
    expect(container.querySelector('header img')).toBeNull();
    expect(screen.getByText('EX2027')).toBeInTheDocument();
  });

  it('degrades to the wordmark when the object is gone from the bucket', () => {
    const { container } = renderShell(
      { mark: 'branding/abc123/deleted.png' },
      { path: '/schedule' },
    );
    fireEvent.error(container.querySelector('header img'));
    expect(container.querySelector('header img')).toBeNull();
    expect(screen.getByText('EX2027')).toBeInTheDocument();
  });
});

describe('Layout masthead', () => {
  it('opens every public page with the rule-bounded nameplate', () => {
    const { container } = renderShell({});
    const plate = container.querySelector('header .nameplate');
    expect(plate).not.toBeNull();
    expect(plate.textContent).toContain('April 12–14, 2027');
    expect(plate.textContent).toContain('Fixtureville, FX');
  });

  it('takes the full treatment on the home page and the compact one elsewhere', () => {
    const { container: home } = renderShell({});
    expect(home.querySelector('.nameplate')).not.toHaveClass('nameplate--compact');
    expect(home.querySelector('.nameplate').textContent).toContain(
      '[Fixture] Example Conference 2027',
    );

    const { container: inner } = renderShell({}, { path: '/schedule' });
    expect(inner.querySelector('.nameplate')).toHaveClass('nameplate--compact');
    expect(inner.querySelector('.nameplate').textContent).toContain('EX2027');
  });

  it('renders no hero banner: the masthead is type and rules only', () => {
    // The hero pattern is gone (brief §5.1) and nothing may put an image or
    // a background behind the event name.
    const { container } = renderShell({});
    expect(container.querySelector('.nameplate img')).toBeNull();
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
  });

  it('gives the home page exactly one h1, and it is the masthead', () => {
    // The home page's subject IS the event, so the nameplate carries the
    // <h1> and the page's stored lead headline follows under it.
    const { container } = renderShell({});
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveClass('nameplate__name');
  });

  it('keeps the running masthead out of the heading outline elsewhere', () => {
    // On an inner page the masthead repeats, and the page owns its own <h1>
    // (§8.1, semantic heading order).
    const { container } = renderShell({}, { path: '/schedule' });
    expect(container.querySelector('header h1')).toBeNull();
  });

  it('marks the active nav item with weight and a rule, never a pill', () => {
    const { container } = renderShell({}, { path: '/' });
    const active = container.querySelector('nav a[aria-current="page"]');
    expect(active).toHaveClass('font-semibold', 'border-b-rule-strong');
    expect(container.querySelector('nav .rounded-full')).toBeNull();
  });

  it('renders the shell with no dateline when config/event carries no days', () => {
    const { container } = renderShell({}, { event: { shortName: 'EX2027', legal: {} } });
    expect(container.querySelector('.nameplate').textContent).toContain('EX2027');
  });
});
