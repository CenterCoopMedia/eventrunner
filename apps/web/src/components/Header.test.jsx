// The four public headers (design brief §2.1).
//
// One contract, four treatments. Every one of them draws the site identity
// and the navigation, none of them is a heading, and none of them puts text
// over an image.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { THEME_HEADERS } from 'shared/theme';
import Header from './Header.jsx';

const PROPS = {
  name: '[Fixture] Harbour Summit',
  dates: 'October 14–16, 2026',
  place: 'Fixtureville, FX',
};

function renderHeader(props = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Header {...PROPS} {...props}>
        <nav aria-label="Main">
          <a href="/schedule">Schedule</a>
        </nav>
      </Header>
    </MemoryRouter>,
  );
}

describe('Header, every treatment', () => {
  it.each([...THEME_HEADERS])('%s carries the identity and the navigation', (variant) => {
    renderHeader({ variant });
    expect(screen.getByRole('link', { name: /Harbour Summit/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it.each([...THEME_HEADERS])('%s leaves the page its own h1', (variant) => {
    renderHeader({ variant });
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it.each([...THEME_HEADERS])('%s never puts text over an image', (variant) => {
    const { container } = renderHeader({
      variant,
      mark: <img src="/branding/mark.svg" alt="" />,
    });
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
  });
});

describe('Header treatments', () => {
  it('standard states the name, the dates, and the place, at normal weight', () => {
    const { container } = renderHeader({ variant: 'standard' });
    expect(screen.getByText('[Fixture] Harbour Summit')).toBeInTheDocument();
    expect(container.textContent).toContain('October 14–16, 2026');
    expect(container.textContent).toContain('Fixtureville, FX');
    // Neutral by default: no nameplate device, and the name is not bolded.
    expect(container.querySelector('.nameplate')).toBeNull();
    expect(container.querySelector('.font-semibold')).toBeNull();
  });

  it('masthead draws the nameplate device', () => {
    const { container } = renderHeader({ variant: 'masthead' });
    const plate = container.querySelector('.nameplate');
    expect(plate).not.toBeNull();
    expect(plate.classList.contains('nameplate--compact')).toBe(false);
    expect(plate.textContent).toContain('October 14–16, 2026');
    expect(plate.textContent).toContain('Fixtureville, FX');
  });

  it('compact draws the nameplate device at running-header size', () => {
    const { container } = renderHeader({ variant: 'compact' });
    const plate = container.querySelector('.nameplate');
    expect(plate).not.toBeNull();
    expect(plate.classList.contains('nameplate--compact')).toBe(true);
    expect(plate.textContent).toContain('October 14–16, 2026');
  });

  it('minimal shows the mark and the navigation, and nothing else', () => {
    const { container } = renderHeader({
      variant: 'minimal',
      mark: <img src="/branding/mark.svg" alt="" />,
    });
    expect(container.querySelector('img')).not.toBeNull();
    // The dates are not part of this treatment.
    expect(container.textContent).not.toContain('October 14–16, 2026');
    // The name is still announced, so the link is never an unlabelled image.
    expect(screen.getByRole('link', { name: '[Fixture] Harbour Summit' })).toBeInTheDocument();
  });

  it('minimal falls back to the name where a deployment has no mark', () => {
    const { container } = renderHeader({ variant: 'minimal' });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('[Fixture] Harbour Summit')).toBeInTheDocument();
  });

  it('renders the base header for a value the theme should never have stored', () => {
    // config/theme is a fail-soft overlay (spec §2.4): a bad live write must
    // not leave a page with no header at all.
    const { container } = renderHeader({ variant: 'letterpress' });
    expect(container.querySelector('.nameplate')).toBeNull();
    expect(screen.getByRole('link', { name: /Harbour Summit/ })).toBeInTheDocument();
    expect(container.textContent).toContain('October 14–16, 2026');
  });

  it('renders no dateline at all rather than an empty line', () => {
    const { container } = renderHeader({ variant: 'standard', dates: null, place: null });
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
