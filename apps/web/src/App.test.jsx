// Smoke test: the app shell renders end to end from the committed synthetic
// snapshot — providers nest, routes resolve, and the snapshot content
// reaches the DOM with no Firebase connection (spec §2.4 first-paint path).
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
// ContentProvider's one seam to Firebase — capture each collection's
// subscription so the preview/sign-out tests below can inspect which
// readSource App asked for, and fire fake snapshots.
const contentSubscriptions = new Map();
vi.mock('./lib/contentSource.js', () => ({
  subscribeContentCollection: vi.fn((name, readSource, onNext) => {
    contentSubscriptions.set(name, { readSource, onNext });
    return () => {
      const current = contentSubscriptions.get(name);
      if (current && current.readSource === readSource) contentSubscriptions.delete(name);
    };
  }),
}));
// … and AuthProvider imports firebase.js at module scope, whose getAuth()
// throws without a real API key. Stub the instances plus the auth entry
// points AuthProvider touches on mount. onAuthStateChanged's callback is
// captured so a test can drive sign-in/sign-out; starts signed out.
let authStateCallback = null;
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    authStateCallback = next;
    next(null);
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
// AuthProvider's isAdmin probe (see AuthContext.jsx) does one getDocs read;
// resolving means "admin" (rules would allow the drafts read), rejecting
// means "not admin". Default to resolving so a signed-in user is treated as
// admin unless a test overrides it.
let adminProbeShouldSucceed = true;
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() =>
    adminProbeShouldSucceed
      ? Promise.resolve({ docs: [] })
      : Promise.reject(new Error('permission denied')),
  ),
  // AuthProvider's attendee-profile subscription (users/{uid}) — the smoke
  // test never drives it, so a no-op unsubscribe with no snapshot is enough.
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
}));
// ProfileProvider's one seam to Firebase (issue #17): capture the own-profile
// subscription so a test can push an account document, and keep the directory
// listener inert unless a test drives it.
const profileSubscriptions = new Map();
vi.mock('./lib/profileSource.js', () => ({
  subscribeOwnProfile: (uid, onNext) => {
    profileSubscriptions.set(uid, onNext);
    return () => profileSubscriptions.delete(uid);
  },
  subscribeDirectory: (_options, onNext) => {
    onNext([]);
    return () => {};
  },
  fetchPublicProfile: () => Promise.resolve(null),
  saveOwnProfile: () => Promise.resolve(),
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

beforeEach(() => {
  contentSubscriptions.clear();
  adminProbeShouldSucceed = true;
});

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

  it('gates the /attendees route and its nav link behind config/features.attendeeDirectory', () => {
    renderAt('/attendees');
    // The snapshot enables the directory; signed out with no public profiles,
    // the page asks for sign-in rather than rendering an empty directory.
    expect(
      screen.getByRole('heading', { name: 'Sign in to see who’s attending' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Attendees' })).toBeInTheDocument();

    act(() => {
      configSubscriptions.get('features')({ attendeeDirectory: false });
    });
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have an attendee directory' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Attendees' })).toBeNull();
  });

  it('?preview=1 alone (signed out) does not select the draft read source', async () => {
    render(
      <MemoryRouter
        initialEntries={['/?preview=1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );
    // Signed-out is the default auth state from the mock — no admin probe
    // resolves true, so App must not have asked for drafts.
    for (const { readSource } of contentSubscriptions.values()) {
      expect(readSource).toBe('published');
    }
  });

  it('signing out with ?preview=1 still in the URL immediately discards draft overlays and re-subscribes to published', async () => {
    render(
      <MemoryRouter
        initialEntries={['/?preview=1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );

    // Sign in as an admin: the isAdmin probe (mocked to succeed) resolves
    // asynchronously inside AuthProvider's effect.
    await act(async () => {
      authStateCallback({ uid: 'admin-1' });
      await Promise.resolve();
      await Promise.resolve();
    });
    for (const { readSource } of contentSubscriptions.values()) {
      expect(readSource).toBe('draft');
    }
    // Push a draft-only headline through the live draft overlay.
    act(() => {
      contentSubscriptions.get('cmsContent').onNext([
        {
          id: 'hero__title',
          section: 'hero',
          field: 'title',
          blockType: 'text',
          value: 'Draft-only headline',
          visible: true,
          order: 0,
        },
      ]);
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Draft-only headline' }),
    ).toBeInTheDocument();

    // Sign out — ?preview=1 is still in the URL, but authorization is gone.
    await act(async () => {
      authStateCallback(null);
      await Promise.resolve();
    });

    // App must have re-subscribed to published, discarding the draft
    // overlay: the draft-only headline is gone from the rendered output,
    // and any new subscription for the collection asks for 'published'.
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Draft-only headline' }),
    ).toBeNull();
    for (const { readSource } of contentSubscriptions.values()) {
      expect(readSource).toBe('published');
    }
    // The snapshot's real hero title is back (overlay reset to null on
    // resubscribe, so the committed snapshot stands until a fresh published
    // result arrives).
    expect(
      screen.getByRole('heading', { level: 1, name: siteContent.hero__title.value }),
    ).toBeInTheDocument();
  });

  it('a signed-in admin can still use ?preview=1 to see draft content', async () => {
    render(
      <MemoryRouter
        initialEntries={['/?preview=1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );
    await act(async () => {
      authStateCallback({ uid: 'admin-1' });
      await Promise.resolve();
      await Promise.resolve();
    });
    for (const { readSource } of contentSubscriptions.values()) {
      expect(readSource).toBe('draft');
    }
    act(() => {
      contentSubscriptions.get('cmsContent').onNext([
        {
          id: 'hero__title',
          section: 'hero',
          field: 'title',
          blockType: 'text',
          value: 'Draft-only headline',
          visible: true,
          order: 0,
        },
      ]);
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Draft-only headline' }),
    ).toBeInTheDocument();
  });
});
