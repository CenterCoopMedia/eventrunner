// Admin route gating (issues #13–#15): the client-side gate mirrors the
// server's admin definition — a verified admin email on config/bootstrap,
// which the browser learns only by probing an admin-only read (AuthContext's
// isAdmin). The server (requireAdmin) and firestore.rules remain the
// enforcement; these tests pin the UI's three states.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
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
// The tier probe (issue #186): resolving means the rules allowed the
// operator-only admin_logs read; rejecting means staff.
let operatorProbeShouldSucceed = true;
// When set, the drafts probe hangs until the test settles it — the window
// in which the auth handshake has finished but admin-ness is still unknown.
let pendingProbe = null;
// When set, the TIER probe hangs while the drafts probe answers at once —
// the window in which admin-ness is known but the tier is not.
let pendingOperatorProbe = null;
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  query: vi.fn((ref) => ref),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn((ref) => {
    if (ref?.name === 'admin_logs') {
      if (pendingOperatorProbe) {
        return new Promise((resolve, reject) => {
          pendingOperatorProbe = { resolve, reject };
        });
      }
      return operatorProbeShouldSucceed
        ? Promise.resolve({ docs: [] })
        : Promise.reject(new Error('permission denied'));
    }
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
  await waitFor(
    () => expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument(),
    { timeout: 10_000 },
  );
  return result;
}

beforeEach(() => {
  adminProbeShouldSucceed = true;
  operatorProbeShouldSucceed = true;
  pendingProbe = null;
  pendingOperatorProbe = null;
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
      'Sessions',
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

  // The two tiers (issue #186). The rules decide the tier the same way they
  // decide admin-ness, and the shell draws only what that tier may reach.
  it('gives a staff admin the content, people and operations sections and none of the operator’s', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin');

    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pages' })).toBeInTheDocument();
    for (const tab of ['Pages', 'Sessions', 'Content', 'Media', 'Materials', 'Speakers', 'Attendees', 'Badges', 'Live updates', 'Ticketing', 'Feedback', 'Event']) {
      expect(screen.getByRole('link', { name: tab })).toBeInTheDocument();
    }
    for (const tab of ['Features', 'Branding', 'Access', 'System errors']) {
      expect(screen.queryByRole('link', { name: tab })).toBeNull();
    }
    // The tier is said in a word beside the address, never left to inference.
    expect(screen.getByText('Staff')).toBeInTheDocument();
  });

  it('refuses a staff admin an operator route rather than only hiding its link', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin/branding');

    expect(
      screen.getByRole('heading', { name: 'This section needs operator access' }),
    ).toBeInTheDocument();
    // Still inside the shell: the rail stays beside the refusal.
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Branding' })).toBeNull();
  });

  it('keeps a staff admin on the content paths, editors included', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin/pages/new');
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
  });

  it('waits for the tier probe too, so the docket never draws the staff set and then grows', async () => {
    // The drafts probe answers at once and the TIER probe hangs: the gate
    // must still be checking, because a docket drawn before the tier is
    // known would be the staff docket for every operator, for a tick.
    pendingOperatorProbe = true;
    adminProbeShouldSucceed = true;
    await renderAt('/admin/pages');
    expect(screen.getByRole('status', { name: 'Checking your access…' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
    expect(screen.queryByText('Staff')).toBeNull();

    await act(async () => {
      pendingOperatorProbe.resolve({ docs: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Branding' })).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
  });

  it('refuses a staff admin an operator route spelled in another case or percent-encoded', async () => {
    // React Router matches /admin/Branding to the Branding page; the shell
    // must refuse it the same way it refuses /admin/branding.
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    for (const path of ['/admin/Branding', '/admin/%41ccess']) {
      const { unmount } = await renderAt(path);
      expect(
        screen.getByRole('heading', { name: 'This section needs operator access' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Branding' })).toBeNull();
      expect(screen.queryByRole('heading', { level: 1, name: 'Access' })).toBeNull();
      unmount();
    }
  });

  it('names the staff sections in the refusal, Event included, in the rail’s own words', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin/features');
    const refusal = screen.getByRole('heading', { name: 'This section needs operator access' }).parentElement;
    expect(refusal.textContent).toContain('Pages, Sessions, Content, Media, Materials, Speakers, Attendees, Badges, Live updates, Ticketing, Feedback and Event');
    expect(refusal.textContent).not.toMatch(/deployment settings/);
  });
});
