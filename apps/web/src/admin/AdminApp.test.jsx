// Admin route gating (issues #13–#15): the client-side gate mirrors the
// server's admin definition — a verified admin email on config/bootstrap,
// which the browser learns only by probing an admin-only read (AuthContext's
// isAdmin). The server (requireAdmin) and firestore.rules remain the
// enforcement; these tests pin the UI's three states.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
}));
vi.mock('../lib/profileSource.js', () => ({
  subscribeOwnProfile: () => () => {},
}));
vi.mock('./adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    onNext([]);
    return () => {};
  },
}));

// Auth state is decided before render: a visitor who is already signed in
// when they open /admin is the case that matters, and rendering signed-out
// first would bounce through /signin.
let currentUser = null;
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next(currentUser);
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

// The isAdmin probe: resolving means firestore.rules allowed the admin-only
// drafts read (i.e. an admin); rejecting means it did not.
let adminProbeShouldSucceed = true;
// When set, the probe hangs until the test settles it — the window in which
// the auth handshake has finished but admin-ness is still unknown.
let pendingProbe = null;
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => {
    if (pendingProbe) {
      return new Promise((resolve, reject) => {
        pendingProbe = { resolve, reject };
      });
    }
    return adminProbeShouldSucceed
      ? Promise.resolve({ docs: [] })
      : Promise.reject(new Error('permission denied'));
  }),
}));

import App from '../App.jsx';

async function renderAt(path) {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  // Let the isAdmin probe settle before asserting.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  adminProbeShouldSucceed = true;
  pendingProbe = null;
  currentUser = { uid: 'admin-1', email: 'admin@example.org', getIdToken: async () => 'id-token' };
});

describe('admin route gating', () => {
  it('routes an unauthenticated visitor to sign-in instead of the admin area', async () => {
    currentUser = null;
    await renderAt('/admin/pages');
    expect(await screen.findByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
  });

  it('denies a signed-in non-admin cleanly, with no retry affordance', async () => {
    adminProbeShouldSucceed = false;
    currentUser = { uid: 'attendee-1', email: 'attendee@example.org' };
    await renderAt('/admin/pages');

    expect(
      screen.getByRole('heading', { name: 'You don’t have admin access' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
  });

  it('renders the admin shell for an admin, defaulting to the pages list', async () => {
    await renderAt('/admin');

    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pages' })).toBeInTheDocument();
    // Every settings surface is reachable from the shell.
    for (const tab of [
      'Pages',
      'Content',
      'Event',
      'Features',
      'Badges',
      'Branding',
      'Live updates',
      'Feedback',
      'System errors',
    ]) {
      expect(screen.getByRole('link', { name: tab })).toBeInTheDocument();
    }
    // The signed-in identity is shown, so an operator can tell which account
    // the server will see.
    expect(screen.getByText('admin@example.org')).toBeInTheDocument();
  });

  it('keeps unknown admin routes inside the admin shell', async () => {
    await renderAt('/admin/nope');
    expect(screen.getByRole('heading', { name: 'Admin page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
  });

  it('waits for the admin probe instead of flashing the denial at an admin', async () => {
    // AuthContext.loading covers the auth handshake only, and it goes false
    // before the probe answers. A gate that read isAdmin at that instant
    // would show "you don't have admin access" to every admin, every load.
    pendingProbe = true;
    await renderAt('/admin/pages');

    expect(screen.queryByRole('heading', { name: 'You don’t have admin access' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Checking your access…' })).toBeInTheDocument();

    await act(async () => {
      pendingProbe.resolve({ docs: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
  });

  it('denies once the probe actually answers no', async () => {
    pendingProbe = true;
    await renderAt('/admin/pages');
    await act(async () => {
      pendingProbe.reject(new Error('permission denied'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'You don’t have admin access' }),
    ).toBeInTheDocument();
  });

  it('does not gate the public site behind the admin routes', async () => {
    await renderAt('/');
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
  });
});
