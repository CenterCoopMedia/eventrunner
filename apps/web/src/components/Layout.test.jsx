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

function renderShell(logos, { path = '/', event = FIXTURE_EVENT, header } = {}) {
  theme = { logos, header };
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
