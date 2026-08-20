// Smoke test: the app shell renders end to end from the committed synthetic
// snapshot — providers nest, routes resolve, and the snapshot content
// reaches the DOM with no Firebase connection (spec §2.4 first-paint path).
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The smoke test needs no Firebase env or network (spec §8.1 credential-free
// CI): stub the two provider seams that would otherwise initialize the SDK.
// EventConfigProvider subscribes to config docs through configSource.js —
// capture each docId's callback so a test can fire a live config/features
// write and drive the feature-gated route tests below.
const configSubscriptions = new Map();
vi.mock('./lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
}));
// … and AuthProvider imports firebase.js at module scope, whose getAuth()
// throws without a real API key. Stub the instances plus the auth entry
// points AuthProvider touches on mount (signed-out stream).
vi.mock('./firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next(null);
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
import App from './App.jsx';
import { eventConfig } from '@generated/eventConfig.js';
import siteContent from '@generated/siteContent.js';

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

describe('app shell', () => {
  it('renders the home page from the snapshot', () => {
    renderAt('/');
    // Hero title comes from the generated snapshot, not hardcoded copy.
    expect(
      screen.getByRole('heading', { level: 1, name: siteContent.hero__title.value }),
    ).toBeInTheDocument();
    // Event days render from eventConfig.
    for (const day of eventConfig.days) {
      expect(screen.getByRole('heading', { name: day.label })).toBeInTheDocument();
    }
    // The skip link is the first focusable element in the shell.
    expect(screen.getByText('Skip to main content')).toHaveAttribute(
      'href',
      '#main-content',
    );
    // EventConfigProvider owns the runtime theme style element (spec §7.2).
    expect(document.getElementById('event-theme-runtime')).not.toBeNull();
    expect(document.title).toBe(eventConfig.name);
  });

  it('renders the schedule from the snapshot with sessions grouped by day', () => {
    renderAt('/schedule');
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByText('[Demo] Welcome and orientation')).toBeInTheDocument();
  });

  it('renders a designed empty state on unknown routes', () => {
    renderAt('/definitely-not-a-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeInTheDocument();
  });

  it('gates the /speakers route behind config/features.speakers, not just the nav link', () => {
    renderAt('/speakers');
    // Snapshot enables speakers, so direct navigation renders the page.
    expect(screen.getByRole('heading', { level: 1, name: 'Speakers' })).toBeInTheDocument();

    act(() => {
      configSubscriptions.get('features')({ speakers: false });
    });
    expect(screen.queryByRole('heading', { level: 1, name: 'Speakers' })).toBeNull();
    expect(
      screen.getByRole('heading', {
        name: 'This event doesn’t have a public speaker directory',
      }),
    ).toBeInTheDocument();
  });

  it('gates the /sponsors route behind config/features.sponsors, not just the nav link', () => {
    renderAt('/sponsors');
    expect(screen.getByRole('heading', { level: 1, name: 'Sponsors' })).toBeInTheDocument();

    act(() => {
      configSubscriptions.get('features')({ sponsors: false });
    });
    expect(screen.queryByRole('heading', { level: 1, name: 'Sponsors' })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have public sponsors' }),
    ).toBeInTheDocument();
  });
});
