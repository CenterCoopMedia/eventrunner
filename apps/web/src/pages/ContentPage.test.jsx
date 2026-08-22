// Pages tests (spec §5.2, issue #52): Home renders its cmsPages sections
// through the block registry, generic pages render at their own root-level
// `path` via the catch-all route, and unknown paths get the same designed
// 404 used everywhere else on the site.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Credential-free (spec §8.1): stub the provider seams so no Firebase env or
// network is needed — same approach as App.test.jsx. contentSource's
// subscription callback is captured so a couple of tests can push a fake
// cmsPages overlay (a stale /p/... doc, a doc under a reserved prefix) that
// could never round-trip through cmsSavePage today, matching data already
// sitting in Firestore from before issue #52.
const { subscriptions, subscribeContentCollection } = vi.hoisted(() => {
  const subscriptions = new Map();
  return {
    subscriptions,
    subscribeContentCollection: vi.fn((name, readSource, onNext) => {
      subscriptions.set(name, onNext);
      return () => subscriptions.delete(name);
    }),
  };
});
vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection,
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../firebase.js', () => ({
  app: {}, auth: {}, db: {}, storage: {},
  // App Check is unconfigured in a credential-free run, which is also its
  // production default: no site key, no attestation header (issue #45).
  appCheckEnabled: false,
  appCheckHeaders: async () => ({}),
}));

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

  it('404s a live/draft doc still carrying the retired /p/ path, not renders it', () => {
    renderAt('/p/faq');
    act(() => {
      subscriptions.get('cmsPages')([
        ...pagesData,
        {
          id: 'legacy-faq',
          label: 'Legacy FAQ',
          path: '/p/faq',
          icon: null,
          order: 99,
          visible: true,
          systemPage: false,
          sections: [],
        },
      ]);
    });
    // validatePageDoc would refuse this path on a save today, but the doc
    // could still be sitting in Firestore from before issue #52 — the
    // router must not trust it just because it matched.
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legacy FAQ' })).not.toBeInTheDocument();
  });

  it('404s a doc saved under a reserved prefix like /signin/help', () => {
    renderAt('/signin/help');
    act(() => {
      subscriptions.get('cmsPages')([
        ...pagesData,
        {
          id: 'signin-help',
          label: 'Sign-in help',
          path: '/signin/help',
          icon: null,
          order: 99,
          visible: true,
          systemPage: false,
          sections: [],
        },
      ]);
    });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign-in help' })).not.toBeInTheDocument();
  });

  it('leaves a normal root-level page unaffected by the reserved-path check', () => {
    renderAt('/faq');
    act(() => {
      subscriptions.get('cmsPages')(pagesData);
    });
    const faqPage = pagesData.find((p) => p.id === 'faq');
    expect(
      screen.getByRole('heading', { level: 1, name: faqPage.label }),
    ).toBeInTheDocument();
  });
});
