// Admin route gating (issues #13–#15): the client-side gate mirrors the
// server's admin definition — a verified admin email on config/bootstrap,
// which the browser learns only by probing an admin-only read (AuthContext's
// isAdmin). The server (requireAdmin) and firestore.rules remain the
// enforcement; these tests pin the UI's three states.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
// operator-only admin_logs read; rejecting with permission-denied means
// staff. Any other rejection is a failed check, not a tier.
let operatorProbeShouldSucceed = true;
let operatorProbeError = null;
const permissionDenied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
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
      if (operatorProbeError) return Promise.reject(operatorProbeError);
      return operatorProbeShouldSucceed
        ? Promise.resolve({ docs: [] })
        : Promise.reject(permissionDenied());
    }
    if (pendingProbe) {
      return new Promise((resolve, reject) => {
        pendingProbe = { resolve, reject };
      });
    }
    return adminProbeShouldSucceed
      ? Promise.resolve({ docs: [] })
      : Promise.reject(permissionDenied());
  }),
}));

// Every admin endpoint the shell's pages call goes through this mock: the
// Access page's changes to the signed-in account, and the overview's
// figures.
const adminCall = vi.fn(() => Promise.resolve({}));
vi.mock('./adminApi.js', async () => {
  const actual = await vi.importActual('./adminApi.js');
  return { ...actual, useAdminApi: () => adminCall };
});

import App from '../App.jsx';

// The overview asks getEventStats for its figures on mount (issue #179).
const STATS = {
  readAt: '2026-10-14T13:14:00.000Z',
  registrations: { total: 9, byStatus: { pending: 1, ticketed: 2, approved: 3, revoked: 3 }, profileComplete: 4 },
  tickets: { total: 0, byStatus: { valid: 0, refunded: 0, cancelled: 0, pending_info: 0 } },
  speakers: { total: 0, byStatus: { draft: 0, invited: 0, accepted: 0, approved: 0, removed: 0 } },
  content: {},
  errors: { unresolved: 0 },
};

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
  operatorProbeError = null;
  pendingProbe = null;
  pendingOperatorProbe = null;
  adminCall.mockReset();
  adminCall.mockImplementation((name) => Promise.resolve(name === 'getEventStats' ? STATS : {}));
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

  it('renders the admin shell for an admin, opening on the overview', async () => {
    await renderAt('/admin');

    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    // /admin opens on the overview (issue #179), which reads its figures
    // from the server.
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('getEventStats', {}));
    expect(adminCall.mock.calls.filter(([name]) => name === 'getEventStats')).toHaveLength(1);
    // Every settings surface is reachable from the shell.
    for (const tab of [
      'Overview',
      'Pages',
      'Sessions',
      'Content',
      'Event',
      'Features',
      'Badges',
      'Branding',
      'Live updates',
      'Feedback',
      'Email log',
      'Change requests',
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
    // Staff open on the overview too: it is a staff section, so the first
    // page they meet is one they may open.
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    for (const tab of ['Overview', 'Pages', 'Sessions', 'Organizations', 'Content', 'Media', 'Materials', 'Speakers', 'Attendees', 'Badges', 'Live updates', 'Ticketing', 'Feedback', 'Email log', 'Change requests', 'Event']) {
      expect(screen.getByRole('link', { name: tab })).toBeInTheDocument();
    }
    for (const tab of ['Features', 'Branding', 'Access', 'System errors']) {
      expect(screen.queryByRole('link', { name: tab })).toBeNull();
    }
    // The tier is said in a word beside the address, never left to inference.
    expect(screen.getByText('Staff')).toBeInTheDocument();
  });

  it('opens the email log for a staff admin: the log is staff visible', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    adminCall.mockImplementation((name) =>
      Promise.resolve(name === 'listSentEmails' ? { rows: [], nextCursor: null, scanned: 0 } : {}),
    );
    await renderAt('/admin/email-log');

    expect(await screen.findByRole('heading', { level: 1, name: 'Email log' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Email log' })).toHaveAttribute('aria-current', 'page');
    // The page's calls go through the shell's admin call mock.
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('listSentEmails', expect.any(Object)));
  });

  it('opens change requests for a staff admin: the page loads on demand and reads the store', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin/change-requests');

    expect(await screen.findByRole('heading', { level: 1, name: 'Change requests' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Change requests' })).toHaveAttribute('aria-current', 'page');
    // The mocked listener answers with no rows.
    expect(await screen.findByText('No one has sent a change request yet.')).toBeInTheDocument();
    // The flag is off in the build-time snapshot: no form, and the notice.
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
    expect(screen.getByText('Change requests are off. An operator can turn them on under Features.')).toBeInTheDocument();
  });

  it('opens the organizations list and editor for a staff admin: organizations are content', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin/organizations');

    expect(await screen.findByRole('heading', { level: 1, name: 'Organizations' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Organizations' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getAllByRole('link', { name: 'Add an organization' })[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'New organization' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
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
    for (const path of ['/admin/Branding', '/admin/%41ccess', '/Admin/branding', '/%41dmin/branding']) {
      const { unmount } = await renderAt(path);
      expect(
        screen.getByRole('heading', { name: 'This section needs operator access' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Branding' })).toBeNull();
      expect(screen.queryByRole('heading', { level: 1, name: 'Access' })).toBeNull();
      unmount();
    }
  });

  // Connector review: only permission-denied proves staff. Any other failure
  // of the tier probe leaves the tier unknown — nothing is refused on a
  // guess, the rail says the check failed, and one press checks again.
  it('does not make an operator staff when the tier probe fails for another reason; the rail offers a retry', async () => {
    operatorProbeError = Object.assign(new Error('unavailable'), { code: 'unavailable' });
    await renderAt('/admin/branding');
    // Not refused: the server decides, and the page renders.
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Branding' })).toBeInTheDocument();
    expect(screen.queryByText('Staff')).toBeNull();
    expect(screen.queryByText('Operator')).toBeNull();
    const rail = screen.getByRole('navigation', { name: 'Admin sections' }).parentElement;
    expect(rail.textContent).toContain('Your access tier could not be checked.');

    operatorProbeError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Operator')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Access' })).toBeInTheDocument();
  });

  // Connector review: an operator who demotes or revokes THEMSELVES must see
  // the result at once — the probe is read again after the change, so the
  // rail and the route refusal follow without a new sign-in.
  it('shows the not-an-admin state at once when an operator revokes their own access', async () => {
    adminCall.mockImplementation((name) => {
      if (name === 'listAdminAccess') {
        return Promise.resolve({
          accounts: [
            { email: 'admin@example.org', tier: 'operator' },
            { email: 'second@example.org', tier: 'operator' },
          ],
          callerEmail: 'admin@example.org',
        });
      }
      // The revocation lands: from here the rules refuse every admin read.
      adminProbeShouldSucceed = false;
      operatorProbeShouldSucceed = false;
      return Promise.resolve({ ok: true, email: 'admin@example.org', tier: null, previousTier: 'operator', changed: true });
    });
    await renderAt('/admin/access');
    const row = (await screen.findByText('admin@example.org', { selector: 'span' })).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove access' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Remove access for admin@example.org' })).getByRole('button', { name: 'Remove access' }));

    expect(await screen.findByRole('heading', { name: 'You don’t have admin access' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
  });

  it('draws the staff rail and refuses the Access route at once when an operator demotes themselves', async () => {
    adminCall.mockImplementation((name) => {
      if (name === 'listAdminAccess') {
        return Promise.resolve({
          accounts: [
            { email: 'admin@example.org', tier: 'operator' },
            { email: 'second@example.org', tier: 'operator' },
          ],
          callerEmail: 'admin@example.org',
        });
      }
      operatorProbeShouldSucceed = false;
      return Promise.resolve({ ok: true, email: 'admin@example.org', tier: 'staff', previousTier: 'operator', changed: true });
    });
    await renderAt('/admin/access');
    const row = (await screen.findByText('admin@example.org', { selector: 'span' })).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Change to staff' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Change admin@example.org to staff' })).getByRole('button', { name: 'Change to staff' }));

    expect(await screen.findByRole('heading', { name: 'This section needs operator access' })).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Access' })).toBeNull();
  });

  it('names the staff sections in the refusal, Event included, in the rail’s own words', async () => {
    operatorProbeShouldSucceed = false;
    currentUser = { uid: 'staff-1', email: 'staff@example.org', getIdToken: async () => 'id-token' };
    await renderAt('/admin/features');
    const refusal = screen.getByRole('heading', { name: 'This section needs operator access' }).parentElement;
    expect(refusal.textContent).toContain('Overview, Pages, Sessions, Organizations, Content, Media, Materials, Speakers, Attendees, Badges, Live updates, Ticketing, Feedback, Email log, Change requests and Event');
    expect(refusal.textContent).not.toMatch(/deployment settings/);
  });
});
