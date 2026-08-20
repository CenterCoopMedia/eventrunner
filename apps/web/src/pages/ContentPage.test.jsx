// Pages tests (spec §5.2): Home renders its cmsPages sections through the
// block registry, /p/:slug renders non-system pages from the snapshot, and
// unknown slugs get a designed 404 empty state with one next action.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Credential-free (spec §8.1): stub the provider seams so no Firebase env or
// network is needed — same approach as App.test.jsx.
vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
}));
vi.mock('../firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

import App from '../App.jsx';
import siteContent from '@generated/siteContent.js';
import pagesData from '@generated/pagesData.js';

function renderAt(path) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

describe('Home', () => {
  it('renders the home page sections from cmsPages + cmsContent', () => {
    renderAt('/');
    // Hero from the hero section blocks.
    expect(
      screen.getByRole('heading', { level: 1, name: siteContent.hero__title.value }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: siteContent.hero__register_cta.label }),
    ).toHaveAttribute('href', siteContent.hero__register_cta.url);
    // Generic sections render with their labels from the pages snapshot.
    const home = pagesData.find((p) => p.id === 'home');
    const statsSection = home.sections.find((s) => s.id === 'stats');
    expect(
      screen.getByRole('heading', { name: statsSection.label }),
    ).toBeInTheDocument();
    // Stat blocks render value + label.
    expect(screen.getByText(siteContent.stats__attendees.label)).toBeInTheDocument();
    // Footer link group renders as a descriptive link.
    expect(
      screen.getByRole('link', { name: siteContent.footer__contact_link.label }),
    ).toHaveAttribute('href', siteContent.footer__contact_link.url);
  });
});

describe('ContentPage (/p/:slug)', () => {
  it('renders a non-system page from its sections', () => {
    renderAt('/p/faq');
    const faqPage = pagesData.find((p) => p.id === 'faq');
    expect(
      screen.getByRole('heading', { level: 1, name: faqPage.label }),
    ).toBeInTheDocument();
    // The FAQ item renders as a disclosure with its question.
    expect(screen.getByText(siteContent.faq__what_is_this.question)).toBeInTheDocument();
  });

  it('404s cleanly on an unknown slug', () => {
    renderAt('/p/definitely-not-published');
    expect(
      screen.getByRole('heading', { name: 'This page is not available' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toBeInTheDocument();
  });

  it('404s on system page ids rather than rendering them twice', () => {
    renderAt('/p/schedule');
    expect(
      screen.getByRole('heading', { name: 'This page is not available' }),
    ).toBeInTheDocument();
  });
});
