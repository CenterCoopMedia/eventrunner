// Pages tests (spec §5.2, issue #52): Home renders its cmsPages sections
// through the block registry, generic pages render at their own root-level
// `path` via the catch-all route, and unknown paths get the same designed
// 404 used everywhere else on the site.
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
import { eventConfig } from '@generated/eventConfig.js';
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

describe('ContentPage (catch-all route)', () => {
  it('renders a non-system page at its own root-level path', () => {
    renderAt('/faq');
    const faqPage = pagesData.find((p) => p.id === 'faq');
    expect(
      screen.getByRole('heading', { level: 1, name: faqPage.label }),
    ).toBeInTheDocument();
    // The FAQ item renders as a disclosure with its question.
    expect(screen.getByText(siteContent.faq_items__what_is_this.question)).toBeInTheDocument();
  });

  it('404s cleanly on an unknown path', () => {
    renderAt('/definitely-not-published');
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toBeInTheDocument();
  });

  it('the old /p/ prefix 404s — it is retired, not redirected', () => {
    renderAt('/p/faq');
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });

  it('shows the unreviewed-template notice on the seeded legal pages (spec §5.5)', () => {
    // config/event.legal.reviewRequired is true on every fresh deployment,
    // and the public notice is one of the two places §5.1.1 puts the
    // enforcement an operator cannot miss.
    expect(eventConfig.legal.reviewRequired).toBe(true);
    renderAt('/privacy');
    expect(screen.getByRole('note')).toHaveTextContent('unreviewed template');
  });

  it('does not show the notice on a non-legal page', () => {
    renderAt('/faq');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('a system route wins over the catch-all even though both could match', () => {
    renderAt('/schedule');
    // Schedule is a dedicated route (spec §2.4), not routed through
    // ContentPage — its own page renders, not a 404 and not the generic
    // content article wrapper.
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });
});
